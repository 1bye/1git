/**
 * Covers: repository identity overrides/reset, linked worktrees, remote edits and validation.
 * Real: Git CLI, settings model and disposable repositories.
 * Doubles: none; no network or writes to global configuration.
 * Requires: Git executable and built workspace Git package.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepository } from "@1git/git";
import { GitSettingsModel } from "../../src/feature/git-settings/git-settings-model";

let directory: string;
let path: string;

async function git(...args: string[]): Promise<string> {
	const child = Bun.spawn(["git", ...args], {
		cwd: path,
		stdout: "pipe",
		stderr: "pipe",
	});

	const output = await new Response(child.stdout).text();

	if (await child.exited)
		throw new Error(await new Response(child.stderr).text());

	return output.trim();
}
beforeEach(async () => {
	directory = await realpath(
		await mkdtemp(join(tmpdir(), "1git-settings-git-"))
	);
	path = directory;
	await git("init", "--initial-branch=main");
	await git("config", "user.name", "Before");
	await git("config", "user.email", "before@example.invalid");
	await writeFile(join(path, "file.txt"), "original\n");
	await git("add", ".");
	await git("commit", "-m", "Initial");
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

test("saves a repository identity, preserves history and files, and resets to inherited Git config", async () => {
	const head = await git("rev-parse", "HEAD");
	const opened = await GitRepository.open({ path });

	if (!opened.ok) throw new Error(opened.error.message);

	await opened.value.unsetConfig({ key: "user.name" });
	await opened.value.unsetConfig({ key: "user.email" });
	const inherited = await GitSettingsModel.read(
		path,
		new AbortController().signal
	);

	expect(inherited).toMatchObject({ ok: true, value: { custom: false } });
	expect(
		await GitSettingsModel.write(path, {
			kind: "identity",
			custom: true,
			identity: { name: "Work", email: "work@example.invalid" },
		})
	).toMatchObject({
		ok: true,
		value: {
			custom: true,
			identity: { name: "Work", email: "work@example.invalid" },
		},
	});
	expect(
		await GitSettingsModel.write(path, {
			kind: "identity",
			custom: false,
			identity: { name: null, email: null },
		})
	).toEqual(inherited);
	expect(await git("rev-parse", "HEAD")).toBe(head);
	expect(await readFile(join(path, "file.txt"), "utf8")).toBe("original\n");
});

test("adds and edits a remote without fetching or replacing its dedicated push URL, then removes it", async () => {
	expect(
		await GitSettingsModel.write(path, {
			kind: "add-remote",
			name: "origin",
			url: "https://example.invalid/one.git",
		})
	).toMatchObject({ ok: true });
	await git(
		"remote",
		"set-url",
		"--push",
		"origin",
		"git@example.invalid:push.git"
	);
	const edited = await GitSettingsModel.write(path, {
		kind: "edit-remote",
		name: "origin",
		url: "https://example.invalid/two.git",
	});

	expect(edited).toMatchObject({
		ok: true,
		value: {
			remotes: [
				{
					name: "origin",
					fetchUrls: ["https://example.invalid/two.git"],
					pushUrls: ["git@example.invalid:push.git"],
				},
			],
		},
	});
	expect(await git("for-each-ref", "refs/remotes/")).toBe("");
	expect(
		await GitSettingsModel.write(path, {
			kind: "remove-remote",
			name: "origin",
		})
	).toMatchObject({ ok: true, value: { remotes: [] } });
});

test("shares local identity with linked worktrees and rejects credential-bearing URLs and invalid identities", async () => {
	const linked = join(directory, "linked");

	await git("worktree", "add", "-b", "feature", linked);
	expect(
		await GitSettingsModel.write(path, {
			kind: "identity",
			custom: true,
			identity: { name: "Shared", email: "shared@example.invalid" },
		})
	).toMatchObject({ ok: true });
	expect(
		await GitSettingsModel.read(linked, new AbortController().signal)
	).toMatchObject({
		ok: true,
		value: { identity: { name: "Shared", email: "shared@example.invalid" } },
	});
	expect(
		await GitSettingsModel.write(path, {
			kind: "identity",
			custom: true,
			identity: { name: "Bad\nName", email: "bad" },
		})
	).toMatchObject({ ok: false, error: { code: "invalid-input" } });
	expect(
		await GitSettingsModel.write(path, {
			kind: "add-remote",
			name: "origin",
			url: "https://user:secret@example.invalid/a.git",
		})
	).toMatchObject({ ok: false, error: { code: "invalid-input" } });
	expect(await git("remote")).toBe("");
});

test("preserves advanced worktree identities and multi-URL remotes", async () => {
	await git("config", "extensions.worktreeConfig", "true");
	await git("config", "--worktree", "user.name", "Worktree author");
	const settings = await GitSettingsModel.read(
		path,
		new AbortController().signal
	);

	expect(settings).toMatchObject({
		ok: true,
		value: {
			identity: { name: "Worktree author" },
			identityReadOnlyReason: expect.any(String),
		},
	});
	expect(
		await GitSettingsModel.write(path, {
			kind: "identity",
			custom: false,
			identity: { name: null, email: null },
		})
	).toMatchObject({ ok: false });
	expect(await git("config", "--local", "user.name")).toBe("Before");
	expect(await git("config", "--worktree", "user.name")).toBe(
		"Worktree author"
	);
	await git("remote", "add", "origin", "https://example.invalid/one.git");
	await git(
		"config",
		"--add",
		"remote.origin.url",
		"https://example.invalid/two.git"
	);
	expect(
		await GitSettingsModel.write(path, {
			kind: "edit-remote",
			name: "origin",
			url: "https://example.invalid/replacement.git",
		})
	).toMatchObject({ ok: false });
	expect(await git("config", "--get-all", "remote.origin.url")).toBe(
		"https://example.invalid/one.git\nhttps://example.invalid/two.git"
	);
});
