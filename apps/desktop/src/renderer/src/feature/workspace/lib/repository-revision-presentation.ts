import type { FileDiff } from "@1git/git";

export interface RepositoryRevisionPresentation {
	readonly diff: FileDiff;
	readonly selectedCommitOid: string | null;
	readonly selectedFilePath: string | null;
	readonly selectedStashOid: string | null;
}

export const getRepositoryRevisionPresentation = (
	kind: "commit" | "stash",
	revision: string,
	diff: FileDiff | null
): RepositoryRevisionPresentation | null => {
	if (!diff) {
		return null;
	}
	return {
		diff,
		selectedCommitOid: kind === "commit" ? revision : null,
		selectedFilePath: diff.stats[0]?.path ?? null,
		selectedStashOid: kind === "stash" ? revision : null,
	};
};
