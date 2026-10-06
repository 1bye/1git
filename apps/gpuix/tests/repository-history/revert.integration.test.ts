/**
 * Covers: historical/root reverts, published history, dirty/stale/merge guards, hooks and conflict recovery.
 * Real: app history/operation boundary, Git backend and disposable repositories.
 * Doubles: none.
 * Requires: local Git and temporary storage; no network or graphics.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import {
	chmod,
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
import {
	GitRepository,
	type FinishOperationInput,
	type RevertCommitInput,
} from "@1git/git";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryOperation } from "../../src/feature/repository-workspace/lib/repository-operation";
import { RepositoryConflicts } from "../../src/feature/repository-workspace/lib/repository-conflicts";

const execute = promisify(execFile);
let root: string;
let base: string;
let target: string;

const git = async (...args: string[]) =>
	(
		await execute("git", args, {
			cwd: root,
			env: {
				...process.env,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_EDITOR: "true",
			},
		})
	).stdout.trimEnd();

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "1git-revert-")));
	await git("init", "--initial-branch=main");
	await git("config", "user.name", "Revert Test");
	await git("config", "user.email", "revert@example.invalid");
	await git("config", "commit.gpgsign", "false");
	await git("config", "core.hooksPath", "/dev/null");
	await writeFile(join(root, "a.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
	base = await git("rev-parse", "HEAD");
	await writeFile(join(root, "a.txt"), "target\n");
	await git("commit", "-am", "Target change");
	target = await git("rev-parse", "HEAD");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const snapshot = async () => {
	const opened = await GitRepository.open({ path: root });

	if (!opened.ok) throw new Error(opened.error.message);

	const result = await opened.value.getSnapshot();

	if (!result.ok) throw new Error(result.error.message);

	return result.value;
};

const request = async (commit = target): Promise<RevertCommitInput> => ({
	commit,
	expectedHead: await git("rev-parse", "HEAD"),
	expectedBranch: await git("branch", "--show-current"),
});

const finishRequest = async (
	kind: FinishOperationInput["kind"]
): Promise<FinishOperationInput> => {
	const state = await snapshot();

	if (state.operationState !== "revert" || !state.operationToken)
		throw new Error("Missing revert operation identity");

	return {
		kind,
		expectedHead: state.head.oid,
		expectedBranch: state.head.branch,
		expectedOperation: "revert",
		expectedToken: state.operationToken,
	};
};

it("reverses an older published commit by adding history, preserving later changes and remote refs", async () => {
	await git("update-ref", "refs/remotes/origin/main", target);
	await writeFile(join(root, "b.txt"), "later work\n");
	await git("add", ".");
	await git("commit", "-m", "Later unrelated work");
	const tip = await git("rev-parse", "HEAD");

	const result = await RepositoryHistory.revert(root, await request());

	expect(result.ok).toBe(true);
	expect(await git("rev-parse", "HEAD^")).toBe(tip);
	expect(await git("rev-parse", "refs/remotes/origin/main")).toBe(target);
	expect(await git("show", "HEAD:a.txt")).toBe("base");
	expect(await git("show", "HEAD:b.txt")).toBe("later work");
	expect(await git("log", "-1", "--format=%s")).toBe('Revert "Target change"');
	expect(await git("status", "--porcelain")).toBe("");
});

for (const dirty of ["unstaged", "staged", "untracked"] as const) {
	it(`does not touch ${dirty} changes`, async () => {
		const intent = await request();
		const path = dirty === "untracked" ? "keep.txt" : "a.txt";

		await writeFile(join(root, path), "keep my work\n");

		if (dirty === "staged") await git("add", path);

		const status = await git("status", "--porcelain");
		const result = await RepositoryHistory.revert(root, intent);

		expect(result.ok).toBe(false);
		expect(await git("rev-parse", "HEAD")).toBe(target);
		expect(await git("status", "--porcelain")).toBe(status);
		expect(await readFile(join(root, path), "utf8")).toBe("keep my work\n");
	});
}

it("rejects a changed branch, moved HEAD, detached HEAD, nonhistorical commits and option-like revisions", async () => {
	const intent = await request();

	await git("checkout", "-b", "other");
	expect((await RepositoryHistory.revert(root, intent)).ok).toBe(false);
	await writeFile(join(root, "a.txt"), "other\n");
	await git("commit", "-am", "Other");
	const other = await git("rev-parse", "HEAD");

	await git("checkout", "main");
	expect((await RepositoryHistory.revert(root, await request(other))).ok).toBe(
		false
	);
	expect(
		(await RepositoryHistory.revert(root, { ...intent, commit: "--all" })).ok
	).toBe(false);
	await git("commit", "--allow-empty", "-m", "Moved");
	expect((await RepositoryHistory.revert(root, intent)).ok).toBe(false);
	await git("checkout", "--detach", target);
	expect((await RepositoryHistory.revert(root, intent)).ok).toBe(false);
	expect((await snapshot()).operationState).toBe("normal");
	expect(await git("status", "--porcelain")).toBe("");
});

it("can reverse a root commit without deleting any history", async () => {
	await git("checkout", "-b", "root-only", base);

	expect((await RepositoryHistory.revert(root, await request(base))).ok).toBe(
		true
	);
	expect(await git("rev-parse", "HEAD^")).toBe(base);
	expect(await git("ls-tree", "--name-only", "HEAD")).toBe("");
});

it("does not guess a merge commit's mainline", async () => {
	await git("checkout", "-b", "other", base);
	await writeFile(join(root, "b.txt"), "branch work\n");
	await git("add", ".");
	await git("commit", "-m", "Other");
	await git("checkout", "main");
	await git("merge", "--no-edit", "other");
	const intent = await request(await git("rev-parse", "HEAD"));

	const result = await RepositoryHistory.revert(root, intent);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.message).toContain("mainline");

	expect(await git("rev-parse", "HEAD")).toBe(intent.expectedHead);
});

for (const kind of ["continue", "abort"] as const) {
	it(`recovers a conflicting revert with ${kind} and checks its operation identity`, async () => {
		await writeFile(join(root, "a.txt"), "later overlapping edit\n");
		await git("commit", "-am", "Later");
		const intent = await request();

		expect((await RepositoryHistory.revert(root, intent)).ok).toBe(false);
		const finish = await finishRequest(kind);

		expect(
			(
				await RepositoryOperation.write(root, {
					...finish,
					expectedToken: "stale",
				})
			).ok
		).toBe(false);
		expect((await RepositoryHistory.revert(root, intent)).ok).toBe(false);

		if (kind === "continue") {
			expect((await RepositoryOperation.write(root, finish)).ok).toBe(false);
			await writeFile(join(root, "a.txt"), "resolved\n");
			const preview = await RepositoryConflicts.read(
				root,
				"a.txt",
				new AbortController().signal
			);

			if (!preview.ok || !preview.value)
				throw new Error("Missing conflict preview");

			expect(
				(
					await RepositoryConflicts.write(root, {
						path: "a.txt",
						expectedContentHash: preview.value.hash,
						expectedHead: intent.expectedHead,
						expectedBranch: "main",
					})
				).ok
			).toBe(true);
		}

		await writeFile(join(root, "keep.txt"), "untracked recovery work\n");
		expect((await RepositoryOperation.write(root, finish)).ok).toBe(true);
		expect((await snapshot()).operationState).toBe("normal");
		expect(await readFile(join(root, "keep.txt"), "utf8")).toBe(
			"untracked recovery work\n"
		);
		expect(await readFile(join(root, "a.txt"), "utf8")).toBe(
			kind === "continue" ? "resolved\n" : "later overlapping edit\n"
		);
		expect(await git("rev-parse", kind === "continue" ? "HEAD^" : "HEAD")).toBe(
			intent.expectedHead
		);

		if (kind === "continue")
			expect(await git("log", "-1", "--format=%s")).toBe(
				'Revert "Target change"'
			);
	});
}

it("preserves Git's prepare-commit-msg hook behavior", async () => {
	const hooks = join(root, ".git", "test-hooks");

	await mkdir(hooks);
	await writeFile(join(hooks, "prepare-commit-msg"), "#!/bin/sh\nexit 1\n");
	await chmod(join(hooks, "prepare-commit-msg"), 0o755);
	await git("config", "core.hooksPath", hooks);

	expect((await RepositoryHistory.revert(root, await request())).ok).toBe(
		false
	);
	expect(await git("rev-parse", "HEAD")).toBe(target);
});
