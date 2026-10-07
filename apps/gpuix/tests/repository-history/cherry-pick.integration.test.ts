/**
 * Covers: single-commit replay onto a reviewed branch, dirty/stale/occupied/merge guards, hooks and conflict recovery.
 * Real: app History/operation/conflict boundaries, Git backend and disposable repositories.
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
	type CherryPickCommitInput,
	type FinishOperationInput,
} from "@1git/git";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryOperation } from "../../src/feature/repository-workspace/lib/repository-operation";
import { RepositoryConflicts } from "../../src/feature/repository-workspace/lib/repository-conflicts";

const execute = promisify(execFile);
let directory: string;
let root: string;
let base: string;
let commit: string;
let head: string;
let destination: string;

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
	directory = await realpath(
		await mkdtemp(join(tmpdir(), "1git-cherry-pick-"))
	);
	root = join(directory, "repository");
	await mkdir(root);
	await git("init", "--initial-branch=main");
	await git("config", "user.name", "Cherry-pick Test");
	await git("config", "user.email", "cherry-pick@example.invalid");
	await git("config", "commit.gpgsign", "false");
	await git("config", "core.hooksPath", "/dev/null");
	await writeFile(join(root, "a.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
	base = await git("rev-parse", "HEAD");
	await git("checkout", "-b", "destination");
	await writeFile(join(root, "destination.txt"), "keep destination work\n");
	await git("add", ".");
	await git("commit", "-m", "Destination work");
	destination = await git("rev-parse", "HEAD");
	await git("checkout", "main");
	await writeFile(join(root, "a.txt"), "selected change\n");
	await git("commit", "-am", "Selected change");
	commit = await git("rev-parse", "HEAD");
	await writeFile(join(root, "later.txt"), "not copied\n");
	await git("add", ".");
	await git("commit", "-m", "Later source work");
	head = await git("rev-parse", "HEAD");
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

const request = (): CherryPickCommitInput => ({
	commit,
	expectedHead: head,
	expectedBranch: "main",
	targetBranch: "destination",
	expectedTarget: destination,
});

const snapshot = async () => {
	const opened = await GitRepository.open({ path: root });

	if (!opened.ok) throw new Error(opened.error.message);

	const result = await opened.value.getSnapshot();

	if (!result.ok) throw new Error(result.error.message);

	return result.value;
};

const finishRequest = async (
	kind: FinishOperationInput["kind"]
): Promise<FinishOperationInput> => {
	const state = await snapshot();

	if (state.operationState !== "cherry-pick" || !state.operationToken)
		throw new Error("Missing cherry-pick operation identity");

	return {
		kind,
		expectedOperation: "cherry-pick",
		expectedHead: state.head.oid,
		expectedBranch: state.head.branch,
		expectedToken: state.operationToken,
	};
};

it("switches to the destination and copies only the selected commit without rewriting source or remote refs", async () => {
	await git("update-ref", "refs/remotes/origin/main", head);
	const result = await RepositoryHistory.cherryPick(root, request());

	expect(result.ok).toBe(true);
	expect(await git("branch", "--show-current")).toBe("destination");
	expect(await git("rev-parse", "HEAD^")).toBe(destination);
	expect(await git("rev-parse", "main")).toBe(head);
	expect(await git("rev-parse", "refs/remotes/origin/main")).toBe(head);
	expect(await git("show", "HEAD:a.txt")).toBe("selected change");
	expect(await git("show", "HEAD:destination.txt")).toBe(
		"keep destination work"
	);
	expect(await git("ls-tree", "--name-only", "HEAD")).not.toContain(
		"later.txt"
	);
	expect(await git("log", "-1", "--format=%s")).toBe("Selected change");
	expect(await git("status", "--porcelain")).toBe("");
});

for (const dirty of ["unstaged", "staged", "untracked"] as const) {
	it(`preserves ${dirty} work and does not switch branches`, async () => {
		const path = dirty === "untracked" ? "keep.txt" : "a.txt";

		await writeFile(join(root, path), "keep my work\n");

		if (dirty === "staged") await git("add", path);

		const before = await git("status", "--porcelain");
		const result = await RepositoryHistory.cherryPick(root, request());

		expect(result.ok).toBe(false);
		expect(await git("branch", "--show-current")).toBe("main");
		expect(await git("rev-parse", "HEAD")).toBe(head);
		expect(await git("rev-parse", "destination")).toBe(destination);
		expect(await git("status", "--porcelain")).toBe(before);
		expect(await readFile(join(root, path), "utf8")).toBe("keep my work\n");
	});
}

it("rejects stale tips, arbitrary or option-like commits, same/unknown branches and detached HEAD before switching", async () => {
	const intent = request();

	await git("update-ref", "refs/heads/destination", base);
	expect((await RepositoryHistory.cherryPick(root, intent)).ok).toBe(false);
	await git("update-ref", "refs/heads/destination", destination);

	for (const invalid of [
		{ commit: destination },
		{ commit: "--abort" },
		{ targetBranch: "main", expectedTarget: head },
		{ targetBranch: "missing" },
		{ targetBranch: "--detach" },
		{ expectedBranch: "other" },
	])
		expect(
			(await RepositoryHistory.cherryPick(root, { ...intent, ...invalid })).ok
		).toBe(false);

	await git("commit", "--allow-empty", "-m", "Source moved");
	expect((await RepositoryHistory.cherryPick(root, intent)).ok).toBe(false);
	await git("checkout", "--detach", head);
	expect((await RepositoryHistory.cherryPick(root, intent)).ok).toBe(false);
	expect(await git("rev-parse", "destination")).toBe(destination);
});

it("rejects a destination occupied by another worktree without touching either worktree", async () => {
	const linked = join(directory, "linked");

	await git("worktree", "add", linked, "destination");
	const result = await RepositoryHistory.cherryPick(root, request());

	expect(result.ok).toBe(false);
	expect(await git("branch", "--show-current")).toBe("main");
	expect(await git("rev-parse", "destination")).toBe(destination);
	expect(await readFile(join(linked, "a.txt"), "utf8")).toBe("base\n");
});

it("rejects merge commits and commits already present in the destination", async () => {
	await git("branch", "already", head);
	expect(
		(
			await RepositoryHistory.cherryPick(root, {
				...request(),
				targetBranch: "already",
				expectedTarget: head,
			})
		).ok
	).toBe(false);
	await git("merge", "--no-edit", "destination");
	const merge = await git("rev-parse", "HEAD");

	const result = await RepositoryHistory.cherryPick(root, {
		...request(),
		commit: merge,
		expectedHead: merge,
	});

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.message).toContain("mainline");

	expect(await git("branch", "--show-current")).toBe("main");
	expect(await git("rev-parse", "destination")).toBe(destination);
});

for (const kind of ["continue", "abort"] as const) {
	it(`recovers a conflicting cherry-pick with ${kind}, preserving source and rejecting stale operation identity`, async () => {
		await git("checkout", "destination");
		await writeFile(join(root, "a.txt"), "destination overlap\n");
		await git("commit", "-am", "Destination overlap");
		destination = await git("rev-parse", "HEAD");
		await git("checkout", "main");

		expect((await RepositoryHistory.cherryPick(root, request())).ok).toBe(
			false
		);
		const finish = await finishRequest(kind);

		expect(await git("branch", "--show-current")).toBe("destination");
		expect(
			(
				await RepositoryOperation.write(root, {
					...finish,
					expectedToken: "stale",
				})
			).ok
		).toBe(false);
		await writeFile(join(root, "keep.txt"), "untracked stays\n");

		if (kind === "continue") {
			expect((await RepositoryOperation.write(root, finish)).ok).toBe(false);
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
						expectedHead: finish.expectedHead,
						expectedBranch: finish.expectedBranch,
						side: "theirs",
					})
				).ok
			).toBe(true);
		}

		const result = await RepositoryOperation.write(root, finish);

		expect(result.ok).toBe(true);
		expect((await snapshot()).operationState).toBe("normal");
		expect(await git("branch", "--show-current")).toBe("destination");
		expect(await git("rev-parse", "main")).toBe(head);
		expect(await git("show", "HEAD:a.txt")).toBe(
			kind === "continue" ? "selected change" : "destination overlap"
		);
		expect(await git("rev-parse", kind === "continue" ? "HEAD^" : "HEAD")).toBe(
			destination
		);
		expect(await readFile(join(root, "keep.txt"), "utf8")).toBe(
			"untracked stays\n"
		);
	});
}

it("does not bypass commit hooks, and exposes the switched destination after failure", async () => {
	const hooks = join(directory, "hooks");

	await mkdir(hooks);
	await writeFile(join(hooks, "prepare-commit-msg"), "#!/bin/sh\nexit 1\n");
	await chmod(join(hooks, "prepare-commit-msg"), 0o755);
	await git("config", "core.hooksPath", hooks);
	const result = await RepositoryHistory.cherryPick(root, request());

	expect(result.ok).toBe(false);
	expect(await git("branch", "--show-current")).toBe("destination");
	expect(await git("rev-parse", "HEAD")).toBe(destination);
	expect(await git("rev-parse", "main")).toBe(head);
	expect((await snapshot()).operationState).toBe("cherry-pick");
});

it("refuses to replay when a checkout hook introduces work on the destination", async () => {
	const hooks = join(directory, "hooks");

	await mkdir(hooks);
	await writeFile(
		join(hooks, "post-checkout"),
		"#!/bin/sh\nprintf 'hook work\\n' > hook-work.txt\n"
	);
	await chmod(join(hooks, "post-checkout"), 0o755);
	await git("config", "core.hooksPath", hooks);

	const result = await RepositoryHistory.cherryPick(root, request());

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.message).toContain("destination changed");

	expect(await git("branch", "--show-current")).toBe("destination");
	expect(await git("rev-parse", "HEAD")).toBe(destination);
	expect(await readFile(join(root, "hook-work.txt"), "utf8")).toBe(
		"hook work\n"
	);
	expect(await git("show", "HEAD:a.txt")).toBe("base");
});

it("does not silently skip an empty replay and allows Abort without returning to the source", async () => {
	await git("commit", "--allow-empty", "-m", "Empty source commit");
	commit = await git("rev-parse", "HEAD");
	head = commit;

	const result = await RepositoryHistory.cherryPick(root, request());

	expect(result.ok).toBe(false);
	expect((await snapshot()).operationState).toBe("cherry-pick");
	expect(
		(await RepositoryOperation.write(root, await finishRequest("abort"))).ok
	).toBe(true);
	expect(await git("branch", "--show-current")).toBe("destination");
	expect(await git("rev-parse", "HEAD")).toBe(destination);
	expect(await git("rev-parse", "main")).toBe(head);
});

it("rejects an already active Git operation without switching or altering its conflicts", async () => {
	await git("checkout", "-b", "conflict", base);
	await writeFile(join(root, "a.txt"), "conflicting change\n");
	await git("commit", "-am", "Conflicting change");
	await git("checkout", "main");
	await expect(git("cherry-pick", "conflict")).rejects.toThrow();
	const before = await git("status", "--porcelain");

	const result = await RepositoryHistory.cherryPick(root, request());

	expect(result.ok).toBe(false);
	expect(await git("branch", "--show-current")).toBe("main");
	expect(await git("rev-parse", "destination")).toBe(destination);
	expect(await git("status", "--porcelain")).toBe(before);
});
