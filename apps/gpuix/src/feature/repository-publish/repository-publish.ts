import { MachineLocation } from "../machines/machine-location";
import {
	type GitResult,
	type SyncResult,
	type SyncBranchInput,
	type GitTransferProgress,
} from "@1git/git";
import { GitRepository } from "../machines/repository-access";
import type { Owner, Repository, RepositoryRef } from "@1git/hosting/contracts";
import { parseRemote } from "@1git/hosting/remote";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";
import {
	AccountStore,
	hasControlCharacters,
	type SavedAccount,
} from "../accounts/lib/account-store";
import type { Accounts } from "../accounts/lib/accounts";
import { RemoteAccounts } from "../accounts/lib/remote-accounts";

/** Public recovery receipt. Creation is never repeated once this receipt has been delivered. */
export interface PublishedRepository {
	readonly id: string;
	readonly ref: RepositoryRef;
	readonly visibility: "private" | "public";
	readonly accountKey: string;
	readonly commonDirectory: string;
	readonly head: string;
	readonly branch: string;
}

/** Explicit form submission; only committed history is uploaded. */
export interface PublishRepositoryRequest {
	readonly account: SavedAccount;
	readonly owner: Owner;
	readonly name: string;
	readonly description: string;
	readonly visibility: "private" | "public";
	readonly created?: PublishedRepository;
}

/** A reviewed local branch, supplied by the window's shared-repository operation lock. */
export type PublishBranchIdentity = Pick<
	SyncBranchInput,
	"expectedHead" | "expectedBranch"
>;

/** Create, connect and upload without overwriting remotes or repeating an uncertain provider write. */
export class RepositoryPublish {
	constructor(
		private readonly accounts: Accounts,
		private readonly bindings: RemoteAccounts
	) {}

	static validName(name: string): boolean {
		return (
			/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(name) && !name.endsWith(".git")
		);
	}

	async write(
		root: string,
		input: PublishRepositoryRequest,
		identity: PublishBranchIdentity,
		signal: AbortSignal,
		onCreated: (receipt: PublishedRepository) => void,
		onUncertain: () => void,
		onProgress?: (progress: GitTransferProgress) => void
	): Promise<GitResult<SyncResult>> {
		let created = input.created;
		let creationStarted = false;
		const request = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);

		try {
			if (MachineLocation.isRemote(root))
				throw new Error(
					"Configure a Git remote on the SSH machine before publishing branches here."
				);

			if (
				!RepositoryPublish.validName(input.name) ||
				input.description.length > 350 ||
				hasControlCharacters(input.description) ||
				!["private", "public"].includes(input.visibility)
			)
				throw new Error(
					"Use a repository name of up to 100 letters, numbers, dots, dashes or underscores, and a description of up to 350 characters."
				);

			const opened = await GitRepository.open({ path: root, signal: request });

			if (!opened.ok) return opened;

			const git = opened.value;
			const snapshot = await git.getSnapshot({ signal: request });

			if (!snapshot.ok) return snapshot;

			const { head } = snapshot.value;

			if (
				!head.oid ||
				!head.branch ||
				head.detached ||
				head.unborn ||
				head.oid !== identity.expectedHead ||
				head.branch !== identity.expectedBranch ||
				snapshot.value.operationState !== "normal"
			)
				throw new Error(
					"The branch changed or has no commit. Refresh and review it before publishing."
				);

			const remotes = await git.getRemotes({ signal: request });

			if (!remotes.ok) return remotes;

			if (!created && remotes.value.length)
				throw new Error(
					"This repository already has a remote. Use Publish branch or edit Remotes instead."
				);

			if (
				created &&
				(created.accountKey !== AccountStore.key(input.account) ||
					created.commonDirectory !== git.info.commonDirectory ||
					created.head !== head.oid ||
					created.branch !== head.branch)
			)
				throw new Error(
					"The account or branch changed after creation. Review the existing remote in Settings before continuing."
				);

			let hosted: Repository;

			if (created)
				hosted = await this.accounts.hostedRepository(
					input.account,
					created.ref,
					request
				);
			else {
				const result = await this.accounts.createRepository(
					input.account,
					{
						owner: input.owner,
						name: input.name,
						description: input.description || undefined,
						visibility: input.visibility,
					},
					request,
					() => {
						creationStarted = true;
					}
				);

				if (!result.ok) {
					if (
						!(
							["network", "timeout", "cancelled", "invalid-response"].includes(
								result.error.code
							) || (result.error.status ?? 0) >= 500
						)
					)
						creationStarted = false;

					throw new Error(result.error.message);
				}

				hosted = result.value;
				created = {
					id: hosted.id,
					ref: hosted.ref,
					visibility: input.visibility,
					accountKey: AccountStore.key(input.account),
					commonDirectory: git.info.commonDirectory,
					head: head.oid,
					branch: head.branch,
				};
				onCreated(created);
			}

			if (
				hosted.id !== created.id ||
				hosted.visibility !== created.visibility ||
				hosted.ref.owner.toLowerCase() !== input.owner.path.toLowerCase() ||
				hosted.ref.name.toLowerCase() !== input.name.toLowerCase()
			)
				throw new Error(
					"The provider returned unexpected repository details. Review the created repository before connecting it."
				);

			const url = hosted.cloneUrls.https;

			const provider =
				input.account.provider === "github"
					? new GitHubProvider({ webUrl: input.account.webUrl })
					: new GitLabProvider({ webUrl: input.account.webUrl });

			const parsed = parseRemote(url, [provider]);

			if (
				!RemoteAccounts.isHttps(url) ||
				!parsed.ok ||
				parsed.value.providerId !== input.account.provider ||
				parsed.value.host !== new URL(input.account.webUrl).host ||
				!parsed.value.browserUrl.startsWith(input.account.webUrl) ||
				parsed.value.repository.owner !== hosted.ref.owner ||
				parsed.value.repository.name !== hosted.ref.name
			)
				throw new Error(
					"The provider returned an unexpected remote destination. No credentials were sent to Git."
				);

			// Re-read after provider I/O; another application may have configured a remote meanwhile.
			const current = await git.getRemotes({ signal: request });

			if (!current.ok) return current;

			const origin = current.value.find((remote) => remote.name === "origin");

			if (
				current.value.length &&
				(!origin ||
					current.value.length !== 1 ||
					origin.fetchUrls.length !== 1 ||
					origin.pushUrls.length !== 1 ||
					origin.fetchUrls[0] !== url ||
					origin.pushUrls[0] !== url)
			)
				throw new Error(
					"Remote settings changed. The hosted repository was kept; no existing remote was overwritten."
				);

			if (!origin) {
				const added = await git.addRemote({
					name: "origin",
					url,
					signal: request,
				});

				if (!added.ok) return added;
			}

			this.bindings.select(
				git.info.commonDirectory,
				"origin",
				url,
				AccountStore.key(input.account)
			);
			const httpAuthentication = await this.accounts.remoteAuthentication(
				input.account,
				url,
				request
			);

			const branches = await git.getBranches({ signal: request });

			if (!branches.ok) return branches;

			const branch = branches.value.branches.find(
				(item) => item.type === "local" && item.name === head.branch
			);

			const remoteRef = `refs/heads/${head.branch}`;

			if (
				branch?.upstream &&
				(branch.upstreamRemote !== "origin" || branch.upstreamRef !== remoteRef)
			)
				throw new Error(
					"The upstream changed. Review tracking before uploading to the created repository."
				);

			return await git.syncBranch({
				...identity,
				onProgress,
				kind: branch?.upstream ? "push" : "publish",
				remote: "origin",
				remoteRef,
				httpAuthentication,
				signal: request,
			});
		} catch (cause) {
			if (creationStarted && !created) onUncertain();

			return {
				ok: false,
				error: {
					code: signal.aborted ? "aborted" : "command-failed",
					operation: "push",
					retryable: !!created,
					message: signal.aborted
						? "Publishing stopped. Review the hosted repository before retrying."
						: cause instanceof Error
							? cause.message
							: "Could not confirm publishing. Review the hosted repository before retrying.",
				},
			};
		}
	}
}
