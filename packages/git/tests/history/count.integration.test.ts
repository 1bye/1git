/**
 * Covers: full reachable commit counts, anchored revisions, shallow history and invalid/cancelled reads.
 * Real: Git backend and disposable local repositories.
 * Doubles: none.
 * Requires: Git and temporary storage; no network or user repositories.
 */
import { afterEach, expect, it } from "bun:test";
import { pathToFileURL } from "node:url";
import { GitRepository } from "../../src/repository.js";
import {
	RepositoryFixtures,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

it("counts the complete anchored history, including merge parents, without changing repository contents", async () => {
	const fixture = await fixtures.create();
	const first = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.git(["commit", "--allow-empty", "-m", "Second"]);
	await fixture.git(["commit", "--allow-empty", "-m", "Third"]);
	const head = await fixture.git(["rev-parse", "HEAD"]);
	const index = await fixture.git(["write-tree"]);

	await fixture.git(["checkout", "-b", "side", first]);
	await fixture.git(["commit", "--allow-empty", "-m", "Side commit"]);
	await fixture.git(["checkout", "main"]);
	expect(unwrapResult(await fixture.repository.getHistoryCount(head))).toBe(3);
	expect(unwrapResult(await fixture.repository.getHistoryCount(first))).toBe(1);
	expect(
		unwrapResult(await fixture.repository.getHistory({ limit: 2 })).commits
	).toHaveLength(2);
	await fixture.git(["merge", "--no-ff", "side", "-m", "Merge side"]);
	const merged = await fixture.git(["rev-parse", "HEAD"]);

	expect(unwrapResult(await fixture.repository.getHistoryCount(merged))).toBe(
		5
	);
	expect(unwrapResult(await fixture.repository.getHistoryCount(head))).toBe(3);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(merged);
	expect(await fixture.git(["write-tree"])).toBe(index);
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
});

it("reports invalid revisions and cancellation rather than returning a misleading zero", async () => {
	const fixture = await fixtures.create();

	for (const revision of ["", "--all", "nul\0revision"])
		expect(await fixture.repository.getHistoryCount(revision)).toMatchObject({
			ok: false,
			error: { operation: "get-history-count", code: "invalid-input" },
		});

	expect(
		(await fixture.repository.getHistoryCount("missing-reference")).ok
	).toBe(false);
	expect(
		await fixture.repository.getHistoryCount("HEAD", {
			signal: AbortSignal.abort(),
		})
	).toMatchObject({
		ok: false,
		error: { code: "aborted" },
	});
});

it("counts only available history in shallow clones and reports the shallow repository identity", async () => {
	const fixture = await fixtures.create();

	for (let index = 0; index < 3; index++)
		await fixture.git(["commit", "--allow-empty", "-m", `Commit ${index}`]);

	const cloned = unwrapResult(
		await GitRepository.clone({
			path: fixture.path("shallow"),
			remoteUrl: pathToFileURL(fixture.repositoryPath).href,
			depth: 2,
		})
	);

	expect(cloned.info.isShallow).toBe(true);
	expect(unwrapResult(await cloned.getHistoryCount("HEAD"))).toBe(2);
});
