import type { BranchCollection, BranchInfo } from "@1git/git";
import { LATEST_BRANCH_LIMIT } from "../constants/workspace-actions-menu.js";

interface WorkspaceBranchGroups {
	readonly latestBranches: readonly BranchInfo[];
	readonly remainingBranches: readonly BranchInfo[];
}

const committedAtTime = (branch: BranchInfo): number => {
	if (!branch.committedAt) {
		return Number.NEGATIVE_INFINITY;
	}

	const timestamp = Date.parse(branch.committedAt);
	return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
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
