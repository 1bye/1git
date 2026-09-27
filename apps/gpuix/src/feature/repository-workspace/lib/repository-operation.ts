import {
	GitRepository,
	type FinishOperationInput,
	type GitResult,
	type RepositorySnapshot,
} from "@1git/git";

/** Explicit merge/rebase completion or confirmed abort, preserving Git messages and hooks. */
export class RepositoryOperation {
	private constructor() {}
	static async write(
		root: string,
		request: FinishOperationInput
	): Promise<GitResult<RepositorySnapshot>> {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		return await opened.value.finishOperation(request);
	}
}
