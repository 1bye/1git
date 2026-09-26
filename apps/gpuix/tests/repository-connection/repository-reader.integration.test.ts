/**
 * Covers: status reads, filesystem-driven refresh, linked-worktree metadata and watcher cleanup.
 * Real: RepositoryReader/Watcher/Refresh, @1git/git, filesystem events, Git CLI and disposable repositories.
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
	rename,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import { RepositoryWatcher } from "../../src/feature/repository-workspace/lib/repository-watcher";
import { RepositoryRefresh } from "../../src/feature/repository-workspace/lib/repository-refresh";
import { RepositoryWorkspaceModel as Model } from "../../src/feature/repository-workspace/lib/repository-workspace-model";

const execute = promisify(execFile);
let sandbox: string;
let repository: string;

const waitFor = async (ready: () => boolean): Promise<void> => {
	const deadline = performance.now() + 5000;

	while (!ready()) {
		if (performance.now() > deadline)
			throw new Error("Timed out waiting for filesystem refresh.");

		await Bun.sleep(25);
	}
};

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

	return result.stdout;
};

beforeEach(async () => {
	sandbox = await realpath(await mkdtemp(join(tmpdir(), "gpuix-status-")));
	repository = join(sandbox, "repository with spaces");
	await mkdir(repository);
	await git("init", "--initial-branch=main");
	await git("config", "core.fsmonitor", "false");
});
afterEach(async () => {
	await rm(sandbox, { recursive: true, force: true });
});

it("refreshes after atomic saves, index and HEAD changes without a self-triggered status loop", async () => {
	await writeFile(join(repository, "a.txt"), "base\n");
	await git("add", "a.txt");
	await git("commit", "-m", "Base");
	const result = await RepositoryReader.read(
		repository,
		new AbortController().signal
	);

	if (!result.ok) throw new Error(result.error.message);

	let snapshot = result.value;

	const workspace = Model.reduce(Model.create(), {
		type: "loaded",
		snapshot,
	}).repository;

	if (!workspace) throw new Error("Missing repository");

	const errors: string[] = [];
	let reads = 0;

	const queue = new RepositoryRefresh(
		async (signal) => {
			const refreshed = await RepositoryReader.read(repository, signal);

			if (!refreshed.ok) throw new Error(refreshed.error.message);

			snapshot = refreshed.value;
			reads += 1;
		},
		(message) => errors.push(message)
	);

	const stop = RepositoryWatcher.watch(
		workspace,
		() => queue.invalidate(),
		(message) => errors.push(message)
	);

	try {
		await writeFile(join(repository, "a.tmp"), "saved\n");
		await rename(join(repository, "a.tmp"), join(repository, "a.txt"));
		await waitFor(() =>
			snapshot.files.some(
				(file) => file.path === "a.txt" && file.worktreeStatus === "modified"
			)
		);
		await git("add", "a.txt");
		await waitFor(() =>
			snapshot.files.some(
				(file) =>
					file.indexStatus === "modified" &&
					file.worktreeStatus === "unmodified"
			)
		);
		const oldHead = snapshot.head.oid;

		await git("commit", "-m", "External commit");
		await waitFor(
			() => snapshot.head.oid !== oldHead && snapshot.files.length === 0
		);
		await Bun.sleep(400);
		const settledReads = reads;

		await RepositoryReader.read(repository, new AbortController().signal);
		await RepositoryReader.read(repository, new AbortController().signal);
		await Bun.sleep(600);
		expect(reads).toBe(settledReads);
		expect(errors).toEqual([]);
		stop();
		queue.dispose();
		await writeFile(join(repository, "a.txt"), "closed\n");
		await Bun.sleep(350);
		expect(reads).toBe(settledReads);
	} finally {
		stop();
		queue.dispose();
	}
}, 15000);

it("observes a linked worktree's external index and shared stash refs, ignoring locks/objects", async () => {
	await writeFile(join(repository, "a.txt"), "base\n");
	await git("add", "a.txt");
	await git("commit", "-m", "Base");
	const linked = join(sandbox, "linked");

	await git("worktree", "add", "-b", "linked", linked);
	const result = await RepositoryReader.read(
		linked,
		new AbortController().signal
	);

	if (!result.ok) throw new Error(result.error.message);

	const workspace = Model.reduce(Model.create(), {
		type: "loaded",
		snapshot: result.value,
	}).repository;

	if (!workspace) throw new Error("Missing linked repository");

	const errors: string[] = [];
	let changes = 0;

	const stop = RepositoryWatcher.watch(
		workspace,
		() => {
			changes += 1;
		},
		(message) => errors.push(message)
	);

	try {
		await writeFile(
			join(workspace.gitDirectory, "index.lock"),
			"temporary lock"
		);
		await unlink(join(workspace.gitDirectory, "index.lock"));
		await writeFile(
			join(workspace.commonDirectory, "objects/ignored-test"),
			"ignored metadata"
		);
		await Bun.sleep(350);
		expect(changes).toBe(0);
		await writeFile(join(linked, "a.txt"), "linked edit\n");
		await waitFor(() => changes > 0);
		await Bun.sleep(350);
		const beforeIndex = changes;

		await git("-C", linked, "add", "a.txt");
		await waitFor(() => changes > beforeIndex);
		await Bun.sleep(350);
		const beforeStash = changes;

		await writeFile(join(repository, "a.txt"), "main edit\n");
		await git("stash", "push", "-m", "External stash");
		await waitFor(() => changes > beforeStash);
		const refreshed = await RepositoryReader.read(
			linked,
			new AbortController().signal
		);

		expect(refreshed.ok && refreshed.value.stashCount).toBe(1);
		expect(errors).toEqual([]);
	} finally {
		stop();
	}
}, 15000);

it("reads from a nested folder and maps mixed status without changing staged content, HEAD or working files", async () => {
	await mkdir(join(repository, "src"));
	await writeFile(join(repository, "src/a.ts"), "original\n");
	await writeFile(join(repository, "remove.txt"), "delete me\n");
	await writeFile(join(repository, "old name.txt"), "rename me\n");
	await git("add", "--", "src/a.ts", "remove.txt", "old name.txt");
	await git("commit", "-m", "Initial fixture");
	await writeFile(join(repository, "src/a.ts"), "staged\n");
	await git("add", "--", "src/a.ts");
	await writeFile(join(repository, "src/a.ts"), "unstaged\n");
	await unlink(join(repository, "remove.txt"));
	await git("mv", "--", "old name.txt", "new name.txt");
	const unusual = "café [new]\nfile.txt";

	await writeFile(join(repository, unusual), "untracked\n");
	const beforeHead = await git("rev-parse", "HEAD");
	const beforeIndex = await git("ls-files", "--stage", "-z");

	const snapshot = await RepositoryReader.read(
		join(repository, "src"),
		new AbortController().signal
	);

	expect(snapshot.ok).toBe(true);

	if (!snapshot.ok) throw new Error(snapshot.error.message);

	expect(snapshot.value.repository.root).toBe(repository);
	expect(snapshot.value.head.branch).toBe("main");
	expect(
		snapshot.value.files.find((file) => file.path === "src/a.ts")
	).toMatchObject({ indexStatus: "modified", worktreeStatus: "modified" });
	expect(
		snapshot.value.files.find((file) => file.path === "new name.txt")
			?.originalPath
	).toBe("old name.txt");
	let state = Model.reduce(Model.create(), {
		type: "loaded",
		snapshot: snapshot.value,
	});

	state = Model.reduce(state, { type: "include-all", included: false });
	state = Model.reduce(state, {
		type: "include-file",
		id: unusual,
		included: true,
	});
	state = Model.reduce(state, {
		type: "edit-commit-message",
		value: "Not a real commit",
	});
	expect(state.entries.changes.map((file) => file.title)).toEqual(
		expect.arrayContaining(["src/a.ts", "remove.txt", "new name.txt", unusual])
	);
	expect(Model.canPreviewCommit(state)).toBe(true);
	expect(await git("rev-parse", "HEAD")).toBe(beforeHead);
	expect(await git("ls-files", "--stage", "-z")).toBe(beforeIndex);
	expect(await readFile(join(repository, "src/a.ts"), "utf8")).toBe(
		"unstaged\n"
	);
	expect(await readFile(join(repository, unusual), "utf8")).toBe("untracked\n");
});

it("supports an unborn branch, a clean tree and a detached linked worktree", async () => {
	const unborn = await RepositoryReader.read(
		repository,
		new AbortController().signal
	);

	expect(unborn.ok).toBe(true);

	if (!unborn.ok) throw new Error(unborn.error.message);

	expect(unborn.value.head.unborn).toBe(true);
	expect(unborn.value.head.branch).toBe("main");
	expect(unborn.value.files).toEqual([]);
	await git("commit", "--allow-empty", "-m", "Initial fixture");
	const worktree = join(sandbox, "linked worktree");

	await git("worktree", "add", "--detach", worktree, "HEAD");
	const linked = await RepositoryReader.read(
		worktree,
		new AbortController().signal
	);

	expect(linked.ok).toBe(true);

	if (!linked.ok) throw new Error(linked.error.message);

	expect(linked.value.repository.root).toBe(worktree);
	expect(linked.value.head.detached).toBe(true);
	expect(linked.value.files).toEqual([]);
});

it("returns actionable failures for invalid folders, bare repositories and cancellation", async () => {
	const invalid = await RepositoryReader.read(
		sandbox,
		new AbortController().signal
	);

	expect(invalid.ok).toBe(false);

	if (invalid.ok) throw new Error("Expected an invalid repository");

	expect(invalid.error.code).toBe("not-a-repository");
	const bare = join(sandbox, "bare.git");

	await git("init", "--bare", bare);
	const bareResult = await RepositoryReader.read(
		bare,
		new AbortController().signal
	);

	expect(bareResult.ok).toBe(false);

	if (bareResult.ok) throw new Error("Expected a bare-repository error");

	expect(bareResult.error.code).toBe("bare-repository");
	const cancelled = await RepositoryReader.read(
		repository,
		AbortSignal.abort()
	);

	expect(cancelled.ok).toBe(false);

	if (cancelled.ok) throw new Error("Expected cancellation");

	expect(cancelled.error.code).toBe("aborted");
});
