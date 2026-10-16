import { type GitResult, type RepositorySnapshot } from "@1git/git";
import { GitRepository } from "../../machines/repository-access";

/** Read-only Git boundary; opens existing working repositories, never initializes or mutates them. */
export class RepositoryReader {
	private constructor() {}

	static async read(
		path: string,
		signal: AbortSignal
	): Promise<
		GitResult<RepositorySnapshot & { readonly remoteCount?: number }>
	> {
		const opened = await GitRepository.open({ path, signal });

		if (!opened.ok) return opened;

		const [snapshot, remotes] = await Promise.all([
			opened.value.getSnapshot({ signal }),
			opened.value.getRemotes({ signal }),
		]);

		if (!snapshot.ok) return snapshot;

		return {
			ok: true,
			value: {
				...snapshot.value,
				remoteCount: remotes.ok ? remotes.value.length : undefined,
			},
		};
	}
}
