import { type BranchCollection, type RemoteInfo } from "@1git/git";
import { GitRepository } from "../machines/repository-access";
import { parseRemote, type RemoteIdentity } from "@1git/hosting/remote";
import type { PullRequest } from "@1git/hosting/contracts";
import type { Accounts } from "../accounts/lib/accounts";
import {
	AccountStore,
	hasControlCharacters,
} from "../accounts/lib/account-store";
import type { RemoteAccounts } from "../accounts/lib/remote-accounts";
import type { ComparisonRequest } from "../repository-comparison/lib/repository-comparison";

const metadataTimeoutMs = 8000;

/** Credential-free review snapshot. Remote-tracking refs describe the last fetch, not live server state. */
export interface PullRequestPreview {
	readonly comparison: ComparisonRequest;
	readonly branch: string;
	readonly head: string;
	readonly remote: string;
	readonly remoteUrl: string;
	readonly remoteRef: string;
	readonly identity: RemoteIdentity;
	readonly publishedHead: string | null;
	readonly uploadKind: "publish" | "push";
	readonly requests: readonly PullRequest[];
	readonly repositoryId: string | null;
	readonly notice: string | null;
}

/** Same-repository PR/MR preview and safe browser destinations; no Git or provider writes. */
export class RepositoryPullRequest {
	constructor(
		private readonly accounts: Accounts,
		private readonly bindings: RemoteAccounts
	) {}

	/** Prefer the exact upstream, then origin, then a sole remote; never guess between other destinations. */
	static destination(
		branches: BranchCollection,
		remotes: readonly RemoteInfo[]
	): RemoteInfo {
		const branch = branches.branches.find(
			(item) => item.type === "local" && item.checkedOut
		);

		const upstream = branch?.upstreamRemote;

		const remote =
			upstream && upstream !== "."
				? remotes.find((item) => item.name === upstream)
				: (remotes.find((item) => item.name === "origin") ??
					(remotes.length === 1 ? remotes[0] : undefined));

		if (!remote)
			throw new Error("Choose a remote in Repository → Remotes first.");

		if (remote.fetchUrls.length !== 1 || remote.pushUrls.length !== 1)
			throw new Error(
				"Pull-request preview requires a remote with one fetch and one push destination."
			);

		return remote;
	}

	async read(root: string, signal: AbortSignal): Promise<PullRequestPreview> {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) throw new Error(opened.error.message);

		const git = opened.value;

		const [snapshot, branches, remotes, providers] = await Promise.all([
			git.getSnapshot({ signal }),
			git.getBranches({ signal }),
			git.getRemotes({ signal }),
			this.accounts.hostProviders(),
		]);

		if (!snapshot.ok) throw new Error(snapshot.error.message);

		if (!branches.ok) throw new Error(branches.error.message);

		if (!remotes.ok) throw new Error(remotes.error.message);

		const { head } = snapshot.value;

		if (!head.oid || !head.branch || head.detached || head.unborn)
			throw new Error(
				"Open a committed branch before previewing a pull request."
			);

		if (snapshot.value.operationState !== "normal")
			throw new Error(
				"Finish the current Git operation before previewing a pull request."
			);

		const remote = RepositoryPullRequest.destination(
			branches.value,
			remotes.value
		);

		const url = remote.fetchUrls[0];
		const pushUrl = remote.pushUrls[0];

		if (!url || !pushUrl) throw new Error("This remote has no destination.");

		const parsed = parseRemote(url, providers);
		const push = parseRemote(pushUrl, providers);

		if (
			!parsed.ok ||
			!push.ok ||
			!["github", "gitlab"].includes(parsed.value.providerId)
		)
			throw new Error(
				"Pull-request preview supports GitHub and GitLab remotes. Configure custom hosts in Accounts."
			);

		if (parsed.value.browserUrl !== push.value.browserUrl)
			throw new Error(
				"Fetch and push point to different repositories. Fork pull requests must be created on the provider's website."
			);

		const identity = parsed.value;

		const provider = providers.find(
			(item) =>
				item.id === identity.providerId &&
				new URL(item.options.webUrl ?? item.defaultWebUrl).host ===
					identity.host
		);

		if (!provider) throw new Error("This hosting provider is unavailable.");

		const local = branches.value.branches.find(
			(item) => item.type === "local" && item.name === head.branch
		);

		if (
			(local?.upstream || local?.upstreamRemote) &&
			(local.upstreamRemote !== remote.name ||
				!local.upstreamRef?.startsWith("refs/heads/"))
		)
			throw new Error(
				"This branch does not track a branch on the selected remote. Configure its remote upstream first."
			);

		const source =
			local?.upstreamRemote === remote.name &&
			local.upstreamRef?.startsWith("refs/heads/")
				? local.upstreamRef.slice("refs/heads/".length)
				: head.branch;

		const prefix = `refs/remotes/${remote.name}/`;

		const published = branches.value.branches.find(
			(item) => item.fullName === `${prefix}${source}`
		);

		const targets = branches.value.branches
			.filter(
				(item) =>
					item.type === "remote" &&
					item.remote === remote.name &&
					item.fullName.startsWith(prefix)
			)
			.map((item) => ({
				value: item.fullName,
				label: item.fullName.slice(prefix.length),
				oid: item.oid,
			}));

		let defaultBranch = remote.defaultBranch;
		let requests: readonly PullRequest[] = [];
		let repositoryId: string | null = null;
		let notice: string | null = null;

		try {
			const choice = this.bindings.choice(
				git.info.commonDirectory,
				remote.name,
				url
			);

			const matching = this.bindings.matching(`${identity.browserUrl}.git`);

			const account =
				choice === "system"
					? undefined
					: choice === "automatic"
						? matching.length === 1
							? matching[0]
							: undefined
						: matching.find((item) => AccountStore.key(item) === choice);

			if (choice !== "automatic" && choice !== "system" && !account)
				throw new Error("The selected account is unavailable.");

			if (!account)
				throw new Error("Connect an account to check existing requests.");

			const hosted = await this.accounts.repositoryReviews(
				account,
				identity.repository,
				AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)])
			);

			if (hosted.repository.browserUrl !== identity.browserUrl)
				throw new Error("The provider returned a different repository.");

			defaultBranch = hosted.repository.defaultBranch ?? defaultBranch;
			requests = hosted.requests;
			repositoryId = hosted.repository.id;

			if (!hosted.complete)
				notice =
					"The request list is incomplete. The provider will check again when you continue.";
		} catch {
			signal.throwIfAborted();
			notice =
				"Could not check existing requests. You can still continue on the provider's website.";
		}

		const base = targets.find((item) => item.label === defaultBranch);
		const incoming = `refs/heads/${head.branch}`;

		return {
			branch: head.branch,
			head: head.oid,
			remote: remote.name,
			remoteUrl: url,
			remoteRef: `refs/heads/${source}`,
			identity,
			publishedHead: published?.oid ?? null,
			uploadKind: local?.upstreamRemote === remote.name ? "push" : "publish",
			requests,
			repositoryId,
			notice,
			comparison: {
				intent: "pull-request",
				root,
				base: base?.oid ?? "",
				baseName: base?.label ?? "Choose a target branch…",
				incoming,
				branches: [
					...targets,
					{ value: incoming, label: head.branch, oid: head.oid },
				],
			},
		};
	}

	/** Tracking determines the upload operation, even when the remote branch is absent or already exists. */
	static action(preview: PullRequestPreview): "browser" | "publish" | "push" {
		return preview.publishedHead === preview.head
			? "browser"
			: preview.uploadKind;
	}

	/** Only reuse requests from this repository, not a fork with an identically named source branch. */
	static existing(
		preview: PullRequestPreview,
		target: string
	): PullRequest | undefined {
		const source = preview.remoteRef.slice("refs/heads/".length);

		return preview.requests.find(
			(item) =>
				item.state === "open" &&
				item.sourceBranch === source &&
				item.targetBranch === target &&
				item.sourceRepositoryId != null &&
				item.sourceRepositoryId === preview.repositoryId
		);
	}

	/** Encoding keeps branch names out of URL syntax. The browser performs final creation; no API POST is made. */
	static browserUrl(preview: PullRequestPreview, target: string): string {
		const existing = RepositoryPullRequest.existing(preview, target);
		const source = preview.remoteRef.slice("refs/heads/".length);
		const { browserUrl, providerId } = preview.identity;

		if (!target || !source || hasControlCharacters(target + source))
			throw new Error("Choose valid branches first.");

		if (existing)
			return `${browserUrl}/${providerId === "github" ? "pull" : "-/merge_requests"}/${existing.number}`;

		if (providerId === "github")
			return `${browserUrl}/compare/${encodeURIComponent(target)}...${encodeURIComponent(source)}?expand=1`;

		if (providerId !== "gitlab")
			throw new Error("Unsupported hosting provider.");

		const url = new URL(`${browserUrl}/-/merge_requests/new`);

		url.searchParams.set("merge_request[source_branch]", source);
		url.searchParams.set("merge_request[target_branch]", target);

		return url.href;
	}
}
