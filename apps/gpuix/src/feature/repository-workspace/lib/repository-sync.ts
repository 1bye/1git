import {
	GitRepository,
	type GitResult,
	type SyncResult,
	type SyncBranchInput,
} from "@1git/git";

const syncTimeoutMs = 120_000;

/** A menu-selected destination; the window adds the reviewed local branch identity. */
export type SyncChoice = Pick<SyncBranchInput, "kind" | "remote" | "remoteRef">;
export type SyncKind = "fetch" | SyncChoice["kind"];

/** Explicit, bounded synchronization using existing Git credentials and guarded branch operations. */
export class RepositorySync {
	private constructor() {}

	static async write(
		root: string,
		input: Omit<SyncBranchInput, "signal">,
		signal: AbortSignal
	): Promise<GitResult<SyncResult>> {
		const timeout = AbortSignal.timeout(syncTimeoutMs);
		const request = AbortSignal.any([signal, timeout]);
		const opened = await GitRepository.open({ path: root, signal: request });

		if (!opened.ok) return opened;

		const result = await opened.value.syncBranch({ ...input, signal: request });

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
