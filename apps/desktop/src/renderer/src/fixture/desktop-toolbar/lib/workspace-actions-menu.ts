import type { BranchCollection, BranchInfo } from "@1git/git";

import {
	LATEST_BRANCH_LIMIT,
	WORKSPACE_BRANCH_COMMIT_AGE_UNITS,
} from "@/fixture/desktop-toolbar/constants/workspace-actions-menu.js";

interface WorkspaceBranchGroups {
	readonly latestBranches: readonly BranchInfo[];
	readonly remainingBranches: readonly BranchInfo[];
}

const BRANCH_COMMIT_RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat(
	undefined,
	{ numeric: "auto" }
);

const branchCommitTime = (committedAt: string | null): number | null => {
	if (!committedAt) {
		return null;
	}

	const timestamp = Date.parse(committedAt);

	return Number.isNaN(timestamp) ? null : timestamp;
};

const committedAtTime = (branch: BranchInfo): number =>
	branchCommitTime(branch.committedAt) ?? Number.NEGATIVE_INFINITY;

export const formatBranchCommitAge = (
	committedAt: string | null,
	nowMilliseconds = Date.now()
): string | null => {
	const timestamp = branchCommitTime(committedAt);

	if (timestamp === null) {
		return null;
	}

	const differenceMilliseconds = timestamp - nowMilliseconds;

	for (const { milliseconds, unit } of WORKSPACE_BRANCH_COMMIT_AGE_UNITS) {
		const magnitude = Math.abs(differenceMilliseconds) / milliseconds;

		if (magnitude >= 1) {
			return BRANCH_COMMIT_RELATIVE_TIME_FORMAT.format(
				Math.round(differenceMilliseconds / milliseconds),
				unit
			);
		}
	}

	return "just now";
};

export const groupWorkspaceBranches = (
	branches: BranchCollection | null
): WorkspaceBranchGroups => {
	const localBranches = (branches?.branches ?? [])
		.filter((branch) => branch.type === "local")
		.toSorted(
			(firstBranch, secondBranch) =>
				committedAtTime(secondBranch) - committedAtTime(firstBranch)
		);

	return {
		latestBranches: localBranches.slice(0, LATEST_BRANCH_LIMIT),
		remainingBranches: localBranches.slice(LATEST_BRANCH_LIMIT),
	};
};
