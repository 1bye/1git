import { type SquashCommitsInput } from "@1git/git";
import { GitRepository } from "../../machines/repository-access";

const squashTimeoutMs = 120_000;

/** Local History review and explicit isolated squashing; no fetch, push or automatic retry. */
export class RepositoryHistorySquash {
	private constructor() {}

	static async read(root: string, input: SquashCommitsInput) {
		const opened = await GitRepository.open({
			path: root,
			signal: input.signal,
		});

		return opened.ok ? await opened.value.getSquashPlan(input) : opened;
	}

	static async write(root: string, input: SquashCommitsInput) {
		const timeout = AbortSignal.timeout(squashTimeoutMs);

		const signal = input.signal
			? AbortSignal.any([input.signal, timeout])
			: timeout;

		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const result = await opened.value.squashCommits({ ...input, signal });

		return !result.ok && result.error.code === "aborted"
			? {
					ok: false as const,
					error: {
						...result.error,
						retryable: false,
						message:
							"Squash stopped. Refresh and inspect History before retrying; the outcome may have completed.",
					},
				}
			: result;
	}
}
