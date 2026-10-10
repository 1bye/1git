/**
 * Covers: reset review, unpublished boundaries, preserved files/index, recovery, ancestry and stale/dirty/locked guards.
 * Real: Git and disposable repositories, local bare remotes and linked worktrees.
 * Doubles: none.
 * Requires: Git and temporary storage; no network or user repositories.
 */
import { afterEach, expect, it } from "bun:test";
import { chmod } from "node:fs/promises";
import { GitRepository } from "../../src/repository.js";
import type { ResetCommitInput } from "../../src/contracts.js";
import {
	RepositoryFixtures,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

async function setup() {
	const fixture = await fixtures.create();
	const target = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.write("one.txt", "one\n");
	const first = await fixture.commitAll("One");

	await fixture.write("README.md", "keep the final files\n");
	await fixture.write("two.txt", "two\n");
	const expectedHead = await fixture.commitAll("Two");

	const input: ResetCommitInput = {
		target,
		expectedHead,
		expectedBranch: "main",
	};

	return { fixture, input, first };
}

it("reviews without writes and resets multiple commits, keeping files/index and retaining tags, branches and old history", async () => {
	const { fixture, input } = await setup();
	const tree = await fixture.git(["write-tree"]);

	await fixture.git(["tag", "original", input.expectedHead]);
	await fixture.git(["branch", "other", input.expectedHead]);
	const plan = unwrapResult(await fixture.repository.getResetCommitPlan(input));

	expect(plan.target.oid).toBe(input.target);
	expect(plan.commitCount).toBe(2);
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);

	const result = unwrapResult(await fixture.repository.resetToCommit(input));

	expect(result.warning).toBeNull();
	expect(result.snapshot?.head.oid).toBe(input.target);
	expect(result.snapshot?.files.map((file) => file.path)).toEqual([
		"README.md",
		"one.txt",
		"two.txt",
	]);
	expect(await fixture.git(["rev-parse", result.recoveryRef])).toBe(
		input.expectedHead
	);
	expect(await fixture.git(["rev-parse", "original", "other"])).toBe(
		`${input.expectedHead}\n${input.expectedHead}`
	);
	expect(await fixture.git(["write-tree"])).toBe(tree);
	expect(await fixture.read("README.md")).toBe("keep the final files\n");
	expect(await fixture.read("one.txt")).toBe("one\n");
	expect(await fixture.read("two.txt")).toBe("two\n");
	expect(await fixture.git(["diff", "--name-only"])).toBe("");
	expect(await fixture.git(["diff", "--cached", "--name-only"])).toBe(
		"README.md\none.txt\ntwo.txt"
	);
});

it("allows resetting to the last published commit but refuses removing even one published commit", async () => {
	const { fixture, input, first } = await setup();
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	await fixture.git(["push", "origin", `${first}:refs/heads/main`]);
	const refused = await fixture.repository.resetToCommit(input);

	expect(refused.ok).toBe(false);

	if (!refused.ok) expect(refused.error.message).toContain("published");

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect(
		unwrapResult(
			await fixture.repository.getResetCommitPlan({ ...input, target: first })
		).commitCount
	).toBe(1);
	expect(
		unwrapResult(
			await fixture.repository.resetToCommit({ ...input, target: first })
		).snapshot?.head.oid
	).toBe(first);
});

it("rechecks publication after review, including other remote branches", async () => {
	const { fixture, input, first } = await setup();

	unwrapResult(await fixture.repository.getResetCommitPlan(input));
	await fixture.git(["update-ref", "refs/remotes/other/shared", first]);
	const result = await fixture.repository.resetToCommit(input);

	expect(result.ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect(
		await fixture.git([
			"for-each-ref",
			"--format=%(refname)",
			"refs/1git/reset",
		])
	).toBe("");
});

it("refuses current-tip/nonancestor/expression targets, stale identities and cancellation without changes", async () => {
	const { fixture, input } = await setup();

	await fixture.git(["checkout", "-b", "side", input.target]);
	await fixture.write("side.txt", "side\n");
	const side = await fixture.commitAll("Side");

	await fixture.git(["checkout", "main"]);

	for (const request of [
		{ ...input, target: input.expectedHead },
		{ ...input, target: side },
		{ ...input, target: "HEAD~1" },
		{ ...input, target: "f".repeat(40) },
		{ ...input, expectedHead: input.target },
		{ ...input, expectedBranch: "side" },
		{ ...input, expectedBranch: "main\ncreate refs/heads/injected" },
		{ ...input, signal: AbortSignal.abort() },
	])
		expect((await fixture.repository.resetToCommit(request)).ok).toBe(false);

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
	expect(
		await fixture.git([
			"for-each-ref",
			"--format=%(refname)",
			"refs/1git/reset",
		])
	).toBe("");

	await fixture.git(["checkout", "--detach"]);
	expect((await fixture.repository.resetToCommit(input)).ok).toBe(false);
});

it("refuses dirty, staged/untracked, active-operation and locked-index states without discarding work or another lock", async () => {
	const { fixture, input } = await setup();

	await fixture.write("one.txt", "staged\n");
	await fixture.git(["add", "one.txt"]);
	await fixture.write("one.txt", "working\n");
	await fixture.write("untracked.txt", "keep\n");
	const index = await fixture.git(["write-tree"]);

	expect((await fixture.repository.resetToCommit(input)).ok).toBe(false);
	expect(await fixture.git(["write-tree"])).toBe(index);
	expect(await fixture.read("one.txt")).toBe("working\n");
	expect(await fixture.read("untracked.txt")).toBe("keep\n");

	await fixture.git(["restore", "--staged", "one.txt"]);
	await fixture.git(["restore", "one.txt"]);
	await fixture.remove("untracked.txt");
	await fixture.write(".git/MERGE_HEAD", `${input.expectedHead}\n`);
	expect((await fixture.repository.resetToCommit(input)).ok).toBe(false);
	await fixture.remove(".git/MERGE_HEAD");
	await fixture.write(".git/index.lock", "owned by another process\n");
	const result = await fixture.repository.resetToCommit(input);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.code).toBe("repository-locked");

	expect(await fixture.read(".git/index.lock")).toBe(
		"owned by another process\n"
	);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
});

it("counts merge-side commits and refuses published side history even when the main tip is unpublished", async () => {
	const { fixture, input } = await setup();

	await fixture.git(["checkout", "-b", "side", input.target]);
	await fixture.write("side.txt", "side\n");
	const side = await fixture.commitAll("Side");

	await fixture.git(["checkout", "main"]);
	await fixture.git(["merge", "--no-ff", "side", "-m", "Merge"]);
	const expectedHead = await fixture.git(["rev-parse", "HEAD"]);
	const request = { ...input, expectedHead };

	expect(
		unwrapResult(await fixture.repository.getResetCommitPlan(request))
			.commitCount
	).toBe(4);
	await fixture.git(["update-ref", "refs/remotes/origin/side", side]);
	expect((await fixture.repository.resetToCommit(request)).ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(expectedHead);
});

it("resets a linked worktree branch without changing the primary branch or files", async () => {
	const { fixture, input } = await setup();
	const linked = fixture.path("linked");

	await fixture.git([
		"worktree",
		"add",
		"-b",
		"linked",
		linked,
		input.expectedHead,
	]);
	const repository = unwrapResult(await GitRepository.open({ path: linked }));

	const result = unwrapResult(
		await repository.resetToCommit({ ...input, expectedBranch: "linked" })
	);

	expect(result.snapshot?.head.oid).toBe(input.target);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
	expect(await fixture.read("two.txt")).toBe("two\n");
});

it("rejects shallow history and a failed ref transaction without moving HEAD or leaving a recovery ref or index lock", async () => {
	const { fixture, input } = await setup();

	await fixture.write(".git/shallow", `${input.target}\n`);
	const shallow = unwrapResult(
		await GitRepository.open({ path: fixture.repositoryPath })
	);

	const refused = await shallow.resetToCommit(input);

	expect(refused.ok).toBe(false);

	if (!refused.ok) expect(refused.error.message).toContain("shallow");

	await fixture.remove(".git/shallow");
	await fixture.write(
		".git/hooks/reference-transaction",
		'#!/bin/sh\nif [ "$1" = prepared ]; then exit 1; fi\n'
	);
	await chmod(
		`${fixture.repositoryPath}/.git/hooks/reference-transaction`,
		0o755
	);
	const failed = await fixture.repository.resetToCommit(input);

	expect(failed.ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect(
		await fixture.git([
			"for-each-ref",
			"--format=%(refname)",
			"refs/1git/reset",
		])
	).toBe("");
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
	await fixture.remove(".git/hooks/reference-transaction");
	expect(
		unwrapResult(await fixture.repository.resetToCommit(input)).snapshot?.head
			.oid
	).toBe(input.target);
});
