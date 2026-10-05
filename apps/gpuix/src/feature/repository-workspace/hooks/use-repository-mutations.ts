import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type Dispatch,
} from "react";
import {
	RepositoryWorktrees,
	type WorktreeChoice,
	type WorktreeRemoval,
} from "../../workspace-tabs/lib/repository-worktrees";

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
import type {
	FinishOperationInput,
	RepositorySnapshot,
	CommitRecoveryInput,
	GitResult,
} from "@1git/git";
import { useCloseProtection } from "./use-close-protection";
import {
	GitSettingsModel,
	type GitSettingsData,
	type GitSettingsRequest,
} from "../../git-settings/git-settings-model";
import {
	RepositoryStashes,
	type StashWriteRequest,
	type StashRequest,
} from "../lib/repository-stashes";
import { RepositoryReader } from "../lib/repository-reader";
import {
	RepositorySync,
	type SyncRequest,
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
	discardFile = RepositoryFileActions.discard,
	writeWorktree = RepositoryWorktrees.create,
	removeWorktree = RepositoryWorktrees.remove,
	undoCommit = RepositoryCommit.undo,
	writeGitSettings = GitSettingsModel.write
) {
	const [settingsPending, setSettingsPending] = useState(false);
	const settingsWrite = useRef(false);

	const closeProtection = useCloseProtection(
		settingsPending ||
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
	// Branch switches with saved changes and worktree writes both own shared Git metadata.
	const sharedWrites = useRef(new Set<string>());
	const stashWrites = useRef(new Map<string, StashRequest["kind"]>());

	const syncs = useRef(
		new Map<string, { controller: AbortController; kind: SyncKind }>()
	);

	useLayoutEffect(() => {
		tabs.current = state.tabs;

		for (const tab of state.tabs) {
			const repository = tab.workspace.repository;

			const sync = repository && syncs.current.get(repository.commonDirectory);

			const operation =
				repository &&
				(pending.current.get(repository.root) ??
					(sharedWrites.current.has(repository.commonDirectory)
						? "operation-started"
						: undefined));

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

	const commit = async (
		id: string,
		undo?: CommitRecoveryInput
	): Promise<string | null> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			!(undo
				? RepositoryWorkspaceModel.canRecoverCommit(workspace)
				: RepositoryWorkspaceModel.canCommit(workspace)) ||
			sharedWrites.current.has(repository.commonDirectory) ||
			pending.current.has(repository.root) ||
			stashWrites.current.has(repository.commonDirectory) ||
			syncs.current.has(repository.commonDirectory)
		)
			return "Wait for the current operation or refresh before continuing.";

		const related = () =>
			tabs.current.filter(
				(tab) =>
					tab.workspace.repository?.commonDirectory ===
					repository.commonDirectory
			);

		if (
			related().some(
				(tab) =>
					tab.workspace.loading ||
					RepositoryWorkspaceModel.isBusy(tab.workspace) ||
					pending.current.has(tab.workspace.repository?.root ?? "")
			)
		)
			return "Wait for the current operation in this repository.";

		if (
			undo &&
			(undo.expectedHead !== repository.head ||
				undo.expectedBranch !== repository.branchName)
		)
			return "The last commit changed. Refresh and review it again.";

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
											tab.id === id && !undo ? submittedMessage : undefined,
										undoMessage: tab.id === id ? action.undoMessage : undefined,
									}
								: action,
					});
			}
		};

		pending.current.set(root, "commit-started");
		sharedWrites.current.add(repository.commonDirectory);
		closeProtection.block();
		send({ type: "commit-started" });

		for (const tab of related())
			if (tab.workspace.repository?.root !== root)
				dispatch({
					type: "workspace",
					id: tab.id,
					action: { type: "operation-started" },
				});

		let error: string | null = null;
		let finishedAction: RepositoryWorkspaceAction;

		try {
			const undone = undo ? await undoCommit(root, undo) : null;

			const result = undone
				? undone.ok
					? {
							ok: true as const,
							value: {
								outcome: "committed" as const,
								oid: undone.value.snapshot?.head.oid ?? null,
								snapshot: undone.value.snapshot,
								warning: undone.value.warning,
							},
						}
					: undone
				: await writeCommit(root, {
						includePartialStaging: true,
						paths: workspace.includedFileIds,
						message: submittedMessage,
						expectedHead: repository.head,
						expectedBranch: repository.branchName,
					});

			if (!result.ok)
				error = [result.error.message, result.error.details]
					.filter(Boolean)
					.join("\n");

			finishedAction = result.ok
				? {
						type: "commit-finished",
						result: result.value,
						undoMessage: undone?.ok ? undone.value.message : undefined,
					}
				: {
						type: "commit-failed",
						message: [result.error.message, result.error.details]
							.filter(Boolean)
							.join("\n"),
						uncertain: !!undo,
					};
		} catch {
			error =
				"Could not confirm the commit action. Refresh and inspect History before trying again.";
			finishedAction = {
				type: "commit-failed",
				uncertain: true,
				message:
					"Could not confirm the commit outcome. Refresh and inspect History before trying again. Your message has been kept.",
			};
		} finally {
			// Shared refs can affect every linked worktree, even after a failed write.
			const refreshedWorktrees = new Map<string, RepositoryWorkspaceAction>();

			await Promise.all(
				[
					...new Set(related().map((tab) => tab.workspace.repository?.root)),
				].map(async (otherRoot) => {
					if (!otherRoot || otherRoot === root) return;

					let action: RepositoryWorkspaceAction;

					try {
						const fresh = await readRepository(
							otherRoot,
							new AbortController().signal
						);

						action = fresh.ok
							? {
									type: "operation-finished",
									snapshot: fresh.value,
									error: null,
								}
							: {
									type: "operation-finished",
									error: null,
									refreshError: fresh.error.message,
								};
					} catch {
						action = {
							type: "operation-finished",
							error: null,
							refreshError:
								"Refresh to confirm this worktree after the commit action.",
						};
					}

					refreshedWorktrees.set(otherRoot, action);
				})
			);
			pending.current.delete(root);
			sharedWrites.current.delete(repository.commonDirectory);

			if (mounted.current)
				for (const tab of related()) {
					const action = refreshedWorktrees.get(
						tab.workspace.repository?.root ?? ""
					);

					if (action) dispatch({ type: "workspace", id: tab.id, action });
				}
		}

		send(finishedAction);

		return error;
	};

	const changeBranch = async (
		id: string,
		choice: Omit<BranchRequest, "expectedHead" | "expectedBranch">
	): Promise<string | null> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			workspace.loading ||
			workspace.error ||
			workspace.commit.needsReview ||
			sharedWrites.current.has(repository.commonDirectory) ||
			pending.current.has(repository.root) ||
			stashWrites.current.has(repository.commonDirectory) ||
			syncs.current.has(repository.commonDirectory)
		)
			return "Wait for the current operation or refresh this workspace before switching branches.";

		const related = () =>
			tabs.current.filter(
				(tab) =>
					tab.workspace.repository?.commonDirectory ===
					repository.commonDirectory
			);

		if (
			related().some(
				(tab) =>
					tab.workspace.loading ||
					RepositoryWorkspaceModel.isBusy(tab.workspace) ||
					pending.current.has(tab.workspace.repository?.root ?? "")
			)
		)
			return "Wait for the current operation in this repository before switching branches.";

		pending.current.set(repository.root, "branch-started");
		sharedWrites.current.add(repository.commonDirectory);
		closeProtection.block();

		for (const tab of related())
			dispatch({
				type: "workspace",
				id: tab.id,
				action: {
					type:
						tab.workspace.repository?.root === repository.root
							? "branch-started"
							: "operation-started",
				},
			});

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
				choice.kind === "merge"
					? "Could not confirm the merge. Review Changes and History before retrying."
					: "Could not confirm the branch change. Check the current branch before retrying.";
		}

		// Failed branch operations may still change Git state or leave an active merge.
		// Re-read before enabling other writes, retaining drafts on every outcome.
		const snapshots = new Map<string, RepositoryWorkspaceAction>();

		await Promise.all(
			[...new Set(related().map((tab) => tab.workspace.repository?.root))].map(
				async (root) => {
					if (!root) return;

					const type =
						root === repository.root ? "branch-finished" : "operation-finished";

					try {
						const refreshed = await readRepository(
							root,
							new AbortController().signal
						);

						const refreshError = refreshed.ok
							? undefined
							: refreshed.error.message;

						if (root === repository.root && refreshError) error = refreshError;

						snapshots.set(
							root,
							refreshed.ok
								? type === "branch-finished"
									? {
											type,
											snapshot: refreshed.value,
											error: error ?? undefined,
										}
									: { type, snapshot: refreshed.value, error: null }
								: type === "branch-finished"
									? { type, error: refreshError }
									: { type, error: null, refreshError }
						);
					} catch {
						const refreshError =
							"Refresh to confirm the current branch before continuing.";

						if (root === repository.root) error = refreshError;

						snapshots.set(
							root,
							type === "branch-finished"
								? { type, error: refreshError }
								: { type, error: null, refreshError }
						);
					}
				}
			)
		);
		pending.current.delete(repository.root);
		sharedWrites.current.delete(repository.commonDirectory);

		if (mounted.current)
			for (const tab of related()) {
				const action = snapshots.get(tab.workspace.repository?.root ?? "") ?? {
					type: "operation-finished",
					error: null,
					refreshError: "Refresh this workspace to confirm its status.",
				};

				dispatch({ type: "workspace", id: tab.id, action });
			}

		if (mounted.current && choice.kind === "merge")
			dispatch({
				type: "workspace",
				id,
				action: { type: "view", view: "changes" },
			});

		return error;
	};

	const mutateWorktree = async (
		id: string,
		choice: WorktreeChoice | WorktreeRemoval
	): Promise<string | null> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			workspace.preview ||
			workspace.error ||
			workspace.commit.needsReview
		)
			return "Refresh this workspace before changing worktrees.";

		const related = () =>
			tabs.current.filter(
				(tab) =>
					tab.workspace.repository?.commonDirectory ===
					repository.commonDirectory
			);

		if (
			sharedWrites.current.has(repository.commonDirectory) ||
			stashWrites.current.has(repository.commonDirectory) ||
			syncs.current.has(repository.commonDirectory) ||
			related().some(
				(tab) =>
					tab.workspace.loading ||
					RepositoryWorkspaceModel.isBusy(tab.workspace) ||
					pending.current.has(tab.workspace.repository?.root ?? "")
			)
		)
			return "Wait for the current Git operation before changing worktrees.";

		sharedWrites.current.add(repository.commonDirectory);
		closeProtection.block();

		for (const tab of related())
			dispatch({
				type: "workspace",
				id: tab.id,
				action: { type: "operation-started" },
			});

		let error: string | null = null;
		let created: RepositorySnapshot | undefined;
		let removed: string | undefined;

		try {
			const result =
				choice.kind === "remove"
					? await removeWorktree(repository.root, choice)
					: await writeWorktree(repository.root, {
							...choice,
							expectedHead: repository.head,
							expectedBranch: repository.branchName,
						});

			if (!result.ok)
				error = [result.error.message, result.error.details]
					.filter(Boolean)
					.join("\n");
			else if (choice.kind === "remove") removed = result.value;
			else {
				// Creation has succeeded. A failed read must never trigger automatic recreation or deletion.
				error = `Worktree created at ${result.value}, but could not be opened. Open that folder to retry.`;
				const read = await readRepository(
					result.value,
					new AbortController().signal
				);

				if (read.ok) {
					created = read.value;
					error = null;
				}
			}
		} catch {
			error ??= `Could not confirm the worktree operation. Inspect ${choice.path} and refresh before retrying.`;
		}

		const snapshots = new Map<string, RepositoryWorkspaceAction>();

		await Promise.all(
			[...new Set(related().map((tab) => tab.workspace.repository?.root))].map(
				async (root) => {
					if (!root || root === removed) return;

					try {
						const refreshed = await readRepository(
							root,
							new AbortController().signal
						);

						snapshots.set(
							root,
							refreshed.ok
								? {
										type: "operation-finished",
										snapshot: refreshed.value,
										error: root === repository.root ? error : null,
									}
								: {
										type: "operation-finished",
										error,
										refreshError: refreshed.error.message,
									}
						);
					} catch {
						snapshots.set(root, {
							type: "operation-finished",
							error,
							refreshError: "Refresh this workspace to confirm its status.",
						});
					}
				}
			)
		);
		sharedWrites.current.delete(repository.commonDirectory);

		if (mounted.current) {
			for (const tab of related().filter(
				(item) => item.workspace.repository?.root !== removed
			))
				dispatch({
					type: "workspace",
					id: tab.id,
					action: snapshots.get(tab.workspace.repository?.root ?? "") ?? {
						type: "operation-finished",
						error,
						refreshError: "Refresh this workspace to confirm its status.",
					},
				});

			if (created) dispatch({ type: "open-worktree", snapshot: created });

			if (removed) dispatch({ type: "worktree-removed", path: removed });
		}

		return error;
	};

	const synchronize = async (
		id: string,
		choice: { kind: "fetch" } | SyncRequest
	): Promise<void> => {
		const workspace = tabs.current.find((tab) => tab.id === id)?.workspace;
		const repository = workspace?.repository;

		if (
			!workspace ||
			!repository ||
			(choice.kind === "sync" &&
				!RepositoryWorkspaceModel.canSync(workspace)) ||
			sharedWrites.current.has(repository.commonDirectory) ||
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
				if (
					choice.kind === "fetch" ||
					choice.kind === "pull" ||
					choice.kind === "sync"
				)
					fetchedAt = Date.now();

				if (choice.kind !== "fetch")
					notice = {
						pull: "Pull complete.",
						push: "Push complete.",
						publish: "Branch published.",
						sync: "Sync complete.",
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
			sharedWrites.current.has(repository.commonDirectory) ||
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
			| {
					kind: "resolve";
					path: string;
					expectedContentHash: string;
					side?: "ours" | "theirs";
			  }
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
			sharedWrites.current.has(repository.commonDirectory) ||
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
							side: request.side,
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
							? `Discarded ${request.paths.length} ${request.paths.length === 1 ? "file" : "files"}. Recovery backup saved.`
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

	const saveSettings = async (
		root: string | null,
		request: GitSettingsRequest
	): Promise<GitResult<GitSettingsData>> => {
		const repository = root
			? tabs.current.find((tab) => tab.workspace.repository?.root === root)
					?.workspace.repository
			: undefined;

		const related = () =>
			tabs.current.filter(
				(tab) =>
					tab.workspace.repository &&
					(!root ||
						tab.workspace.repository.commonDirectory ===
							repository?.commonDirectory)
			);

		if (
			settingsWrite.current ||
			(root && !repository) ||
			related().some(
				(tab) =>
					tab.workspace.loading ||
					tab.workspace.error ||
					RepositoryWorkspaceModel.isBusy(tab.workspace)
			) ||
			sharedWrites.current.size ||
			syncs.current.size ||
			stashWrites.current.size ||
			pending.current.size
		)
			return {
				ok: false,
				error: {
					code: "repository-locked",
					operation: "set-config",
					retryable: true,
					message:
						"Wait for the current Git operation or refresh the repository before saving settings.",
				},
			};

		const directories = [
			...new Set(
				related()
					.map((tab) => tab.workspace.repository?.commonDirectory)
					.filter((directory) => directory !== undefined)
			),
		];

		settingsWrite.current = true;
		setSettingsPending(true);

		for (const directory of directories) sharedWrites.current.add(directory);

		closeProtection.block();

		for (const tab of related())
			dispatch({
				type: "workspace",
				id: tab.id,
				action: { type: "operation-started" },
			});

		let result: GitResult<GitSettingsData>;

		try {
			result = await writeGitSettings(root, request);
		} catch {
			result = {
				ok: false,
				error: {
					code: "command-failed",
					operation: "set-config",
					retryable: false,
					message:
						"Could not confirm the save. Read the current settings before retrying.",
				},
			};
		}

		const refreshed = new Map<string, RepositoryWorkspaceAction>();

		await Promise.all(
			[...new Set(related().map((tab) => tab.workspace.repository?.root))].map(
				async (path) => {
					if (!path) return;

					try {
						const fresh = await readRepository(
							path,
							new AbortController().signal
						);

						refreshed.set(
							path,
							fresh.ok
								? {
										type: "operation-finished",
										error: null,
										snapshot: fresh.value,
									}
								: {
										type: "operation-finished",
										error: null,
										refreshError: fresh.error.message,
									}
						);
					} catch {
						refreshed.set(path, {
							type: "operation-finished",
							error: null,
							refreshError: "Refresh to confirm repository settings.",
						});
					}
				}
			)
		);

		for (const directory of directories) sharedWrites.current.delete(directory);

		settingsWrite.current = false;

		if (mounted.current) setSettingsPending(false);

		if (mounted.current)
			for (const tab of related()) {
				const action = refreshed.get(tab.workspace.repository?.root ?? "");

				if (action) dispatch({ type: "workspace", id: tab.id, action });
			}

		if (
			result.ok &&
			[...refreshed.values()].some(
				(action) => action.type === "operation-finished" && action.refreshError
			)
		)
			return {
				ok: false,
				error: {
					code: "command-failed",
					operation: "set-config",
					retryable: false,
					message:
						"Settings were saved, but the repository could not be refreshed. Refresh it before another Git operation.",
				},
			};

		return result;
	};

	return {
		saveSettings,
		resolve: (
			id: string,
			path: string,
			expectedContentHash: string,
			side?: "ours" | "theirs"
		) =>
			updateWorktree(id, { kind: "resolve", path, expectedContentHash, side }),
		finishOperation: (id: string, request: FinishOperationInput) =>
			updateWorktree(id, request),
		discardFile: (id: string, request: FileDiscardRequest) =>
			updateWorktree(id, request),
		closeProtection,
		stash,
		commit,
		undoCommit: (id: string, input: CommitRecoveryInput) => commit(id, input),
		changeBranch,
		createWorktree: (id: string, choice: WorktreeChoice) =>
			mutateWorktree(id, choice),
		removeWorktree: (id: string, choice: WorktreeRemoval) =>
			mutateWorktree(id, choice),
		fetch: (id: string) => synchronize(id, { kind: "fetch" }),
		synchronize,
		cancelSync,
	};
}
