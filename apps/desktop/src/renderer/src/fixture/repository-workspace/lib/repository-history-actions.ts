import type { BranchCollection, BranchInfo, CommitInfo } from "@1git/git";

export const canAmendHistoryCommit = (
	commit: CommitInfo,
	headOid: string | null
): boolean => commit.oid === headOid;

export const canRevertHistoryCommit = (commit: CommitInfo): boolean =>
	commit.parentOids.length <= 1;

export const getCherryPickTargetBranches = (
	branches: BranchCollection | null
): readonly BranchInfo[] =>
	branches?.branches.filter(
		(branch) => branch.type === "local" && !branch.checkedOut
	) ?? [];
