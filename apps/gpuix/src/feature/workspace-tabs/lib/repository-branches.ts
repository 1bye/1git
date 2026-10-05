import {
	GitRepository,
	type BranchCollection,
	type BranchInfo,
	type BranchMutationResult,
	type GitResult,
	type RemoteInfo,
	type WorktreeInfo,
} from "@1git/git";
import {
	RepositoryBranchChanges,
	type SavedBranchChanges,
} from "./repository-branch-changes";

export interface WorkspaceBranches {
	readonly branches: BranchCollection;
	readonly worktrees: readonly WorktreeInfo[];
	readonly remotes: readonly RemoteInfo[];
	readonly savedChanges?: readonly SavedBranchChanges[];
}

export interface BranchRequest {
	readonly kind:
		| "switch"
		| "create"
		| "remote"
		| "rename"
		| "delete"
		| "merge"
		| "restore";
	readonly name: string;
	readonly newName?: string;
	readonly expectedTarget?: string;
	readonly expectedHead: string | null;
	readonly expectedBranch: string | null;
	readonly changes?: "leave" | "bring";
	readonly savedChangesOid?: string;
	readonly reviewedSource?: {
		readonly head: string | null;
		readonly branch: string | null;
	};
}

/** Non-forcing branch operations and reviewed merges, with explicit stash-backed switching choices. */
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

		const [branches, worktrees, remotes, stashes] = await Promise.all([
			opened.value.getBranches({ signal }),
			opened.value.getWorktrees({ signal }),
			opened.value.getRemotes({ signal }),
			opened.value.getStashes({ signal }),
		]);

		if (!branches.ok) return branches;

		if (!worktrees.ok) return worktrees;

		if (!remotes.ok) return remotes;

		if (!stashes.ok) return stashes;

		return {
			ok: true,
			value: {
				branches: branches.value,
				worktrees: worktrees.value,
				remotes: remotes.value,
				savedChanges: RepositoryBranchChanges.list(
					opened.value.info.root,
					stashes.value
				),
			},
		};
	}

	/** Safe to inject as a standalone callback; branch operations do not depend on a receiver. */
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
			head.branch !== request.expectedBranch ||
			(request.reviewedSource &&
				(head.oid !== request.reviewedSource.head ||
					head.branch !== request.reviewedSource.branch))
		)
			message =
				"The branch changed outside this app. Refresh the workspace before trying again.";
		else if (
			operationState !== "normal" ||
			files.some((file) => file.recordType === "unmerged")
		)
			message =
				request.kind === "merge"
					? "Finish the current Git operation before merging branches."
					: "Finish the current Git operation before switching branches.";
		else if (
			files.some((file) => file.recordType !== "ignored") &&
			!(
				(request.kind === "switch" || request.kind === "remote") &&
				request.changes
			)
		)
			message =
				request.kind === "merge"
					? "Commit or stash your changes before merging branches. Nothing has been discarded."
					: "Commit or stash your changes before switching branches. Nothing has been discarded.";

		if (message)
			return {
				ok: false,
				error: {
					code: "conflict",
					operation: request.kind === "merge" ? "merge" : "checkout-branch",
					retryable: false,
					message,
				},
			};

		if (request.kind === "merge") {
			const branches = await opened.value.getBranches();

			if (!branches.ok) return branches;

			const target = branches.value.branches.find(
				(item) => item.fullName === request.name
			);

			if (
				!head.oid ||
				!head.branch ||
				!target ||
				target.oid !== request.expectedTarget ||
				(target.type === "local" && target.name === head.branch)
			)
				return {
					ok: false,
					error: {
						code: "conflict",
						operation: "merge",
						retryable: false,
						message:
							"Choose another available branch and review it again before merging.",
					},
				};

			// Pin the reviewed source commit; never follow a ref that moves during the merge.
			const merged = await opened.value.merge({
				revision: target.oid,
				message: `Merge branch '${target.name}' into ${head.branch}`,
			});

			if (!merged.ok) return merged;

			const refreshed = await opened.value.getBranches();

			return refreshed.ok
				? {
						ok: true,
						value: { branches: refreshed.value, snapshot: merged.value },
					}
				: refreshed;
		}

		if (request.kind === "restore") {
			const restored = await RepositoryBranchChanges.restore(
				opened.value,
				opened.value.info.root,
				request.name,
				request.savedChangesOid ?? ""
			);

			if (!restored.ok) return restored;

			const branches = await opened.value.getBranches();

			return branches.ok
				? {
						ok: true,
						value: { branches: branches.value, snapshot: restored.value },
					}
				: branches;
		}

		if (
			(request.kind === "switch" || request.kind === "remote") &&
			request.changes &&
			files.some((file) => file.recordType !== "ignored")
		) {
			if (!head.oid || !head.branch)
				return RepositoryBranchChanges.fail(
					"Commit the first changes or attach HEAD to a branch before saving branch changes."
				);

			if (files.some((file) => file.submodule.startsWith("S")))
				return RepositoryBranchChanges.fail(
					"Save submodule changes inside the submodule before switching branches."
				);

			const branches = await opened.value.getBranches();

			if (!branches.ok) return branches;

			const target = branches.value.branches.find((item) =>
				request.kind === "remote"
					? item.type === "remote" && item.fullName === request.name
					: item.type === "local" && item.name === request.name
			);

			const remoteTarget =
				target && request.kind === "remote"
					? RepositoryBranches.remoteTarget(target, branches.value)
					: null;

			const destination = remoteTarget?.name ?? target?.name;

			if (
				!target ||
				remoteTarget?.error ||
				target.worktreePath ||
				destination === head.branch
			)
				return RepositoryBranchChanges.fail(
					remoteTarget?.error ??
						"Choose an available branch that is not checked out in another worktree."
				);

			const saved = await RepositoryBranchChanges.save(
				opened.value,
				opened.value.info.root,
				request.changes === "leave"
					? head.branch
					: (destination ?? request.name)
			);

			if (!saved.ok) return saved;

			const switched = await RepositoryBranches.write(root, {
				...request,
				changes: undefined,
			});

			if (!switched.ok)
				return {
					...switched,
					error: {
						...switched.error,
						message: `${switched.error.message} Your changes are safe in Stashes (${saved.value.oid.slice(0, 7)}). Inspect the current branch before restoring or retrying.`,
					},
				};

			if (request.changes === "leave") return switched;

			const restored = await RepositoryBranchChanges.restore(
				opened.value,
				opened.value.info.root,
				saved.value.branch,
				saved.value.oid
			);

			return restored.ok
				? { ok: true, value: { ...switched.value, snapshot: restored.value } }
				: restored;
		}

		if (request.kind === "rename" || request.kind === "delete") {
			const branches = await opened.value.getBranches();

			if (!branches.ok) return branches;

			const target = branches.value.branches.find(
				(item) => item.type === "local" && item.name === request.name
			);

			let error: string | null = null;

			if (!target || target.oid !== request.expectedTarget)
				error =
					"This branch changed or disappeared. Refresh before trying again.";
			else if (
				request.kind === "delete" &&
				(target.checkedOut || target.worktreePath)
			)
				error =
					"This branch is checked out in a workspace and cannot be deleted.";
			else if (
				request.kind === "rename" &&
				target.worktreePath &&
				target.name !== head.branch
			)
				error =
					"Rename this branch from the workspace where it is checked out.";
			else if (request.kind === "rename" && !request.newName?.trim())
				error = "Enter a new branch name.";

			if (error)
				return {
					ok: false,
					error: {
						code: "conflict",
						operation:
							request.kind === "rename" ? "rename-branch" : "delete-branch",
						retryable: false,
						message: error,
					},
				};

			return request.kind === "rename"
				? await opened.value.renameBranch({
						currentName: request.name,
						newName: request.newName ?? "",
					})
				: await opened.value.deleteBranch({ name: request.name });
		}

		if (request.kind === "remote") {
			const branches = await opened.value.getBranches();

			if (!branches.ok) return branches;

			const remote = branches.value.branches.find(
				(item) => item.type === "remote" && item.fullName === request.name
			);

			const target = remote
				? RepositoryBranches.remoteTarget(remote, branches.value)
				: null;

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
