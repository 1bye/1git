import { describe, expect, test } from "bun:test";

import type { BranchCollection, BranchInfo } from "@1git/git";

import {
	formatBranchCommitAge,
	groupWorkspaceBranches,
} from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-actions-menu.js";

const branch = (
	name: string,
	committedAt: string | null,
	type: BranchInfo["type"] = "local"
): BranchInfo => ({
	ahead: 0,
	behind: 0,
	checkedOut: name === "main",
	committedAt,
	fullName: `${type === "local" ? "refs/heads" : "refs/remotes/origin"}/${name}`,
	name,
	oid: name,
	remote: type === "remote" ? "origin" : null,
	summary: "",
	type,
	upstream: null,
	worktreePath: null,
});

describe("workspace actions menu branches", () => {
	test("shows the three latest local branches before inline expansion", () => {
		const branches: BranchCollection = {
			branches: [
				branch("oldest", "2025-01-01T00:00:00.000Z"),
				branch("remote", "2026-06-01T00:00:00.000Z", "remote"),
				branch("newest", "2026-05-01T00:00:00.000Z"),
				branch("main", "2026-04-01T00:00:00.000Z"),
				branch("middle", "2026-03-01T00:00:00.000Z"),
			],
			current: "main",
		};

		const result = groupWorkspaceBranches(branches);

		expect(result.latestBranches.map(({ name }) => name)).toEqual([
			"newest",
			"main",
			"middle",
		]);
		expect(result.remainingBranches.map(({ name }) => name)).toEqual([
			"oldest",
		]);
	});

	test("places branches without valid commit dates last", () => {
		const branches: BranchCollection = {
			branches: [
				branch("unknown", null),
				branch("invalid", "not-a-date"),
				branch("known", "2026-01-01T00:00:00.000Z"),
			],
			current: null,
		};

		const result = groupWorkspaceBranches(branches);

		expect(result.latestBranches.map(({ name }) => name)).toEqual([
			"known",
			"unknown",
			"invalid",
		]);
		expect(result.remainingBranches).toEqual([]);
	});
});

describe("workspace branch commit age", () => {
	const now = Date.parse("2026-07-31T12:00:00.000Z");

	test("formats recent branch commits for compact menu rows", () => {
		expect(formatBranchCommitAge("2026-07-31T11:59:40.000Z", now)).toBe(
			"just now"
		);
		expect(formatBranchCommitAge("2026-07-29T12:00:00.000Z", now)).toBe(
			"2 days ago"
		);
		expect(formatBranchCommitAge("2026-07-20T12:00:00.000Z", now)).toBe(
			"11 days ago"
		);
		expect(formatBranchCommitAge("2026-07-01T12:00:00.000Z", now)).toBe(
			"last month"
		);
	});

	test("omits missing or invalid branch commit dates", () => {
		expect(formatBranchCommitAge(null, now)).toBeNull();
		expect(formatBranchCommitAge("not-a-date", now)).toBeNull();
	});
});
