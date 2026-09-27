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

		if (kind === "existing") await mkdir(path);

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

it("creates explicit tracking branches from remote refs in this workspace and a new worktree", async () => {
	const expectedHead = await git("rev-parse", "HEAD");

	await git("remote", "add", "origin", repository);
	await git("config", "branch.autoSetupMerge", "false");
	await git("update-ref", "refs/remotes/origin/feature/remote", expectedHead);
	await git("update-ref", "refs/remotes/origin/feature/worktree", expectedHead);

	const result = await RepositoryBranches.write(repository, {
		kind: "remote",
		name: "refs/remotes/origin/feature/remote",
		expectedHead,
		expectedBranch: "main",
	});

	expect(result.ok).toBe(true);
	expect(await git("branch", "--show-current")).toBe("feature/remote");
	expect(await git("rev-parse", "--symbolic-full-name", "@{upstream}")).toBe(
		"refs/remotes/origin/feature/remote"
	);

	const path = join(sandbox, "remote worktree");

	const worktree = await RepositoryWorktrees.create(repository, {
		kind: "remote",
		branch: "refs/remotes/origin/feature/worktree",
		path,
		expectedHead,
		expectedBranch: "feature/remote",
	});

	expect(worktree).toEqual({ ok: true, value: path });
	expect(
		await git("-C", path, "rev-parse", "--symbolic-full-name", "@{upstream}")
	).toBe("refs/remotes/origin/feature/worktree");
	expect(await git("branch", "--show-current")).toBe("feature/remote");

	for (const name of [
		"refs/remotes/origin/feature/remote",
		"refs/remotes/origin/missing",
	]) {
		expect(
			(
				await RepositoryBranches.write(repository, {
					kind: "remote",
					name,
					expectedHead,
					expectedBranch: "feature/remote",
				})
			).ok
		).toBe(false);
		expect(
			(
				await RepositoryWorktrees.create(repository, {
					kind: "remote",
					branch: name,
					path: join(sandbox, "blocked"),
					expectedHead,
					expectedBranch: "feature/remote",
				})
			).ok
		).toBe(false);
	}
});

it("renames local branches and deletes only safe, unchanged local targets", async () => {
	const head = await git("rev-parse", "HEAD");

	const request = {
		expectedHead: head,
		expectedBranch: "main",
		expectedTarget: head,
	};

	expect(
		(
			await RepositoryBranches.write(repository, {
				...request,
				kind: "rename",
				name: "main",
				newName: "renamed",
			})
		).ok
	).toBe(true);
	expect(await git("branch", "--show-current")).toBe("renamed");
	const current = { ...request, expectedBranch: "renamed" };

	for (const change of [
		{ kind: "delete" as const, name: "renamed" },
		{ kind: "rename" as const, name: "renamed", newName: "feature/ui" },
		{ kind: "delete" as const, name: "feature/ui", expectedTarget: "stale" },
		{ kind: "delete" as const, name: "refs/remotes/origin/main" },
	])
		expect(
			(await RepositoryBranches.write(repository, { ...current, ...change })).ok
		).toBe(false);

	const linked = join(sandbox, "linked");

	await git("worktree", "add", linked, "feature/ui");

	for (const kind of ["rename", "delete"] as const) {
		expect(
			(
				await RepositoryBranches.write(repository, {
					...current,
					kind,
					name: "feature/ui",
					newName: "blocked",
				})
			).ok
		).toBe(false);
	}

	await git("worktree", "remove", linked);
	expect(
		(
			await RepositoryBranches.write(repository, {
				...current,
				kind: "delete",
				name: "feature/ui",
			})
		).ok
	).toBe(true);
	expect(await git("branch", "--list", "feature/ui")).toBe("");

	await git("switch", "-c", "unmerged");
	await writeFile(join(repository, "file.txt"), "unmerged work\n");
	await git("commit", "-am", "Unmerged work");
	const unmerged = await git("rev-parse", "HEAD");

	await git("switch", "renamed");
	expect(
		(
			await RepositoryBranches.write(repository, {
				...current,
				kind: "delete",
				name: "unmerged",
				expectedTarget: unmerged,
			})
		).ok
	).toBe(false);
	expect(await git("rev-parse", "unmerged")).toBe(unmerged);
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
