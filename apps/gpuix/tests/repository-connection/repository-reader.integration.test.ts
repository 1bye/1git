/**
 * Covers: repository opening and real status for staged/unstaged/untracked paths, worktrees and invalid folders.
 * Real: RepositoryReader, @1git/git, Git CLI and disposable local repositories.
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
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";
import { RepositoryWorkspaceModel as Model } from "../../src/feature/repository-workspace/lib/repository-workspace-model";

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
