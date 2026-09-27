import {
	GitRepository,
	type BranchCollection,
	type BranchInfo,
	type BranchMutationResult,
	type GitResult,
	type RemoteInfo,
	type WorktreeInfo,
} from "@1git/git";

export interface WorkspaceBranches {
	readonly branches: BranchCollection;
	readonly worktrees: readonly WorktreeInfo[];
	readonly remotes: readonly RemoteInfo[];
}

export interface BranchRequest {
	readonly kind: "switch" | "create" | "remote";
	readonly name: string;
	readonly expectedHead: string | null;
	readonly expectedBranch: string | null;
}

/** Explicit, non-forcing branch operations; never stash, reset, or discard user work. */
export class RepositoryBranches {
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

	static async read(
		root: string,
		signal: AbortSignal
	): Promise<GitResult<WorkspaceBranches>> {
		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const [branches, worktrees, remotes] = await Promise.all([
			opened.value.getBranches({ signal }),
			opened.value.getWorktrees({ signal }),
			opened.value.getRemotes({ signal }),
		]);

		if (!branches.ok) return branches;

		if (!worktrees.ok) return worktrees;

		if (!remotes.ok) return remotes;

		return {
			ok: true,
			value: {
				branches: branches.value,
				worktrees: worktrees.value,
				remotes: remotes.value,
			},
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

		if (request.kind === "remote") {
			const branches = await opened.value.getBranches();

			if (!branches.ok) return branches;

			const remote = branches.value.branches.find(
				(item) => item.type === "remote" && item.fullName === request.name
			);

			const target = remote ? this.remoteTarget(remote, branches.value) : null;

			if (!remote || !target || target.error)
				return {
					ok: false,
					error: {
						code: "conflict",
						operation: "checkout-branch",
						retryable: false,
						message:
							target?.error ??
							"The remote branch is unavailable. Refresh and try again.",
					},
				};

			return await opened.value.createBranch({
				name: target.name,
				startPoint: remote.fullName,
				checkout: true,
				track: true,
			});
		}

		return request.kind === "create"
			? await opened.value.createBranch({ name: request.name, checkout: true })
			: await opened.value.checkoutBranch({ name: request.name });
	}
}
