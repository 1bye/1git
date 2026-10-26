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
	commitOutputLimit,
	type RepositoryWorkspaceAction,
} from "../lib/repository-workspace-model";
import { RepositoryCommit } from "../lib/repository-commit";
import { RepositoryConflicts } from "../lib/repository-conflicts";
import { RepositoryOperation } from "../lib/repository-operation";
import { RepositoryHistory } from "../lib/repository-history";
import { RepositoryTags } from "../lib/repository-tags";
import { RepositoryHistorySquash } from "../lib/repository-history-squash";
import {
	RepositoryFileActions,
	type FileDiscardRequest,
	type FileIgnoreRequest,
} from "../lib/repository-file-actions";
import type {
	FinishOperationInput,
	RepositorySnapshot,
	CommitRecoveryInput,
	GitResult,
	SyncResult,
	RevertCommitInput,
	CherryPickCommitInput,
	CreateReleaseTagInput,
	PushTagInput,
	SquashCommitsInput,
	ResetCommitInput,
	ReorderCommitsInput,
	GitTransferProgress,
	GitCommitProgress,
} from "@1git/git";
import type { PublishBranchIdentity } from "../../repository-publish/repository-publish";
import type { RemoteAccountAccess } from "../../accounts/lib/remote-accounts";
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
	type RepositorySyncResult,
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
	writeGitSettings = GitSettingsModel.write,
	revertCommit = RepositoryHistory.revert,
	ignoreFile = RepositoryFileActions.ignore,
	cherryPickCommit = RepositoryHistory.cherryPick,
	createTag = RepositoryTags.create,
	pushTag = RepositorySync.pushTag,
	squashCommits = RepositoryHistorySquash.write,
	resetCommit = RepositoryHistory.reset,
	reorderCommits = RepositoryHistory.reorder
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

	const commits = useRef(new Map<string, AbortController>());

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
							: operation === "commit-started"
								? {
										type: "commit-started",
										cancellable: commits.current.has(repository?.root ?? ""),
									}
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
		send({ type: "commit-started", cancellable: !undo });

		for (const tab of related())
			if (tab.workspace.repository?.root !== root)
				dispatch({
					type: "workspace",
					id: tab.id,
					action: { type: "operation-started" },
				});

		let error: string | null = null;
		let finishedAction: RepositoryWorkspaceAction;
		const controller = new AbortController();
		let progressTimer: ReturnType<typeof setTimeout> | undefined;
		let phase: GitCommitProgress["phase"] = "preparing";
		let output = "";
		let acceptingProgress = true;

		const flushProgress = (): void => {
			if (progressTimer) clearTimeout(progressTimer);

			progressTimer = undefined;
			send({ type: "commit-progress", progress: { phase, output } });
			output = "";
		};

		const reportProgress = (progress: GitCommitProgress): void => {
			if (!acceptingProgress) return;

			output = (output + (progress.output ?? "")).slice(-commitOutputLimit);
			const changed = phase !== progress.phase;

			phase = progress.phase;

			if (changed) flushProgress();
			else progressTimer ??= setTimeout(flushProgress, 100);
		};

		if (!undo) commits.current.set(root, controller);

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
						signal: controller.signal,
						onProgress: reportProgress,
						...(workspace.amend ? { amend: true } : {}),
						includePartialStaging: true,
						paths: workspace.includedFileIds,
						...(Object.keys(workspace.partialFiles ?? {}).length
							? {
									partialFiles: Object.entries(workspace.partialFiles ?? {})
										.filter(([path]) =>
											workspace.includedFileIds.includes(path)
										)
										.map(([path, selection]) => ({ path, ...selection })),
								}
							: {}),
						message: submittedMessage,
						expectedHead: repository.head,
						expectedBranch: repository.branchName,
					});

			if (!result.ok)
				error =
					result.error.code === "aborted"
						? "Commit cancelled. No commit was created. Your message has been kept."
						: [result.error.message, result.error.details]
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
						message: error ?? result.error.message,
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
			acceptingProgress = false;

			if (progressTimer) clearTimeout(progressTimer);

			if (output) flushProgress();

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
			commits.current.delete(root);
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

	const cancelCommit = (id: string): void => {
		const root = tabs.current.find((tab) => tab.id === id)?.workspace.repository
			?.root;

		const controller = root && commits.current.get(root);

		if (!controller || controller.signal.aborted) return;

		controller.abort();

		for (const tab of tabs.current) {
			if (tab.workspace.repository?.root === root)
				dispatch({
					type: "workspace",
					id: tab.id,
					action: { type: "commit-cancelling" },
				});
		}
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
				choice.kind === "merge" ||
				choice.kind === "squash-merge" ||
				choice.kind === "rebase"
					? "Could not confirm branch integration. Review Changes and History before retrying."
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

		if (
			mounted.current &&
			(choice.kind === "merge" ||
				choice.kind === "squash-merge" ||
				choice.kind === "rebase")
		)
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
		const spaceId =
			tabs.current.find((tab) => tab.id === id)?.spaceId ?? "default";

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

			if (created)
				dispatch({ type: "open-worktree", snapshot: created, spaceId });

			if (removed) dispatch({ type: "worktree-removed", path: removed });
		}

		return error;
	};

	const synchronize = async (
		id: string,
		choice: { kind: "fetch" } | SyncRequest,
		publish?: (
			root: string,
			identity: PublishBranchIdentity,
			signal: AbortSignal,
			onProgress?: (progress: GitTransferProgress) => void
		) => Promise<GitResult<SyncResult>>,
		reviewed?: PublishBranchIdentity
	): Promise<string | null> => {
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
			return "Wait for the current operation before synchronizing.";

		if (
			reviewed &&
			(repository.head !== reviewed.expectedHead ||
				repository.branchName !== reviewed.expectedBranch)
		)
			return "The branch changed. Refresh and review it before synchronizing.";

		if (
			choice.kind !== "fetch" &&
			(!repository.head ||
				!repository.branchName ||
				workspace.error ||
				workspace.commit.needsReview)
		)
			return "Refresh and review this branch before synchronizing.";

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
			return "Wait for the current operation before synchronizing.";

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
		let lastProgress: GitTransferProgress | undefined;
		let progressAt = 0;

		const onProgress = (progress: GitTransferProgress): void => {
			if (
				controller.signal.aborted ||
				syncs.current.get(repository.commonDirectory)?.controller !== controller
			)
				return;

			const now = Date.now();

			if (
				lastProgress?.phase === progress.phase &&
				progress.percent !== 100 &&
				now - progressAt < 100
			)
				return;

			lastProgress = progress;
			progressAt = now;
			send({ type: "sync-progress", progress });
		};

		let error: string | null = null;
		let fetchedAt: number | null = null;
		let accountAccess: RemoteAccountAccess | undefined;
		let notice: string | undefined;

		const cancelledMessage =
			choice.kind === "fetch"
				? "Fetch cancelled."
				: "Synchronization stopped. It may have completed; review status before retrying.";

		try {
			const result: RepositorySyncResult = publish
				? await publish(
						repository.root,
						{
							expectedHead: repository.head ?? "",
							expectedBranch: repository.branchName ?? "",
						},
						controller.signal,
						onProgress
					)
				: choice.kind === "fetch"
					? await fetchRepository(
							repository.root,
							controller.signal,
							undefined,
							onProgress
						)
					: await writeSyncRepository(
							repository.root,
							{
								...choice,
								expectedHead: repository.head ?? "",
								expectedBranch: repository.branchName ?? "",
							},
							controller.signal,
							undefined,
							onProgress
						);

			if (result.ok) {
				if (
					choice.kind === "fetch" ||
					choice.kind === "pull" ||
					choice.kind === "sync"
				)
					fetchedAt = Date.now();

				if (choice.kind !== "fetch")
					notice = publish
						? "Repository published."
						: {
								pull: "Pull complete.",
								push: "Push complete.",
								publish: "Branch published.",
								sync: "Sync complete.",
							}[choice.kind];
			} else {
				accountAccess = result.accountAccess;

				error =
					result.error.code === "aborted" && controller.signal.aborted
						? cancelledMessage
						: [result.error.message, result.error.details]
								.filter(Boolean)
								.join("\n");
			}
		} catch {
			error = controller.signal.aborted
				? cancelledMessage
				: "Could not confirm synchronization. Review status and remote tracking before retrying.";
		}

		// Failed or cancelled sync can still change refs. Re-read every open worktree before unlocking.
		send({
			type: "sync-progress",
			progress: { phase: "refreshing", percent: null },
		});
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
						accountAccess,
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
						accountAccess,
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
					accountAccess,
					fetchedAt,
					notice,
				},
				root
			);

		const outcome = outcomes.get(repository.root);

		return (
			error ??
			(outcome?.type === "sync-finished"
				? (outcome.refreshError ?? null)
				: "Refresh to confirm synchronization.")
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
			| (RevertCommitInput & { kind: "revert" })
			| (CherryPickCommitInput & { kind: "cherry-pick" })
			| (CreateReleaseTagInput & { kind: "create-tag" })
			| (PushTagInput & { kind: "push-tag" })
			| (SquashCommitsInput & { kind: "squash-commits" })
			| (ResetCommitInput & { kind: "reset-commit" })
			| (ReorderCommitsInput & { kind: "reorder-commits" })
			| FileDiscardRequest
			| FileIgnoreRequest
			| {
					kind: "resolve";
					path: string;
					expectedContentHash: string;
					side?: "ours" | "theirs";
					expectedSideOid?: string;
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

		const sharedHistoryWrite =
			request.kind === "reset-commit" ||
			request.kind === "squash-commits" ||
			request.kind === "reorder-commits" ||
			request.kind === "create-tag" ||
			request.kind === "push-tag" ||
			request.kind === "revert" ||
			request.kind === "cherry-pick" ||
			((request.kind === "continue" || request.kind === "abort") &&
				(request.expectedOperation === "revert" ||
					request.expectedOperation === "cherry-pick"));

		const related = () =>
			tabs.current.filter(
				(tab) =>
					tab.workspace.repository?.commonDirectory ===
					repository.commonDirectory
			);

		if (
			sharedHistoryWrite &&
			related().some(
				(tab) =>
					tab.workspace.loading ||
					RepositoryWorkspaceModel.isBusy(tab.workspace) ||
					pending.current.has(tab.workspace.repository?.root ?? "")
			)
		)
			return "Wait for the current operation in this repository.";

		const send = (action: RepositoryWorkspaceAction) => {
			if (!mounted.current) return;

			for (const tab of tabs.current) {
				if (
					tab.workspace.repository?.root === repository.root ||
					(sharedHistoryWrite &&
						tab.workspace.repository?.commonDirectory ===
							repository.commonDirectory)
				)
					dispatch({ type: "workspace", id: tab.id, action });
			}
		};

		const started =
			request.kind === "resolve" ? "conflict-started" : "operation-started";

		pending.current.set(repository.root, started);

		if (sharedHistoryWrite)
			sharedWrites.current.add(repository.commonDirectory);

		closeProtection.block();
		send({ type: started });
		let error: string | null = null;
		let recoveryDirectory: string | undefined;

		try {
			const result =
				request.kind === "reorder-commits"
					? await reorderCommits(repository.root, request)
					: request.kind === "reset-commit"
						? await resetCommit(repository.root, request)
						: request.kind === "squash-commits"
							? await squashCommits(repository.root, request)
							: request.kind === "resolve"
								? await resolveConflict(repository.root, {
										path: request.path,
										expectedContentHash: request.expectedContentHash,
										side: request.side,
										expectedSideOid: request.expectedSideOid,
										expectedHead: repository.head,
										expectedBranch: repository.branchName,
									})
								: request.kind === "discard"
									? await discardFile(repository.root, request)
									: request.kind === "revert"
										? await revertCommit(repository.root, request)
										: request.kind === "cherry-pick"
											? await cherryPickCommit(repository.root, request)
											: request.kind === "ignore"
												? await ignoreFile(repository.root, request)
												: request.kind === "create-tag"
													? await createTag(repository.root, request)
													: request.kind === "push-tag"
														? await pushTag(
																repository.root,
																request,
																new AbortController().signal
															)
														: await writeOperation(repository.root, request);

			if (!result.ok) error = result.error.message;
			else if (
				(request.kind === "squash-commits" ||
					request.kind === "reorder-commits" ||
					request.kind === "reset-commit") &&
				"warning" in result.value &&
				result.value.warning
			)
				error = result.value.warning;

			if (
				"recoveryDirectory" in result &&
				typeof result.recoveryDirectory === "string"
			)
				recoveryDirectory = result.recoveryDirectory;
		} catch {
			error =
				"Could not confirm the Git action. Refresh and inspect Changes and History before retrying.";
		}

		const refreshed = new Map<string, RepositoryWorkspaceAction>();

		const roots = sharedHistoryWrite
			? [
					...new Set([
						repository.root,
						...related().map((tab) => tab.workspace.repository?.root),
					]),
				]
			: [repository.root];

		for (const root of roots) {
			if (!root) continue;

			let snapshot: RepositorySnapshot | undefined;
			let refreshError: string | undefined;

			try {
				const fresh = await readRepository(root, new AbortController().signal);

				if (fresh.ok) snapshot = fresh.value;
				else refreshError = fresh.error.message;
			} catch {
				refreshError =
					"Refresh to confirm the repository after the Git action.";
			}

			const source = root === repository.root;

			refreshed.set(
				root,
				request.kind === "resolve"
					? { type: "conflict-finished", snapshot, error: refreshError }
					: {
							type: "operation-finished",
							recoveryDirectory: source ? recoveryDirectory : undefined,
							snapshot,
							error: source ? error : null,
							refreshError,
							notice:
								!source || error || refreshError
									? undefined
									: request.kind === "discard"
										? `Discarded ${request.paths.length} ${request.paths.length === 1 ? "file" : "files"}. Recovery backup saved.`
										: request.kind === "squash-commits"
											? `Squashed ${request.commits.length} commits. Original history retained for recovery.`
											: request.kind === "reset-commit"
												? "Branch reset. Changes kept; original history retained for recovery."
												: request.kind === "reorder-commits"
													? `Reordered ${request.commits.length} commits. Original history retained for recovery.`
													: request.kind === "revert"
														? "Revert commit created."
														: request.kind === "cherry-pick"
															? `Commit cherry-picked onto ${request.targetBranch}.`
															: request.kind === "ignore"
																? "Rule added to .gitignore. Already tracked files remain unchanged."
																: request.kind === "create-tag"
																	? `Tag ${request.name} created locally.`
																	: request.kind === "push-tag"
																		? `Tag ${request.name} pushed to ${request.remote}.`
																		: request.kind === "abort"
																			? "Operation aborted."
																			: snapshot?.operationState === "normal"
																				? "Operation completed."
																				: "Git paused again. Review the current operation before continuing.",
						}
			);

			if (source && refreshError) error = refreshError;
		}

		// Keep every related tab busy until all reads finish; release before publishing their snapshots.
		pending.current.delete(repository.root);

		if (sharedHistoryWrite)
			sharedWrites.current.delete(repository.commonDirectory);

		if (mounted.current)
			for (const tab of tabs.current) {
				const action = refreshed.get(tab.workspace.repository?.root ?? "");

				if (action) dispatch({ type: "workspace", id: tab.id, action });
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
		publishRepository: async (
			id: string,
			run: (
				root: string,
				identity: PublishBranchIdentity,
				signal: AbortSignal,
				onProgress?: (progress: GitTransferProgress) => void
			) => Promise<GitResult<SyncResult>>
		): Promise<GitResult<SyncResult> | undefined> => {
			let outcome: GitResult<SyncResult> | undefined;

			await synchronize(
				id,
				{ kind: "publish", remote: "origin", remoteRef: "" },
				async (root, identity, signal, onProgress) => {
					outcome = await run(root, identity, signal, onProgress);

					return outcome;
				}
			);

			return outcome;
		},
		saveSettings,
		resolve: (
			id: string,
			path: string,
			expectedContentHash: string,
			side?: "ours" | "theirs",
			expectedSideOid?: string
		) =>
			updateWorktree(id, {
				kind: "resolve",
				path,
				expectedContentHash,
				side,
				expectedSideOid,
			}),
		finishOperation: (id: string, request: FinishOperationInput) =>
			updateWorktree(id, request),
		revertCommit: (id: string, request: RevertCommitInput) =>
			updateWorktree(id, { ...request, kind: "revert" }),
		cherryPickCommit: (id: string, request: CherryPickCommitInput) =>
			updateWorktree(id, { ...request, kind: "cherry-pick" }),
		createTag: (id: string, request: CreateReleaseTagInput) =>
			updateWorktree(id, { ...request, kind: "create-tag" }),
		pushTag: (id: string, request: PushTagInput) =>
			updateWorktree(id, { ...request, kind: "push-tag" }),
		squashCommits: (id: string, request: SquashCommitsInput) =>
			updateWorktree(id, { ...request, kind: "squash-commits" }),
		resetCommit: (id: string, request: ResetCommitInput) =>
			updateWorktree(id, { ...request, kind: "reset-commit" }),
		reorderCommits: (id: string, request: ReorderCommitsInput) =>
			updateWorktree(id, { ...request, kind: "reorder-commits" }),
		discardFile: (id: string, request: FileDiscardRequest) =>
			updateWorktree(id, request),
		ignoreFile: (id: string, request: FileIgnoreRequest) =>
			updateWorktree(id, request),
		closeProtection,
		stash,
		commit,
		cancelCommit,
		undoCommit: (id: string, input: CommitRecoveryInput) => commit(id, input),
		changeBranch,
		createWorktree: (id: string, choice: WorktreeChoice) =>
			mutateWorktree(id, choice),
		removeWorktree: (id: string, choice: WorktreeRemoval) =>
			mutateWorktree(id, choice),
		fetch: (id: string) => synchronize(id, { kind: "fetch" }),
		// Opening recovery settings acknowledges the failure, not successful authentication.
		// The next rail click can make a fresh, explicit attempt across any linked worktree.
		dismissSyncError: (id: string): void => {
			const directory = tabs.current.find((tab) => tab.id === id)?.workspace
				.repository?.commonDirectory;

			if (!directory) return;

			for (const tab of tabs.current) {
				if (tab.workspace.repository?.commonDirectory === directory)
					dispatch({
						type: "workspace",
						id: tab.id,
						action: { type: "sync-error-dismissed" },
					});
			}
		},
		synchronize,
		cancelSync,
	};
}
