/**
 * Covers: conflict previews, explicit resolution, stale content/branch and marker rejection, unrelated staging preservation.
 * Real: Git CLI/backend and disposable conflicted repositories.
 * Doubles: none.
 * Requires: Git and writable temporary storage; no network or graphics.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { RepositoryConflicts } from "../../src/feature/repository-workspace/lib/repository-conflicts";

const execute = promisify(execFile);
let root: string;
let head: string;

const git = async (...args: string[]) =>
	(
		await execute("git", args, {
			cwd: root,
			env: {
				...process.env,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
			},
		})
	).stdout.trimEnd();

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "1git-conflicts-")));
	await git("init", "--initial-branch=main");
	await git("config", "user.name", "Test");
	await git("config", "user.email", "test@example.invalid");
	await git("config", "commit.gpgsign", "false");
	await git("config", "core.hooksPath", "/dev/null");
	await writeFile(join(root, "file.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "base");
	await git("checkout", "-b", "other");
	await writeFile(join(root, "file.txt"), "theirs\n");
	await git("commit", "-am", "other");
	await git("checkout", "main");
	await writeFile(join(root, "file.txt"), "ours\n");
	await git("commit", "-am", "ours");
	head = await git("rev-parse", "HEAD");
	await expect(git("merge", "other")).rejects.toThrow();
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const preview = async () => {
	const result = await RepositoryConflicts.read(
		root,
		"file.txt",
		new AbortController().signal
	);

	if (!result.ok || !result.value)
		throw new Error("Expected text conflict preview");

	return result.value;
};

const resolve = async (hash: string, expectedHead = head) =>
	await RepositoryConflicts.write(root, {
		path: "file.txt",
		expectedHead,
		expectedBranch: "main",
		expectedContentHash: hash,
	});

it("shows conflict markers and refuses to stage them", async () => {
	const value = await preview();

	expect(value.text).toContain("<<<<<<< HEAD");
	expect(value.ours).toMatchObject({
		text: "ours\n",
		label: "Current · main",
		revision: await git("rev-parse", ":2:file.txt"),
	});
	expect(value.theirs).toMatchObject({
		text: "theirs\n",
		label: `Incoming · ${(await git("rev-parse", "MERGE_HEAD")).slice(0, 7)}`,
		revision: await git("rev-parse", ":3:file.txt"),
	});
	const before = await git("ls-files", "--stage");
	const result = await resolve(value.hash);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.message).toContain("markers remain");

	expect(await git("ls-files", "--stage")).toBe(before);
});

it("labels rebase sources by their actual roles without changing the working conflict", async () => {
	await git("merge", "--abort");
	await expect(git("rebase", "other")).rejects.toThrow();
	const before = await git("ls-files", "--stage");
	const value = await preview();

	expect(value.ours).toMatchObject({
		text: "theirs\n",
		label: "Upstream version",
	});
	expect(value.theirs).toMatchObject({
		text: "ours\n",
		label: `Replayed commit · ${head.slice(0, 7)}`,
	});
	expect(await git("ls-files", "--stage")).toBe(before);
});

it("rejects a changed indexed source before replacing the working file", async () => {
	const value = await preview();

	await writeFile(join(root, "replacement.txt"), "changed indexed source\n");
	const oid = await git("hash-object", "-w", "replacement.txt");

	await new Promise<void>((resolve, reject) => {
		const child = execFile(
			"git",
			["update-index", "--index-info"],
			{
				cwd: root,
				env: {
					...process.env,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
				},
			},
			(error) => (error ? reject(error) : resolve())
		);

		child.stdin?.end(`100644 ${oid} 2\tfile.txt\n`);
	});
	const before = await git("ls-files", "--stage");

	const result = await RepositoryConflicts.write(root, {
		path: "file.txt",
		side: "ours",
		expectedSideOid: value.ours?.revision,
		expectedHead: head,
		expectedBranch: "main",
		expectedContentHash: value.hash,
	});

	expect(!result.ok && result.error.message).toContain(
		"indexed version changed"
	);
	expect((await preview()).text).toBe(value.text);
	expect(await git("ls-files", "--stage")).toBe(before);
});

for (const side of ["ours", "theirs"] as const) {
	it(`resolves the whole file using ${side} without committing or changing unrelated staging`, async () => {
		await writeFile(join(root, "unrelated.txt"), "staged\n");
		await git("add", "unrelated.txt");
		await writeFile(join(root, "unrelated.txt"), "unstaged\n");
		const result = await RepositoryConflicts.write(root, {
			path: "file.txt",
			expectedHead: head,
			expectedBranch: "main",
			expectedContentHash: (await preview()).hash,
			side,
		});

		expect(result.ok).toBe(true);
		expect(await git("show", ":file.txt")).toBe(side);
		expect(await git("ls-files", "--unmerged")).toBe("");
		expect(await git("show", ":unrelated.txt")).toBe("staged");
		expect(await git("rev-parse", "HEAD")).toBe(head);
		expect(await git("rev-parse", "MERGE_HEAD")).not.toBe("");
	});
}

it("refuses side replacement when the reviewed file has changed", async () => {
	const { hash } = await preview();

	await writeFile(join(root, "file.txt"), "manual edits\n");
	const result = await RepositoryConflicts.write(root, {
		path: "file.txt",
		expectedHead: head,
		expectedBranch: "main",
		expectedContentHash: hash,
		side: "theirs",
	});

	expect(result.ok).toBe(false);
	expect((await preview()).text).toBe("manual edits\n");
	expect(await git("ls-files", "--unmerged")).not.toBe("");
});

it("uses Git's index-side semantics during rebase without continuing it", async () => {
	await git("merge", "--abort");
	await expect(git("rebase", "other")).rejects.toThrow();
	const expectedHead = await git("rev-parse", "HEAD");

	const result = await RepositoryConflicts.write(root, {
		path: "file.txt",
		expectedHead,
		expectedBranch: null,
		expectedContentHash: (await preview()).hash,
		side: "ours",
	});

	expect(result.ok).toBe(true);
	expect(await git("show", ":file.txt")).toBe("theirs");
	expect(await git("rev-parse", "HEAD")).toBe(expectedHead);
	expect(await git("rev-parse", "REBASE_HEAD")).toBe(head);
});

it("stages only the reviewed file, preserving HEAD, merge state and unrelated staging", async () => {
	await writeFile(join(root, "unrelated.txt"), "staged\n");
	await git("add", "unrelated.txt");
	await writeFile(join(root, "unrelated.txt"), "unstaged\n");
	await writeFile(join(root, "file.txt"), "resolved\n");
	expect((await resolve((await preview()).hash)).ok).toBe(true);
	expect(await git("ls-files", "--unmerged")).toBe("");
	expect(await git("show", ":file.txt")).toBe("resolved");
	expect(await git("show", ":unrelated.txt")).toBe("staged");
	expect(await git("rev-parse", "HEAD")).toBe(head);
	expect(await git("rev-parse", "MERGE_HEAD")).not.toBe("");
});

it("rejects changed contents and stale branch identity", async () => {
	await writeFile(join(root, "file.txt"), "first resolution\n");
	const value = await preview();

	await writeFile(join(root, "file.txt"), "second resolution\n");
	const result = await resolve(value.hash);

	expect(result.ok).toBe(false);

	if (!result.ok)
		expect(result.error.message).toContain("changed since the preview");

	expect((await resolve((await preview()).hash, "0".repeat(40))).ok).toBe(
		false
	);
	expect(await git("ls-files", "--unmerged")).not.toBe("");
});

it("does not treat binary content as a text resolution", async () => {
	await writeFile(join(root, "file.txt"), Buffer.from([0, 1, 2]));
	const result = await RepositoryConflicts.read(
		root,
		"file.txt",
		new AbortController().signal
	);

	expect(result).toEqual({ ok: true, value: null });
	expect((await resolve("irrelevant")).ok).toBe(false);
});
