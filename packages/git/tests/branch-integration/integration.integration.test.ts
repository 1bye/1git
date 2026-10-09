/**
 * Covers: reviewed rebase/squash merge, unpublished/stale/dirty guards, hooks, conflict continuation/abort and retained tips.
 * Real: Git transactions and disposable repositories.
 * Doubles: none.
 * Requires: Git and temporary storage; no network or user repositories.
 */
import { afterEach, expect, it } from "bun:test";
import { chmod } from "node:fs/promises";
import { GitRepository } from "../../src/repository.js";
import type {
	BranchIntegrationInput,
	FinishOperationInput,
} from "../../src/contracts.js";
import {
	RepositoryFixtures,
	type RepositoryFixture,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

async function review(
	fixture: RepositoryFixture,
	kind: BranchIntegrationInput["kind"]
): Promise<BranchIntegrationInput> {
	return {
		kind,
		branch: "refs/heads/topic",
		expectedTarget: await fixture.git(["rev-parse", "topic"]),
		expectedHead: await fixture.git(["rev-parse", "HEAD"]),
		expectedBranch: "main",
		message: "Combined work\n\nReviewed details",
	};
}

async function paused(
	fixture: RepositoryFixture,
	kind: FinishOperationInput["kind"]
): Promise<FinishOperationInput> {
	const snapshot = unwrapResult(await fixture.repository.getSnapshot());

	if (
		(snapshot.operationState !== "rebase" &&
			snapshot.operationState !== "squash-merge") ||
		!snapshot.operationToken
	)
		throw new Error("Missing operation identity");

	return {
		kind,
		expectedOperation: snapshot.operationState,
		expectedHead: snapshot.head.oid,
		expectedBranch: snapshot.head.branch,
		expectedToken: snapshot.operationToken,
	};
}

async function diverge(
	fixture: RepositoryFixture,
	conflict = false
): Promise<void> {
	await fixture.write("shared.txt", "base\n");
	await fixture.commitAll("Base");
	await fixture.git(["checkout", "-b", "topic"]);
	await fixture.write(conflict ? "shared.txt" : "topic.txt", "topic\n");
	await fixture.commitAll("Topic");
	await fixture.git(["checkout", "main"]);
	await fixture.write(conflict ? "shared.txt" : "main.txt", "main\n");
	await fixture.commitAll("Main");
}

it.each([false, true])(
	"squash merges multiple commits into one single-parent commit and retains the source (diverged: %s)",
	async (diverged) => {
		const fixture = await fixtures.create();

		await fixture.git(["checkout", "-b", "topic"]);
		await fixture.write("one.txt", "one\n");
		await fixture.commitAll("One");
		await fixture.write("two.txt", "two\n");
		await fixture.commitAll("Two");
		const target = await fixture.git(["rev-parse", "HEAD"]);

		await fixture.git(["checkout", "main"]);

		if (diverged) {
			await fixture.write("main.txt", "main\n");
			await fixture.commitAll("Main");
		}

		const before = await fixture.git(["rev-parse", "HEAD"]);

		const result = unwrapResult(
			await fixture.repository.integrateBranch(
				await review(fixture, "squash-merge")
			)
		);

		expect(result.operationState).toBe("normal");
		expect(result.head.branch).toBe("main");
		expect(result.files).toHaveLength(0);
		expect(await fixture.git(["show", "-s", "--format=%P"])).toBe(before);
		expect(await fixture.git(["log", "-1", "--format=%B"])).toBe(
			"Combined work\n\nReviewed details"
		);
		expect(await fixture.git(["rev-parse", "topic"])).toBe(target);
		expect(await fixture.read("one.txt")).toBe("one\n");
		expect(await fixture.read("two.txt")).toBe("two\n");
	}
);

it("rebases unpublished commits, retains the original tip, and never follows updateRefs configuration", async () => {
	const fixture = await fixtures.create();

	await diverge(fixture);
	const before = await fixture.git(["rev-parse", "HEAD"]);
	const input = await review(fixture, "rebase");
	const author = await fixture.git(["show", "-s", "--format=%an <%ae>"]);

	await fixture.git(["branch", "sibling"]);
	await fixture.git(["config", "rebase.updateRefs", "true"]);
	const result = unwrapResult(await fixture.repository.integrateBranch(input));

	expect(result.operationState).toBe("normal");
	expect(result.head.branch).toBe("main");
	expect(result.head.oid).not.toBe(before);
	expect(await fixture.git(["rev-parse", "HEAD^"])).toBe(input.expectedTarget);
	expect(await fixture.git(["log", "-1", "--format=%s"])).toBe("Main");
	expect(await fixture.git(["show", "-s", "--format=%an <%ae>"])).toBe(author);
	expect(await fixture.git(["rev-parse", "sibling"])).toBe(before);
	expect(await fixture.git(["rev-parse", "topic"])).toBe(input.expectedTarget);
	expect(
		await fixture.git([
			"for-each-ref",
			"--format=%(objectname)",
			"refs/1git/rebase/",
		])
	).toBe(before);
});

for (const kind of ["rebase", "squash-merge"] as const) {
	it(`rejects dirty, staged, detached and stale ${kind} inputs before any change`, async () => {
		const fixture = await fixtures.create();

		await diverge(fixture);
		const input = await review(fixture, kind);

		await fixture.write("keep.txt", "keep\n");
		expect((await fixture.repository.integrateBranch(input)).ok).toBe(false);
		await fixture.git(["add", "keep.txt"]);
		expect((await fixture.repository.integrateBranch(input)).ok).toBe(false);
		expect(await fixture.read("keep.txt")).toBe("keep\n");
		await fixture.git(["reset", "--", "keep.txt"]);
		await fixture.remove("keep.txt");
		expect(
			(
				await fixture.repository.integrateBranch({
					...input,
					expectedHead: "0".repeat(40),
				})
			).ok
		).toBe(false);
		expect(
			(
				await fixture.repository.integrateBranch({
					...input,
					expectedTarget: "0".repeat(40),
				})
			).ok
		).toBe(false);
		expect(
			(
				await fixture.repository.integrateBranch({
					...input,
					branch: "refs/heads/main",
					expectedTarget: input.expectedHead,
				})
			).ok
		).toBe(false);
		await fixture.git(["checkout", "--detach"]);
		expect((await fixture.repository.integrateBranch(input)).ok).toBe(false);
		expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
		expect(await fixture.git(["status", "--porcelain"])).toBe("");
	});

	for (const action of ["continue", "abort"] as const) {
		it(`recovers conflicted ${kind} through reviewed ${action} after restart`, async () => {
			const fixture = await fixtures.create();

			await diverge(fixture, true);
			const input = await review(fixture, kind);

			expect((await fixture.repository.integrateBranch(input)).ok).toBe(false);
			const repository = unwrapResult(
				await GitRepository.open({ path: fixture.repositoryPath })
			);

			const intent = await paused(fixture, action);

			expect(intent.expectedOperation).toBe(kind);
			expect(
				(
					await repository.finishOperation({
						...intent,
						expectedToken: "stale",
					})
				).ok
			).toBe(false);
			await fixture.write("keep.txt", "untracked stays\n");

			if (action === "continue") {
				expect((await repository.finishOperation(intent)).ok).toBe(false);
				await fixture.write("shared.txt", "resolved\n");
				await fixture.git(["add", "shared.txt"]);
				await fixture.write("shared.txt", "unstaged edit\n");
				expect((await repository.finishOperation(intent)).ok).toBe(false);
				await fixture.write("shared.txt", "resolved\n");
			}

			const result = unwrapResult(await repository.finishOperation(intent));

			expect(result.operationState).toBe("normal");
			expect(result.head.branch).toBe("main");
			expect(await fixture.read("keep.txt")).toBe("untracked stays\n");
			expect(await fixture.git(["rev-parse", "topic"])).toBe(
				input.expectedTarget
			);

			if (action === "abort") {
				expect(result.head.oid).toBe(input.expectedHead);
				expect(await fixture.read("shared.txt")).toBe("main\n");
			} else {
				expect(await fixture.git(["show", "HEAD:shared.txt"])).toBe("resolved");
				expect(await fixture.git(["show", "-s", "--format=%P"])).toBe(
					kind === "rebase" ? input.expectedTarget : input.expectedHead
				);
				expect(await fixture.git(["log", "-1", "--format=%s"])).toBe(
					kind === "rebase" ? "Main" : "Combined work"
				);
			}
		});
	}
}

it("refuses rewriting a published ancestor even when the last commit is unpublished", async () => {
	const fixture = await fixtures.create();

	await diverge(fixture);
	const remote = await fixture.createBareRemote();

	await fixture.git(["remote", "add", "origin", remote]);
	await fixture.git(["push", "origin", "main"]);
	await fixture.write("later.txt", "unpublished\n");
	await fixture.commitAll("Later");
	const input = await review(fixture, "rebase");
	const result = await fixture.repository.integrateBranch(input);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.message).toContain("published");

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect(await fixture.git(["for-each-ref", "refs/1git/rebase/"])).toBe("");
});

it("refuses flattening merge history and leaves branches untouched", async () => {
	const fixture = await fixtures.create();

	await diverge(fixture);
	await fixture.git(["checkout", "-b", "other"]);
	await fixture.write("other.txt", "other\n");
	await fixture.commitAll("Other");
	await fixture.git(["checkout", "main"]);
	await fixture.git(["merge", "--no-ff", "other", "-m", "Merge"]);
	const input = await review(fixture, "rebase");
	const result = await fixture.repository.integrateBranch(input);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.message).toContain("merge commits");

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
});

it("keeps staged squash results after hook failure, then continues with the reviewed message", async () => {
	const fixture = await fixtures.create();

	await diverge(fixture);
	await fixture.write(".git/hooks/commit-msg", "#!/bin/sh\nexit 1\n");
	await fixture.git(["config", "core.hooksPath", ".git/hooks"]);
	await chmod(`${fixture.repositoryPath}/.git/hooks/commit-msg`, 0o700);
	const input = await review(fixture, "squash-merge");

	expect((await fixture.repository.integrateBranch(input)).ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(input.expectedHead);
	expect((await paused(fixture, "continue")).expectedOperation).toBe(
		"squash-merge"
	);
	await fixture.git(["config", "core.hooksPath", "/dev/null"]);
	unwrapResult(
		await fixture.repository.finishOperation(await paused(fixture, "continue"))
	);
	expect(await fixture.git(["log", "-1", "--format=%B"])).toBe(
		input.message ?? ""
	);
});

it("does not create an empty squash commit when the selected branch is already included", async () => {
	const fixture = await fixtures.create();

	await fixture.git(["branch", "topic"]);
	const input = await review(fixture, "squash-merge");
	const result = unwrapResult(await fixture.repository.integrateBranch(input));

	expect(result.operationState).toBe("normal");
	expect(result.head.oid).toBe(input.expectedHead);
});
