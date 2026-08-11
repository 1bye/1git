import type { DiffTarget, FileDiff, GitError } from "@1git/git";

export type BranchSwitchResult = "failed" | "needs-stash" | "switched";
export type RepositoryStashAction = "apply" | "pop";

const EMPTY_GIT_TREE_OID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export const repositoryStashDiffTargets = (
	revision: string
): readonly [DiffTarget, DiffTarget] => [
	{ base: `${revision}^1`, head: revision, kind: "range" },
	{ base: EMPTY_GIT_TREE_OID, head: `${revision}^3`, kind: "range" },
];

export const combineRepositoryStashDiffs = (
	tracked: FileDiff,
	untracked: FileDiff | null
): FileDiff => ({
	patch: [tracked.patch, untracked?.patch].filter(Boolean).join("\n"),
	stats: untracked ? [...tracked.stats, ...untracked.stats] : tracked.stats,
	target: tracked.target,
});

export const shouldOfferStashAndSwitch = (error: GitError): boolean =>
	error.code === "dirty-worktree";

export const repositoryStashErrorMessage = (
	error: GitError,
	action: RepositoryStashAction
): string => {
	if (error.code === "conflict") {
		return action === "pop"
			? "The stash produced conflicts and was kept. Resolve the conflicts, then drop it when it is no longer needed."
			: "The stash was kept because applying it produced conflicts. Resolve the conflicted files before continuing.";
	}
	if (error.code === "repository-locked") {
		return "Another Git operation is using this repository. Retry when it finishes.";
	}
	return error.message;
};
