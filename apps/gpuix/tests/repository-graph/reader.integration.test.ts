/**
 * Covers: local/remote/tag ref labels, detached and unborn heads, non-commit tags and anchored graph pages.
 * Real: graph reader, shared Git backend and disposable repositories.
 * Doubles: none.
 * Requires: Git and writable temporary storage; no network or graphics.
 */
import { afterEach, expect, it } from "bun:test";
import {
	RepositoryFixture,
	unwrapResult,
} from "../../../../packages/git/tests/_shared/repository-fixture";
import { RepositoryGraphReader } from "../../src/feature/repository-graph/repository-graph-reader";

let fixture: RepositoryFixture | undefined;
const signal = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
	await fixture?.cleanup();
});

it("reads all branch and tag tips without fetching or checking out a branch", async () => {
	fixture = await RepositoryFixture.create();
	const head = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.git(["branch", "feature/search"]);
	await fixture.git(["update-ref", "refs/remotes/origin/main", head]);
	await fixture.git(["tag", "v1"]);
	await fixture.git(["tag", "-a", "v2", "-m", "Release"]);
	const refs = unwrapResult(
		await RepositoryGraphReader.references(
			fixture.repositoryPath,
			head,
			signal()
		)
	);

	expect(refs.references).toContainEqual({
		id: "refs/heads/main",
		name: "main",
		oid: head,
		kind: "local",
		current: true,
	});
	expect(refs.references).toContainEqual({
		id: "refs/remotes/origin/main",
		name: "origin/main",
		oid: head,
		kind: "remote",
		current: false,
	});
	expect(
		refs.references.filter((ref) => ref.kind === "tag").map((ref) => ref.oid)
	).toEqual([head, head]);
	const page = unwrapResult(
		await RepositoryGraphReader.page(
			fixture.repositoryPath,
			[...new Set(refs.references.map((ref) => ref.oid))],
			0,
			signal()
		)
	);

	expect(page.commits.map((commit) => commit.oid)).toEqual([head]);
	await fixture.git(["checkout", "--detach", head]);
	const detached = unwrapResult(
		await RepositoryGraphReader.references(
			fixture.repositoryPath,
			head,
			signal()
		)
	);

	expect(detached.head).toBe(head);
	expect(detached.references.some((ref) => ref.current)).toBe(false);
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
});

it("does not invent commits for an unborn repository or a tag pointing to a tree", async () => {
	fixture = await RepositoryFixture.create({ initialCommit: false });
	const refs = unwrapResult(
		await RepositoryGraphReader.references(
			fixture.repositoryPath,
			null,
			signal()
		)
	);

	expect(refs.references).toEqual([]);
	expect(
		unwrapResult(
			await RepositoryGraphReader.page(fixture.repositoryPath, [], 0, signal())
		).commits
	).toEqual([]);
	await fixture.write("README.md", "content\n");
	await fixture.git(["add", "README.md"]);
	await fixture.git(["commit", "-m", "Root"]);
	const head = await fixture.git(["rev-parse", "HEAD"]);
	const tree = await fixture.git(["rev-parse", "HEAD^{tree}"]);

	await fixture.git(["tag", "tree", tree]);
	const page = unwrapResult(
		await RepositoryGraphReader.page(
			fixture.repositoryPath,
			[head, tree],
			0,
			signal()
		)
	);

	expect(page.commits.map((commit) => commit.oid)).toEqual([head]);
	expect(
		unwrapResult(
			await RepositoryGraphReader.page(
				fixture.repositoryPath,
				[tree],
				0,
				signal()
			)
		).commits
	).toEqual([]);
});
