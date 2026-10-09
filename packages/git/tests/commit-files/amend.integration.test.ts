/**
 * Covers: message-only/selected-file/partial amendments, author and recovery refs, hooks, stale/published/merge guards and worktrees.
 * Real: Git transactions, indexes and disposable repositories.
 * Doubles: none.
 * Requires: Git and writable temporary storage; no network.
 */
import { afterEach, expect, it } from "bun:test";
import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GitRepository } from "../../src/repository.js";
import {
	RepositoryFixtures,
	type RepositoryFixture,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

async function review(
	fixture: RepositoryFixture,
	paths: readonly string[] = []
) {
	const snapshot = unwrapResult(await fixture.repository.getSnapshot());

	return {
		amend: true,
		message: "Amended\n\nDetails",
		paths,
		expectedHead: snapshot.head.oid,
		expectedBranch: snapshot.head.branch,
	};
}

it("amends only the message, retaining the tree, author, parent, staged/working edits and old commit", async () => {
	const fixture = await fixtures.create();
	const parent = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.write("a.txt", "committed\n");
	const oldHead = await fixture.commitAll("Original");
	const author = await fixture.git(["show", "-s", "--format=%an <%ae> %aI"]);
	const tree = await fixture.git(["rev-parse", "HEAD^{tree}"]);

	await fixture.git(["config", "user.name", "New Committer"]);
	await fixture.git(["config", "user.email", "new-committer@example.invalid"]);
	await fixture.write("a.txt", "staged\n");
	await fixture.git(["add", "a.txt"]);
	await fixture.write("a.txt", "working\n");
	await fixture.write("untracked.txt", "untracked\n");
	const index = await fixture.git(["ls-files", "--stage"]);

	unwrapResult(await fixture.repository.commitFiles(await review(fixture)));

	expect(await fixture.git(["rev-parse", "HEAD"])).not.toBe(oldHead);
	expect(await fixture.git(["rev-parse", "HEAD^{tree}"])).toBe(tree);
	expect(await fixture.git(["rev-parse", "HEAD^"])).toBe(parent);
	expect(await fixture.git(["show", "-s", "--format=%an <%ae> %aI"])).toBe(
		author
	);
	expect(await fixture.git(["show", "-s", "--format=%cn <%ce>"])).toBe(
		"New Committer <new-committer@example.invalid>"
	);
	expect(await fixture.git(["log", "-1", "--format=%B"])).toBe(
		"Amended\n\nDetails"
	);
	expect(await fixture.git(["ls-files", "--stage"])).toBe(index);
	expect(await fixture.read("a.txt")).toBe("working\n");
	expect(await fixture.read("untracked.txt")).toBe("untracked\n");
	expect(
		await fixture.git([
			"for-each-ref",
			"--format=%(objectname)",
			"refs/1git/amend/",
		])
	).toBe(oldHead);
});

it("adds checked whole files without including unchecked staging or losing original commit changes", async () => {
	const fixture = await fixtures.create();

	await fixture.write("selected.txt", "original\n");
	await fixture.write("excluded.txt", "base\n");
	await fixture.write("original-only.txt", "retain\n");
	await fixture.commitAll("Original");
	const count = await fixture.git(["rev-list", "--count", "HEAD"]);

	await fixture.write("selected.txt", "selected\n");
	await fixture.write("new.txt", "new\n");
	await fixture.write("excluded.txt", "staged excluded\n");
	await fixture.git(["add", "excluded.txt"]);
	await fixture.write("excluded.txt", "working excluded\n");

	const result = unwrapResult(
		await fixture.repository.commitFiles(
			await review(fixture, ["selected.txt", "new.txt"])
		)
	);

	expect(result.outcome).toBe("committed");
	expect(result.warning).toBeNull();
	expect(await fixture.git(["rev-list", "--count", "HEAD"])).toBe(count);
	expect(await fixture.git(["show", "HEAD:selected.txt"])).toBe("selected");
	expect(await fixture.git(["show", "HEAD:new.txt"])).toBe("new");
	expect(await fixture.git(["show", "HEAD:original-only.txt"])).toBe("retain");
	expect(await fixture.git(["show", "HEAD:excluded.txt"])).toBe("base");
	expect(await fixture.git(["show", ":excluded.txt"])).toBe("staged excluded");
	expect(await fixture.read("excluded.txt")).toBe("working excluded\n");
});

it("amends selected lines and retains excluded lines and staging", async () => {
	const fixture = await fixtures.create();

	await fixture.write("partial.txt", "one\ntwo\nthree\n");
	await fixture.commitAll("Original");
	await fixture.write("partial.txt", "ONE\ntwo\nTHREE\n");
	await fixture.write("excluded.txt", "staged\n");
	await fixture.git(["add", "excluded.txt"]);
	const input = await review(fixture, ["partial.txt"]);

	const { patch } = unwrapResult(
		await fixture.repository.getDiff({
			paths: ["partial.txt"],
			target: { kind: "changes" },
		})
	);

	unwrapResult(
		await fixture.repository.commitFiles({
			...input,
			partialFiles: [
				{
					path: "partial.txt",
					expectedPatch: patch,
					includedLines: ["-:1", "+:1"],
				},
			],
		})
	);

	expect(await fixture.git(["show", "HEAD:partial.txt"])).toBe(
		"ONE\ntwo\nthree"
	);
	expect(await fixture.read("partial.txt")).toBe("ONE\ntwo\nTHREE\n");
	expect(await fixture.git(["diff", "--cached", "--", "partial.txt"])).toBe("");
	expect(await fixture.git(["show", ":excluded.txt"])).toBe("staged");
	expect(
		await fixture.git(["ls-tree", "--name-only", "HEAD", "excluded.txt"])
	).toBe("");
});

it("amends a root commit without creating a parent and supports a linked worktree", async () => {
	const fixture = await fixtures.create();

	unwrapResult(await fixture.repository.commitFiles(await review(fixture)));
	expect(await fixture.git(["rev-list", "--count", "HEAD"])).toBe("1");
	const main = await fixture.git(["rev-parse", "HEAD"]);
	const path = fixture.path("linked");

	await fixture.git(["worktree", "add", "-b", "feature", path]);
	const linked = unwrapResult(await GitRepository.open({ path }));

	unwrapResult(
		await linked.commitFiles({
			amend: true,
			paths: [],
			message: "Worktree message",
			expectedHead: main,
			expectedBranch: "feature",
		})
	);
	expect(unwrapResult(await linked.getSnapshot()).head.oid).not.toBe(main);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(main);
	expect(await readFile(join(path, "README.md"), "utf8")).toBe(
		"# Test repository\n"
	);
});

it("refuses published or stale tips before changing HEAD or the index", async () => {
	const fixture = await fixtures.create();
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	await fixture.git(["push", "origin", "main"]);
	await fixture.write("selected.txt", "selected\n");
	await fixture.git(["add", "selected.txt"]);
	const input = await review(fixture, ["selected.txt"]);
	const index = await fixture.git(["ls-files", "--stage"]);
	const published = await fixture.repository.commitFiles(input);

	expect(published.ok).toBe(false);

	if (!published.ok) expect(published.error.message).toContain("published");

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(
		input.expectedHead ?? ""
	);
	expect(await fixture.git(["ls-files", "--stage"])).toBe(index);
	const next = await fixture.commitAll("Next");

	expect((await fixture.repository.commitFiles(input)).ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(next);
	expect(await fixture.git(["for-each-ref", "refs/1git/amend/"])).toBe("");
});

it("rejects detached, unborn, active-operation and merge tips", async () => {
	const unborn = await fixtures.create({ initialCommit: false });

	expect((await unborn.repository.commitFiles(await review(unborn))).ok).toBe(
		false
	);
	const fixture = await fixtures.create();
	const input = await review(fixture);

	await fixture.git(["checkout", "--detach"]);
	expect((await fixture.repository.commitFiles(await review(fixture))).ok).toBe(
		false
	);
	await fixture.git(["checkout", "main"]);
	await fixture.write(".git/MERGE_HEAD", `${input.expectedHead}\n`);
	expect((await fixture.repository.commitFiles(input)).ok).toBe(false);
	await fixture.remove(".git/MERGE_HEAD");
	await fixture.git(["checkout", "-b", "other"]);
	await fixture.write("other.txt", "other\n");
	await fixture.commitAll("Other");
	await fixture.git(["checkout", "main"]);
	await fixture.git(["merge", "--no-ff", "-m", "Merge", "other"]);
	const merged = await review(fixture);

	expect((await fixture.repository.commitFiles(merged)).ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(
		merged.expectedHead ?? ""
	);
});

it("honors failing hooks without changing HEAD, working files or original staging", async () => {
	const fixture = await fixtures.create();

	await fixture.write("selected.txt", "selected\n");
	await fixture.git(["add", "selected.txt"]);
	await fixture.write(".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
	await chmod(join(fixture.repositoryPath, ".git/hooks/pre-commit"), 0o755);
	const input = await review(fixture, ["selected.txt"]);
	const index = await fixture.git(["ls-files", "--stage"]);

	expect((await fixture.repository.commitFiles(input)).ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(
		input.expectedHead ?? ""
	);
	expect(await fixture.git(["ls-files", "--stage"])).toBe(index);
	expect(await fixture.read("selected.txt")).toBe("selected\n");
});
