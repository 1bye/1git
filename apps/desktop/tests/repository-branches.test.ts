import { describe, expect, test } from "bun:test";

import type { BranchCollection, BranchInfo } from "@1git/git";

import {
	getRepositoryCurrentBranch,
	getRepositoryDeletableBranches,
	getRepositoryRemoteBranches,
	repositoryBranchSwitchDisabledReason,
	repositoryBranchTrackingLabel,
} from "../src/renderer/src/feature/workspace/lib/repository-branches.js";

const branch = (
	name: string,
	options: Partial<BranchInfo> = {}
): BranchInfo => ({
	ahead: 0,
	behind: 0,
	checkedOut: name === "main",
	committedAt: null,
	fullName: `refs/heads/${name}`,
	name,
	oid: name,
	remote: null,
	summary: "",
	type: "local",
	upstream: null,
	worktreePath: null,
	...options,
});

const branches: BranchCollection = {
	branches: [
		branch("main", { worktreePath: "/repo" }),
		branch("feature"),
		branch("linked", { worktreePath: "/repo-linked" }),
		branch("origin/main", {
			fullName: "refs/remotes/origin/main",
			remote: "origin",
			type: "remote",
		}),
	],
	current: "main",
};

describe("repository branch actions", () => {
	test("keeps current and linked-worktree branches out of delete targets", () => {
		expect(getRepositoryCurrentBranch(branches)?.name).toBe("main");
		expect(
			getRepositoryDeletableBranches(branches).map(({ name }) => name)
		).toEqual(["feature"]);
	});

	test("returns remote tracking choices separately", () => {
		expect(
			getRepositoryRemoteBranches(branches).map(({ name }) => name)
		).toEqual(["origin/main"]);
	});

	test("blocks switching to a branch checked out in another worktree", () => {
		const linked = branches.branches.find(({ name }) => name === "linked");
		expect(linked).toBeDefined();
		expect(
			repositoryBranchSwitchDisabledReason(linked as BranchInfo, "main")
		).toBe("This branch is checked out in another worktree.");
		expect(
			repositoryBranchSwitchDisabledReason(branch("main"), "main")
		).toBeNull();
	});
});

describe("repository branch tracking label", () => {
	test("formats no-upstream and synchronized branches quietly", () => {
		expect(repositoryBranchTrackingLabel(branch("local"))).toBe("No upstream");
		expect(
			repositoryBranchTrackingLabel(branch("main", { upstream: "origin/main" }))
		).toBe("origin/main");
	});

	test("formats ahead and behind state", () => {
		expect(
			repositoryBranchTrackingLabel(
				branch("main", {
					ahead: 2,
					behind: 1,
					upstream: "origin/main",
				})
			)
		).toBe("origin/main · 2 ahead · 1 behind");
	});
});
