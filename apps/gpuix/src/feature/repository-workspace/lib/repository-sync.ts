import {
	GitRepository,
	type GitResult,
	type SyncResult,
	type SyncBranchInput,
	type GitHttpAuthentication,
	type PushTagInput,
	type TagPushResult,
	type GitOperation,
	type GitTransferProgress,
} from "@1git/git";
import type {
	RemoteAccounts,
	ChooseRemoteAccount,
	RemoteAccountAccess,
} from "../../accounts/lib/remote-accounts";

const syncTimeoutMs = 120_000;

/** A menu-selected destination; the window adds the reviewed local branch identity. */
export type SyncChoice = Pick<SyncBranchInput, "kind" | "remote" | "remoteRef">;
/** Combined sync uses the configured upstream, never an inferred remote or branch. */
export type SyncRequest = SyncChoice | { kind: "sync" };
export type SyncKind = "fetch" | SyncRequest["kind"];

/** Git outcome with optional app-account recovery, kept outside the Git package. */
export type RepositorySyncResult = GitResult<SyncResult> & {
	readonly accountAccess?: RemoteAccountAccess;
};

type SyncInput = SyncRequest &
	Pick<SyncBranchInput, "expectedHead" | "expectedBranch">;

/** Window-owned account resolution; tokens never enter workspace or component state. */
export interface SyncAuthentication {
	readonly accounts: RemoteAccounts;
	readonly choose?: ChooseRemoteAccount;
}

/** Explicit, bounded synchronization using existing Git credentials and guarded branch operations. */
export class RepositorySync {
	private constructor() {}

	/** Resolves the same remote account as branch pushes, but sends only the reviewed tag. */
	static async pushTag(
		root: string,
		input: PushTagInput,
		signal: AbortSignal,
		authentication?: SyncAuthentication
	): Promise<
		GitResult<TagPushResult> & { readonly accountAccess?: RemoteAccountAccess }
	> {
		const timeout = AbortSignal.timeout(syncTimeoutMs);
		const request = AbortSignal.any([signal, timeout]);

		try {
			const opened = await GitRepository.open({ path: root, signal: request });

			if (!opened.ok) return opened;

			const credential = await RepositorySync.credentials(
				opened.value,
				input.remote,
				true,
				request,
				authentication
			);

			const result = await RepositorySync.explainAccountFailure(
				await opened.value.pushTag({
					...input,
					signal: request,
					httpAuthentication: credential,
				}),
				opened.value,
				input.remote,
				credential,
				authentication
			);

			if (!result.ok && timeout.aborted && !signal.aborted)
				return {
					ok: false,
					error: {
						...result.error,
						message:
							"Tag push timed out. It may have completed; inspect the remote before retrying.",
						retryable: false,
					},
				};

			return result;
		} catch (cause) {
			if (timeout.aborted && !signal.aborted)
				return {
					ok: false,
					error: {
						code: "aborted",
						operation: "push-tag",
						retryable: false,
						message:
							"Tag push timed out. It may have completed; inspect the remote before retrying.",
					},
				};

			return RepositorySync.authenticationFailure<TagPushResult>(
				cause,
				request,
				"push-tag"
			);
		}
	}

	static async write(
		root: string,
		input: SyncInput,
		signal: AbortSignal,
		authentication?: SyncAuthentication,
		onProgress?: (progress: GitTransferProgress) => void
	): Promise<RepositorySyncResult> {
		try {
			return await RepositorySync.writeAuthenticated(
				root,
				input,
				signal,
				authentication,
				onProgress
			);
		} catch (cause) {
			return RepositorySync.authenticationFailure(cause, signal);
		}
	}

	private static async writeAuthenticated(
		root: string,
		input: SyncInput,
		signal: AbortSignal,
		authentication?: SyncAuthentication,
		onProgress?: (progress: GitTransferProgress) => void
	): Promise<RepositorySyncResult> {
		const timeout = AbortSignal.timeout(syncTimeoutMs);
		const request = AbortSignal.any([signal, timeout]);
		const opened = await GitRepository.open({ path: root, signal: request });

		if (!opened.ok) return opened;

		let result: RepositorySyncResult;

		if (input.kind === "sync")
			result = await RepositorySync.syncUpstream(
				opened.value,
				input,
				request,
				authentication,
				onProgress
			);
		else {
			const credential = await RepositorySync.credentials(
				opened.value,
				input.remote,
				input.kind !== "pull",
				request,
				authentication
			);

			result = await RepositorySync.explainAccountFailure(
				await opened.value.syncBranch({
					...input,
					onProgress,
					signal: request,
					httpAuthentication: credential,
				}),
				opened.value,
				input.remote,
				credential,
				authentication
			);
		}

		if (!result.ok && timeout.aborted && !signal.aborted)
			return {
				ok: false,
				error: {
					...result.error,
					message:
						"Synchronization timed out. It may have completed; review status before retrying.",
					retryable: true,
				},
			};

		return result;
	}

	private static async syncUpstream(
		repository: GitRepository,
		input: SyncInput,
		signal: AbortSignal,
		authentication?: SyncAuthentication,
		onProgress?: (progress: GitTransferProgress) => void
	): Promise<RepositorySyncResult> {
		const snapshot = await repository.getSnapshot({ signal });

		if (!snapshot.ok) return snapshot;

		const { head } = snapshot.value;
		let message: string | undefined;

		if (
			!head.oid ||
			!head.branch ||
			head.detached ||
			head.unborn ||
			head.oid !== input.expectedHead ||
			head.branch !== input.expectedBranch
		)
			message =
				"The branch changed or has no commit. Refresh before synchronizing.";
		else if (snapshot.value.operationState !== "normal")
			message = "Finish the current Git operation before synchronizing.";

		if (message)
			return {
				ok: false,
				error: {
					code: "invalid-input",
					operation: "fetch",
					message,
					retryable: false,
				},
			};

		const branches = await repository.getBranches({ signal });

		if (!branches.ok) return branches;

		const branch = branches.value.branches.find(
			(item) => item.type === "local" && item.name === head.branch
		);

		if (
			!branch?.upstreamRemote ||
			!branch.upstreamRef ||
			branch.upstreamRemote === "."
		)
			return {
				ok: false,
				error: {
					code: "invalid-input",
					operation: "fetch",
					retryable: false,
					message:
						"This branch has no remote upstream. Publish it from the tab menu before synchronizing.",
				},
			};

		const remote = branch.upstreamRemote;
		const remoteRef = branch.upstreamRef;

		const httpAuthentication = await RepositorySync.credentials(
			repository,
			remote,
			false,
			signal,
			authentication
		);

		onProgress?.({ phase: "connecting", percent: null });
		let result = await repository.fetch({
			remote,
			signal,
			httpAuthentication,
			onProgress,
		});

		if (!result.ok)
			return await RepositorySync.explainAccountFailure(
				result,
				repository,
				remote,
				httpAuthentication,
				authentication
			);

		if (
			result.value.snapshot.head.oid !== input.expectedHead ||
			result.value.snapshot.head.branch !== input.expectedBranch
		)
			return {
				ok: false,
				error: {
					code: "invalid-input",
					operation: "fetch",
					retryable: false,
					message:
						"The branch changed while synchronizing. Refresh before retrying.",
				},
			};

		if (result.value.snapshot.head.behind > 0) {
			onProgress?.({ phase: "connecting", percent: null });
			result = await repository.syncBranch({
				...input,
				onProgress,
				kind: "pull",
				httpAuthentication,
				remote,
				remoteRef,
				signal,
			});

			if (!result.ok)
				return await RepositorySync.explainAccountFailure(
					result,
					repository,
					remote,
					httpAuthentication,
					authentication
				);
		}

		if (result.value.snapshot.head.ahead > 0) {
			onProgress?.({ phase: "connecting", percent: null });
			const credential = await RepositorySync.credentials(
				repository,
				remote,
				true,
				signal,
				authentication
			);

			return await RepositorySync.explainAccountFailure(
				await repository.syncBranch({
					...input,
					onProgress,
					kind: "push",
					httpAuthentication: credential,
					remote,
					remoteRef,
					signal,
				}),
				repository,
				remote,
				credential,
				authentication
			);
		}

		return result;
	}

	static async fetch(
		root: string,
		signal: AbortSignal,
		authentication?: SyncAuthentication,
		onProgress?: (progress: GitTransferProgress) => void
	): Promise<RepositorySyncResult> {
		try {
			return await RepositorySync.fetchAuthenticated(
				root,
				signal,
				authentication,
				onProgress
			);
		} catch (cause) {
			return RepositorySync.authenticationFailure(cause, signal);
		}
	}

	private static async fetchAuthenticated(
		root: string,
		signal: AbortSignal,
		authentication?: SyncAuthentication,
		onProgress?: (progress: GitTransferProgress) => void
	): Promise<RepositorySyncResult> {
		const timeout = AbortSignal.timeout(syncTimeoutMs);
		const request = AbortSignal.any([signal, timeout]);
		const opened = await GitRepository.open({ path: root, signal: request });

		if (!opened.ok) return opened;

		const remotes = await opened.value.getRemotes({ signal: request });

		if (!remotes.ok) return remotes;

		if (!remotes.value.length)
			return {
				ok: false,
				error: {
					code: "invalid-input",
					operation: "fetch",
					retryable: false,
					message: "No remote is configured for this repository.",
				},
			};

		// Resolve all choices before the first network write; never send one token to `fetch --all`.
		const destinations: {
			remote: string;
			httpAuthentication?: GitHttpAuthentication;
		}[] = [];

		for (const remote of remotes.value)
			destinations.push({
				remote: remote.name,
				httpAuthentication: await RepositorySync.credentials(
					opened.value,
					remote.name,
					false,
					request,
					authentication
				),
			});

		let result: RepositorySyncResult = {
			ok: false,
			error: {
				code: "invalid-input",
				operation: "fetch",
				retryable: false,
				message: "No remote is configured.",
			},
		};

		for (const destination of destinations) {
			onProgress?.({ phase: "connecting", percent: null });
			result = await RepositorySync.explainAccountFailure(
				await opened.value.fetch({
					...destination,
					signal: request,
					onProgress,
				}),
				opened.value,
				destination.remote,
				destination.httpAuthentication,
				authentication
			);

			if (!result.ok) break;
		}

		if (!result.ok && timeout.aborted && !signal.aborted)
			return {
				ok: false,
				error: {
					...result.error,
					message:
						"Fetch timed out. Check your connection and credentials, then retry.",
					retryable: true,
				},
			};

		return result;
	}

	private static async explainAccountFailure<T>(
		result: GitResult<T>,
		repository: GitRepository,
		remote: string,
		credential: GitHttpAuthentication | undefined,
		authentication: SyncAuthentication | undefined
	): Promise<GitResult<T> & { readonly accountAccess?: RemoteAccountAccess }> {
		if (
			result.ok ||
			result.error.code !== "authentication-required" ||
			!credential ||
			!authentication
		)
			return result;

		let accountAccess: RemoteAccountAccess = {
			message:
				"The selected account could not access this repository. Check its permissions or reconnect.",
		};

		try {
			accountAccess = await authentication.accounts.permissionHelp(
				repository.info.commonDirectory,
				remote,
				credential.url
			);
		} catch {
			// Permission metadata is optional; a vault/preferences failure must not hide the original access denial.
		}

		return {
			ok: false,
			error: {
				...result.error,
				message: accountAccess.message,
				details: undefined,
			},
			accountAccess,
		};
	}

	private static async credentials(
		repository: GitRepository,
		name: string,
		push: boolean,
		signal: AbortSignal,
		authentication?: SyncAuthentication
	): Promise<GitHttpAuthentication | undefined> {
		if (!authentication) return undefined;

		const remotes = await repository.getRemotes({ signal });

		if (!remotes.ok)
			throw new Error(
				"Could not verify the remote destination before authentication."
			);

		const remote = remotes.value.find((item) => item.name === name);
		const urls = push ? remote?.pushUrls : remote?.fetchUrls;

		if (!urls?.length)
			throw new Error(
				"The selected remote is unavailable. Refresh before synchronizing."
			);

		const [url] = urls;

		if (!url) return undefined;

		const credential = await authentication.accounts.authentication(
			repository.info.commonDirectory,
			name,
			url,
			signal,
			authentication.choose
		);

		if (credential && urls.length !== 1)
			throw new Error(
				"Configure a single remote destination before synchronizing with an account."
			);

		return credential;
	}

	private static authenticationFailure<T = SyncResult>(
		cause: unknown,
		signal: AbortSignal,
		operation: GitOperation = "fetch"
	): GitResult<T> {
		return {
			ok: false,
			error: {
				code: signal.aborted ? "aborted" : "authentication-required",
				operation,
				retryable: true,
				message: signal.aborted
					? "Synchronization cancelled."
					: cause instanceof Error
						? cause.message
						: "Could not authenticate. Check the account in Settings.",
			},
		};
	}
}
