/**
 * Covers: fetched sync review selection, exact upstream refs and stale/missing branch rejection.
 * Real: comparison request construction. Doubles: branch metadata. Requires: none.
 */
import { expect, it } from "bun:test";
import type { BranchInfo } from "@1git/git";
import { RepositoryComparison } from "../../src/feature/repository-comparison/lib/repository-comparison";
import type { WorkspaceBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";

const branch = (overrides: Partial<BranchInfo> = {}): BranchInfo => ({
	name: "topic/local",
	fullName: "refs/heads/topic/local",
	oid: "local-tip",
	type: "local",
	checkedOut: true,
	upstream: "second/release/next",
	upstreamRemote: "second",
	upstreamRef: "refs/heads/release/next",
	ahead: 6,
	behind: 2,
	remote: null,
	committedAt: null,
	summary: "Local work",
	worktreePath: "/test",
	...overrides,
});

const collection = (): WorkspaceBranches => ({
	branches: {
		current: "topic/local",
		branches: [
			branch(),
			branch({
				name: "origin/release/next",
				fullName: "refs/remotes/origin/release/next",
				type: "remote",
				oid: "wrong-tip",
				checkedOut: false,
				upstream: null,
			}),
			branch({
				name: "second/release/next",
				fullName: "refs/remotes/second/release/next",
				type: "remote",
				oid: "upstream-tip",
				checkedOut: false,
				upstream: null,
			}),
		],
	},
	worktrees: [],
	remotes: [],
});

it("selects the configured upstream even when its remote and branch names differ", () => {
	const request = RepositoryComparison.syncRequest(
		"/test",
		"local-tip",
		"topic/local",
		collection()
	);

	expect(request).toMatchObject({
		intent: "sync",
		base: "local-tip",
		baseName: "topic/local",
		incoming: "refs/remotes/second/release/next",
		ahead: 6,
		behind: 2,
		remote: "second",
		remoteRef: "refs/heads/release/next",
	});
	expect(request.branches.map((item) => item.oid)).toEqual([
		"local-tip",
		"upstream-tip",
	]);
});

it.each(["other-tip", ""])("rejects a stale reviewed HEAD %s", (head) => {
	expect(() =>
		RepositoryComparison.syncRequest("/test", head, "topic/local", collection())
	).toThrow("The branch changed");
});

it("rejects a changed current branch and never substitutes another remote for a missing upstream", () => {
	const data = collection();

	expect(() =>
		RepositoryComparison.syncRequest(
			"/test",
			"local-tip",
			"another-branch",
			data
		)
	).toThrow("The branch changed");
	const missing = {
		...data,
		branches: {
			...data.branches,
			branches: data.branches.branches.slice(0, 2),
		},
	};

	expect(() =>
		RepositoryComparison.syncRequest(
			"/test",
			"local-tip",
			"topic/local",
			missing
		)
	).toThrow("The upstream branch is unavailable");
});
