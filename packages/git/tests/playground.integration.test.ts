/**
 * Covers: disposable scenarios, dirty branch switching, offline remotes and independent repeated creation.
 * Real: playground generator, filesystem and Git CLI. Doubles: none.
 * Requires: Git and writable temporary storage; no network or credentials.
 */
import { expect, it } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { GitPlayground } from "../scripts/playground";
import { GitRepository } from "../src/repository";

it("creates real isolated scenarios and never resets an earlier playground", async () => {
	const roots: string[] = [];

	try {
		const root = await GitPlayground.create();

		roots.push(root);
		const open = async (name: string) => {
			const result = await GitRepository.open({ path: join(root, name) });

			if (!result.ok) throw new Error(result.error.message);

			return result.value;
		};

		const changes = await open("01-changes");
		const status = await changes.getSnapshot();

		expect(status.ok && status.value.files.length).toBeGreaterThanOrEqual(8);
		const stashes = await changes.getStashes();

		expect(stashes.ok && stashes.value.length).toBe(1);
		const compare = await open("02-compare");
		const comparison = await compare.compareBranches("main", "feature/colors");

		expect(
			comparison.ok && comparison.value.files.map((file) => file.path)
		).toEqual(["badge.svg", "colors.txt"]);
		const worktrees = await compare.getWorktrees();

		expect(worktrees.ok && worktrees.value.length).toBe(2);
		const conflict = await open("04-conflict");
		const conflicting = await conflict.getSnapshot();

		expect(conflicting.ok && conflicting.value.operationState).toBe("merge");
		const sync = await open("03-sync");
		const remotes = await sync.getRemotes();

		expect(remotes.ok && remotes.value[0]?.fetchUrls).toEqual([
			join(root, "origin.git"),
		]);
		const fetched = await sync.fetch({ remote: "origin" });

		expect(fetched.ok).toBe(true);
		const synced = await sync.getSnapshot();

		expect(synced.ok && synced.value.head.behind).toBe(1);

		for (const name of [
			"06-branch-leave",
			"07-branch-bring",
			"08-branch-conflict",
			"09-branch-remote",
		]) {
			const scenario = await open(name);
			const snapshot = await scenario.getSnapshot();

			expect(snapshot.ok && snapshot.value.head.branch).toBe("main");
			expect(snapshot.ok && snapshot.value.operationState).toBe("normal");
			expect(
				snapshot.ok &&
					snapshot.value.files.some((file) => file.recordType === "untracked")
			).toBe(true);
			const saved = await scenario.getStashes();

			expect(saved.ok && saved.value.map((stash) => stash.summary)).toEqual([
				expect.stringContaining("Manual stash — keep me"),
			]);
		}

		const checklist = await readFile(join(root, "START-HERE.md"), "utf8");

		expect(checklist).toContain(join(root, "02-compare"));
		expect(checklist).toContain(join(root, "06-branch-leave"));
		expect(checklist).toContain(join(root, "09-branch-remote"));
		const second = await GitPlayground.create();

		roots.push(second);
		expect(second).not.toBe(root);
		expect(await readFile(join(root, "START-HERE.md"), "utf8")).toBe(checklist);
		expect((await changes.getSnapshot()).ok).toBe(true);
	} finally {
		for (const root of roots) await rm(root, { recursive: true, force: true });
	}
}, 30_000);

it("provides successful and conflicting dirty-switch scenarios with untouched manual stashes", async () => {
	const root = await GitPlayground.create();

	try {
		for (const name of [
			"06-branch-leave",
			"07-branch-bring",
			"08-branch-conflict",
			"09-branch-remote",
		]) {
			const opened = await GitRepository.open({ path: join(root, name) });

			if (!opened.ok) throw new Error(opened.error.message);

			const repository = opened.value;
			const before = await repository.getSnapshot();
			const originalStashes = await repository.getStashes();

			if (!originalStashes.ok) throw new Error(originalStashes.error.message);

			if (name !== "08-branch-conflict")
				expect(
					before.ok &&
						before.value.files.some(
							(file) =>
								file.path === "message.txt" &&
								file.indexStatus === "modified" &&
								file.worktreeStatus === "modified"
						)
				).toBe(true);

			const saved = await repository.stash({
				message: "Fixture switch recovery",
				includeUntracked: true,
			});

			expect(saved.ok).toBe(true);
			const stashes = await repository.getStashes();
			const backup = stashes.ok && stashes.value[0];

			if (!backup) throw new Error("Expected a recovery stash");

			const switched =
				name === "09-branch-remote"
					? await repository.createBranch({
							name: "remote-only",
							startPoint: "refs/remotes/origin/remote-only",
							checkout: true,
							track: true,
						})
					: await repository.checkoutBranch({ name: "feature/next" });

			expect(switched.ok).toBe(true);
			expect(switched.ok && switched.value.snapshot.files).toEqual([]);

			if (name === "06-branch-leave")
				expect((await repository.checkoutBranch({ name: "main" })).ok).toBe(
					true
				);

			const restored = await repository.applyStash({
				reference: backup.oid,
				reinstateIndex: true,
			});

			if (name === "08-branch-conflict") {
				expect(restored.ok).toBe(false);
				const conflicted = await repository.getSnapshot();

				expect(conflicted.ok && conflicted.value.operationState).toBe("normal");
				expect(
					conflicted.ok &&
						conflicted.value.files.some(
							(file) =>
								file.path === "message.txt" && file.recordType === "unmerged"
						)
				).toBe(true);
			} else {
				expect(restored.ok).toBe(true);
				expect(await readFile(join(root, name, "message.txt"), "utf8")).toBe(
					"My uncommitted branch-switch edits.\n"
				);
				expect(
					await readFile(join(root, name, "untracked-note.txt"), "utf8")
				).toContain("should be saved or brought along");
				expect(
					(await repository.dropStash({ reference: backup.reference })).ok
				).toBe(true);
			}

			const remaining = await repository.getStashes();

			expect(
				remaining.ok &&
					remaining.value
						.filter((stash) => stash.oid !== backup.oid)
						.map((stash) => stash.oid)
			).toEqual(originalStashes.value.map((stash) => stash.oid));
			expect(
				remaining.ok &&
					remaining.value.some((stash) => stash.oid === backup.oid)
			).toBe(name === "08-branch-conflict");
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);
