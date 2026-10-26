import { type BranchComparison, type GitResult } from "@1git/git";
import { GitRepository } from "../../machines/repository-access";
import { RepositoryHistory } from "../../repository-workspace/lib/repository-history";
import type { WorkspaceEntry } from "../../repository-workspace/types";
import type { WorkspaceBranches } from "../../workspace-tabs/lib/repository-branches";

/** A comparison captures references when opened, without changing the workspace. */
interface ComparisonBranches {
	readonly root: string;
	readonly base: string;
	readonly baseName: string;
	readonly incoming?: string;
	readonly branches: readonly {
		readonly value: string;
		readonly label: string;
		readonly oid: string;
	}[];
}

/** Sync reviews keep both branch tips and their fetched counts together. */
export type ComparisonRequest = ComparisonBranches &
	(
		| { readonly intent?: "pull-request" }
		| {
				readonly intent: "sync";
				readonly incoming: string;
				readonly ahead: number;
				readonly behind: number;
				readonly remote: string;
				readonly remoteRef: string;
		  }
	);

export type SyncComparisonRequest = Extract<
	ComparisonRequest,
	{ intent: "sync" }
>;

export class RepositoryComparison {
	private constructor() {}

	/** Select the configured tracking ref from the fetched collection without guessing a remote. */
	static syncRequest(
		root: string,
		head: string,
		branchName: string,
		data: WorkspaceBranches
	): SyncComparisonRequest {
		const branch = data.branches.branches.find(
			(item) => item.type === "local" && item.name === branchName
		);

		if (data.branches.current !== branchName || branch?.oid !== head)
			throw new Error(
				"The branch changed. Go back and sync again to refresh the review."
			);

		const upstream = branch.upstream
			? data.branches.branches.find(
					(item) => item.type === "remote" && item.name === branch.upstream
				)
			: undefined;

		if (
			!upstream ||
			!branch.upstreamRemote ||
			branch.upstreamRemote === "." ||
			!branch.upstreamRef
		)
			throw new Error(
				"The upstream branch is unavailable. Check Remotes, then sync again."
			);

		return {
			root,
			base: head,
			baseName: branchName,
			intent: "sync",
			incoming: upstream.fullName,
			ahead: branch.ahead,
			behind: branch.behind,
			remote: branch.upstreamRemote,
			remoteRef: branch.upstreamRef,
			branches: [branch, upstream].map((item) => ({
				value: item.fullName,
				label: item.name,
				oid: item.oid,
			})),
		};
	}

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
