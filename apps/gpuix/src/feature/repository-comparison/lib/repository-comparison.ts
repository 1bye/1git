import {
	GitRepository,
	type BranchComparison,
	type GitResult,
} from "@1git/git";
import { RepositoryHistory } from "../../repository-workspace/lib/repository-history";
import type { WorkspaceEntry } from "../../repository-workspace/types";

/** A comparison captures references when opened, without changing the workspace. */
export interface ComparisonRequest {
	readonly root: string;
	readonly base: string;
	readonly baseName: string;
	readonly incoming?: string;
	readonly intent?: "pull-request";
	readonly branches: readonly {
		readonly value: string;
		readonly label: string;
		readonly oid: string;
	}[];
}

export class RepositoryComparison {
	private constructor() {}

	static async read(
		root: string,
		base: string,
		head: string,
		signal: AbortSignal
	): Promise<GitResult<BranchComparison>> {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		return await opened.value.compareBranches(base, head, { signal });
	}

	static files(comparison: BranchComparison): readonly WorkspaceEntry[] {
		return comparison.files.map((file) => ({
			...RepositoryHistory.fileEntry(file, comparison.head),
			commitFile: {
				...file,
				commit: comparison.head,
				base: comparison.mergeBase,
			},
		}));
	}
}
