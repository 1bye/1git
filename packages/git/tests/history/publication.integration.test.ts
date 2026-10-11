/**
 * Covers: batched publication checks, merged ancestry, other remotes, tags, ref refresh and invalid/cancelled reads.
 * Real: Git backend and disposable local repositories.
 * Doubles: none.
 * Requires: Git and temporary storage; no network or user repositories.
 */
import { afterEach, expect, it } from "bun:test";
import {
	RepositoryFixtures,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

it("checks actual remote ancestry rather than commit position or local tags", async () => {
	const fixture = await fixtures.create();
	const first = await fixture.git(["rev-parse", "HEAD"]);
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	await fixture.git(["push", "--set-upstream", "origin", "main"]);
	await fixture.git(["commit", "--allow-empty", "-m", "Local main"]);
	const local = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.git(["tag", "local-release", local]);
	await fixture.git(["checkout", "-b", "side", first]);
	await fixture.git(["commit", "--allow-empty", "-m", "Published side"]);
	const side = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.git(["push", "origin", "side"]);
	await fixture.git(["checkout", "main"]);
	await fixture.git(["merge", "--no-ff", "side", "-m", "Local merge"]);
	const merge = await fixture.git(["rev-parse", "HEAD"]);
	const before = await fixture.git(["status", "--porcelain=v2", "--branch"]);

	// Order can come from a search, file history or a later page, not a contiguous HEAD prefix.
	expect(
		unwrapResult(
			await fixture.repository.getUnpushedCommits([side, merge, first, local])
		)
	).toEqual([merge, local]);
	expect(await fixture.git(["status", "--porcelain=v2", "--branch"])).toBe(
		before
	);
	await fixture.git(["push", "origin", "main"]);
	expect(
		unwrapResult(
			await fixture.repository.getUnpushedCommits([side, merge, first, local])
		)
	).toEqual([]);
});

it("handles no tracking refs, duplicates, other remotes and large loaded lists", async () => {
	const fixture = await fixtures.create();
	const first = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.git(["commit", "--allow-empty", "-m", "Second"]);
	const second = await fixture.git(["rev-parse", "HEAD"]);

	expect(
		unwrapResult(
			await fixture.repository.getUnpushedCommits([second, first, second])
		)
	).toEqual([second, first]);
	await fixture.git(["update-ref", "refs/remotes/backup/main", second]);
	expect(
		unwrapResult(await fixture.repository.getUnpushedCommits([first, second]))
	).toEqual([]);
	expect(unwrapResult(await fixture.repository.getUnpushedCommits([]))).toEqual(
		[]
	);

	// More than one History page, with output bounded to the requested commits.
	const tree = await fixture.git(["rev-parse", "HEAD^{tree}"]);
	const oids: string[] = [];

	for (let index = 0; index < 501; index++)
		oids.push(
			await fixture.git([
				"commit-tree",
				tree,
				"-p",
				second,
				"-m",
				`Unpushed ${index}`,
			])
		);

	expect(
		unwrapResult(await fixture.repository.getUnpushedCommits(oids))
	).toEqual(oids);
}, 30_000);

it("does not misclassify known commits when committer clocks differ across ancestry", async () => {
	const fixture = await fixtures.create();
	const first = await fixture.git(["rev-parse", "HEAD"]);
	const tree = await fixture.git(["rev-parse", "HEAD^{tree}"]);

	const future = await fixture.git(
		["hash-object", "-t", "commit", "-w", "--stdin"],
		`tree ${tree}\nparent ${first}\nauthor Test <test@example.test> 2051222400 +0000\ncommitter Test <test@example.test> 2051222400 +0000\n\nFuture clock\n`
	);

	const remote = await fixture.git(
		["hash-object", "-t", "commit", "-w", "--stdin"],
		`tree ${tree}\nparent ${future}\nauthor Test <test@example.test> 946684800 +0000\ncommitter Test <test@example.test> 946684800 +0000\n\nOlder clock\n`
	);

	await fixture.git(["update-ref", "refs/remotes/origin/main", remote]);
	expect(
		unwrapResult(await fixture.repository.getUnpushedCommits([future]))
	).toEqual([]);
});

it("returns failures for invalid/missing IDs and cancelled queries, never guesses a publication status", async () => {
	const fixture = await fixtures.create();

	for (const oid of ["", "HEAD", "--all", "nul\0revision"])
		expect(await fixture.repository.getUnpushedCommits([oid])).toMatchObject({
			ok: false,
			error: { operation: "get-unpushed-commits", code: "invalid-input" },
		});

	expect(
		(await fixture.repository.getUnpushedCommits(["a".repeat(40)])).ok
	).toBe(false);
	const first = await fixture.git(["rev-parse", "HEAD"]);

	expect(
		await fixture.repository.getUnpushedCommits([first], {
			signal: AbortSignal.abort(),
		})
	).toMatchObject({ ok: false, error: { code: "aborted" } });
});
