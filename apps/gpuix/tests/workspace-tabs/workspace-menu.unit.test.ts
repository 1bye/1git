/**
 * Covers: branch ordering, upstream context, and relative commit ages.
 * Real: workspace menu presentation model.
 * Doubles: branch metadata values; no Git or renderer I/O.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import type { BranchInfo } from "@1git/git";
import { WorkspaceMenuModel } from "../../src/feature/workspace-tabs/lib/workspace-menu-model";

const main: BranchInfo = {
	name: "main",
	fullName: "refs/heads/main",
	oid: "abc",
	type: "local",
	checkedOut: true,
	worktreePath: null,
	remote: null,
	upstream: "origin/main",
	ahead: 0,
	behind: 0,
	committedAt: "2026-09-26T12:00:00Z",
	summary: "Update menu",
};

it("orders only local branches by commit time without mutating the collection", () => {
	const branches: BranchInfo[] = [
		{ ...main, name: "unknown", committedAt: null },
		{ ...main, name: "old", committedAt: "2026-09-25T12:00:00Z" },
		{ ...main, name: "remote", type: "remote" },
		main,
		{ ...main, name: "invalid", committedAt: "invalid" },
	];

	const original = [...branches];

	expect(
		WorkspaceMenuModel.recentBranches({ branches, current: "main" }).map(
			(branch) => branch.name
		)
	).toEqual(["main", "old", "unknown", "invalid"]);
	expect(branches).toEqual(original);
	expect(WorkspaceMenuModel.recentBranches(undefined)).toEqual([]);
});

it("describes upstream and divergence without inventing tracking data", () => {
	expect(WorkspaceMenuModel.trackingLabel(undefined)).toBe("No upstream");
	expect(WorkspaceMenuModel.trackingLabel({ ...main, upstream: null })).toBe(
		"No upstream"
	);
	expect(WorkspaceMenuModel.trackingLabel(main)).toBe("origin/main");
	expect(
		WorkspaceMenuModel.trackingLabel({ ...main, ahead: 2, behind: 1 })
	).toBe("origin/main · 2 ahead · 1 behind");
});

it("formats known commit ages and leaves invalid or absent dates blank", () => {
	const now = Date.parse("2026-09-26T12:00:00Z");
	const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

	expect(WorkspaceMenuModel.commitAge(null, now)).toBe("");
	expect(WorkspaceMenuModel.commitAge("invalid", now)).toBe("");
	expect(WorkspaceMenuModel.commitAge(main.committedAt, now)).toBe("just now");
	expect(WorkspaceMenuModel.commitAge("2026-09-26T10:00:00Z", now)).toBe(
		formatter.format(-2, "hour")
	);
	expect(WorkspaceMenuModel.commitAge("2026-09-25T12:00:00Z", now)).toBe(
		formatter.format(-1, "day")
	);
	expect(WorkspaceMenuModel.commitAge("2026-09-26T12:01:00Z", now)).toBe(
		formatter.format(1, "minute")
	);
});
