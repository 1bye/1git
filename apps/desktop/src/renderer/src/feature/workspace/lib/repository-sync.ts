import type {
	FetchInput,
	HeadState,
	PullInput,
	PushInput,
	RemoteInfo,
} from "@1git/git";

export type RepositorySyncActionKind =
	| "fetch"
	| "publish"
	| "pull"
	| "push"
	| "sync";

export interface RepositorySyncAction {
	readonly description: string;
	readonly disabledReason: string | null;
	readonly kind: RepositorySyncActionKind;
	readonly label: string;
	readonly remoteName: string | null;
}

export type RepositorySyncStep =
	| {
			readonly input: FetchInput;
			readonly kind: "fetch";
	  }
	| {
			readonly input: PullInput;
			readonly kind: "pull";
	  }
	| {
			readonly input: PushInput;
			readonly kind: "push";
	  };

const commitCount = (count: number): string =>
	`${count} ${count === 1 ? "commit" : "commits"}`;

const preferredPushRemote = (
	remotes: readonly RemoteInfo[]
): RemoteInfo | null =>
	remotes.find(
		(remote) => remote.name === "origin" && remote.pushUrls.length > 0
	) ??
	remotes.find((remote) => remote.pushUrls.length > 0) ??
	null;

export const getRepositorySyncAction = (
	head: HeadState,
	remotes: readonly RemoteInfo[]
): RepositorySyncAction => {
	if (!head.upstream) {
		const remote = preferredPushRemote(remotes);
		let disabledReason: string | null = null;
		if (!(head.branch && head.oid)) {
			disabledReason = "Create or check out a branch with a commit first.";
		} else if (!remote) {
			disabledReason = "Add a remote before publishing this branch.";
		}
		return {
			description: remote
				? `Publish ${head.branch ?? "the current branch"} to ${remote.name}`
				: "Connect this branch to a remote",
			disabledReason,
			kind: "publish",
			label: "Publish branch",
			remoteName: remote?.name ?? null,
		};
	}

	if (head.ahead > 0 && head.behind > 0) {
		return {
			description: `Pull ${commitCount(head.behind)}, then push ${commitCount(head.ahead)}`,
			disabledReason: null,
			kind: "sync",
			label: "Sync branch",
			remoteName: head.upstream.split("/", 1)[0] ?? null,
		};
	}

	if (head.behind > 0) {
		return {
			description: `Pull ${commitCount(head.behind)} from ${head.upstream}`,
			disabledReason: null,
			kind: "pull",
			label: "Pull",
			remoteName: head.upstream.split("/", 1)[0] ?? null,
		};
	}

	if (head.ahead > 0) {
		return {
			description: `Push ${commitCount(head.ahead)} to ${head.upstream}`,
			disabledReason: null,
			kind: "push",
			label: "Push",
			remoteName: head.upstream.split("/", 1)[0] ?? null,
		};
	}

	return {
		description: `Check ${head.upstream} for new commits`,
		disabledReason: null,
		kind: "fetch",
		label: "Fetch",
		remoteName: head.upstream.split("/", 1)[0] ?? null,
	};
};

export const getRepositorySyncSteps = (
	action: RepositorySyncAction,
	branch: string | null
): readonly RepositorySyncStep[] => {
	switch (action.kind) {
		case "fetch":
			return [{ input: { prune: true }, kind: "fetch" }];
		case "pull":
			return [
				{
					input: { strategy: "fast-forward-only" },
					kind: "pull",
				},
			];
		case "push":
			return [{ input: {}, kind: "push" }];
		case "publish":
			if (!(action.remoteName && branch)) {
				return [];
			}
			return [
				{
					input: {
						branch,
						remote: action.remoteName,
						setUpstream: true,
					},
					kind: "push",
				},
			];
		case "sync":
			// Merging preserves local history; Phase 1 must not rewrite it implicitly.
			return [
				{ input: { strategy: "merge" }, kind: "pull" },
				{ input: {}, kind: "push" },
			];
		default:
			throw new Error("Unsupported repository sync action.");
	}
};

export const isRepositorySyncActionKind = (
	action: string | null
): action is RepositorySyncActionKind =>
	action === "fetch" ||
	action === "publish" ||
	action === "pull" ||
	action === "push" ||
	action === "sync";

export const repositorySyncProgressLabel = (
	action: RepositorySyncActionKind
): string => {
	switch (action) {
		case "fetch":
			return "Fetching";
		case "publish":
			return "Publishing";
		case "pull":
			return "Pulling";
		case "push":
			return "Pushing";
		case "sync":
			return "Syncing";
		default:
			throw new Error("Unsupported repository sync action.");
	}
};
