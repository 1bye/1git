import { describe, expect, test } from "bun:test";
import type { BranchCollection, BranchInfo, CommitInfo } from "@1git/git";
import {
	canAmendHistoryCommit,
	canRevertHistoryCommit,
	getCherryPickTargetBranches,
} from "../src/renderer/src/fixture/repository-workspace/lib/repository-history-actions.js";

const commit = (
	oid: string,
	parentOids: readonly string[] = ["parent"]
): CommitInfo => ({
	author: { email: "author@example.com", name: "Author" },
	authoredAt: "2026-08-05T08:00:00.000Z",
	body: "",
	committedAt: "2026-08-05T08:00:00.000Z",
	committer: { email: "author@example.com", name: "Author" },
	oid,
	parentOids,
	summary: "Commit summary",
});

const branch = (
	name: string,
	type: BranchInfo["type"],
	checkedOut = false
): BranchInfo => ({
	ahead: 0,
	behind: 0,
	checkedOut,
	committedAt: null,
	fullName: `refs/${type === "local" ? "heads" : "remotes"}/${name}`,
	name,
	oid: "branch-oid",
	remote: type === "remote" ? "origin" : null,
	summary: "",
	type,
	upstream: null,
});

describe("repository history actions", () => {
	test("only allows amending the current HEAD commit", () => {
		expect(canAmendHistoryCommit(commit("head"), "head")).toBe(true);
		expect(canAmendHistoryCommit(commit("older"), "head")).toBe(false);
		expect(canAmendHistoryCommit(commit("head"), null)).toBe(false);
	});

	test("excludes checked-out and remote branches from cherry-pick targets", () => {
		const branches: BranchCollection = {
			branches: [
				branch("main", "local", true),
				branch("release", "local"),
				branch("origin/main", "remote"),
			],
			current: "main",
		};

		expect(
			getCherryPickTargetBranches(branches).map(({ name }) => name)
		).toEqual(["release"]);
		expect(getCherryPickTargetBranches(null)).toEqual([]);
	});

	test("does not offer single-parent revert behavior for merge commits", () => {
		expect(canRevertHistoryCommit(commit("root", []))).toBe(true);
		expect(canRevertHistoryCommit(commit("regular"))).toBe(true);
		expect(canRevertHistoryCommit(commit("merge", ["one", "two"]))).toBe(false);
	});
});
