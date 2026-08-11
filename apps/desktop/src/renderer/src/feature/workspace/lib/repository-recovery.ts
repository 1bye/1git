import type { GitError, RepositoryOperationState } from "@1git/git";

export type RepositoryRecoveryAction = "abort" | "continue" | "skip";

export interface RepositoryRecovery {
	readonly actions: readonly RepositoryRecoveryAction[];
	readonly label: string;
}

const RECOVERY_BY_OPERATION: Readonly<
	Record<Exclude<RepositoryOperationState, "normal">, RepositoryRecovery>
> = {
	"cherry-pick": {
		actions: ["continue", "abort"],
		label: "Cherry-pick in progress",
	},
	merge: {
		actions: ["continue", "abort"],
		label: "Merge in progress",
	},
	rebase: {
		actions: ["continue", "skip", "abort"],
		label: "Rebase in progress",
	},
	revert: {
		actions: ["continue", "abort"],
		label: "Revert in progress",
	},
};

export const getRepositoryRecovery = (
	operationState: RepositoryOperationState
): RepositoryRecovery | null =>
	operationState === "normal" ? null : RECOVERY_BY_OPERATION[operationState];

export const isRepositoryRecoveryActionAllowed = (
	operationState: RepositoryOperationState,
	action: RepositoryRecoveryAction
): boolean =>
	getRepositoryRecovery(operationState)?.actions.includes(action) ?? false;

export const shouldStageFilesOnFirstPresentation = (
	operationState: RepositoryOperationState
): boolean => operationState === "normal";

export const repositoryRecoveryErrorMessage = (
	error: GitError,
	operationState: RepositoryOperationState,
	action: RepositoryRecoveryAction
): string => {
	if (error.code === "conflict") {
		return "Conflicts remain. Resolve them, stage the files, then continue.";
	}
	if (error.code === "dirty-worktree") {
		return "Local changes still block this operation. Review the conflicted files and retry.";
	}
	if (error.code === "repository-locked") {
		return "Another Git operation is using this repository. Retry when it finishes.";
	}
	const recovery = getRepositoryRecovery(operationState);
	const operationLabel = recovery
		? recovery.label.toLowerCase()
		: "Git operation";
	return `Could not ${action} the ${operationLabel}. ${error.message}`;
};
