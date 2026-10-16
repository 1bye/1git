import type { BranchCollection, BranchInfo } from "@1git/git";

/** Pure tracking-branch validation shared by local and SSH worktree creation. */
export class RepositoryBranchTargets {
	private constructor() {}

	/** Resolve a remote ref to an unoccupied local tracking name without guessing a remote. */
	static remoteTarget(
		branch: BranchInfo,
		collection: BranchCollection
	): {
		name: string;
		error: string | null;
	} {
		const prefix = `refs/remotes/${branch.remote}/`;
		const name = branch.fullName.slice(prefix.length);

		if (
			branch.type !== "remote" ||
			!branch.remote ||
			!branch.fullName.startsWith(prefix) ||
			!name
		)
			return {
				name,
				error: "This remote branch is unavailable. Refresh and try again.",
			};

		const local = collection.branches.find(
			(item) => item.type === "local" && item.name === name
		);

		return {
			name,
			error: local
				? `Local branch “${name}” already exists. Choose it instead.`
				: null,
		};
	}
}
