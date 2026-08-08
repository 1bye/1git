import type { BranchCollection, BranchInfo, CommitInfo } from "@1git/git";

export const canAmendRepositoryCommit = (
	commit: CommitInfo,
	headOid: string | null
): boolean => commit.oid === headOid;

export const canRevertRepositoryCommit = (commit: CommitInfo): boolean =>
	commit.parentOids.length <= 1;

export const getRepositoryCherryPickTargets = (
	branches: BranchCollection | null
): readonly BranchInfo[] =>
	branches?.branches.filter(
		(branch) => branch.type === "local" && !branch.checkedOut
	) ?? [];
