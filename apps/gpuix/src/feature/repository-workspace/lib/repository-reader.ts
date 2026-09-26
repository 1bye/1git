import {
	GitRepository,
	type GitResult,
	type RepositorySnapshot,
} from "@1git/git";

/** Read-only Git boundary; opens existing working repositories, never initializes or mutates them. */
export class RepositoryReader {
	private constructor() {}

	static async read(
		path: string,
		signal: AbortSignal
	): Promise<GitResult<RepositorySnapshot>> {
		const opened = await GitRepository.open({ path, signal });

		if (!opened.ok) return opened;

		return await opened.value.getSnapshot({ signal });
	}
}
