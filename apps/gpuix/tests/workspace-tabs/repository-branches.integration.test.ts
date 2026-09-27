/**
 * Covers: branch switching/creation, stale state and dirty-tree protection, worktree ownership.
 * Real: app Git boundaries, Git CLI and disposable repositories.
 * Doubles: none.
 * Requires: Git on PATH and writable temporary storage; no network or existing repository.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";
import { RepositoryWorktrees } from "../../src/feature/workspace-tabs/lib/repository-worktrees";
import { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";

const execute = promisify(execFile);
let sandbox: string;
let repository: string;

const git = async (...args: string[]): Promise<string> => {
	const result = await execute(
		"git",
		[
			"-c",
			"user.name=GPUIX Test",
			"-c",
			"user.email=gpuix-test@example.invalid",
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

	return result.stdout.trim();
};

beforeEach(async () => {
	sandbox = await realpath(await mkdtemp(join(tmpdir(), "gpuix-branches-")));
	repository = join(sandbox, "repository with spaces");
	await mkdir(repository);
	await git("init", "--initial-branch=main");
	await git("config", "core.fsmonitor", "false");
	await git("config", "core.hooksPath", "/dev/null");
	await writeFile(join(repository, "file.txt"), "base\n");
	await git("add", "file.txt");
	await git("commit", "-m", "Base");
	await git("branch", "feature/ui");
});
afterEach(async () => {
	await rm(sandbox, { recursive: true, force: true });
});

const switchTo = async (name: string, kind: "switch" | "create" = "switch") => {
	const result = await RepositoryReader.read(
		repository,
		new AbortController().signal
	);

	if (!result.ok) throw new Error(result.error.message);

	return await RepositoryBranches.write(repository, {
		name,
		kind,
		expectedHead: result.value.head.oid,
		expectedBranch: result.value.head.branch,
	});
};

it("lists branches, switches and creates a branch without changing committed contents", async () => {
	const read = await RepositoryBranches.read(
		repository,
		new AbortController().signal
	);

	expect(
		read.ok && read.value.branches.branches.map((item) => item.name)
	).toEqual(expect.arrayContaining(["main", "feature/ui"]));
	const switched = await switchTo("feature/ui");

	expect(switched.ok && switched.value.snapshot.head.branch).toBe("feature/ui");
	const created = await switchTo("new/branch", "create");

	expect(created.ok && created.value.snapshot.head.branch).toBe("new/branch");
	expect(await git("status", "--porcelain")).toBe("");
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe("base\n");
});

it("preserves mixed staged/unstaged and untracked work when switching or creating is blocked", async () => {
	await writeFile(join(repository, "file.txt"), "staged\n");
	await git("add", "file.txt");
	await writeFile(join(repository, "file.txt"), "unstaged\n");
	await writeFile(join(repository, "new.txt"), "untracked\n");
	const index = await git("ls-files", "--stage");
	const switched = await switchTo("feature/ui");
	const created = await switchTo("blocked", "create");

	expect(switched.ok).toBe(false);
	expect(created.ok).toBe(false);
	expect(await git("branch", "--show-current")).toBe("main");
	expect(await git("ls-files", "--stage")).toBe(index);
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(
		"unstaged\n"
	);
	expect(await readFile(join(repository, "new.txt"), "utf8")).toBe(
		"untracked\n"
	);
	expect(await git("branch", "--list", "blocked")).toBe("");
});

it("rejects stale HEAD and in-progress Git operations", async () => {
	const stale = await RepositoryBranches.write(repository, {
		kind: "switch",
		name: "feature/ui",
		expectedHead: "0".repeat(40),
		expectedBranch: "main",
	});

	expect(stale.ok).toBe(false);
	await writeFile(
		join(repository, ".git/MERGE_HEAD"),
		`${await git("rev-parse", "HEAD")}\n`
	);
	const merge = await switchTo("feature/ui");

	expect(merge.ok).toBe(false);
	expect(await git("branch", "--show-current")).toBe("main");
});

it("identifies linked worktrees and never steals their checked-out branches", async () => {
	const linked = join(sandbox, "linked worktree");

	await git("worktree", "add", linked, "feature/ui");
	const read = await RepositoryBranches.read(
		repository,
		new AbortController().signal
	);

	expect(
		read.ok && read.value.worktrees.some((item) => item.path === linked)
	).toBe(true);
	expect(
		read.ok &&
			read.value.branches.branches.find((item) => item.name === "feature/ui")
				?.worktreePath
	).toBe(linked);
	const switched = await switchTo("feature/ui");

	expect(switched.ok).toBe(false);
	expect(await git("branch", "--show-current")).toBe("main");
	expect(await git("-C", linked, "branch", "--show-current")).toBe(
		"feature/ui"
	);
});

it("reports invalid/duplicate names and cancellation without replacing existing branches", async () => {
	expect((await switchTo("bad name", "create")).ok).toBe(false);
	expect((await switchTo("feature/ui", "create")).ok).toBe(false);
	expect(
		(await RepositoryBranches.read(repository, AbortSignal.abort())).ok
	).toBe(false);
	expect(await git("branch", "--show-current")).toBe("main");
});

it("creates new and existing branch worktrees without changing source files, index or branch", async () => {
	await writeFile(join(repository, "file.txt"), "staged\n");
	await git("add", "file.txt");
	await writeFile(join(repository, "file.txt"), "unstaged\n");
	await writeFile(join(repository, "new.txt"), "untracked\n");
	const index = await git("ls-files", "--stage");
	const head = await git("rev-parse", "HEAD");

	for (const kind of ["new", "existing"] as const) {
		const branch = kind === "new" ? "new/worktree" : "feature/ui";
		const path = join(sandbox, `${kind} worktree`);

		const result = await RepositoryWorktrees.create(repository, {
			kind,
			branch,
			path,
			expectedHead: head,
			expectedBranch: "main",
		});

		expect(result).toEqual({ ok: true, value: path });
		expect(await git("-C", path, "branch", "--show-current")).toBe(branch);
		expect(await readFile(join(path, "file.txt"), "utf8")).toBe("base\n");
	}

	expect(await git("branch", "--show-current")).toBe("main");
	expect(await git("ls-files", "--stage")).toBe(index);
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(
		"unstaged\n"
	);
	expect(await readFile(join(repository, "new.txt"), "utf8")).toBe(
		"untracked\n"
	);
});

it("rejects stale state, occupied branches, existing destinations and invalid names without overwrites", async () => {
	const expectedHead = await git("rev-parse", "HEAD");

	const request = {
		kind: "new" as const,
		branch: "new/safe",
		path: join(sandbox, "safe"),
		expectedHead,
		expectedBranch: "main",
	};

	for (const change of [
		{ expectedHead: "0".repeat(40) },
		{ branch: "bad name" },
		{ branch: "feature/ui" },
		{ kind: "existing" as const, branch: "main" },
		{ kind: "existing" as const, branch: "missing" },
		{ path: repository },
		{ path: "relative" },
		{ path: join(sandbox, "missing", "child") },
	])
		expect(
			(await RepositoryWorktrees.create(repository, { ...request, ...change }))
				.ok
		).toBe(false);

	await writeFile(join(repository, ".git/MERGE_HEAD"), `${expectedHead}\n`);
	expect((await RepositoryWorktrees.create(repository, request)).ok).toBe(
		false
	);
	expect(await git("branch", "--list", "new/safe")).toBe("");
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe("base\n");
});
