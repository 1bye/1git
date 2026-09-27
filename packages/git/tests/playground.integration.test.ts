/**
 * Covers: disposable scenarios, offline remotes and independent repeated creation.
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
		const checklist = await readFile(join(root, "START-HERE.md"), "utf8");

		expect(checklist).toContain(join(root, "02-compare"));
		const second = await GitPlayground.create();

		roots.push(second);
		expect(second).not.toBe(root);
		expect(await readFile(join(root, "START-HERE.md"), "utf8")).toBe(checklist);
		expect((await changes.getSnapshot()).ok).toBe(true);
	} finally {
		for (const root of roots) await rm(root, { recursive: true, force: true });
	}
}, 30_000);
