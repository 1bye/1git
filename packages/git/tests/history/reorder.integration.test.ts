/**
 * Covers: isolated unpublished reordering, replay, authors/messages, root/empty commits, guards and recovery.
 * Real: Git and disposable repositories, local remotes and worktrees.
 * Doubles: none.
 * Requires: Git and temporary storage; no network or user repositories.
 */
import { afterEach, expect, it } from "bun:test";
import { chmod } from "node:fs/promises";
import type { ReorderCommitsInput } from "../../src/contracts.js";
import { GitRepository } from "../../src/repository.js";
import { GitProcess } from "../../src/process/git-process.js";
import {
	RepositoryFixtures,
	unwrapResult,
	type RepositoryFixture,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

async function setup(): Promise<{
	fixture: RepositoryFixture;
	commits: string[];
	input: ReorderCommitsInput;
}> {
	const fixture = await fixtures.create();

	await fixture.git(["config", "commit.gpgsign", "false"]);
	const commits = [await fixture.git(["rev-parse", "HEAD"])];

	for (const name of ["One", "Two", "Three"]) {
		await fixture.git(["config", "user.name", `${name} Author`]);
		await fixture.write(`${name}.txt`, `${name}\n`);
		commits.push(await fixture.commitAll(`${name}\n\n${name} description`));
	}

	const selected = [commits[2] ?? "", commits[1] ?? ""];

	return {
		fixture,
		commits,
		input: {
			commits: selected,
			order: selected,
			expectedHead: commits[3] ?? "",
			expectedBranch: "main",
		},
	};
}

it("reorders a middle range, replays later commits and preserves files/index/messages/authors and original refs", async () => {
	const { fixture, commits, input } = await setup();
	const tree = await fixture.git(["write-tree"]);

	await fixture.git(["tag", "original", input.expectedHead]);
	await fixture.git(["branch", "other", input.expectedHead]);
	const metadata = await Promise.all(
		commits
			.slice(1)
			.map(
				async (oid) =>
					await fixture.git(["show", "-s", "--format=%an <%ae> %aI%n%B", oid])
			)
	);

	const plan = unwrapResult(await fixture.repository.getReorderPlan(input));

	expect(plan.commits.map((commit) => commit.oid)).toEqual([...input.commits]);
	expect(plan.replay.map((commit) => commit.oid)).toEqual([input.expectedHead]);
	const result = unwrapResult(await fixture.repository.reorderCommits(input));

	expect(result.oid).not.toBe(input.expectedHead);
	expect(result.warning).toBeNull();
	expect(result.snapshot?.files).toEqual([]);
	expect(result.recoveryRef).toStartWith("refs/1git/reorder/");
	expect(await fixture.git(["rev-parse", result.recoveryRef])).toBe(
		input.expectedHead
	);
	expect(await fixture.git(["rev-parse", "refs/tags/original"])).toBe(
		input.expectedHead
	);
	expect(await fixture.git(["rev-parse", "refs/heads/other"])).toBe(
		input.expectedHead
	);
	expect(await fixture.git(["write-tree"])).toBe(tree);
	expect(await fixture.git(["rev-parse", "HEAD^{tree}"])).toBe(tree);
	expect(await fixture.git(["log", "--format=%s"])).toBe(
		"Three\nOne\nTwo\ninitial commit"
	);

	for (const [revision, index] of [
		["HEAD", 2],
		["HEAD~1", 0],
		["HEAD~2", 1],
	] as const)
		expect(
			await fixture.git(["show", "-s", "--format=%an <%ae> %aI%n%B", revision])
		).toBe(metadata[index] ?? "");

	expect(await fixture.read("One.txt")).toBe("One\n");
	expect(
		(await fixture.git(["worktree", "list", "--porcelain"])).match(/worktree /g)
	).toHaveLength(1);
});

it("retains intentionally empty selected and later commits", async () => {
	const { fixture, input } = await setup();

	await fixture.git(["commit", "--allow-empty", "-m", "Empty selected"]);
	const empty = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.git(["commit", "--allow-empty", "-m", "Empty later"]);
	const head = await fixture.git(["rev-parse", "HEAD"]);

	unwrapResult(
		await fixture.repository.reorderCommits({
			...input,
			expectedHead: head,
			commits: [empty, input.expectedHead],
			order: [empty, input.expectedHead],
		})
	);
	expect(await fixture.git(["log", "-3", "--format=%s"])).toBe(
		"Empty later\nThree\nEmpty selected"
	);
	expect(await fixture.git(["rev-list", "--count", "HEAD"])).toBe("6");
});

it("supports a selected root that stays first, but refuses moving the root", async () => {
	const { fixture, commits, input } = await setup();
	const root = commits[0] ?? "";
	const selected = [...commits].reverse();

	expect(
		(
			await fixture.repository.reorderCommits({
				...input,
				commits: selected,
				order: [commits[1] ?? "", root, ...commits.slice(2)],
			})
		).ok
	).toBe(false);
	unwrapResult(
		await fixture.repository.reorderCommits({
			...input,
			commits: selected,
			order: [root, commits[2] ?? "", commits[1] ?? "", input.expectedHead],
		})
	);
	expect(await fixture.git(["rev-list", "--max-parents=0", "HEAD"])).toBe(root);
	expect(await fixture.git(["log", "--format=%s"])).toBe(
		"Three\nOne\nTwo\ninitial commit"
	);
});

it("refuses missing, duplicate, foreign and unchanged orders and nonconsecutive ranges", async () => {
	const { fixture, commits, input } = await setup();

	for (const order of [
		[],
		[input.commits[0] ?? ""],
		[input.commits[0] ?? "", input.commits[0] ?? ""],
		[input.expectedHead, input.commits[0] ?? ""],
		[...input.commits].reverse(),
	])
		expect(
			(await fixture.repository.reorderCommits({ ...input, order })).ok
		).toBe(false);

	for (const selected of [
		[input.expectedHead],
		[input.expectedHead, commits[1] ?? ""],
		["HEAD", "HEAD~1"],
		[...input.commits].reverse(),
	])
		expect(
			(
				await fixture.repository.reorderCommits({
					...input,
					commits: selected,
					order: selected,
				})
			).ok
		).toBe(false);

	expect(
		(
			await fixture.repository.getReorderPlan({
				...input,
				order: [...input.commits].reverse(),
			})
		).ok
	).toBe(true);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect(
		await fixture.git([
			"for-each-ref",
			"--format=%(refname)",
			"refs/1git/reorder/",
		])
	).toBe("");
});

it("refuses dirty/staged/untracked files, stale identities, active operations, cancellation and detached HEAD", async () => {
	const { fixture, input } = await setup();

	for (const request of [
		{ ...input, expectedHead: "b".repeat(40) },
		{ ...input, expectedBranch: "other" },
		{ ...input, signal: AbortSignal.abort() },
	])
		expect((await fixture.repository.reorderCommits(request)).ok).toBe(false);

	await fixture.write("One.txt", "staged\n");
	await fixture.git(["add", "One.txt"]);
	await fixture.write("One.txt", "working\n");
	await fixture.write("untracked.txt", "keep\n");
	const index = await fixture.git(["write-tree"]);

	expect((await fixture.repository.reorderCommits(input)).ok).toBe(false);
	expect(await fixture.git(["write-tree"])).toBe(index);
	expect(await fixture.read("One.txt")).toBe("working\n");
	await fixture.git(["restore", "--staged", "One.txt"]);
	await fixture.git(["restore", "One.txt"]);
	await fixture.remove("untracked.txt");
	await fixture.write(".git/MERGE_HEAD", `${input.expectedHead}\n`);
	expect((await fixture.repository.reorderCommits(input)).ok).toBe(false);
	await fixture.remove(".git/MERGE_HEAD");
	await fixture.git(["checkout", "--detach"]);
	expect((await fixture.repository.reorderCommits(input)).ok).toBe(false);
});

it("refuses publication, even when only the oldest selected commit is on a known remote", async () => {
	const { fixture, commits, input } = await setup();
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	await fixture.git(["push", "origin", `${commits[1]}:refs/heads/main`]);
	const result = await fixture.repository.reorderCommits(input);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.message).toContain("published");

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
});

it("refuses merge history and a range from another branch", async () => {
	const { fixture, commits, input } = await setup();

	await fixture.git(["checkout", "-b", "side", commits[0] ?? ""]);
	await fixture.write("side.txt", "side\n");
	const side = await fixture.commitAll("Side");

	await fixture.git(["checkout", "main"]);
	expect(
		(
			await fixture.repository.reorderCommits({
				...input,
				commits: [side, commits[0] ?? ""],
				order: [commits[0] ?? "", side],
			})
		).ok
	).toBe(false);
	await fixture.git(["merge", "--no-ff", "side", "-m", "Merge"]);
	const head = await fixture.git(["rev-parse", "HEAD"]);

	expect(
		(await fixture.repository.reorderCommits({ ...input, expectedHead: head }))
			.ok
	).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
});

it("rejects dependent replay conflicts without touching the branch, files or index", async () => {
	const { fixture, input } = await setup();

	await fixture.write("One.txt", "modified later\n");
	const tip = await fixture.commitAll("Depends on One");
	const index = await fixture.git(["write-tree"]);
	const selected = [tip, input.expectedHead, ...input.commits];

	const result = await fixture.repository.reorderCommits({
		...input,
		expectedHead: tip,
		commits: selected,
		order: [tip, ...selected.slice(1).reverse()],
	});

	expect(result.ok).toBe(false);

	if (!result.ok) {
		expect(result.error.code).toBe("conflict");
		expect(result.error.message).toContain("unchanged");
	}

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(tip);
	expect(await fixture.git(["write-tree"])).toBe(index);
	expect(await fixture.read("One.txt")).toBe("modified later\n");
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
	expect(
		(await fixture.git(["worktree", "list", "--porcelain"])).match(/worktree /g)
	).toHaveLength(1);
	expect(
		await fixture.git([
			"for-each-ref",
			"--format=%(refname)",
			"refs/1git/reorder/",
		])
	).toBe("");
});

it("rejects a conflict-free replay when it would change the final file contents", async () => {
	const fixture = await fixtures.create();

	await fixture.write("README.md", "# Changed\n");
	const first = await fixture.commitAll("Change README");

	await fixture.write("README.md", "# Test repository\n");
	const tip = await fixture.commitAll("Undo README change");

	const result = await fixture.repository.reorderCommits({
		expectedHead: tip,
		expectedBranch: "main",
		commits: [tip, first],
		order: [tip, first],
	});

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.message).toContain("resulting files");

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(tip);
	expect(await fixture.read("README.md")).toBe("# Test repository\n");
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
});

it("rejects hook-altered final files and honors another process's index lock", async () => {
	const { fixture, input } = await setup();

	await fixture.write(".git/index.lock", "owned elsewhere\n");
	const locked = await fixture.repository.reorderCommits(input);

	expect(locked.ok).toBe(false);

	if (!locked.ok) expect(locked.error.code).toBe("repository-locked");

	expect(await fixture.read(".git/index.lock")).toBe("owned elsewhere\n");
	await fixture.remove(".git/index.lock");
	await fixture.write(
		".git/hooks/post-commit",
		"#!/bin/sh\ngit read-tree --empty\n"
	);
	await chmod(`${fixture.repositoryPath}/.git/hooks/post-commit`, 0o755);
	await fixture.git(["config", "core.hooksPath", ".git/hooks"]);
	const result = await fixture.repository.reorderCommits(input);

	expect(result.ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
});

it("does not overwrite branch movement by an external writer during replay", async () => {
	const { fixture, commits, input } = await setup();
	const moved = commits[2] ?? "";

	await fixture.write(
		".git/hooks/post-commit",
		`#!/bin/sh\ngit update-ref refs/heads/main ${moved}\n`
	);
	await chmod(`${fixture.repositoryPath}/.git/hooks/post-commit`, 0o755);
	const result = await fixture.repository.reorderCommits(input);

	expect(result.ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(moved);
	expect(
		await fixture.git([
			"for-each-ref",
			"--format=%(refname)",
			"refs/1git/reorder/",
		])
	).toBe("");
	expect(
		(await fixture.git(["worktree", "list", "--porcelain"])).match(/worktree /g)
	).toHaveLength(1);
});

it("works from a linked worktree without moving other branches or changing their files", async () => {
	const { fixture, input } = await setup();
	const linkedPath = fixture.path("linked");

	await fixture.git(["worktree", "add", "-b", "linked", "--", linkedPath]);
	const linked = unwrapResult(await GitRepository.open({ path: linkedPath }));

	const result = unwrapResult(
		await linked.reorderCommits({ ...input, expectedBranch: "linked" })
	);

	expect(result.snapshot?.files).toEqual([]);
	expect(await fixture.git(["rev-parse", "refs/heads/linked"])).toBe(
		result.oid
	);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
	expect(await fixture.read("One.txt")).toBe("One\n");
	expect(
		(await fixture.git(["worktree", "list", "--porcelain"])).match(/worktree /g)
	).toHaveLength(2);
});

it("requires full history for shallow repositories", async () => {
	const { fixture, input } = await setup();
	const shallowPath = fixture.path("shallow");

	await new GitProcess().run({
		args: [
			"clone",
			"--depth=2",
			"--no-local",
			"--",
			fixture.repositoryPath,
			shallowPath,
		],
		cwd: fixture.sandboxPath,
	});
	const shallow = unwrapResult(await GitRepository.open({ path: shallowPath }));
	const result = await shallow.getReorderPlan(input);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.message).toContain("full history");
});
