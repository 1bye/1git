/**
 * Covers: reviewed range squashing, later replay, root commits, publication/identity guards, hooks, failures and recovery.
 * Real: Git and disposable repositories, remotes and worktrees.
 * Doubles: none.
 * Requires: Git and temporary storage; no network or user repositories.
 */
import { afterEach, expect, it } from "bun:test";
import { chmod } from "node:fs/promises";
import type { SquashCommitsInput } from "../../src/contracts.js";
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
	input: SquashCommitsInput;
}> {
	const fixture = await fixtures.create();

	await fixture.git(["config", "commit.gpgsign", "false"]);
	const commits = [await fixture.git(["rev-parse", "HEAD"])];

	for (const name of ["One", "Two", "Three"]) {
		await fixture.git([
			"config",
			"user.name",
			name === "One" ? "Original Author" : "Current Committer",
		]);
		await fixture.write(`${name}.txt`, `${name}\n`);
		commits.push(await fixture.commitAll(name));
	}

	return {
		fixture,
		commits,
		input: {
			commits: [commits[2] ?? "", commits[1] ?? ""],
			expectedHead: commits[3] ?? "",
			expectedBranch: "main",
			message: "Combined\n\nOne and Two",
		},
	};
}

it("squashes a middle range, replays later commits, preserves files/index/authors and retains original history", async () => {
	const { fixture, commits, input } = await setup();
	const tree = await fixture.git(["write-tree"]);

	await fixture.git(["tag", "original", input.expectedHead]);
	await fixture.git(["branch", "other", input.expectedHead]);

	const originalAuthor = await fixture.git([
		"show",
		"-s",
		"--format=%an <%ae> %aI",
		commits[1] ?? "",
	]);

	const plan = unwrapResult(await fixture.repository.getSquashPlan(input));

	expect(plan.commits.map((commit) => commit.oid)).toEqual([...input.commits]);
	expect(plan.replay.map((commit) => commit.oid)).toEqual([input.expectedHead]);
	const result = unwrapResult(await fixture.repository.squashCommits(input));

	expect(result.oid).not.toBe(input.expectedHead);
	expect(result.warning).toBeNull();
	expect(result.snapshot?.files).toEqual([]);
	expect(await fixture.git(["write-tree"])).toBe(tree);
	expect(await fixture.git(["rev-parse", "HEAD^{tree}"])).toBe(tree);
	expect(await fixture.git(["rev-parse", result.recoveryRef])).toBe(
		input.expectedHead
	);
	expect(await fixture.git(["rev-parse", "refs/tags/original"])).toBe(
		input.expectedHead
	);
	expect(await fixture.git(["rev-parse", "refs/heads/other"])).toBe(
		input.expectedHead
	);
	expect(await fixture.git(["log", "--format=%s"])).toBe(
		"Three\nCombined\ninitial commit"
	);
	expect(await fixture.git(["show", "-s", "--format=%B", "HEAD~1"])).toBe(
		input.message
	);
	expect(
		await fixture.git(["show", "-s", "--format=%an <%ae> %aI", "HEAD~1"])
	).toBe(originalAuthor);
	expect(await fixture.read("One.txt")).toBe("One\n");
	expect(
		(await fixture.git(["worktree", "list", "--porcelain"])).match(/worktree /g)
	).toHaveLength(1);
});

it("preserves intentionally empty later commits when replaying", async () => {
	const { fixture, input } = await setup();

	await fixture.git(["commit", "--allow-empty", "-m", "Empty"]);
	const expectedHead = await fixture.git(["rev-parse", "HEAD"]);
	const tree = await fixture.git(["write-tree"]);

	const result = unwrapResult(
		await fixture.repository.squashCommits({ ...input, expectedHead })
	);

	expect(await fixture.git(["log", "--format=%s"])).toBe(
		"Empty\nThree\nCombined\ninitial commit"
	);
	expect(await fixture.git(["rev-parse", "HEAD^{tree}"])).toBe(tree);
	expect(await fixture.git(["rev-parse", result.recoveryRef])).toBe(
		expectedHead
	);
});

it("refuses an existing index lock without removing another process's lock", async () => {
	const { fixture, input } = await setup();

	await fixture.write(".git/index.lock", "owned by another process\n");
	const result = await fixture.repository.squashCommits(input);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.code).toBe("repository-locked");

	expect(await fixture.read(".git/index.lock")).toBe(
		"owned by another process\n"
	);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
});

it("squashes through the tip and supports the root without changing its author or producing an extra parent", async () => {
	const { fixture, commits, input } = await setup();

	const result = unwrapResult(
		await fixture.repository.squashCommits({
			...input,
			commits: [...commits].reverse(),
		})
	);

	expect(await fixture.git(["rev-list", "--count", "HEAD"])).toBe("1");
	expect(await fixture.git(["show", "-s", "--format=%P", "HEAD"])).toBe("");
	expect(await fixture.git(["rev-parse", result.recoveryRef])).toBe(
		input.expectedHead
	);
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
});

it("refuses single, duplicate, nonconsecutive, reversed and revision-expression selections", async () => {
	const { fixture, commits, input } = await setup();

	for (const selected of [
		[input.expectedHead],
		[input.expectedHead, input.expectedHead],
		[commits[3] ?? "", commits[1] ?? ""],
		[...input.commits].reverse(),
		["HEAD", "HEAD~1"],
	])
		expect(
			(await fixture.repository.squashCommits({ ...input, commits: selected }))
				.ok
		).toBe(false);

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
});

it("refuses dirty/staged/untracked files, active operations, stale identities, cancellation and detached HEAD", async () => {
	const { fixture, input } = await setup();

	for (const request of [
		{ ...input, expectedHead: "b".repeat(40) },
		{ ...input, expectedBranch: "other" },
		{ ...input, signal: AbortSignal.abort() },
	])
		expect((await fixture.repository.squashCommits(request)).ok).toBe(false);

	await fixture.write("One.txt", "keep staged\n");
	await fixture.git(["add", "One.txt"]);
	await fixture.write("One.txt", "keep working\n");
	await fixture.write("untracked.txt", "keep\n");
	const index = await fixture.git(["write-tree"]);

	expect((await fixture.repository.squashCommits(input)).ok).toBe(false);
	expect(await fixture.git(["write-tree"])).toBe(index);
	expect(await fixture.read("One.txt")).toBe("keep working\n");
	await fixture.git(["restore", "--staged", "One.txt"]);
	await fixture.git(["restore", "One.txt"]);
	await fixture.remove("untracked.txt");
	await fixture.write(".git/MERGE_HEAD", `${input.expectedHead}\n`);
	expect((await fixture.repository.squashCommits(input)).ok).toBe(false);
	await fixture.remove(".git/MERGE_HEAD");
	await fixture.git(["checkout", "--detach"]);
	expect((await fixture.repository.squashCommits(input)).ok).toBe(false);
});

it("refuses publication even when only part of the selected range is on a known remote", async () => {
	const { fixture, commits, input } = await setup();
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	await fixture.git(["push", "origin", `${commits[1]}:refs/heads/main`]);
	const result = await fixture.repository.squashCommits(input);

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
			await fixture.repository.squashCommits({
				...input,
				commits: [side, commits[0] ?? ""],
			})
		).ok
	).toBe(false);
	await fixture.git(["merge", "--no-ff", "side", "-m", "Merge"]);
	const head = await fixture.git(["rev-parse", "HEAD"]);

	const result = await fixture.repository.squashCommits({
		...input,
		expectedHead: head,
	});

	expect(result.ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
});

it("honors relative commit hooks and does not move the branch on hook failure", async () => {
	const { fixture, input } = await setup();

	await fixture.write(
		".git/hooks/pre-commit",
		"#!/bin/sh\necho Rejected >&2\nexit 1\n"
	);
	await chmod(`${fixture.repositoryPath}/.git/hooks/pre-commit`, 0o755);
	await fixture.git(["config", "core.hooksPath", ".git/hooks"]);
	const result = await fixture.repository.squashCommits(input);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.details).toContain("Rejected");

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
	expect(
		(await fixture.git(["worktree", "list", "--porcelain"])).match(/worktree /g)
	).toHaveLength(1);
});

it("does not overwrite external branch movement while hooks run", async () => {
	const { fixture, commits, input } = await setup();
	const moved = commits[2] ?? "";

	await fixture.write(
		".git/hooks/post-commit",
		`#!/bin/sh\ngit update-ref refs/heads/main ${moved} ${input.expectedHead}\n`
	);
	await chmod(`${fixture.repositoryPath}/.git/hooks/post-commit`, 0o755);
	const result = await fixture.repository.squashCommits(input);

	expect(result.ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(moved);
	expect(await fixture.read("Three.txt")).toBe("Three\n");
});
