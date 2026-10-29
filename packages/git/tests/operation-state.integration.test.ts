/**
 * Covers: absent/partial Git operation markers, detection precedence and linked-worktree metadata.
 * Real: GitRepository snapshots, Git CLI and disposable filesystem repositories.
 * Doubles: marker files represent interrupted operations; no real merge/rebase or remote service.
 * Requires: Git on PATH and writable temporary storage.
 */
import { afterEach, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GitRepository } from "../src/repository.js";
import {
	RepositoryFixtures,
	unwrapResult,
} from "./_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

it("refreshes repeatedly with all optional operation markers absent", async () => {
	const fixture = await fixtures.create();
	const head = await fixture.git(["rev-parse", "HEAD"]);

	for (let attempt = 0; attempt < 20; attempt++) {
		const snapshot = unwrapResult(await fixture.repository.getSnapshot());

		expect(snapshot.operationState).toBe("normal");
		expect(snapshot.operationToken).toBeUndefined();
		expect(snapshot.head.oid).toBe(head);
	}
});

it.each([
	["rebase-merge", "rebase", true],
	["rebase-apply", "rebase", true],
	["MERGE_HEAD", "merge", false],
	["CHERRY_PICK_HEAD", "cherry-pick", false],
	["REVERT_HEAD", "revert", false],
	["SQUASH_MSG", "squash-merge", false],
] as const)(
	"detects %s even when optional operation-token files are missing",
	async (marker, state, directory) => {
		const fixture = await fixtures.create();
		const path = join(fixture.repository.info.gitDirectory, marker);
		const head = await fixture.git(["rev-parse", "HEAD"]);

		if (directory) await mkdir(path);
		else await writeFile(path, `${head}\n`);

		const snapshot = unwrapResult(await fixture.repository.getSnapshot());

		expect(snapshot.operationState).toBe(state);

		if (state !== "cherry-pick")
			expect(snapshot.operationToken).toMatch(/^[a-f0-9]{64}$/);

		await rm(path, { recursive: directory, force: true });
		expect(
			unwrapResult(await fixture.repository.getSnapshot()).operationState
		).toBe("normal");
	}
);

it("checks linked-worktree markers rather than the main worktree and preserves rebase precedence", async () => {
	const fixture = await fixtures.create();
	const linked = fixture.path("linked");

	await fixture.git(["worktree", "add", "-b", "linked", linked]);
	const repository = unwrapResult(await GitRepository.open({ path: linked }));
	const head = await fixture.git(["rev-parse", "HEAD"]);

	await writeFile(
		join(repository.info.gitDirectory, "MERGE_HEAD"),
		`${head}\n`
	);
	await mkdir(join(repository.info.gitDirectory, "rebase-merge"));
	expect(unwrapResult(await repository.getSnapshot()).operationState).toBe(
		"rebase"
	);
	expect(
		unwrapResult(await fixture.repository.getSnapshot()).operationState
	).toBe("normal");

	await rm(join(repository.info.gitDirectory, "rebase-merge"), {
		recursive: true,
	});
	expect(unwrapResult(await repository.getSnapshot()).operationState).toBe(
		"merge"
	);
});

it("distinguishes mailbox application from apply-backend rebase in linked worktrees", async () => {
	const fixture = await fixtures.create();
	const linked = fixture.path("linked");

	await fixture.git(["worktree", "add", "-b", "linked", linked]);
	const repository = unwrapResult(await GitRepository.open({ path: linked }));
	const directory = join(repository.info.gitDirectory, "rebase-apply");

	await mkdir(directory);
	await writeFile(join(directory, "rebasing"), "");
	expect(unwrapResult(await repository.getSnapshot()).operationState).toBe(
		"rebase"
	);
	await rm(join(directory, "rebasing"));
	await writeFile(join(directory, "applying"), "");
	await writeFile(join(directory, "patch"), "first mailbox patch\n");
	const snapshot = unwrapResult(await repository.getSnapshot());

	expect(snapshot.operationState).toBe("am");
	expect(snapshot.operationToken).toMatch(/^[a-f0-9]{64}$/);
	await writeFile(join(directory, "patch"), "replacement mailbox patch\n");
	expect(unwrapResult(await repository.getSnapshot()).operationToken).not.toBe(
		snapshot.operationToken
	);
	expect(
		unwrapResult(await fixture.repository.getSnapshot()).operationState
	).toBe("normal");
});
