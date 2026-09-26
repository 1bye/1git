import {
	GitRepository,
	type BranchCollection,
	type BranchMutationResult,
	type GitResult,
	type WorktreeInfo,
} from "@1git/git";

export interface WorkspaceBranches {
	readonly branches: BranchCollection;
	readonly worktrees: readonly WorktreeInfo[];
}

export interface BranchRequest {
	readonly kind: "switch" | "create";
	readonly name: string;
	readonly expectedHead: string | null;
	readonly expectedBranch: string | null;
}

/** Explicit, non-forcing branch operations; never stash, reset, or discard user work. */
export class RepositoryBranches {
	private constructor() {}

	static async read(
		root: string,
		signal: AbortSignal
	): Promise<GitResult<WorkspaceBranches>> {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const [branches, worktrees] = await Promise.all([
			opened.value.getBranches({ signal }),
			opened.value.getWorktrees({ signal }),
		]);

		if (!branches.ok) return branches;

		if (!worktrees.ok) return worktrees;

		return {
			ok: true,
			value: { branches: branches.value, worktrees: worktrees.value },
		};
	}

	static async write(
		root: string,
		request: BranchRequest
	): Promise<GitResult<BranchMutationResult>> {
		const opened = await GitRepository.open({ path: root });

		if (!opened.ok) return opened;

		const snapshot = await opened.value.getSnapshot();

		if (!snapshot.ok) return snapshot;

		const { head, operationState, files } = snapshot.value;
		let message: string | undefined;

		if (
			head.oid !== request.expectedHead ||
			head.branch !== request.expectedBranch
		)
			message =
				"The branch changed outside this app. Refresh the workspace before trying again.";
		else if (operationState !== "normal")
			message = "Finish the current Git operation before switching branches.";
		else if (files.some((file) => file.recordType !== "ignored"))
			message =
				"Commit or stash your changes before switching branches. Nothing has been discarded.";

		if (message)
			return {
				ok: false,
				error: {
					code: "conflict",
					operation: "checkout-branch",
					retryable: false,
					message,
				},
			};

		return request.kind === "create"
			? await opened.value.createBranch({ name: request.name, checkout: true })
			: await opened.value.checkoutBranch({ name: request.name });
	}
}
