import type { CommitPage, GitResult, TagInfo } from "@1git/git";
import { GitRepository } from "../machines/repository-access";

/** A local ref's resolved commit; browsing it never checks out or fetches a branch. */
export interface GraphReference {
	readonly id: string;
	readonly name: string;
	readonly oid: string;
	readonly kind: "local" | "remote" | "tag";
	readonly current: boolean;
}

/** Ref labels and immutable tips captured together for stable graph pagination. */
export interface GraphReferences {
	readonly references: readonly GraphReference[];
	readonly tags: readonly TagInfo[];
	readonly head: string | null;
}

/** Bounded, read-only multi-ref history through the same local/SSH boundary as History. */
export class RepositoryGraphReader {
	static async references(
		root: string,
		head: string | null,
		signal: AbortSignal
	): Promise<GitResult<GraphReferences>> {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const [branches, tags] = await Promise.all([
			opened.value.getBranches({ signal }),
			opened.value.getTags({ signal }),
		]);

		if (!branches.ok) return branches;

		if (!tags.ok) return tags;

		return {
			ok: true,
			value: {
				head,
				tags: tags.value,
				references: [
					...branches.value.branches.map((branch) => ({
						id: branch.fullName,
						name: branch.name,
						oid: branch.oid,
						kind: branch.type,
						current: branch.checkedOut,
					})),
					...tags.value.map((tag) => ({
						id: `refs/tags/${tag.name}`,
						name: tag.name,
						oid: tag.targetOid,
						kind: "tag" as const,
						current: false,
					})),
				],
			},
		};
	}

	static async page(
		root: string,
		tips: readonly string[],
		offset: number,
		signal: AbortSignal
	): Promise<GitResult<CommitPage>> {
		if (!tips.length)
			return {
				ok: true,
				value: { commits: [], hasMore: false, nextOffset: null },
			};

		const opened = await GitRepository.open({ path: root, signal });

		return opened.ok
			? await opened.value.getHistory({
					revisions: tips,
					topoOrder: true,
					limit: 100,
					offset,
					signal,
				})
			: opened;
	}
}
