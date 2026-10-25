/**
 * Covers: multi-tip topological pagination, immutable tips and invalid graph inputs.
 * Real: GitRepository, Git process and disposable repositories with unmerged/merged branches.
 * Doubles: none.
 * Requires: Git and writable temporary storage; no network.
 */
import { afterEach, expect, it } from "bun:test";
import { RepositoryFixture, unwrapResult } from "../_shared/repository-fixture";

let fixture: RepositoryFixture | undefined;

afterEach(async () => {
	await fixture?.cleanup();
});

it("includes unmerged tips and paginates a merge without losing parent order or changing the worktree", async () => {
	fixture = await RepositoryFixture.create();
	const root = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.git(["checkout", "-b", "feature"]);
	await fixture.git(["commit", "--allow-empty", "-m", "Feature"]);
	const feature = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.git(["checkout", "main"]);
	await fixture.git(["commit", "--allow-empty", "-m", "Main"]);
	const main = await fixture.git(["rev-parse", "HEAD"]);
	const tips = [main, feature];

	const first = unwrapResult(
		await fixture.repository.getHistory({
			revisions: tips,
			topoOrder: true,
			limit: 2,
		})
	);

	expect(new Set(first.commits.map((commit) => commit.oid))).toEqual(
		new Set(tips)
	);
	expect(first.nextOffset).toBe(2);

	// Moving the named branch cannot change the next page of the captured tips.
	await fixture.git(["commit", "--allow-empty", "-m", "Later"]);
	const second = unwrapResult(
		await fixture.repository.getHistory({
			revisions: tips,
			topoOrder: true,
			limit: 2,
			offset: 2,
		})
	);

	expect(second.commits.map((commit) => commit.oid)).toEqual([root]);
	expect(second.hasMore).toBe(false);
	await fixture.git(["merge", "--no-ff", "feature", "-m", "Merge feature"]);
	const merged = await fixture.git(["rev-parse", "HEAD"]);

	const graph = unwrapResult(
		await fixture.repository.getHistory({
			revisions: [merged, feature],
			topoOrder: true,
		})
	);

	const order = new Map(
		graph.commits.map((commit, index) => [commit.oid, index])
	);

	for (const [index, commit] of graph.commits.entries())
		for (const parent of commit.parentOids)
			expect(order.get(parent)).toBeGreaterThan(index);

	expect(await fixture.git(["branch", "--show-current"])).toBe("main");
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
});

it("rejects empty, conflicting and option-like graph tips", async () => {
	fixture = await RepositoryFixture.create();
	const head = await fixture.git(["rev-parse", "HEAD"]);

	for (const input of [
		{ revisions: [] },
		{ revisions: ["--all"] },
		{ revisions: [head], revision: head },
		{ revisions: [head], filePath: "README.md" },
	]) {
		const result = await fixture.repository.getHistory(input);

		expect(result.ok).toBe(false);
	}
});
