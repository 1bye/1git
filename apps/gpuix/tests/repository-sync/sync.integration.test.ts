/**
 * Covers: fetch, guarded fast-forward pull, targeted push/publish, stale state, dirty trees and config overrides.
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
import type { SyncChoice } from "../../src/feature/repository-workspace/lib/repository-sync";

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

const synchronize = async (
	kind: SyncChoice["kind"],
	remote = "origin",
	remoteRef = "refs/heads/main"
) => {
	const read = await RepositoryReader.read(
		repository,
		new AbortController().signal
	);

	if (!read.ok) throw new Error(read.error.message);

	return await RepositorySync.write(
		repository,
		{
			kind,
			remote,
			remoteRef,
			expectedHead: read.value.head.oid ?? "",
			expectedBranch: read.value.head.branch ?? "",
		},
		new AbortController().signal
	);
};

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

it("pulls a clean branch by fast-forward despite rebase and auto-stash defaults", async () => {
	await git(repository, "config", "pull.rebase", "true");
	await git(repository, "config", "rebase.autoStash", "true");
	await git(repository, "config", "merge.autoStash", "true");
	await writeFile(join(writer, "file.txt"), "upstream\n");
	await git(writer, "commit", "-am", "Remote change");
	await git(writer, "push", "origin", "main");
	const result = await synchronize("pull");

	expect(result.ok).toBe(true);
	expect(await git(repository, "rev-parse", "HEAD")).toBe(
		await git(writer, "rev-parse", "HEAD")
	);
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(
		"upstream\n"
	);
	expect(await git(repository, "stash", "list")).toBe("");
	expect(result.ok && result.value.snapshot.head.behind).toBe(0);
});

it("refuses dirty and diverged pulls without changing files, the index, HEAD or stash", async () => {
	await git(repository, "config", "pull.rebase", "true");
	await git(repository, "config", "rebase.autoStash", "true");
	await writeFile(join(repository, "file.txt"), "local\n");
	await git(repository, "add", "file.txt");
	await writeFile(join(repository, "new.txt"), "untracked\n");
	await writeFile(join(writer, "other.txt"), "remote\n");
	await git(writer, "add", "other.txt");
	await git(writer, "commit", "-m", "Remote change");
	await git(writer, "push", "origin", "main");
	const index = await readFile(join(repository, ".git/index"));
	const head = await git(repository, "rev-parse", "HEAD");
	const dirty = await synchronize("pull");

	expect(!dirty.ok && dirty.error.code).toBe("dirty-worktree");
	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
	expect(await git(repository, "rev-parse", "HEAD")).toBe(head);
	expect(await readFile(join(repository, "new.txt"), "utf8")).toBe(
		"untracked\n"
	);
	await git(repository, "add", "new.txt");
	await git(repository, "commit", "-m", "Local change");
	const local = await git(repository, "rev-parse", "HEAD");
	const diverged = await synchronize("pull");

	expect(diverged.ok).toBe(false);
	expect(await git(repository, "rev-parse", "HEAD")).toBe(local);
	expect(await git(repository, "status", "--porcelain")).toBe("");
	expect(await git(repository, "stash", "list")).toBe("");
});

it("pushes only the reviewed commit to its differently named upstream, ignoring broad push defaults", async () => {
	await git(writer, "push", "origin", "main:refs/heads/release/topic");
	await git(repository, "fetch", "origin");
	await git(repository, "branch", "--set-upstream-to=origin/release/topic");
	const main = await git(writer, "rev-parse", "main");

	await writeFile(join(repository, "file.txt"), "committed\n");
	await git(repository, "commit", "-am", "Local change");
	await git(repository, "branch", "unrelated");
	await git(repository, "tag", "-a", "v-test", "-m", "Do not publish");
	await git(repository, "config", "remote.origin.mirror", "true");
	await git(
		repository,
		"config",
		"remote.origin.push",
		"+refs/heads/*:refs/heads/*"
	);
	await git(repository, "config", "push.followTags", "true");
	await writeFile(join(repository, "file.txt"), "uncommitted\n");
	const result = await synchronize(
		"push",
		"origin",
		"refs/heads/release/topic"
	);

	expect(result).toMatchObject({ ok: true });
	const remote = join(sandbox, "remote.git");

	expect(await git(remote, "rev-parse", "refs/heads/release/topic")).toBe(
		await git(repository, "rev-parse", "HEAD")
	);
	expect(await git(remote, "rev-parse", "refs/heads/main")).toBe(main);
	expect(
		await git(
			remote,
			"for-each-ref",
			"--format=%(refname)",
			"refs/heads/unrelated",
			"refs/tags"
		)
	).toBe("");
	expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(
		"uncommitted\n"
	);
});

it("publishes to the explicitly chosen remote and establishes upstream for slash-named branches", async () => {
	const second = join(sandbox, "second.git");

	await git(sandbox, "init", "--bare", second);
	await git(repository, "remote", "add", "second", second);
	await git(repository, "switch", "-c", "feature/new");
	const result = await synchronize(
		"publish",
		"second",
		"refs/heads/feature/new"
	);

	expect(result.ok).toBe(true);
	expect(result.ok && result.value.snapshot.head.upstream).toBe(
		"second/feature/new"
	);
	expect(await git(second, "rev-parse", "refs/heads/feature/new")).toBe(
		await git(repository, "rev-parse", "HEAD")
	);
	expect(
		await git(
			join(sandbox, "remote.git"),
			"for-each-ref",
			"--format=%(refname)",
			"refs/heads/feature/new"
		)
	).toBe("");
	const metadata = await RepositoryBranches.read(
		repository,
		new AbortController().signal
	);

	expect(
		metadata.ok &&
			metadata.value.branches.branches.find(
				(item) => item.name === "feature/new"
			)
	).toMatchObject({
		upstreamRemote: "second",
		upstreamRef: "refs/heads/feature/new",
	});
});

it("rejects a non-fast-forward push even when remote push defaults force", async () => {
	await writeFile(join(repository, "file.txt"), "local\n");
	await git(repository, "commit", "-am", "Local");
	await writeFile(join(writer, "file.txt"), "remote\n");
	await git(writer, "commit", "-am", "Remote");
	await git(writer, "push", "origin", "main");
	await git(
		repository,
		"config",
		"remote.origin.push",
		"+refs/heads/main:refs/heads/main"
	);
	const result = await synchronize("push");

	expect(result.ok).toBe(false);
	expect(await git(join(sandbox, "remote.git"), "rev-parse", "main")).toBe(
		await git(writer, "rev-parse", "main")
	);
});

it("rejects stale identities, changed upstreams, detached HEAD, ongoing operations and multiple push destinations", async () => {
	const head = await git(repository, "rev-parse", "HEAD");

	const request = {
		kind: "push" as const,
		expectedHead: head,
		expectedBranch: "main",
		remote: "origin",
		remoteRef: "refs/heads/main",
	};

	const signal = new AbortController().signal;

	expect(
		(
			await RepositorySync.write(
				repository,
				{ ...request, expectedHead: "0".repeat(40) },
				signal
			)
		).ok
	).toBe(false);
	expect(
		(
			await RepositorySync.write(
				repository,
				{ ...request, remoteRef: "refs/heads/other" },
				signal
			)
		).ok
	).toBe(false);
	expect(
		(await RepositorySync.write(repository, request, AbortSignal.abort())).ok
	).toBe(false);
	await git(repository, "switch", "--detach");
	expect((await RepositorySync.write(repository, request, signal)).ok).toBe(
		false
	);
	await git(repository, "switch", "main");
	await writeFile(join(repository, ".git/MERGE_HEAD"), `${head}\n`);
	expect((await RepositorySync.write(repository, request, signal)).ok).toBe(
		false
	);
	await rm(join(repository, ".git/MERGE_HEAD"));
	await git(
		repository,
		"remote",
		"set-url",
		"--push",
		"--add",
		"origin",
		join(sandbox, "remote.git")
	);
	await git(
		repository,
		"remote",
		"set-url",
		"--push",
		"--add",
		"origin",
		join(sandbox, "second.git")
	);
	expect((await synchronize("push")).ok).toBe(false);
	expect(await git(repository, "rev-parse", "HEAD")).toBe(head);
});
