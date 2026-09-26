import {
	GitRepository,
	type CommitFilesInput,
	type CommitFilesResult,
	type GitResult,
} from "@1git/git";

/** Explicit selected-file commits; checkbox changes never mutate Git staging. */
export class RepositoryCommit {
	private constructor() {}

	static async write(
		root: string,
		input: CommitFilesInput
	): Promise<GitResult<CommitFilesResult>> {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		return await opened.value.commitFiles(input);
	}
}
