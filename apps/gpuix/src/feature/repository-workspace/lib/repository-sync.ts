import { GitRepository, type GitResult, type SyncResult } from "@1git/git";

const fetchTimeoutMs = 120_000;

/** Explicit, cancellable fetches using existing Git credentials; never integrates or publishes commits. */
export class RepositorySync {
	private constructor() {}

	static async fetch(
		root: string,
		signal: AbortSignal
	): Promise<GitResult<SyncResult>> {
		const timeout = AbortSignal.timeout(fetchTimeoutMs);
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
