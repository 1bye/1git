import {
	GitRepository,
	type CommitFilesInput,
	type CommitFilesResult,
	type GitResult,
} from "@1git/git";

/** The app's only Git write boundary: explicit selected-file commits, never staging on checkbox changes. */
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
