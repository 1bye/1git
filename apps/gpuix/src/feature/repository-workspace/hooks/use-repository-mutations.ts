import { useEffect, useLayoutEffect, useRef, type Dispatch } from "react";

import type {
	WorkspaceTabsAction,
	WorkspaceTabsState,
} from "../../workspace-tabs/lib/workspace-tabs-model";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceAction,
} from "../lib/repository-workspace-model";
import { RepositoryCommit } from "../lib/repository-commit";
import { RepositoryConflicts } from "../lib/repository-conflicts";
import { RepositoryOperation } from "../lib/repository-operation";
import {
	RepositoryFileActions,
	type FileDiscardRequest,
} from "../lib/repository-file-actions";
import type { FinishOperationInput, RepositorySnapshot } from "@1git/git";
import { useCloseProtection } from "./use-close-protection";
import {
	RepositoryStashes,
	type StashWriteRequest,
	type StashRequest,
} from "../lib/repository-stashes";
import { RepositoryReader } from "../lib/repository-reader";
import {
	RepositorySync,
	type SyncChoice,
	type SyncKind,
} from "../lib/repository-sync";
import {
	RepositoryBranches,
	type BranchRequest,
} from "../../workspace-tabs/lib/repository-branches";

/** Window-owned operations survive menus; synchronization locks shared refs across linked worktrees. */
export function useRepositoryMutations(
	state: WorkspaceTabsState,
	dispatch: Dispatch<WorkspaceTabsAction>,
	writeCommit = RepositoryCommit.write,
	writeBranch = RepositoryBranches.write,
	readRepository = RepositoryReader.read,
	fetchRepository = RepositorySync.fetch,
	writeSyncRepository = RepositorySync.write,
	beforeCloseRelease?: () => void,
	writeStash = RepositoryStashes.write,
	resolveConflict = RepositoryConflicts.write,
	writeOperation = RepositoryOperation.write,
	discardFile = RepositoryFileActions.discard
) {
	const closeProtection = useCloseProtection(
		state.tabs.some((tab) => RepositoryWorkspaceModel.isBusy(tab.workspace)),
		state.tabs,
		beforeCloseRelease
	);

	const tabs = useRef(state.tabs);

	const pending = useRef(
		new Map<
			string,
			| "commit-started"
			| "branch-started"
			| "conflict-started"
			| "operation-started"
		>()
	);

	const mounted = useRef(true);
	const stashWrites = useRef(new Map<string, StashRequest["kind"]>());

	const syncs = useRef(
		new Map<string, { controller: AbortController; kind: SyncKind }>()
	);

	useLayoutEffect(() => {
		tabs.current = state.tabs;

		for (const tab of state.tabs) {
			const repository = tab.workspace.repository;

			const sync = repository && syncs.current.get(repository.commonDirectory);
			const operation = repository && pending.current.get(repository.root);

			const stash =
				repository && stashWrites.current.get(repository.commonDirectory);

			if (
				(operation || sync || stash) &&
				!RepositoryWorkspaceModel.isBusy(tab.workspace)
			)
				dispatch({
					type: "workspace",
					id: tab.id,
					action: stash
						? { type: "stash-started", kind: stash }
						: sync
							? { type: "sync-started", kind: sync.kind }
							: { type: operation ?? "commit-started" },
				});
		}
	}, [state.tabs, dispatch]);

	useEffect(() => {
		mounted.current = true;
		const requests = syncs.current;

		return () => {
			mounted.current = false;

			for (const request of requests.values()) request.controller.abort();
		};
	}, []);

	const commit = async (id: string): Promise<void> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			!RepositoryWorkspaceModel.canCommit(workspace) ||
			pending.current.has(repository.root) ||
			stashWrites.current.has(repository.commonDirectory) ||
			syncs.current.has(repository.commonDirectory)
		)
			return;

		const root = repository.root;
		const submittedMessage = workspace.commitMessage;

		const send = (action: RepositoryWorkspaceAction): void => {
			if (!mounted.current) return;

			for (const tab of tabs.current) {
				if (tab.workspace.repository?.root === root)
					dispatch({
						type: "workspace",
						id: tab.id,
						action:
							action.type === "commit-finished"
								? {
										...action,
										submittedMessage:
											tab.id === id ? submittedMessage : undefined,
									}
								: action,
					});
			}
		};

		pending.current.set(root, "commit-started");
		closeProtection.block();
		send({ type: "commit-started" });

		try {
			const result = await writeCommit(root, {
				paths: workspace.includedFileIds,
				message: submittedMessage,
				expectedHead: repository.head,
				expectedBranch: repository.branchName,
			});

			pending.current.delete(root);
			send(
				result.ok
					? { type: "commit-finished", result: result.value }
					: {
							type: "commit-failed",
							message: [result.error.message, result.error.details]
								.filter(Boolean)
								.join("\n"),
						}
			);
		} catch {
			pending.current.delete(root);
			send({
				type: "commit-failed",
				uncertain: true,
				message:
					"Could not confirm the commit outcome. Refresh and inspect History before trying again. Your message has been kept.",
			});
		}
	};

	const changeBranch = async (
		id: string,
		choice: Pick<BranchRequest, "kind" | "name">
	): Promise<string | null> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			workspace.loading ||
			workspace.error ||
			workspace.commit.needsReview ||
			pending.current.has(repository.root) ||
			stashWrites.current.has(repository.commonDirectory) ||
			syncs.current.has(repository.commonDirectory)
		)
			return "Wait for the current operation or refresh this workspace before switching branches.";

		const send = (action: RepositoryWorkspaceAction): void => {
			if (!mounted.current) return;

			for (const tab of tabs.current) {
				if (tab.workspace.repository?.root === repository.root)
					dispatch({ type: "workspace", id: tab.id, action });
			}
		};

		pending.current.set(repository.root, "branch-started");
		closeProtection.block();
		send({ type: "branch-started" });
		let error: string | null = null;

		try {
			const result = await writeBranch(repository.root, {
				...choice,
				expectedHead: repository.head,
				expectedBranch: repository.branchName,
			});

			if (!result.ok)
				error = [result.error.message, result.error.details]
					.filter(Boolean)
					.join("\n");
		} catch {
			error =
				"Could not confirm the branch change. Check the current branch before retrying.";
		}

		// Even a reported failure can follow a completed checkout (for example, a failed hook).
		// Re-read before enabling other writes, retaining drafts on every outcome.
		try {
			const refreshed = await readRepository(
				repository.root,
				new AbortController().signal
			);

			pending.current.delete(repository.root);
			send(
				refreshed.ok
					? { type: "branch-finished", snapshot: refreshed.value }
					: { type: "branch-finished", error: refreshed.error.message }
			);

			if (!refreshed.ok) error = refreshed.error.message;
		} catch {
			pending.current.delete(repository.root);
			error = "Refresh to confirm the current branch before continuing.";
			send({ type: "branch-finished", error });
		}

		return error;
	};

	const synchronize = async (
		id: string,
		choice: { kind: "fetch" } | SyncChoice
	): Promise<void> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			stashWrites.current.has(repository.commonDirectory) ||
			syncs.current.has(repository.commonDirectory)
		)
			return;

		if (
			choice.kind !== "fetch" &&
			(!repository.head ||
				!repository.branchName ||
				workspace.error ||
				workspace.commit.needsReview)
		)
			return;

		const related = tabs.current.filter(
			(tab) =>
				tab.workspace.repository?.commonDirectory === repository.commonDirectory
		);

		if (
			related.some(
				(tab) =>
					tab.workspace.loading ||
					RepositoryWorkspaceModel.isBusy(tab.workspace) ||
					(tab.workspace.repository &&
						pending.current.has(tab.workspace.repository.root))
			)
		)
			return;

		const controller = new AbortController();

		syncs.current.set(repository.commonDirectory, {
			controller,
			kind: choice.kind,
		});
		closeProtection.block();

		const send = (action: RepositoryWorkspaceAction, root?: string): void => {
			if (!mounted.current) return;

			for (const tab of tabs.current) {
				if (
					tab.workspace.repository?.commonDirectory ===
						repository.commonDirectory &&
					(!root || tab.workspace.repository.root === root)
				)
					dispatch({ type: "workspace", id: tab.id, action });
			}
		};

		send({ type: "sync-started", kind: choice.kind });
		let error: string | null = null;
		let fetchedAt: number | null = null;
		let notice: string | undefined;

		const cancelledMessage =
			choice.kind === "fetch"
				? "Fetch cancelled."
				: "Synchronization stopped. It may have completed; review status before retrying.";

		try {
			const result =
				choice.kind === "fetch"
					? await fetchRepository(repository.root, controller.signal)
					: await writeSyncRepository(
							repository.root,
							{
								...choice,
								expectedHead: repository.head ?? "",
								expectedBranch: repository.branchName ?? "",
							},
							controller.signal
						);

			if (result.ok) {
				if (choice.kind === "fetch" || choice.kind === "pull")
					fetchedAt = Date.now();

				if (choice.kind !== "fetch")
					notice = {
						pull: "Pull complete.",
						push: "Push complete.",
						publish: "Branch published.",
					}[choice.kind];
			} else
				error =
					result.error.code === "aborted" && controller.signal.aborted
						? cancelledMessage
						: [result.error.message, result.error.details]
								.filter(Boolean)
								.join("\n");
		} catch {
			error = controller.signal.aborted
				? cancelledMessage
				: "Could not confirm synchronization. Review status and remote tracking before retrying.";
		}

		// Failed or cancelled sync can still change refs. Re-read every open worktree before unlocking.
		const roots = new Set(
			tabs.current.flatMap((tab) =>
				tab.workspace.repository?.commonDirectory === repository.commonDirectory
					? [tab.workspace.repository.root]
					: []
			)
		);

		const outcomes = new Map<string, RepositoryWorkspaceAction>();

		await Promise.all(
			[...roots].map(async (root) => {
				if (!mounted.current) return;

				try {
					const refreshed = await readRepository(
						root,
						new AbortController().signal
					);

					outcomes.set(root, {
						type: "sync-finished",
						error,
						fetchedAt,
						notice,
						...(refreshed.ok
							? { snapshot: refreshed.value }
							: { refreshError: refreshed.error.message }),
					});
				} catch {
					outcomes.set(root, {
						type: "sync-finished",
						error,
						fetchedAt,
						notice,
						refreshError:
							"Refresh this workspace to confirm its status after synchronization.",
					});
				}
			})
		);
		syncs.current.delete(repository.commonDirectory);

		// Include tabs opened while the post-sync reads were running, without leaving them locked.
		for (const tab of tabs.current) {
			if (
				tab.workspace.repository?.commonDirectory === repository.commonDirectory
			)
				roots.add(tab.workspace.repository.root);
		}

		for (const root of roots)
			send(
				outcomes.get(root) ?? {
					type: "sync-finished",
					error,
					fetchedAt,
					notice,
				},
				root
			);
	};

	const stash = async (
		id: string,
		request: StashWriteRequest
	): Promise<boolean> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			workspace.preview ||
			workspace.error ||
			workspace.commit.needsReview ||
			stashWrites.current.has(repository.commonDirectory) ||
			syncs.current.has(repository.commonDirectory)
		)
			return false;

		const related = tabs.current.filter(
			(tab) =>
				tab.workspace.repository?.commonDirectory === repository.commonDirectory
		);

		if (
			related.some(
				(tab) =>
					tab.workspace.loading ||
					RepositoryWorkspaceModel.isBusy(tab.workspace) ||
					(tab.workspace.repository &&
						pending.current.has(tab.workspace.repository.root))
			)
		)
			return false;

		stashWrites.current.set(repository.commonDirectory, request.kind);
		closeProtection.block();

		for (const tab of related)
			dispatch({
				type: "workspace",
				id: tab.id,
				action: { type: "stash-started", kind: request.kind },
			});

		let error: string | null = null;

		try {
			const result = await writeStash(repository.root, request);

			if (!result.ok)
				error = [result.error.message, result.error.details]
					.filter(Boolean)
					.join("\n");
		} catch {
			error =
				"Could not confirm the stash action. Review Changes and Stashes before retrying; it may have completed.";
		}

		const roots = new Set(
			tabs.current.flatMap((tab) =>
				tab.workspace.repository?.commonDirectory === repository.commonDirectory
					? [tab.workspace.repository.root]
					: []
			)
		);

		const outcomes = new Map<string, RepositoryWorkspaceAction>();

		await Promise.all(
			[...roots].map(async (root) => {
				try {
					const result = await readRepository(
						root,
						new AbortController().signal
					);

					outcomes.set(root, {
						type: "stash-finished",
						error,
						...(result.ok
							? { snapshot: result.value }
							: { refreshError: result.error.message }),
						notice: error
							? undefined
							: {
									create: "Changes stashed.",
									apply: "Stash applied and kept.",
									delete: "Stash deleted.",
								}[request.kind],
					});
				} catch {
					outcomes.set(root, {
						type: "stash-finished",
						error,
						refreshError:
							"Refresh to confirm the repository after the stash action.",
					});
				}
			})
		);
		stashWrites.current.delete(repository.commonDirectory);

		if (!mounted.current) return false;

		let refreshed = true;

		for (const tab of tabs.current) {
			if (
				tab.workspace.repository?.commonDirectory !== repository.commonDirectory
			)
				continue;

			const outcome = outcomes.get(tab.workspace.repository.root);

			const action =
				outcome?.type === "stash-finished"
					? outcome
					: {
							type: "stash-finished" as const,
							error,
							refreshError:
								"Refresh this newly opened workspace before continuing.",
						};

			if (action.refreshError) refreshed = false;

			dispatch({
				type: "workspace",
				id: tab.id,
				action: {
					...action,
					...(!error &&
						!action.refreshError &&
						tab.id === id &&
						request.kind !== "delete" && {
							view:
								request.kind === "create"
									? ("stashes" as const)
									: ("changes" as const),
						}),
				},
			});
		}

		return !error && refreshed;
	};

	const cancelSync = (id: string): void => {
		const repository = tabs.current.find((tab) => tab.id === id)?.workspace
			.repository;

		if (repository)
			syncs.current.get(repository.commonDirectory)?.controller.abort();
	};

	const updateWorktree = async (
		id: string,
		request:
			| FinishOperationInput
			| FileDiscardRequest
			| { kind: "resolve"; path: string; expectedContentHash: string }
	): Promise<string | null> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			workspace.preview ||
			workspace.loading ||
			workspace.error ||
			workspace.commit.needsReview ||
			RepositoryWorkspaceModel.isBusy(workspace) ||
			pending.current.has(repository.root) ||
			syncs.current.has(repository.commonDirectory) ||
			stashWrites.current.has(repository.commonDirectory)
		)
			return "Wait for the current operation or refresh before continuing.";

		const send = (action: RepositoryWorkspaceAction) => {
			if (!mounted.current) return;

			for (const tab of tabs.current) {
				if (tab.workspace.repository?.root === repository.root)
					dispatch({ type: "workspace", id: tab.id, action });
			}
		};

		const started =
			request.kind === "resolve" ? "conflict-started" : "operation-started";

		pending.current.set(repository.root, started);
		closeProtection.block();
		send({ type: started });
		let error: string | null = null;
		let recoveryDirectory: string | undefined;

		try {
			const result =
				request.kind === "resolve"
					? await resolveConflict(repository.root, {
							path: request.path,
							expectedContentHash: request.expectedContentHash,
							expectedHead: repository.head,
							expectedBranch: repository.branchName,
						})
					: request.kind === "discard"
						? await discardFile(repository.root, request)
						: await writeOperation(repository.root, request);

			if (!result.ok) error = result.error.message;
			else if (
				"recoveryDirectory" in result &&
				typeof result.recoveryDirectory === "string"
			)
				recoveryDirectory = result.recoveryDirectory;
		} catch {
			error =
				"Could not confirm the Git action. Refresh and inspect Changes and History before retrying.";
		}

		const finish = (snapshot?: RepositorySnapshot, refreshError?: string) => {
			pending.current.delete(repository.root);

			if (request.kind === "resolve")
				send({ type: "conflict-finished", snapshot, error: refreshError });
			else
				send({
					type: "operation-finished",
					recoveryDirectory,
					snapshot,
					error,
					refreshError,
					notice: error
						? undefined
						: request.kind === "discard"
							? `Discarded ${request.path}. Recovery backup saved.`
							: request.kind === "abort"
								? "Operation aborted."
								: snapshot?.operationState === "normal"
									? "Operation completed."
									: "Git paused again. Review the current operation before continuing.",
				});
		};

		try {
			const fresh = await readRepository(
				repository.root,
				new AbortController().signal
			);

			if (fresh.ok) finish(fresh.value);
			else finish(undefined, fresh.error.message);

			if (!fresh.ok) error = fresh.error.message;
		} catch {
			error = "Refresh to confirm the repository after the Git action.";
			finish(undefined, error);
		}

		return error;
	};

	return {
		resolve: (id: string, path: string, expectedContentHash: string) =>
			updateWorktree(id, { kind: "resolve", path, expectedContentHash }),
		finishOperation: (id: string, request: FinishOperationInput) =>
			updateWorktree(id, request),
		discardFile: (id: string, request: FileDiscardRequest) =>
			updateWorktree(id, request),
		closeProtection,
		stash,
		commit,
		changeBranch,
		fetch: (id: string) => synchronize(id, { kind: "fetch" }),
		synchronize,
		cancelSync,
	};
}
