/**
 * Covers: branch switching/creation/merging, stale state and dirty-tree protection, worktree ownership.
 * Real: app Git boundaries, Git CLI and disposable repositories.
 * Doubles: none.
 * Requires: Git on PATH and writable temporary storage; no network or existing repository.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import {
	chmod,
	lstat,
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
import { RepositoryStashes } from "../../src/feature/repository-workspace/lib/repository-stashes";
import { RepositoryOperation } from "../../src/feature/repository-workspace/lib/repository-operation";

const execute = promisify(execFile);
let sandbox: string;
let repository: string;

// The app injects the writer as a standalone callback, without its class receiver.
const writeBranch = RepositoryBranches.write;

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
	await git("config", "user.name", "GPUIX Test");
	await git("config", "user.email", "gpuix-test@example.invalid");
	await git("config", "commit.gpgsign", "false");
	await writeFile(join(repository, "file.txt"), "base\n");
	await git("add", "file.txt");
	await git("commit", "-m", "Base");
	await git("branch", "feature/ui");
});
afterEach(async () => {
	await rm(sandbox, { recursive: true, force: true });
});

const switchTo = async (
	name: string,
	kind: "switch" | "create" = "switch",
	changes?: "leave" | "bring"
) => {
	const result = await RepositoryReader.read(
		repository,
		new AbortController().signal
	);

	if (!result.ok) throw new Error(result.error.message);

	return await writeBranch(repository, {
		name,
		kind,
		changes,
		expectedHead: result.value.head.oid,
		expectedBranch: result.value.head.branch,
	});
};

const mergeBranch = async (
	name = "refs/heads/feature/ui",
	expectedTarget?: string
) =>
	await writeBranch(repository, {
		kind: "merge",
		name,
		expectedTarget: expectedTarget ?? (await git("rev-parse", name)),
		expectedHead: await git("rev-parse", "HEAD"),
		expectedBranch: await git("branch", "--show-current"),
	});

it("merges a reviewed branch by fast-forward without switching or deleting it", async () => {
	await git("switch", "feature/ui");
	await writeFile(join(repository, "feature.txt"), "feature work\n");
	await git("add", "feature.txt");
	await git("commit", "-m", "Feature work");
	const target = await git("rev-parse", "HEAD");

	await git("switch", "main");
	const result = await mergeBranch();

	expect(result.ok && result.value.snapshot.head.branch).toBe("main");
	expect(await git("rev-parse", "HEAD")).toBe(target);
	expect(await git("rev-parse", "feature/ui")).toBe(target);
	expect(await readFile(join(repository, "feature.txt"), "utf8")).toBe(
		"feature work\n"
	);
	expect(await git("status", "--porcelain")).toBe("");
});

it("creates a normal merge commit for clean diverged branches", async () => {
	await git("switch", "feature/ui");
	await writeFile(join(repository, "feature.txt"), "feature\n");
	await git("add", "feature.txt");
	await git("commit", "-m", "Feature work");
	const target = await git("rev-parse", "HEAD");

	await git("switch", "main");
	await writeFile(join(repository, "main.txt"), "main\n");
	await git("add", "main.txt");
	await git("commit", "-m", "Main work");
	const previous = await git("rev-parse", "HEAD");
	const result = await mergeBranch();

	expect(result.ok).toBe(true);
	expect(await git("branch", "--show-current")).toBe("main");
	expect(await git("show", "-s", "--format=%P", "HEAD")).toBe(
		`${previous} ${target}`
	);
	expect(await git("show", "-s", "--format=%s", "HEAD")).toBe(
		"Merge branch 'feature/ui' into main"
	);
	expect(await git("status", "--porcelain")).toBe("");
});

it("exposes merge conflicts for recovery and can abort without changing either branch", async () => {
	await git("switch", "feature/ui");
	await writeFile(join(repository, "file.txt"), "feature\n");
	await git("commit", "-am", "Feature edit");
	const target = await git("rev-parse", "HEAD");

	await git("switch", "main");
	await writeFile(join(repository, "file.txt"), "main\n");
	await git("commit", "-am", "Main edit");
	const previous = await git("rev-parse", "HEAD");
	const result = await mergeBranch();

	const refreshed = await RepositoryReader.read(
		repository,
		new AbortController().signal
	);

	expect(result.ok).toBe(false);
	expect(!result.ok && result.error.code).toBe("conflict");
	expect(refreshed.ok && refreshed.value.operationState).toBe("merge");
	expect(await git("status", "--porcelain")).toContain("UU file.txt");

	if (!refreshed.ok || !refreshed.value.operationToken)
		throw new Error("Expected active merge");

	const aborted = await RepositoryOperation.write(repository, {
		kind: "abort",
		expectedOperation: "merge",
		expectedHead: previous,
		expectedBranch: "main",
		expectedToken: refreshed.value.operationToken,
	});

	expect(aborted.ok).toBe(true);
	expect(await git("rev-parse", "HEAD")).toBe(previous);
	expect(await git("rev-parse", "feature/ui")).toBe(target);
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe("main\n");
	expect(await git("status", "--porcelain")).toBe("");
});

it("refuses dirty trees, stale target commits and changed source branches without discarding work", async () => {
	const original = await git("rev-parse", "HEAD");

	expect((await mergeBranch("refs/heads/feature/ui", "0".repeat(40))).ok).toBe(
		false
	);
	expect((await mergeBranch("refs/heads/main")).ok).toBe(false);
	expect(
		(
			await writeBranch(repository, {
				kind: "merge",
				name: "refs/heads/feature/ui",
				expectedTarget: original,
				expectedHead: "0".repeat(40),
				expectedBranch: "main",
			})
		).ok
	).toBe(false);
	await writeFile(join(repository, "file.txt"), "my changes\n");
	await git("add", "file.txt");
	await writeFile(join(repository, "untracked.txt"), "untracked\n");
	const index = await git("ls-files", "--stage");
	const result = await mergeBranch();

	expect(result.ok).toBe(false);
	expect(!result.ok && result.error.message).toContain("Commit or stash");
	expect(await git("rev-parse", "HEAD")).toBe(original);
	expect(await git("ls-files", "--stage")).toBe(index);
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(
		"my changes\n"
	);
	expect(await readFile(join(repository, "untracked.txt"), "utf8")).toBe(
		"untracked\n"
	);
	expect(await git("stash", "list")).toBe("");
});

it("merges remote-tracking and other-worktree branches without checking them out", async () => {
	await git("switch", "feature/ui");
	await writeFile(join(repository, "file.txt"), "feature\n");
	await git("commit", "-am", "Feature edit");
	const target = await git("rev-parse", "HEAD");

	await git("switch", "main");
	await git("worktree", "add", join(sandbox, "linked"), "feature/ui");
	expect((await mergeBranch()).ok).toBe(true);
	await git("remote", "add", "origin", repository);
	await git("update-ref", "refs/remotes/origin/topic", target);
	expect((await mergeBranch("refs/remotes/origin/topic")).ok).toBe(true);
	expect(await git("branch", "--show-current")).toBe("main");
	expect(await git("rev-parse", "feature/ui")).toBe(target);
});

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

it("leaves tracked and untracked changes on the source branch in a durable stash", async () => {
	await writeFile(join(repository, "file.txt"), "work in progress\n");
	await writeFile(join(repository, "new.txt"), "untracked\n");
	const switched = await switchTo("feature/ui", "switch", "leave");

	expect(switched.ok).toBe(true);
	expect(await git("branch", "--show-current")).toBe("feature/ui");
	expect(await git("status", "--porcelain")).toBe("");
	expect(await git("stash", "list")).toContain("1git: changes for main");
});

it("brings mixed staged, unstaged and untracked changes and removes only its recovery stash", async () => {
	await writeFile(join(repository, "manual.txt"), "manual stash\n");
	await git("stash", "push", "-u", "-m", "Manual stash");
	const manual = await git("rev-parse", "stash@{0}");

	await writeFile(join(repository, "file.txt"), "staged\n");
	await git("add", "file.txt");
	await writeFile(join(repository, "file.txt"), "unstaged\n");
	await writeFile(join(repository, "new.txt"), "untracked\n");
	const index = await git("ls-files", "--stage");
	const switched = await switchTo("feature/ui", "switch", "bring");

	expect(switched.ok).toBe(true);
	expect(await git("branch", "--show-current")).toBe("feature/ui");
	expect(await git("ls-files", "--stage")).toBe(index);
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(
		"unstaged\n"
	);
	expect(await readFile(join(repository, "new.txt"), "utf8")).toBe(
		"untracked\n"
	);
	expect(await git("stash", "list", "--format=%H")).toBe(manual);
});

it("restores branch-owned changes after a fresh read, preserving the index and unrelated stashes", async () => {
	await writeFile(join(repository, "manual.txt"), "manual\n");
	await git("stash", "push", "-u", "-m", "Manual");
	const manual = await git("rev-parse", "stash@{0}");

	await writeFile(join(repository, "file.txt"), "staged\n");
	await git("add", "file.txt");
	await writeFile(join(repository, "file.txt"), "unstaged\n");
	await writeFile(join(repository, "new.txt"), "new\n");
	const index = await git("ls-files", "--stage");

	expect((await switchTo("feature/ui", "switch", "leave")).ok).toBe(true);
	const reopened = await RepositoryBranches.read(
		repository,
		new AbortController().signal
	);

	const saved = reopened.ok && reopened.value.savedChanges?.[0];

	if (!saved) throw new Error("Saved branch changes not discovered");

	expect(saved.branch).toBe("main");
	expect((await switchTo("main")).ok).toBe(true);
	expect(await git("status", "--porcelain")).toBe("");
	const restored = await writeBranch(repository, {
		kind: "restore",
		name: "main",
		savedChangesOid: saved.oid,
		expectedHead: await git("rev-parse", "HEAD"),
		expectedBranch: "main",
	});

	expect(restored.ok).toBe(true);
	expect(await git("ls-files", "--stage")).toBe(index);
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(
		"unstaged\n"
	);
	expect(await readFile(join(repository, "new.txt"), "utf8")).toBe("new\n");
	expect(await git("stash", "list", "--format=%H")).toBe(manual);
});

it("keeps the recovery stash and exposes real conflicts when brought changes cannot apply", async () => {
	await git("switch", "feature/ui");
	await writeFile(join(repository, "file.txt"), "destination\n");
	await git("commit", "-am", "Destination edits");
	await git("switch", "main");
	await writeFile(join(repository, "file.txt"), "my edits\n");
	const switched = await switchTo("feature/ui", "switch", "bring");

	expect(switched.ok).toBe(false);
	expect(!switched.ok && switched.error.message).toContain("recovery backup");
	expect(await git("branch", "--show-current")).toBe("feature/ui");
	expect(await git("status", "--porcelain")).toContain("UU file.txt");
	expect(await git("stash", "show", "-p", "stash@{0}")).toContain("+my edits");
	const saved = await RepositoryBranches.read(
		repository,
		new AbortController().signal
	);

	expect(saved.ok && saved.value.savedChanges?.[0]?.branch).toBe("feature/ui");
});

it("keeps saved work when checkout fails after a hook changed the destination", async () => {
	const hooks = join(sandbox, "hooks");

	await mkdir(hooks);
	const hook = join(hooks, "post-checkout");

	await writeFile(
		hook,
		'#!/bin/sh\nprintf "hook edit\\n" > hook.txt\nexit 1\n'
	);
	await chmod(hook, 0o755);
	await git("config", "core.hooksPath", hooks);
	await writeFile(join(repository, "file.txt"), "my edits\n");
	const switched = await switchTo("feature/ui", "switch", "bring");

	expect(switched.ok).toBe(false);
	expect(!switched.ok && switched.error.message).toContain("safe in Stashes");
	expect(await git("branch", "--show-current")).toBe("feature/ui");
	expect(await git("stash", "show", "-p", "stash@{0}")).toContain("+my edits");
	expect(await readFile(join(repository, "hook.txt"), "utf8")).toBe(
		"hook edit\n"
	);
});

it("refuses missing and occupied targets before saving anything", async () => {
	await git("worktree", "add", join(sandbox, "linked"), "feature/ui");
	await writeFile(join(repository, "file.txt"), "edits\n");

	expect((await switchTo("missing", "switch", "leave")).ok).toBe(false);
	expect((await switchTo("feature/ui", "switch", "bring")).ok).toBe(false);
	expect(await git("stash", "list")).toBe("");
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe("edits\n");
	expect(await git("branch", "--show-current")).toBe("main");
});

it("brings dirty work to a newly created remote tracking branch", async () => {
	const expectedHead = await git("rev-parse", "HEAD");

	await git("remote", "add", "origin", repository);
	await git("update-ref", "refs/remotes/origin/topic", expectedHead);
	await writeFile(join(repository, "file.txt"), "remote edits\n");
	await writeFile(join(repository, "new.txt"), "new\n");
	const result = await writeBranch(repository, {
		kind: "remote",
		name: "refs/remotes/origin/topic",
		changes: "bring",
		expectedHead,
		expectedBranch: "main",
	});

	expect(result.ok).toBe(true);
	expect(await git("branch", "--show-current")).toBe("topic");
	expect(await git("rev-parse", "--abbrev-ref", "@{upstream}")).toBe(
		"origin/topic"
	);
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(
		"remote edits\n"
	);
	expect(await readFile(join(repository, "new.txt"), "utf8")).toBe("new\n");
	expect(await git("stash", "list")).toBe("");
});

it("rejects stale dialog identity even if the app has refreshed its expected HEAD", async () => {
	await writeFile(join(repository, "file.txt"), "edits\n");
	const result = await RepositoryBranches.write(repository, {
		kind: "switch",
		name: "feature/ui",
		changes: "leave",
		expectedHead: await git("rev-parse", "HEAD"),
		expectedBranch: "main",
		reviewedSource: { head: "0".repeat(40), branch: "main" },
	});

	expect(result.ok).toBe(false);
	expect(await git("stash", "list")).toBe("");
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe("edits\n");
});

it("never restores a manual stash, another branch's work, or a backup from another worktree", async () => {
	await writeFile(join(repository, "manual.txt"), "manual\n");
	await git("stash", "push", "-u", "-m", "Manual");
	const manual = await git("rev-parse", "stash@{0}");

	await writeFile(join(repository, "file.txt"), "branch work\n");
	expect((await switchTo("feature/ui", "switch", "leave")).ok).toBe(true);
	const read = await RepositoryBranches.read(
		repository,
		new AbortController().signal
	);

	const saved = read.ok && read.value.savedChanges?.[0];

	if (!saved) throw new Error("Saved work not found");

	for (const oid of [manual, saved.oid]) {
		const result = await RepositoryBranches.write(repository, {
			kind: "restore",
			name: "feature/ui",
			savedChangesOid: oid,
			expectedHead: await git("rev-parse", "HEAD"),
			expectedBranch: "feature/ui",
		});

		expect(result.ok).toBe(false);
	}

	const linked = join(sandbox, "linked");

	await git("worktree", "add", linked, "main");
	const other = await RepositoryBranches.read(
		linked,
		new AbortController().signal
	);

	expect(other.ok && other.value.savedChanges).toEqual([]);
	expect(await git("stash", "list", "--format=%H")).toBe(
		`${saved.oid}\n${manual}`
	);
	expect(await git("status", "--porcelain")).toBe("");
});

it("keeps saved changes if restoration is attempted over new local work", async () => {
	await writeFile(join(repository, "file.txt"), "saved edits\n");
	expect((await switchTo("feature/ui", "switch", "leave")).ok).toBe(true);
	expect((await switchTo("main")).ok).toBe(true);
	const saved = await git("rev-parse", "stash@{0}");

	await writeFile(join(repository, "file.txt"), "new local work\n");
	const restored = await RepositoryBranches.write(repository, {
		kind: "restore",
		name: "main",
		savedChangesOid: saved,
		expectedHead: await git("rev-parse", "HEAD"),
		expectedBranch: "main",
	});

	expect(restored.ok).toBe(false);
	expect(await git("rev-parse", "stash@{0}")).toBe(saved);
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(
		"new local work\n"
	);
	const files = await RepositoryStashes.readFiles(
		repository,
		saved,
		new AbortController().signal
	);

	expect(
		files.ok && files.value.some((file) => file.commitFile?.path === "file.txt")
	).toBe(true);
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

	const result = await writeBranch(repository, {
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

it("removes a clean linked checkout but retains its branch and refuses unsafe targets", async () => {
	const head = await git("rev-parse", "HEAD");
	const path = join(sandbox, "removable");

	await git("worktree", "add", path, "feature/ui");
	const request = {
		kind: "remove" as const,
		path,
		expectedHead: head,
		expectedBranch: "feature/ui",
	};

	expect(
		(
			await RepositoryWorktrees.remove(repository, {
				...request,
				path: repository,
				expectedBranch: "main",
			})
		).ok
	).toBe(false);
	expect(
		(
			await RepositoryWorktrees.remove(repository, {
				...request,
				expectedHead: "stale",
			})
		).ok
	).toBe(false);
	expect(
		(
			await RepositoryWorktrees.remove(repository, {
				...request,
				path: sandbox,
			})
		).ok
	).toBe(false);
	await git("worktree", "lock", path);
	expect((await RepositoryWorktrees.remove(repository, request)).ok).toBe(
		false
	);
	await git("worktree", "unlock", path);
	await writeFile(join(path, "file.txt"), "dirty\n");
	expect((await RepositoryWorktrees.remove(repository, request)).ok).toBe(
		false
	);
	expect(await readFile(join(path, "file.txt"), "utf8")).toBe("dirty\n");
	await git("-C", path, "restore", "file.txt");
	await writeFile(join(path, "untracked.txt"), "keep\n");
	expect((await RepositoryWorktrees.remove(repository, request)).ok).toBe(
		false
	);
	await rm(join(path, "untracked.txt"));
	await writeFile(join(repository, ".git/info/exclude"), "ignored.txt\n");
	await writeFile(join(path, "ignored.txt"), "keep ignored\n");
	expect((await RepositoryWorktrees.remove(repository, request)).ok).toBe(
		false
	);
	expect(await readFile(join(path, "ignored.txt"), "utf8")).toBe(
		"keep ignored\n"
	);
	await rm(join(path, "ignored.txt"));
	expect(await RepositoryWorktrees.remove(repository, request)).toEqual({
		ok: true,
		value: path,
	});
	await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
	expect(await git("rev-parse", "feature/ui")).toBe(head);
	expect(await git("branch", "--show-current")).toBe("main");
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
