import type { HeadState, RemoteInfo } from "@1git/git";
import {
	getGithubPullRequestUrl,
	getPreferredRepositoryRemote,
	getPreferredRepositoryRemoteUrl,
	getRepositoryWebUrl,
} from "@/feature/workspace/lib/repository-remote.js";
import type { RepositorySyncAction } from "@/feature/workspace/lib/repository-sync.js";

export interface RepositoryBranchComparison {
	readonly baseBranch: string;
	readonly baseRevision: string;
	readonly browserActionLabel: "Open pull request" | "Open remote";
	readonly browserUrl: string;
	readonly headBranch: string;
}

export type RepositoryCleanAction =
	| {
			readonly description: string;
			readonly disabledReason: string | null;
			readonly kind: "preview-comparison";
			readonly label: string;
	  }
	| {
			readonly description: string;
			readonly disabledReason: string | null;
			readonly kind: "sync";
			readonly label: string;
			readonly syncAction: RepositorySyncAction;
	  };

export const getRepositoryBranchComparison = (
	head: HeadState,
	remotes: readonly RemoteInfo[]
): RepositoryBranchComparison | null => {
	if (!(head.branch && head.oid)) {
		return null;
	}
	const remote = getPreferredRepositoryRemote(remotes, head.upstream);
	if (!remote?.defaultBranch || remote.defaultBranch === head.branch) {
		return null;
	}
	const remoteUrl = getPreferredRepositoryRemoteUrl([remote], head.upstream);
	const repositoryUrl = getRepositoryWebUrl(remoteUrl);
	if (!repositoryUrl) {
		return null;
	}
	const pullRequestUrl = getGithubPullRequestUrl(
		remoteUrl,
		remote.defaultBranch,
		head.branch
	);
	return {
		baseBranch: remote.defaultBranch,
		baseRevision: `${remote.name}/${remote.defaultBranch}`,
		browserActionLabel: pullRequestUrl ? "Open pull request" : "Open remote",
		browserUrl: pullRequestUrl ?? repositoryUrl,
		headBranch: head.branch,
	};
};

export const getRepositoryCleanAction = (
	syncAction: RepositorySyncAction,
	comparison: RepositoryBranchComparison | null
): RepositoryCleanAction => {
	if (syncAction.kind !== "fetch" || !comparison) {
		return {
			description: syncAction.description,
			disabledReason: syncAction.disabledReason,
			kind: "sync",
			label: syncAction.label,
			syncAction,
		};
	}
	return {
		description: `Compare ${comparison.headBranch} with ${comparison.baseBranch}`,
		disabledReason: null,
		kind: "preview-comparison",
		label: "Preview pull request",
	};
};
