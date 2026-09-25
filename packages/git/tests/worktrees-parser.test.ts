import { describe, expect, test } from "bun:test";

import { parseWorktrees } from "../src/parsers/worktrees.js";

const OID = "a".repeat(40);

describe("parseWorktrees", () => {
	test("parses a normal branch worktree", () => {
		const worktrees = parseWorktrees(
			`worktree /tmp/repository\0HEAD ${OID}\0branch refs/heads/main\0\0`
		);

		expect(worktrees[0]).toEqual({
			branch: "main",
			detached: false,
			headOid: OID,
			locked: false,
			lockReason: null,
			path: "/tmp/repository",
			prunable: false,
			pruneReason: null,
		});
	});

	test("parses detached worktrees", () => {
		const worktrees = parseWorktrees(
			`worktree /tmp/detached\0HEAD ${OID}\0detached\0\0`
		);

		expect(worktrees[0]?.detached).toBe(true);
		expect(worktrees[0]?.branch).toBeNull();
	});

	test("parses lock reasons", () => {
		const worktrees = parseWorktrees(
			`worktree /tmp/locked\0HEAD ${OID}\0locked external drive\0\0`
		);

		expect(worktrees[0]).toMatchObject({
			locked: true,
			lockReason: "external drive",
		});
	});

	test("parses prunable reasons", () => {
		const worktrees = parseWorktrees(
			`worktree /tmp/stale\0HEAD ${OID}\0prunable gitdir file points to non-existent location\0\0`
		);

		expect(worktrees[0]).toMatchObject({
			prunable: true,
			pruneReason: "gitdir file points to non-existent location",
		});
	});

	test("parses multiple worktrees", () => {
		const worktrees = parseWorktrees(
			[
				`worktree /tmp/one\0HEAD ${OID}\0branch refs/heads/main`,
				`worktree /tmp/two\0HEAD ${OID}\0detached`,
				"",
			].join("\0\0")
		);

		expect(worktrees).toHaveLength(2);
	});

	test("ignores records without a worktree path", () => {
		expect(parseWorktrees(`HEAD ${OID}\0detached\0\0`)).toEqual([]);
	});
});
