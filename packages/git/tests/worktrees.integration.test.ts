import { afterEach, describe, expect, test } from "bun:test";
import { rename, rm, writeFile } from "node:fs/promises";
import {
	RepositoryFixtures,
	unwrapResult,
} from "./_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

describe("GitRepository worktrees", () => {
	test("lists the main worktree", async () => {
		const fixture = await fixtures.create();

		const worktrees = unwrapResult(await fixture.repository.getWorktrees());

		expect(worktrees).toEqual([
			{
				branch: "main",
				detached: false,
				headOid: expect.any(String),
				locked: false,
				lockReason: null,
				path: fixture.repositoryPath,
				prunable: false,
				pruneReason: null,
			},
		]);
	});

	test("creates a worktree with a new branch", async () => {
		const fixture = await fixtures.create();
		const path = fixture.path("feature-worktree");

		const worktrees = unwrapResult(
			await fixture.repository.createWorktree({
				newBranch: "feature/worktree",
				path,
			})
		);

		expect(worktrees).toHaveLength(2);
		expect(worktrees.find((worktree) => worktree.path === path)).toMatchObject({
			branch: "feature/worktree",
			detached: false,
		});
	});

	test("creates a detached worktree", async () => {
		const fixture = await fixtures.create();
		const path = fixture.path("detached-worktree");

		const worktrees = unwrapResult(
			await fixture.repository.createWorktree({
				detach: true,
				path,
				revision: "HEAD",
			})
		);

		expect(worktrees.find((worktree) => worktree.path === path)).toMatchObject({
			branch: null,
			detached: true,
		});
	});

	test("rejects mutually exclusive detached and new-branch options", async () => {
		const fixture = await fixtures.create();

		const result = await fixture.repository.createWorktree({
			detach: true,
			newBranch: "invalid",
			path: fixture.path("invalid"),
		});

		expect(result).toMatchObject({
			error: { code: "invalid-input" },
			ok: false,
		});
	});

	test("creates a locked worktree with a reason", async () => {
		const fixture = await fixtures.create();
		const path = fixture.path("locked-worktree");

		const worktrees = unwrapResult(
			await fixture.repository.createWorktree({
				lockReason: "external drive",
				newBranch: "feature/locked",
				path,
			})
		);

		expect(worktrees.find((worktree) => worktree.path === path)).toMatchObject({
			locked: true,
			lockReason: "external drive",
		});
	});

	test("locks and unlocks an existing worktree", async () => {
		const fixture = await fixtures.create();
		const path = fixture.path("lock-later");
		unwrapResult(
			await fixture.repository.createWorktree({
				newBranch: "feature/lock-later",
				path,
			})
		);

		const locked = unwrapResult(
			await fixture.repository.lockWorktree({
				path,
				reason: "maintenance",
			})
		);
		const unlocked = unwrapResult(
			await fixture.repository.unlockWorktree({ path })
		);

		expect(locked.find((worktree) => worktree.path === path)).toMatchObject({
			locked: true,
			lockReason: "maintenance",
		});
		expect(unlocked.find((worktree) => worktree.path === path)?.locked).toBe(
			false
		);
	});

	test("moves a worktree", async () => {
		const fixture = await fixtures.create();
		const path = fixture.path("before-move");
		const newPath = fixture.path("after-move");
		unwrapResult(
			await fixture.repository.createWorktree({
				newBranch: "feature/move",
				path,
			})
		);

		const worktrees = unwrapResult(
			await fixture.repository.moveWorktree({ newPath, path })
		);

		expect(worktrees.some((worktree) => worktree.path === path)).toBe(false);
		expect(worktrees.some((worktree) => worktree.path === newPath)).toBe(true);
	});

	test("removes a clean worktree", async () => {
		const fixture = await fixtures.create();
		const path = fixture.path("remove-worktree");
		unwrapResult(
			await fixture.repository.createWorktree({
				newBranch: "feature/remove",
				path,
			})
		);

		const worktrees = unwrapResult(
			await fixture.repository.removeWorktree({ path })
		);

		expect(worktrees).toHaveLength(1);
		expect(worktrees[0]?.path).toBe(fixture.repositoryPath);
	});

	test("requires force to remove a dirty worktree", async () => {
		const fixture = await fixtures.create();
		const path = fixture.path("dirty-worktree");
		unwrapResult(
			await fixture.repository.createWorktree({
				newBranch: "feature/dirty",
				path,
			})
		);
		await writeFile(`${path}/dirty.txt`, "dirty\n");

		const rejected = await fixture.repository.removeWorktree({ path });
		const removed = unwrapResult(
			await fixture.repository.removeWorktree({ force: true, path })
		);

		expect(rejected.ok).toBe(false);
		expect(removed).toHaveLength(1);
	});

	test("prunes metadata for a manually removed worktree", async () => {
		const fixture = await fixtures.create();
		const path = fixture.path("stale-worktree");
		unwrapResult(
			await fixture.repository.createWorktree({
				newBranch: "feature/stale",
				path,
			})
		);
		await rm(path, { force: true, recursive: true });

		const before = unwrapResult(await fixture.repository.getWorktrees());
		const after = unwrapResult(
			await fixture.repository.pruneWorktrees({ expire: "now" })
		);

		expect(before.find((worktree) => worktree.path === path)?.prunable).toBe(
			true
		);
		expect(after.some((worktree) => worktree.path === path)).toBe(false);
	});

	test("repairs metadata after a worktree is moved manually", async () => {
		const fixture = await fixtures.create();
		const path = fixture.path("manual-before");
		const newPath = fixture.path("manual-after");
		unwrapResult(
			await fixture.repository.createWorktree({
				newBranch: "feature/repair",
				path,
			})
		);
		await rename(path, newPath);

		const worktrees = unwrapResult(
			await fixture.repository.repairWorktrees({ paths: [newPath] })
		);

		expect(worktrees.some((worktree) => worktree.path === newPath)).toBe(true);
	});
});
