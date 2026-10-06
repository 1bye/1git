import {
	GitRepository,
	type GitResult,
	type SyncResult,
	type SyncBranchInput,
	type GitHttpAuthentication,
} from "@1git/git";
import type {
	RemoteAccounts,
	ChooseRemoteAccount,
} from "../../accounts/lib/remote-accounts";

const syncTimeoutMs = 120_000;

/** A menu-selected destination; the window adds the reviewed local branch identity. */
export type SyncChoice = Pick<SyncBranchInput, "kind" | "remote" | "remoteRef">;
/** Combined sync uses the configured upstream, never an inferred remote or branch. */
export type SyncRequest = SyncChoice | { kind: "sync" };
export type SyncKind = "fetch" | SyncRequest["kind"];

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

	static async write(
		root: string,
		input: SyncInput,
		signal: AbortSignal,
		authentication?: SyncAuthentication
	): Promise<GitResult<SyncResult>> {
		try {
			return await RepositorySync.writeAuthenticated(
				root,
				input,
				signal,
				authentication
			);
		} catch (cause) {
			return RepositorySync.authenticationFailure(cause, signal);
		}
	}

	private static async writeAuthenticated(
		root: string,
		input: SyncInput,
		signal: AbortSignal,
		authentication?: SyncAuthentication
	): Promise<GitResult<SyncResult>> {
		const timeout = AbortSignal.timeout(syncTimeoutMs);
		const request = AbortSignal.any([signal, timeout]);
		const opened = await GitRepository.open({ path: root, signal: request });

		if (!opened.ok) return opened;

		const result =
			input.kind === "sync"
				? await RepositorySync.syncUpstream(
						opened.value,
						input,
						request,
						authentication
					)
				: await opened.value.syncBranch({
						...input,
						signal: request,
						httpAuthentication: await RepositorySync.credentials(
							opened.value,
							input.remote,
							input.kind !== "pull",
							request,
							authentication
						),
					});

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
		authentication?: SyncAuthentication
	): Promise<GitResult<SyncResult>> {
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

		let result = await repository.fetch({ remote, signal, httpAuthentication });

		if (!result.ok) return result;

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
			result = await repository.syncBranch({
				...input,
				kind: "pull",
				httpAuthentication,
				remote,
				remoteRef,
				signal,
			});

			if (!result.ok) return result;
		}

		if (result.value.snapshot.head.ahead > 0)
			return await repository.syncBranch({
				...input,
				kind: "push",
				httpAuthentication: await RepositorySync.credentials(
					repository,
					remote,
					true,
					signal,
					authentication
				),
				remote,
				remoteRef,
				signal,
			});

		return result;
	}

	static async fetch(
		root: string,
		signal: AbortSignal,
		authentication?: SyncAuthentication
	): Promise<GitResult<SyncResult>> {
		try {
			return await RepositorySync.fetchAuthenticated(
				root,
				signal,
				authentication
			);
		} catch (cause) {
			return RepositorySync.authenticationFailure(cause, signal);
		}
	}

	private static async fetchAuthenticated(
		root: string,
		signal: AbortSignal,
		authentication?: SyncAuthentication
	): Promise<GitResult<SyncResult>> {
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

		let result: GitResult<SyncResult> = {
			ok: false,
			error: {
				code: "invalid-input",
				operation: "fetch",
				retryable: false,
				message: "No remote is configured.",
			},
		};

		for (const destination of destinations) {
			result = await opened.value.fetch({ ...destination, signal: request });

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

	private static authenticationFailure(
		cause: unknown,
		signal: AbortSignal
	): GitResult<SyncResult> {
		return {
			ok: false,
			error: {
				code: signal.aborted ? "aborted" : "authentication-required",
				operation: "fetch",
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
