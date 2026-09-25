import type { BranchCollection, BranchInfo } from "@1git/git";

export const getRepositoryLocalBranch = (
	branches: BranchCollection | null,
	name: string
): BranchInfo | null =>
	branches?.branches.find(
		(branch) => branch.type === "local" && branch.name === name
	) ?? null;

export const getRepositoryCurrentBranch = (
	branches: BranchCollection | null
): BranchInfo | null => {
	if (!branches?.current) {
		return null;
	}

	return getRepositoryLocalBranch(branches, branches.current);
};

export const getRepositoryRemoteBranches = (
	branches: BranchCollection | null
): readonly BranchInfo[] =>
	branches?.branches.filter((branch) => branch.type === "remote") ?? [];

export const getRepositoryDeletableBranches = (
	branches: BranchCollection | null
): readonly BranchInfo[] =>
	branches?.branches.filter(
		(branch) =>
			branch.type === "local" &&
			branch.name !== branches.current &&
			branch.worktreePath === null
	) ?? [];

export const repositoryBranchSwitchDisabledReason = (
	branch: BranchInfo,
	currentBranch: string | null
): string | null => {
	if (branch.name === currentBranch) {
		return null;
	}

	if (branch.worktreePath) {
		return "This branch is checked out in another worktree.";
	}

	return null;
};

export const repositoryBranchTrackingLabel = (
	branch: BranchInfo | null
): string => {
	if (!branch?.upstream) {
		return "No upstream";
	}

	if (branch.ahead === 0 && branch.behind === 0) {
		return branch.upstream;
	}

	if (branch.ahead > 0 && branch.behind > 0) {
		return `${branch.upstream} · ${branch.ahead} ahead · ${branch.behind} behind`;
	}

	if (branch.ahead > 0) {
		return `${branch.upstream} · ${branch.ahead} ahead`;
	}

	return `${branch.upstream} · ${branch.behind} behind`;
};
