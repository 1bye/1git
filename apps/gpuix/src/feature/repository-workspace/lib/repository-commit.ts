import {
	type CommitFilesInput,
	type CommitFilesResult,
	type GitResult,
	type CommitRecoveryInput,
	type CommitInfo,
} from "@1git/git";
import { GitRepository } from "../../machines/repository-access";

/** Metadata remains visible even when undo is unavailable for a published commit. */
export interface LastCommit {
	readonly commit: CommitInfo;
	readonly undoUnavailableReason: string | null;
}

/** Explicit selected-file commits; checkbox changes never mutate Git staging. */
export class RepositoryCommit {
	private constructor() {}

	/** Read one tip and its undo eligibility for the footer, without contacting remotes. */
	static async readLast(
		root: string,
		input: CommitRecoveryInput
	): Promise<GitResult<LastCommit>> {
		const opened = await GitRepository.open({
			path: root,
			signal: input.signal,
		});

		if (!opened.ok) return opened;

		const recovery = await opened.value.getCommitRecovery(input);

		if (recovery.ok)
			return {
				ok: true,
				value: { commit: recovery.value, undoUnavailableReason: null },
			};

		if (input.signal?.aborted) return recovery;

		const commit = await opened.value.getCommit(input.expectedHead, {
			signal: input.signal,
		});

		if (!commit.ok) return commit;

		return {
			ok: true,
			value: {
				commit: commit.value,
				undoUnavailableReason: recovery.error.message,
			},
		};
	}

	/** Undo preserves working files and staging; the backend retains the old commit. */
	static async undo(root: string, input: CommitRecoveryInput) {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		return await opened.value.undoCommit(input);
	}

	static async write(
		root: string,
		input: CommitFilesInput
	): Promise<GitResult<CommitFilesResult>> {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		return await opened.value.commitFiles(input);
	}
}
