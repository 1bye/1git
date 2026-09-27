/**
 * Covers: immediate branch-name feedback in the worktree form.
 * Real: form validation; final Git validation remains in the write boundary.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { RepositoryWorktrees } from "../../src/feature/workspace-tabs/lib/repository-worktrees";

it("accepts ordinary names and rejects Git ref syntax and revision expressions", () => {
	for (const name of [
		"",
		"main",
		"feature/search",
		"Feature",
		"fix-123",
		"日本語",
	])
		expect(RepositoryWorktrees.branchNameError(name)).toBeNull();

	for (const name of [
		"HEAD",
		"@",
		"@{-1}",
		"-branch",
		"bad name",
		"a..b",
		"a//b",
		".hidden",
		"a/.hidden",
		"a.lock",
		"a.lock/b",
		"a/",
		"/a",
		"a.",
		"a~1",
		"a^",
		"a:b",
		"a?",
		"a*",
		"a[",
		"a\\b",
		"a\0b",
		"a\nb",
	])
		expect(RepositoryWorktrees.branchNameError(name)).not.toBeNull();
});
