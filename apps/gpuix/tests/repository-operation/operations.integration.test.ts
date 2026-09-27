/**
 * Covers: merge/rebase continuation and abort, stale intent, conflicts and unstaged-change guards.
 * Real: Git/backend and disposable local repositories.
 * Doubles: none.
 * Requires: Git and temporary storage; no network or graphics.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GitRepository, type FinishOperationInput } from "@1git/git";
import { RepositoryOperation } from "../../src/feature/repository-workspace/lib/repository-operation";

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
		(value.operationState !== "merge" && value.operationState !== "rebase") ||
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

for (const operation of ["merge", "rebase"] as const) {
	it(`continues ${operation} using staged resolutions and the existing message`, async () => {
		await expect(git(operation, "other")).rejects.toThrow();
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
			operation === "merge" ? "Merge" : "Main"
		);
	});
	it(`aborts ${operation} only with the reviewed identity`, async () => {
		await expect(git(operation, "other")).rejects.toThrow();
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
