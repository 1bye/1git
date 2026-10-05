import {
	GitRepository,
	type GitResult,
	type SyncResult,
	type SyncBranchInput,
} from "@1git/git";

const syncTimeoutMs = 120_000;

/** A menu-selected destination; the window adds the reviewed local branch identity. */
export type SyncChoice = Pick<SyncBranchInput, "kind" | "remote" | "remoteRef">;
/** Combined sync uses the configured upstream, never an inferred remote or branch. */
export type SyncRequest = SyncChoice | { kind: "sync" };
export type SyncKind = "fetch" | SyncRequest["kind"];

type SyncInput = SyncRequest &
	Pick<SyncBranchInput, "expectedHead" | "expectedBranch">;

/** Explicit, bounded synchronization using existing Git credentials and guarded branch operations. */
export class RepositorySync {
	private constructor() {}

	static async write(
		root: string,
		input: SyncInput,
		signal: AbortSignal
	): Promise<GitResult<SyncResult>> {
		const timeout = AbortSignal.timeout(syncTimeoutMs);
		const request = AbortSignal.any([signal, timeout]);
		const opened = await GitRepository.open({ path: root, signal: request });

		if (!opened.ok) return opened;

		const result =
			input.kind === "sync"
				? await RepositorySync.syncUpstream(opened.value, input, request)
				: await opened.value.syncBranch({ ...input, signal: request });

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
		signal: AbortSignal
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
		let result = await repository.fetch({ remote, signal });

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
				remote,
				remoteRef,
				signal,
			});

		return result;
	}

	static async fetch(
		root: string,
		signal: AbortSignal
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

		const result = await opened.value.fetch({ signal: request });

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
}
