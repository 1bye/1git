import { describe, expect, test } from "bun:test";

import type { GitError } from "@1git/git";

import {
	combineRepositoryStashDiffs,
	repositoryStashDiffTargets,
	repositoryStashErrorMessage,
	shouldOfferStashAndSwitch,
} from "../src/renderer/src/feature/workspace/lib/repository-stash.js";

const gitError = (code: GitError["code"]): GitError => ({
	code,
	message: "Git could not complete the operation.",
	operation: "pop-stash",
	retryable: false,
});

describe("repository stash policy", () => {
	test("builds ordinary tracked and untracked stash comparisons", () => {
		expect(repositoryStashDiffTargets("stash-oid")).toEqual([
			{
				base: "stash-oid^1",
				head: "stash-oid",
				kind: "range",
			},
			{
				base: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
				head: "stash-oid^3",
				kind: "range",
			},
		]);
	});

	test("combines tracked and optional untracked stash patches", () => {
		const tracked = {
			patch: "tracked patch",
			stats: [{ addedLines: 1, deletedLines: 0, path: "tracked.ts" }],
			target: {
				base: "stash-oid^1",
				head: "stash-oid",
				kind: "range",
			},
		} as const;

		const untracked = {
			patch: "untracked patch",
			stats: [{ addedLines: 2, deletedLines: 0, path: "new.ts" }],
			target: {
				base: "empty-tree",
				head: "stash-oid^3",
				kind: "range",
			},
		} as const;

		expect(combineRepositoryStashDiffs(tracked, untracked)).toEqual({
			patch: "tracked patch\nuntracked patch",
			stats: [...tracked.stats, ...untracked.stats],
			target: tracked.target,
		});
		expect(combineRepositoryStashDiffs(tracked, null)).toEqual(tracked);
	});

	test("offers stash and switch only for a dirty checkout", () => {
		expect(shouldOfferStashAndSwitch(gitError("dirty-worktree"))).toBe(true);
		expect(shouldOfferStashAndSwitch(gitError("conflict"))).toBe(false);
		expect(shouldOfferStashAndSwitch(gitError("repository-locked"))).toBe(
			false
		);
	});

	test("explains that a conflicted pop keeps the stash", () => {
		expect(repositoryStashErrorMessage(gitError("conflict"), "pop")).toBe(
			"The stash produced conflicts and was kept. Resolve the conflicts, then drop it when it is no longer needed."
		);
	});
});
