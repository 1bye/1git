/**
 * Covers: multi-file merge/rebase/mailbox resolution, continuation, abort recovery, stale intent and unstaged-change guards.
 * Real: Git/backend and disposable local repositories.
 * Doubles: none.
 * Requires: Git and temporary storage; no network or graphics.
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
import { GitRepository, type FinishOperationInput } from "@1git/git";
import { RepositoryOperation } from "../../src/feature/repository-workspace/lib/repository-operation";
import { RepositoryConflicts } from "../../src/feature/repository-workspace/lib/repository-conflicts";

const execute = promisify(execFile);
let root: string;
let initialHead: string;

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
	root = await realpath(await mkdtemp(join(tmpdir(), "1git-operation-")));
	await git("init", "--initial-branch=main");
	await git("config", "user.name", "Test");
	await git("config", "user.email", "test@example.invalid");
	await git("config", "commit.gpgsign", "false");
	await git("config", "core.hooksPath", "/dev/null");
	await writeFile(join(root, "a.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
	await git("checkout", "-b", "other");
	await writeFile(join(root, "a.txt"), "other\n");
	await git("commit", "-am", "Other");
	await git("checkout", "main");
	await writeFile(join(root, "a.txt"), "main\n");
	await git("commit", "-am", "Main");
	initialHead = await git("rev-parse", "HEAD");
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

const request = async (
	kind: FinishOperationInput["kind"]
): Promise<FinishOperationInput> => {
	const value = await snapshot();

	if (
		(value.operationState !== "merge" &&
			value.operationState !== "rebase" &&
			value.operationState !== "am") ||
		!value.operationToken
	)
		throw new Error("Missing operation identity");

	return {
		kind,
		expectedOperation: value.operationState,
		expectedHead: value.head.oid,
		expectedBranch: value.head.branch,
		expectedToken: value.operationToken,
	};
};

async function startOperation(operation: "merge" | "rebase" | "am") {
	if (operation !== "am") return await git(operation, "other");

	const patch = join(root, ".git", "fixture.patch");

	await writeFile(patch, await git("format-patch", "-1", "--stdout", "other"));

	return await git("am", "--3way", patch);
}

for (const operation of ["merge", "rebase", "am"] as const) {
	it(`resolves multiple files then continues ${operation}, preserving untracked work`, async () => {
		await addSecondConflict();
		await expect(startOperation(operation)).rejects.toThrow();
		await writeFile(join(root, "keep.txt"), "untracked stays\n");
		expect(
			(await snapshot()).files.filter((file) => file.recordType === "unmerged")
		).toHaveLength(2);
		await resolveFile("a.txt", "theirs");
		expect(
			(await RepositoryOperation.write(root, await request("continue"))).ok
		).toBe(false);
		expect((await snapshot()).operationState).toBe(operation);
		await writeFile(join(root, "b.txt"), "manually resolved\n");
		await resolveFile("b.txt");
		const result = await RepositoryOperation.write(
			root,
			await request("continue")
		);

		expect(result.ok).toBe(true);
		expect((await snapshot()).operationState).toBe("normal");
		expect(await git("show", "HEAD:a.txt")).toBe(
			operation === "rebase" ? "main" : "other"
		);
		expect(await git("show", "HEAD:b.txt")).toBe("manually resolved");
		expect(await git("ls-files", "--unmerged")).toBe("");
		expect(await readFile(join(root, "keep.txt"), "utf8")).toBe(
			"untracked stays\n"
		);
	});
	it(`aborts a partly resolved ${operation} and restores the original branch and files`, async () => {
		await addSecondConflict();
		await expect(startOperation(operation)).rejects.toThrow();
		await resolveFile("a.txt", "theirs");
		await writeFile(join(root, "b.txt"), "unfinished manual resolution\n");
		await writeFile(join(root, "keep.txt"), "untracked stays\n");
		const result = await RepositoryOperation.write(
			root,
			await request("abort")
		);

		expect(result.ok).toBe(true);
		expect((await snapshot()).operationState).toBe("normal");
		expect(await git("rev-parse", "HEAD")).toBe(initialHead);
		expect(await git("branch", "--show-current")).toBe("main");
		expect(await readFile(join(root, "a.txt"), "utf8")).toBe("main\n");
		expect(await readFile(join(root, "b.txt"), "utf8")).toBe("main b\n");
		expect(await readFile(join(root, "keep.txt"), "utf8")).toBe(
			"untracked stays\n"
		);
		expect(await git("ls-files", "--unmerged")).toBe("");
	});
	it(`continues ${operation} using staged resolutions and the existing message`, async () => {
		await expect(startOperation(operation)).rejects.toThrow();
		const intent = await request("continue");

		expect((await RepositoryOperation.write(root, intent)).ok).toBe(false);
		await writeFile(join(root, "a.txt"), "resolved\n");
		await git("add", "a.txt");
		await writeFile(join(root, "keep.txt"), "untracked stays\n");
		const result = await RepositoryOperation.write(root, intent);

		expect(result.ok).toBe(true);
		expect((await snapshot()).operationState).toBe("normal");
		expect(await git("show", "HEAD:a.txt")).toBe("resolved");
		expect(await readFile(join(root, "keep.txt"), "utf8")).toBe(
			"untracked stays\n"
		);
		expect(await git("log", "-1", "--format=%s")).toContain(
			operation === "merge" ? "Merge" : operation === "am" ? "Other" : "Main"
		);
	});
	it(`aborts ${operation} only with the reviewed identity`, async () => {
		await expect(startOperation(operation)).rejects.toThrow();
		const intent = await request("abort");

		expect(
			(
				await RepositoryOperation.write(root, {
					...intent,
					expectedToken: "stale",
				})
			).ok
		).toBe(false);
		expect((await snapshot()).operationState).toBe(operation);
		expect((await RepositoryOperation.write(root, intent)).ok).toBe(true);
		expect(await git("rev-parse", "HEAD")).toBe(initialHead);
		expect((await snapshot()).operationState).toBe("normal");
	});
}

async function addSecondConflict() {
	// Amend each branch tip so both conflicts belong to the same replayed commit.
	await writeFile(join(root, "b.txt"), "main b\n");
	await git("add", "b.txt");
	await git("commit", "--amend", "--no-edit");
	initialHead = await git("rev-parse", "HEAD");
	await git("checkout", "other");
	await writeFile(join(root, "b.txt"), "other b\n");
	await git("add", "b.txt");
	await git("commit", "--amend", "--no-edit");
	await git("checkout", "main");
}

async function resolveFile(path: string, side?: "ours" | "theirs") {
	const state = await snapshot();

	const preview = await RepositoryConflicts.read(
		root,
		path,
		new AbortController().signal
	);

	if (!preview.ok || !preview.value)
		throw new Error("Missing conflict preview");

	const result = await RepositoryConflicts.write(root, {
		path,
		side,
		expectedHead: state.head.oid,
		expectedBranch: state.head.branch,
		expectedContentHash: preview.value.hash,
	});

	if (!result.ok) throw new Error(result.error.message);
}

it("rejects unstaged tracked edits without including or discarding them", async () => {
	await expect(git("merge", "other")).rejects.toThrow();
	await writeFile(join(root, "a.txt"), "staged resolution\n");
	await git("add", "a.txt");
	await writeFile(join(root, "a.txt"), "later unstaged edit\n");
	const result = await RepositoryOperation.write(
		root,
		await request("continue")
	);

	expect(result.ok).toBe(false);
	expect(await git("show", ":a.txt")).toBe("staged resolution");
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe(
		"later unstaged edit\n"
	);
});

it("preserves resolutions after a failing merge hook and allows a reviewed retry", async () => {
	await expect(git("merge", "other")).rejects.toThrow();
	await writeFile(join(root, "a.txt"), "resolved\n");
	await resolveFile("a.txt");
	const hooks = join(root, ".git", "journey-hooks");

	await mkdir(hooks);
	await writeFile(join(hooks, "commit-msg"), "#!/bin/sh\nexit 1\n", {
		mode: 0o700,
	});
	await git("config", "core.hooksPath", hooks);
	const failed = await RepositoryOperation.write(
		root,
		await request("continue")
	);

	expect(failed.ok).toBe(false);
	expect((await snapshot()).operationState).toBe("merge");
	expect(await git("show", ":a.txt")).toBe("resolved");
	expect(await git("rev-parse", "HEAD")).toBe(initialHead);
	await git("config", "core.hooksPath", "/dev/null");
	const retried = await RepositoryOperation.write(
		root,
		await request("continue")
	);

	expect(retried.ok).toBe(true);
	expect((await snapshot()).operationState).toBe("normal");
	expect(await git("show", "HEAD:a.txt")).toBe("resolved");
});
