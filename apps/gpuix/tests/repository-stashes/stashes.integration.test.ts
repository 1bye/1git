/**
 * Covers: saved previews, explicit stash create/apply/delete, fresh identity checks, conflicts and data preservation.
 * Real: shared Git backend, stash/diff readers, Sharp and disposable Git repositories.
 * Doubles: scheduling hooks around Git calls for concurrent external stash writes.
 * Requires: Git, Sharp and writable temporary storage; no network or graphics.
 */
import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { GitRepository } from "@1git/git";
import { GitProcess } from "@1git/git/process";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { RepositoryStashes } from "../../src/feature/repository-workspace/lib/repository-stashes";
import { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import type { WorkspaceEntry } from "../../src/feature/repository-workspace/types";
import {
	previewPixel,
	rasterContent,
	svgContent,
} from "../_shared/image-content";

const execute = promisify(execFile);
let repository: string;
const signal = (): AbortSignal => new AbortController().signal;

const git = async (...args: string[]): Promise<string> => {
	const result = await execute(
		"git",
		[
			"--literal-pathspecs",
			"-c",
			"user.name=Stash Test",
			"-c",
			"user.email=stash@example.invalid",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			...args,
		],
		{
			cwd: repository,
			env: {
				...process.env,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
			},
		}
	);

	return result.stdout.trimEnd();
};

beforeEach(async () => {
	repository = await realpath(await mkdtemp(join(tmpdir(), "gpuix-stashes-")));
	await git("init", "--initial-branch=main");
	await git("config", "core.fsmonitor", "false");
	await git("config", "user.name", "Stash Test");
	await git("config", "user.email", "stash@example.invalid");
	await git("config", "core.hooksPath", "/dev/null");
	await git("config", "commit.gpgsign", "false");
});
afterEach(async () => {
	await rm(repository, { recursive: true, force: true });
});

const files = async (oid: string) => {
	const result = await RepositoryStashes.readFiles(repository, oid, signal());

	if (!result.ok) throw new Error(result.error.message);

	return result.value;
};

async function stashFixture() {
	await writeFile(join(repository, "a.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
	const identity = {
		expectedHead: await git("rev-parse", "HEAD"),
		expectedBranch: "main",
	};

	await writeFile(join(repository, "a.txt"), "first\n");
	await git("stash", "push", "-m", "First");
	const first = await git("rev-parse", "refs/stash");

	return { identity, first };
}

it("deletes only the reviewed stash when another client inserts one after the app lookup", async () => {
	const { identity, first } = await stashFixture();
	const original = GitRepository.prototype.dropStash;
	let inserted = "";

	const drop = spyOn(GitRepository.prototype, "dropStash").mockImplementation(
		async function (this: GitRepository, input) {
			await writeFile(join(repository, "a.txt"), "second\n");
			await git("stash", "push", "-m", "Concurrent");
			inserted = await git("rev-parse", "refs/stash");

			return await original.call(this, input);
		}
	);

	try {
		const result = await RepositoryStashes.write(repository, {
			kind: "delete",
			oid: first,
			...identity,
		});

		expect(result.ok).toBe(true);
		expect(await git("stash", "list", "--format=%H")).toBe(inserted);
		expect(await git("stash", "show", "-p", inserted)).toContain("+second");
	} finally {
		drop.mockRestore();
	}
});

it("holds Git's stash lock through identity lookup and removes the last packed stash safely", async () => {
	const { identity, first } = await stashFixture();

	await git("pack-refs", "--all", "--prune");
	const original = GitProcess.prototype.run;
	let checked = false;
	let blocked = false;

	const run = spyOn(GitProcess.prototype, "run").mockImplementation(
		async function (this: GitProcess, input) {
			if (
				!checked &&
				input.args[0] === "stash" &&
				input.args[1] === "list" &&
				existsSync(join(repository, ".git/refs/stash.lock"))
			) {
				checked = true;

				try {
					await git("stash", "store", "-m", "Concurrent", first);
				} catch {
					blocked = true;
				}
			}

			return await original.call(this, input);
		}
	);

	try {
		const result = await RepositoryStashes.write(repository, {
			kind: "delete",
			oid: first,
			...identity,
		});

		expect(result.ok).toBe(true);
		expect(checked).toBe(true);
		expect(blocked).toBe(true);
		expect(await git("stash", "list")).toBe("");
		await expect(git("rev-parse", "--verify", "refs/stash")).rejects.toThrow();
		expect(await git("rev-parse", "HEAD")).toBe(identity.expectedHead);
		expect(existsSync(join(repository, ".git/refs/stash.lock"))).toBe(false);
	} finally {
		run.mockRestore();
	}
});

it("preserves a new stash inserted while cleaning up the final reviewed entry", async () => {
	const { identity, first } = await stashFixture();

	await writeFile(join(repository, "a.txt"), "concurrent saved work\n");
	const second = await git("stash", "create");

	await git("restore", "a.txt");
	const original = GitProcess.prototype.run;
	let inserted = false;

	const run = spyOn(GitProcess.prototype, "run").mockImplementation(
		async function (this: GitProcess, input) {
			if (
				!inserted &&
				input.args[0] === "update-ref" &&
				input.args.includes("refs/stash")
			) {
				inserted = true;
				await git("stash", "store", "-m", "Concurrent", second);
			}

			return await original.call(this, input);
		}
	);

	try {
		const result = await RepositoryStashes.write(repository, {
			kind: "delete",
			oid: first,
			...identity,
		});

		expect(result.ok).toBe(true);
		expect(inserted).toBe(true);
		expect(await git("stash", "list", "--format=%H")).toBe(second);
		expect(await git("stash", "show", "-p", second)).toContain(
			"+concurrent saved work"
		);
	} finally {
		run.mockRestore();
	}
});

it("creates all tracked changes, opts into untracked files, and applies without removing the stash", async () => {
	await writeFile(join(repository, "a.txt"), "base\n");
	await writeFile(join(repository, ".gitignore"), "ignored.txt\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
	const expectedHead = await git("rev-parse", "HEAD");
	const identity = { expectedHead, expectedBranch: "main" };

	await writeFile(join(repository, "a.txt"), "staged\n");
	await git("add", "a.txt");
	await writeFile(join(repository, "a.txt"), "unstaged too\n");
	await writeFile(join(repository, "new.txt"), "untracked\n");
	await writeFile(join(repository, "ignored.txt"), "ignored\n");
	expect(
		(
			await RepositoryStashes.write(repository, {
				kind: "create",
				message: "My work",
				includeUntracked: false,
				...identity,
			})
		).ok
	).toBe(true);
	expect(await readFile(join(repository, "a.txt"), "utf8")).toBe("base\n");
	expect(await readFile(join(repository, "new.txt"), "utf8")).toBe(
		"untracked\n"
	);
	expect(
		(
			await RepositoryStashes.write(repository, {
				kind: "create",
				message: "With new files",
				includeUntracked: true,
				...identity,
			})
		).ok
	).toBe(true);
	expect(await readFile(join(repository, "ignored.txt"), "utf8")).toBe(
		"ignored\n"
	);
	const oid = await git("rev-parse", "stash@{1}");

	expect(
		(
			await RepositoryStashes.write(repository, {
				kind: "apply",
				oid,
				...identity,
			})
		).ok
	).toBe(true);
	expect(await readFile(join(repository, "a.txt"), "utf8")).toBe(
		"unstaged too\n"
	);
	expect(await git("rev-parse", "stash@{1}")).toBe(oid);
	expect(
		(
			await RepositoryStashes.write(repository, {
				kind: "apply",
				oid,
				...identity,
			})
		).ok
	).toBe(false);
	expect(await readFile(join(repository, "a.txt"), "utf8")).toBe(
		"unstaged too\n"
	);
});

it("deletes the reviewed OID after reflog renumbering and rejects missing IDs or changed HEAD", async () => {
	await writeFile(join(repository, "a.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
	const identity = {
		expectedHead: await git("rev-parse", "HEAD"),
		expectedBranch: "main",
	};

	await writeFile(join(repository, "a.txt"), "first\n");
	await git("stash", "push", "-m", "First");
	const first = await git("rev-parse", "stash@{0}");

	await writeFile(join(repository, "a.txt"), "second\n");
	await git("stash", "push", "-m", "Second");
	const second = await git("rev-parse", "stash@{0}");

	expect(
		(
			await RepositoryStashes.write(repository, {
				kind: "delete",
				oid: first,
				...identity,
			})
		).ok
	).toBe(true);
	expect(await git("rev-parse", "stash@{0}")).toBe(second);
	expect(
		(
			await RepositoryStashes.write(repository, {
				kind: "delete",
				oid: first,
				...identity,
			})
		).ok
	).toBe(false);
	await git("commit", "--allow-empty", "-m", "New HEAD");
	expect(
		(
			await RepositoryStashes.write(repository, {
				kind: "delete",
				oid: second,
				...identity,
			})
		).ok
	).toBe(false);
	expect(await git("rev-parse", "stash@{0}")).toBe(second);
});

it("keeps a stash on apply conflicts and rejects empty or unborn creation", async () => {
	expect(
		(
			await RepositoryStashes.write(repository, {
				kind: "create",
				message: "",
				includeUntracked: false,
				expectedHead: null,
				expectedBranch: "main",
			})
		).ok
	).toBe(false);
	await writeFile(join(repository, "a.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
	const original = {
		expectedHead: await git("rev-parse", "HEAD"),
		expectedBranch: "main",
	};

	expect(
		(
			await RepositoryStashes.write(repository, {
				kind: "create",
				message: "",
				includeUntracked: false,
				...original,
			})
		).ok
	).toBe(false);
	await writeFile(join(repository, "a.txt"), "stashed\n");
	await git("stash", "push", "-m", "Conflict candidate");
	const oid = await git("rev-parse", "stash@{0}");

	await writeFile(join(repository, "a.txt"), "committed differently\n");
	await git("add", ".");
	await git("commit", "-m", "Conflicting base");
	expect(
		(
			await RepositoryStashes.write(repository, {
				kind: "apply",
				oid,
				expectedHead: await git("rev-parse", "HEAD"),
				expectedBranch: "main",
			})
		).ok
	).toBe(false);
	expect(await git("rev-parse", "stash@{0}")).toBe(oid);
	expect(await git("diff", "--name-only", "--diff-filter=U")).toBe("a.txt");
});

const diff = async (file: WorkspaceEntry | undefined) => {
	if (!file?.commitFile) throw new Error("Missing saved file");

	const result = await RepositoryDiff.read(
		repository,
		file.commitFile,
		signal()
	);

	if (!result.ok) throw new Error(result.error.message);

	return result.value[0];
};

it("reads both tracked and saved untracked snapshots without changing HEAD, index, working files or stashes", async () => {
	expect(await RepositoryStashes.read(repository, signal())).toEqual({
		ok: true,
		value: [],
	});

	for (const path of ["staged.txt", "working.txt", "rename.txt", "deleted.txt"])
		await writeFile(join(repository, path), `original ${path}\n`);

	await git("add", ".");
	await git("commit", "-m", "Base");
	await writeFile(join(repository, "staged.txt"), "staged snapshot\n");
	await git("add", "staged.txt");
	await writeFile(join(repository, "working.txt"), "working snapshot\n");
	await git("mv", "rename.txt", "renamed.txt");
	await git("rm", "deleted.txt");
	const unusual = "café [one]\tline\nfile.txt";

	await writeFile(join(repository, unusual), "untracked snapshot\n");
	await git("stash", "push", "-u", "-m", "Saved work");
	const oid = await git("rev-parse", "refs/stash");

	await writeFile(join(repository, "staged.txt"), "later staged\n");
	await git("add", "staged.txt");
	await writeFile(join(repository, "staged.txt"), "later working\n");
	const head = await git("rev-parse", "HEAD");
	const index = await readFile(join(repository, ".git/index"));
	const reflog = await readFile(join(repository, ".git/logs/refs/stash"));
	const list = await RepositoryStashes.read(repository, signal());

	if (!list.ok) throw new Error(list.error.message);

	expect(list.value[0]).toMatchObject({
		oid,
		reference: "stash@{0}",
		summary: "On main: Saved work",
	});
	expect(list.value[0]?.createdAt).toMatch(/^\d{4}-/u);
	const entries = await files(oid);
	const find = (path: string) => entries.find((file) => file.title === path);

	expect(entries).toHaveLength(5);
	expect((await diff(find("staged.txt")))?.patch).toContain("+staged snapshot");
	expect((await diff(find("working.txt")))?.patch).toContain(
		"+working snapshot"
	);
	expect(find("renamed.txt")?.commitFile?.originalPath).toBe("rename.txt");
	expect((await diff(find("deleted.txt")))?.patch).toContain("-original");
	expect((await diff(find(unusual)))?.patch).toContain("+untracked snapshot");
	expect(find(unusual)?.status).toBe("A");
	expect(find(unusual)?.commitFile?.commit).toBe(
		await git("rev-parse", `${oid}^3`)
	);
	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
	expect(await readFile(join(repository, ".git/logs/refs/stash"))).toEqual(
		reflog
	);
	expect(await git("rev-parse", "HEAD")).toBe(head);
	expect(await git("rev-parse", "refs/stash")).toBe(oid);
	expect(await readFile(join(repository, "staged.txt"), "utf8")).toBe(
		"later working\n"
	);
});

it("previews saved image versions and untracked SVG source even after stash references are renumbered", async () => {
	const red = await rasterContent("png", "red");
	const green = await rasterContent("png", "lime");

	await writeFile(
		join(repository, "image.png"),
		Buffer.from(red.content, "base64")
	);
	await git("add", ".");
	await git("commit", "-m", "Image");
	await writeFile(
		join(repository, "image.png"),
		Buffer.from(green.content, "base64")
	);
	await writeFile(join(repository, "icon.svg"), svgContent().content);
	await git("stash", "push", "-u", "-m", "Image snapshots");
	const oid = await git("rev-parse", "refs/stash");

	await git("rm", "image.png");
	await git("stash", "push", "-m", "Deleted image");
	const deleted = await git("rev-parse", "refs/stash");
	const entries = await files(oid);

	const comparison = (
		await diff(entries.find((file) => file.title === "image.png"))
	)?.image;

	expect(await previewPixel(comparison?.before?.image?.src ?? "")).toEqual([
		255, 0, 0, 255,
	]);
	expect(await previewPixel(comparison?.after?.image?.src ?? "")).toEqual([
		0, 255, 0, 255,
	]);
	const svg = await diff(entries.find((file) => file.title === "icon.svg"));

	expect(svg?.image?.svg).toBe(true);
	expect(svg?.image?.before).toBeNull();
	expect(svg?.patch).toContain("+<svg");
	expect((await diff((await files(deleted))[0]))?.image?.after).toBeNull();
	expect(await git("rev-parse", "stash@{1}")).toBe(oid);
});

it("keeps distinct tracked and untracked snapshots with the same path and reports invalid or cancelled reads", async () => {
	await writeFile(join(repository, "same.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
	await git("rm", "--cached", "same.txt");
	await writeFile(join(repository, "same.txt"), "untracked\n");
	await git("stash", "push", "-u", "-m", "Untrack file");
	const entries = await files(await git("rev-parse", "refs/stash"));

	expect(entries.map((file) => file.status)).toEqual(["M", "A"]);
	expect(new Set(entries.map((file) => file.id)).size).toBe(2);
	expect((await diff(entries[0]))?.patch).toContain("-base");
	expect((await diff(entries[1]))?.patch).toContain("+untracked");
	expect(
		(await RepositoryStashes.readFiles(repository, "missing-ref", signal())).ok
	).toBe(false);
	const controller = new AbortController();

	controller.abort();
	expect((await RepositoryStashes.read(repository, controller.signal)).ok).toBe(
		false
	);
});
