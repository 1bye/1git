/**
 * Covers: local undo, excluded staging, roots, linked worktrees and published/stale guards.
 * Real: Git, indexes, refs, hooks and disposable repositories.
 * Doubles: none.
 * Requires: Git and writable temporary storage; no network.
 */
import { afterEach, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GitRepository } from "../../src/repository.js";
import {
	RepositoryFixtures,
	type RepositoryFixture,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

const review = async (fixture: RepositoryFixture) => {
	const snapshot = unwrapResult(await fixture.repository.getSnapshot());

	if (!snapshot.head.oid || !snapshot.head.branch)
		throw new Error("Fixture has no branch tip");

	return {
		expectedHead: snapshot.head.oid,
		expectedBranch: snapshot.head.branch,
	};
};

it("undo keeps working files, excluded staging and the original commit, then returns its full message", async () => {
	const fixture = await fixtures.create();
	const parent = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.write("a.txt", "committed\n");
	const tip = await fixture.commitAll("Feature\n\nDetails");

	await fixture.write("a.txt", "additional edits\n");
	await fixture.write("excluded.txt", "staged\n");
	await fixture.git(["add", "excluded.txt"]);
	await fixture.write("excluded.txt", "working\n");
	const index = await readFile(join(fixture.repositoryPath, ".git/index"));

	const result = unwrapResult(
		await fixture.repository.undoCommit(await review(fixture))
	);

	expect(result.snapshot?.head.oid).toBe(parent);
	expect(result.message).toBe("Feature\n\nDetails");
	expect(result.warning).toBeNull();
	expect(await fixture.git(["rev-parse", result.recoveryRef])).toBe(tip);
	expect(await readFile(join(fixture.repositoryPath, ".git/index"))).toEqual(
		index
	);
	expect(await fixture.read("a.txt")).toBe("additional edits\n");
	expect(await fixture.git(["show", ":excluded.txt"])).toBe("staged");
	expect(await fixture.read("excluded.txt")).toBe("working\n");
});

it("undo of the first commit returns to an unborn branch without deleting files", async () => {
	const fixture = await fixtures.create();

	const result = unwrapResult(
		await fixture.repository.undoCommit(await review(fixture))
	);

	expect(result.snapshot?.head.unborn).toBe(true);
	expect(result.snapshot?.head.branch).toBe("main");
	expect(await fixture.read("README.md")).toBe("# Test repository\n");
	expect(await fixture.git(["show", `${result.recoveryRef}:README.md`])).toBe(
		"# Test repository"
	);
});

it("rejects a tip published to any known remote, even without upstream", async () => {
	const fixture = await fixtures.create();
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	await fixture.git(["push", "origin", "main"]);
	const input = await review(fixture);

	expect((await fixture.repository.getCommitRecovery(input)).ok).toBe(false);
	expect((await fixture.repository.undoCommit(input)).ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
});

it("rejects stale review, detached HEAD and conflicted/merge states without ref changes", async () => {
	const fixture = await fixtures.create();
	const input = await review(fixture);

	await fixture.write("next.txt", "next\n");
	const next = await fixture.commitAll("Next");

	expect((await fixture.repository.undoCommit(input)).ok).toBe(false);
	await fixture.git(["checkout", "--detach"]);
	expect(
		(
			await fixture.repository.undoCommit({
				expectedHead: next,
				expectedBranch: "main",
			})
		).ok
	).toBe(false);
	await fixture.git(["checkout", "main"]);
	await writeFile(
		join(fixture.repositoryPath, ".git/MERGE_HEAD"),
		`${input.expectedHead}\n`
	);
	expect((await fixture.repository.undoCommit(await review(fixture))).ok).toBe(
		false
	);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(next);
});

it("undo works in a linked worktree without changing the main checkout", async () => {
	const fixture = await fixtures.create();
	const main = await fixture.git(["rev-parse", "HEAD"]);
	const path = fixture.path("linked");

	await fixture.git(["worktree", "add", "-b", "feature", path]);
	const repository = unwrapResult(await GitRepository.open({ path }));

	await writeFile(join(path, "new.txt"), "new\n");
	unwrapResult(await repository.stage({ paths: ["new.txt"] }));
	const written = unwrapResult(await repository.commit({ summary: "Feature" }));
	const snapshot = unwrapResult(await repository.getSnapshot());

	unwrapResult(
		await repository.undoCommit({
			expectedHead: snapshot.head.oid ?? "",
			expectedBranch: "feature",
		})
	);

	expect(unwrapResult(await repository.getSnapshot()).head.oid).toBe(main);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(main);
	expect(await readFile(join(path, "new.txt"), "utf8")).toBe("new\n");
	expect(written.commit.oid).not.toBe(main);
});
