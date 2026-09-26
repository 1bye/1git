/**
 * Covers: explicit fetch, tracking/branch updates, shared worktrees, cancellation and failures without integrating changes.
 * Real: app Git boundaries, Git CLI, a temporary bare remote and local clones.
 * Doubles: none.
 * Requires: Git and writable temporary storage; no network or user repository.
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
import { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";
import { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";

const execute = promisify(execFile);
let sandbox: string;
let repository: string;
let writer: string;

const git = async (cwd: string, ...args: string[]): Promise<string> => {
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
			cwd,
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
	sandbox = await realpath(await mkdtemp(join(tmpdir(), "gpuix-fetch-")));
	writer = join(sandbox, "writer");
	repository = join(sandbox, "repository with spaces");
	const remote = join(sandbox, "remote.git");

	await mkdir(writer);
	await git(writer, "init", "--initial-branch=main");
	await writeFile(join(writer, "file.txt"), "base\n");
	await git(writer, "add", "file.txt");
	await git(writer, "commit", "-m", "Base");
	await git(sandbox, "clone", "--bare", writer, remote);
	await git(writer, "remote", "add", "origin", remote);
	await git(sandbox, "clone", remote, repository);
	await git(repository, "config", "core.fsmonitor", "false");
	await git(repository, "config", "core.hooksPath", "/dev/null");
});

afterEach(async () => {
	await rm(sandbox, { recursive: true, force: true });
});

it("refreshes tracking refs and remote branches while preserving HEAD, index, working files and linked worktrees", async () => {
	const linked = join(sandbox, "linked worktree");

	await git(repository, "worktree", "add", "-b", "feature/linked", linked);
	await git(linked, "branch", "--set-upstream-to=origin/main");
	await writeFile(join(repository, "file.txt"), "staged\n");
	await git(repository, "add", "file.txt");
	await writeFile(join(repository, "file.txt"), "unstaged\n");
	await writeFile(join(repository, "new.txt"), "untracked\n");
	const head = await git(repository, "rev-parse", "HEAD");
	const index = await readFile(join(repository, ".git/index"));

	await writeFile(join(writer, "file.txt"), "remote\n");
	await git(writer, "commit", "-am", "Remote change");
	await git(writer, "branch", "feature/remote");
	await git(writer, "push", "origin", "main", "feature/remote");
	const result = await RepositorySync.fetch(
		repository,
		new AbortController().signal
	);

	expect(result.ok).toBe(true);

	if (!result.ok) throw new Error(result.error.message);

	expect(result.value.snapshot.head).toMatchObject({
		branch: "main",
		oid: head,
		upstream: "origin/main",
		ahead: 0,
		behind: 1,
	});
	expect(await git(repository, "rev-parse", "HEAD")).toBe(head);
	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(
		"unstaged\n"
	);
	expect(await readFile(join(repository, "new.txt"), "utf8")).toBe(
		"untracked\n"
	);
	expect(await readFile(join(linked, "file.txt"), "utf8")).toBe("base\n");
	const branches = await RepositoryBranches.read(
		repository,
		new AbortController().signal
	);

	expect(
		branches.ok && branches.value.remotes.map((remote) => remote.name)
	).toEqual(["origin"]);
	expect(
		branches.ok &&
			branches.value.branches.branches.some(
				(branch) => branch.name === "origin/feature/remote"
			)
	).toBe(true);
	const shared = await RepositoryReader.read(
		linked,
		new AbortController().signal
	);

	expect(shared.ok && shared.value.head).toMatchObject({
		branch: "feature/linked",
		oid: head,
		behind: 1,
	});
});

it("reports a missing remote instead of treating Git's no-op fetch as success", async () => {
	await git(repository, "remote", "remove", "origin");
	const result = await RepositorySync.fetch(
		repository,
		new AbortController().signal
	);

	expect(result.ok).toBe(false);
	expect(!result.ok && result.error.message).toContain("No remote");
});

it("reports unavailable remotes and cancellation without changing the local branch", async () => {
	const head = await git(repository, "rev-parse", "HEAD");

	await git(
		repository,
		"remote",
		"set-url",
		"origin",
		join(sandbox, "missing.git")
	);
	const failed = await RepositorySync.fetch(
		repository,
		new AbortController().signal
	);

	expect(failed.ok).toBe(false);
	const cancelled = await RepositorySync.fetch(repository, AbortSignal.abort());

	expect(!cancelled.ok && cancelled.error.code).toBe("aborted");
	expect(await git(repository, "rev-parse", "HEAD")).toBe(head);
	expect(await git(repository, "status", "--porcelain")).toBe("");
});
