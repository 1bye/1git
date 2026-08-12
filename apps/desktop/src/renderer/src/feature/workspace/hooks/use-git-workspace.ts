import type {
	BranchCollection,
	BranchMutationResult,
	ChangeHunkInput,
	CommitInfo,
	CommitPage,
	FileChange,
	FileDiff,
	GitError,
	GitResult,
	RemoteInfo,
	RepositoryOperationState,
	RepositorySnapshot,
	ResetMode,
	StashInfo,
	SyncResult,
} from "@1git/git";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRepositoryRefresh } from "@/feature/workspace/hooks/use-repository-refresh.js";
import {
	getRepositoryCurrentBranch,
	getRepositoryDeletableBranches,
	getRepositoryLocalBranch,
	getRepositoryRemoteBranches,
	repositoryBranchSwitchDisabledReason,
} from "@/feature/workspace/lib/repository-branches.js";
import {
	getRepositoryBranchComparison,
	getRepositoryCleanAction,
	type RepositoryBranchComparison,
	type RepositoryCleanAction,
} from "@/feature/workspace/lib/repository-clean-state.js";
import {
	canAmendRepositoryCommit,
	canRevertRepositoryCommit,
	getRepositoryCherryPickTargets,
} from "@/feature/workspace/lib/repository-history-actions.js";
import {
	getRepositoryOwner,
	type RepositoryOwner,
} from "@/feature/workspace/lib/repository-owner.js";
import {
	isRepositoryRecoveryActionAllowed,
	type RepositoryRecoveryAction,
	repositoryRecoveryErrorMessage,
	shouldStageFilesOnFirstPresentation,
} from "@/feature/workspace/lib/repository-recovery.js";
import {
	type BranchSwitchResult,
	combineRepositoryStashDiffs,
	type RepositoryStashAction,
	repositoryStashDiffTargets,
	repositoryStashErrorMessage,
	shouldOfferStashAndSwitch,
} from "@/feature/workspace/lib/repository-stash.js";
import {
	getRepositorySyncAction,
	getRepositorySyncSteps,
	type RepositorySyncAction,
	type RepositorySyncActionKind,
	type RepositorySyncStep,
} from "@/feature/workspace/lib/repository-sync.js";
import {
	groupRepositoryDiffPaths,
	isFileStaged,
} from "@/feature/workspace/lib/workspace-model.js";
import {
	moveWorkspaceInOrder,
	reconcileWorkspaceOrder,
} from "@/feature/workspace/lib/workspace-order.js";
import {
	presentedSession,
	type SessionSnapshotState,
	sessionForSnapshot,
	snapshotForSession,
} from "@/feature/workspace/lib/workspace-snapshot.js";
import type {
	GitWorkspace,
	OpenRepositoryOptions,
	PendingWorkspaceAction,
	RepositoryTab,
	WorkspaceDiscardUndo,
	WorkspaceTabState,
} from "@/feature/workspace/types/git-workspace.js";
import type {
	OpenedRepositorySession,
	RepositoryManagerResult,
	RepositoryManagerState,
	RepositorySessionId,
	RepositorySessionRecord,
} from "../../../../../shared/repository-session.js";

const EMPTY_MANAGER_STATE: RepositoryManagerState = {
	activeSessionId: null,
	recentRepositories: [],
	sessions: [],
};

const HISTORY_LIMIT = 100;

const gitErrorMessage = (error: GitError): string => {
	if (error.details && error.details !== error.message) {
		return `${error.message} ${error.details}`;
	}
	return error.message;
};

const resultValue = <T>(result: GitResult<T>): T => {
	if (!result.ok) {
		throw new Error(gitErrorMessage(result.error));
	}
	return result.value;
};

const managerResultValue = <T>(result: RepositoryManagerResult<T>): T => {
	if (!result.ok) {
		throw new Error(result.error.message);
	}
	return result.value;
};

const repositorySnapshot = async (
	sessionId: RepositorySessionId,
	knownSnapshot?: RepositorySnapshot
): Promise<RepositorySnapshot> =>
	knownSnapshot ??
	resultValue(await window.desktop.git.repository.snapshot(sessionId));

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : "The repository operation failed.";

const fileNameFromPath = (path: string): string =>
	path.split("/").at(-1) ?? path;

const firstDiffPath = (diff: FileDiff | null): string | null =>
	diff?.stats[0]?.path ?? null;

const openExternalBranchComparison = async (
	comparison: RepositoryBranchComparison | null
): Promise<void> => {
	if (comparison) {
		await window.desktop.integrations.openExternal(comparison.browserUrl);
	}
};

interface BranchComparisonPreviewOptions {
	readonly comparison: RepositoryBranchComparison | null;
	readonly ignoreWhitespace: boolean;
	readonly isBlocked: boolean;
	readonly onError: (message: string | null) => void;
	readonly onPendingChange: (action: PendingWorkspaceAction) => void;
	readonly onPresent: (
		comparison: RepositoryBranchComparison,
		diff: FileDiff
	) => void;
	readonly sessionId?: RepositorySessionId | null;
}

interface RepositoryCleanPresentation {
	readonly action: RepositoryCleanAction | null;
	readonly comparison: RepositoryBranchComparison | null;
}

const getRepositoryCleanPresentation = (
	snapshot: RepositorySnapshot | null,
	remotes: readonly RemoteInfo[],
	syncAction: RepositorySyncAction | null
): RepositoryCleanPresentation => {
	const comparison = snapshot
		? getRepositoryBranchComparison(snapshot.head, remotes)
		: null;
	return {
		action: syncAction
			? getRepositoryCleanAction(syncAction, comparison)
			: null,
		comparison,
	};
};

const previewRepositoryBranchComparison = async ({
	comparison,
	ignoreWhitespace,
	isBlocked,
	onError,
	onPendingChange,
	onPresent,
	sessionId,
}: BranchComparisonPreviewOptions): Promise<void> => {
	if (!(comparison && sessionId) || isBlocked) {
		return;
	}
	onPendingChange("refresh");
	try {
		onError(null);
		const diff = resultValue(
			await window.desktop.git.repository.diff(sessionId, {
				ignoreWhitespace,
				target: {
					base: comparison.baseRevision,
					head: "HEAD",
					kind: "range",
					mergeBase: true,
				},
			})
		);
		onPresent(comparison, diff);
	} catch (cause) {
		onError(errorMessage(cause));
	} finally {
		onPendingChange(null);
	}
};

interface WorkspaceSummary {
	readonly branch: string | null;
	readonly changedFiles: number;
	readonly owner: RepositoryOwner | null;
}

interface HistoryActionResult {
	readonly selectedCommitOid: string | null;
	readonly snapshot: RepositorySnapshot;
}

interface ActiveRepositorySync {
	cancelRequested: boolean;
	operationId: string | null;
	repositoryMayHaveChanged: boolean;
}

interface RepositorySyncFailure {
	readonly message: string;
}

const activeSessionFromManager = (
	manager: RepositoryManagerState
): RepositorySessionRecord | null =>
	manager.sessions.find((session) => session.id === manager.activeSessionId) ??
	null;

const syncErrorMessage = (error: GitError): string => {
	switch (error.code) {
		case "authentication-required":
			return "Authentication is required. Check your Git credentials and retry.";
		case "conflict":
			return "Sync stopped because the branch has conflicts.";
		case "dirty-worktree":
			return "Local changes block this operation. Commit or stash them, then retry.";
		case "repository-locked":
			return "Another Git operation is using this repository. Retry when it finishes.";
		default:
			return error.message;
	}
};

const syncFailureMayHaveChangedRepository = (error: GitError): boolean =>
	error.code === "command-failed" || error.code === "conflict";

const runRepositoryRecovery = async (
	sessionId: RepositorySessionId,
	operationState: RepositoryOperationState,
	action: RepositoryRecoveryAction
): Promise<GitResult<RepositorySnapshot>> => {
	if (operationState === "merge") {
		if (action === "continue") {
			return await window.desktop.git.branches.continueMerge(sessionId);
		}
		if (action === "abort") {
			return await window.desktop.git.branches.abortMerge(sessionId);
		}
	}
	if (operationState === "rebase") {
		if (action === "continue") {
			return await window.desktop.git.branches.continueRebase(sessionId);
		}
		if (action === "skip") {
			return await window.desktop.git.branches.skipRebase(sessionId);
		}
		return await window.desktop.git.branches.abortRebase(sessionId);
	}
	if (operationState === "cherry-pick") {
		if (action === "continue") {
			return await window.desktop.git.sequences.continueCherryPick(sessionId);
		}
		if (action === "abort") {
			return await window.desktop.git.sequences.abortCherryPick(sessionId);
		}
	}
	if (operationState === "revert") {
		if (action === "continue") {
			return await window.desktop.git.sequences.continueRevert(sessionId);
		}
		if (action === "abort") {
			return await window.desktop.git.sequences.abortRevert(sessionId);
		}
	}
	throw new Error("This recovery action is not valid for the Git operation.");
};

export const useGitWorkspace = (): GitWorkspace => {
	const [manager, setManager] =
		useState<RepositoryManagerState>(EMPTY_MANAGER_STATE);
	const [workspaceOrder, setWorkspaceOrder] = useState<
		readonly RepositorySessionId[]
	>([]);
	const [sessionSnapshot, setSessionSnapshot] =
		useState<SessionSnapshotState | null>(null);
	const [branches, setBranches] = useState<BranchCollection | null>(null);
	const [remotes, setRemotes] = useState<readonly RemoteInfo[]>([]);
	const [history, setHistory] = useState<CommitPage | null>(null);
	const [stashes, setStashes] = useState<readonly StashInfo[]>([]);
	const [diffs, setDiffs] = useState<readonly FileDiff[]>([]);
	const [ignoreWhitespace, setIgnoreWhitespaceState] = useState(false);
	const [visibleBranchComparison, setVisibleBranchComparison] =
		useState<RepositoryBranchComparison | null>(null);
	const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
	const [selectedCommitOid, setSelectedCommitOid] = useState<string | null>(
		null
	);
	const [selectedStashOid, setSelectedStashOid] = useState<string | null>(null);
	const [tab, setTabState] = useState<RepositoryTab>("changes");
	const [pendingAction, setPendingAction] =
		useState<PendingWorkspaceAction>(null);
	const [isInitialLoading, setIsInitialLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [syncFailures, setSyncFailures] = useState<
		Readonly<Record<RepositorySessionId, RepositorySyncFailure>>
	>({});
	const [pendingSyncActions, setPendingSyncActions] = useState<
		Readonly<Partial<Record<RepositorySessionId, RepositorySyncActionKind>>>
	>({});
	const [discardUndo, setDiscardUndo] = useState<WorkspaceDiscardUndo | null>(
		null
	);
	const [workspaceSummaries, setWorkspaceSummaries] = useState<
		Readonly<Record<RepositorySessionId, WorkspaceSummary>>
	>({});
	const diffRequestIdRef = useRef(0);
	const selectedStashOidRef = useRef(selectedStashOid);
	selectedStashOidRef.current = selectedStashOid;
	const stagedOnFirstPresentationRef = useRef(new Set<RepositorySessionId>());
	const activeSyncsRef = useRef(
		new Map<RepositorySessionId, ActiveRepositorySync>()
	);
	const ignoredRefreshOperationIdsRef = useRef(new Set<string>());
	const presentedSessionIdRef = useRef<RepositorySessionId | null>(null);
	const managerActiveSession = activeSessionFromManager(manager);
	const snapshotSession = sessionForSnapshot(sessionSnapshot, manager.sessions);
	const activeSession = presentedSession(
		managerActiveSession,
		snapshotSession,
		pendingAction === "workspace"
	);
	const presentedSessionId = activeSession ? activeSession.id : null;
	presentedSessionIdRef.current = presentedSessionId;
	const stageOnFirstPresentation = useCallback(
		async (
			sessionId: RepositorySessionId,
			initialSnapshot?: RepositorySnapshot
		): Promise<RepositorySnapshot | null> => {
			if (stagedOnFirstPresentationRef.current.has(sessionId)) {
				return null;
			}
			stagedOnFirstPresentationRef.current.add(sessionId);
			try {
				const currentSnapshot =
					initialSnapshot ?? (await repositorySnapshot(sessionId));
				if (
					!shouldStageFilesOnFirstPresentation(currentSnapshot.operationState)
				) {
					return currentSnapshot;
				}
				return resultValue(
					await window.desktop.git.changes.stageAll(sessionId)
				);
			} catch (cause) {
				stagedOnFirstPresentationRef.current.delete(sessionId);
				throw cause;
			}
		},
		[]
	);
	const snapshot = snapshotForSession(sessionSnapshot, presentedSessionId);
	const syncAction = snapshot
		? getRepositorySyncAction(snapshot.head, remotes)
		: null;
	const { action: cleanAction, comparison: branchComparison } =
		getRepositoryCleanPresentation(snapshot, remotes, syncAction);
	const pendingSyncAction = presentedSessionId
		? (pendingSyncActions[presentedSessionId] ?? null)
		: null;
	const visiblePendingAction = pendingAction ?? pendingSyncAction;
	const syncFailure = presentedSessionId
		? (syncFailures[presentedSessionId] ?? null)
		: null;
	const visibleError = syncFailure?.message ?? error;
	const applyManagerState = useCallback(
		(nextManager: RepositoryManagerState): void => {
			setManager(nextManager);
			setWorkspaceOrder((currentOrder) =>
				reconcileWorkspaceOrder(currentOrder, nextManager.sessions)
			);
		},
		[]
	);

	const rememberSnapshot = useCallback(
		(
			sessionId: RepositorySessionId,
			nextSnapshot: RepositorySnapshot,
			nextOwner?: RepositoryOwner | null
		): void => {
			setWorkspaceSummaries((current) => ({
				...current,
				[sessionId]: {
					branch: nextSnapshot.head.branch,
					changedFiles: nextSnapshot.files.length,
					owner:
						nextOwner === undefined
							? (current[sessionId]?.owner ?? null)
							: nextOwner,
				},
			}));
		},
		[]
	);

	const applySnapshot = useCallback(
		(
			sessionId: RepositorySessionId,
			nextSnapshot: RepositorySnapshot,
			nextOwner?: RepositoryOwner | null
		): void => {
			setSessionSnapshot({ sessionId, snapshot: nextSnapshot });
			rememberSnapshot(sessionId, nextSnapshot, nextOwner);
		},
		[rememberSnapshot]
	);

	const loadChangesDiff = useCallback(
		async (
			sessionId: RepositorySessionId,
			files: readonly FileChange[],
			requestIgnoreWhitespace = ignoreWhitespace
		): Promise<void> => {
			const requestId = diffRequestIdRef.current + 1;
			diffRequestIdRef.current = requestId;
			const paths = groupRepositoryDiffPaths(files);
			const requests: Promise<GitResult<FileDiff>>[] = [];
			if (paths.staged.length > 0) {
				requests.push(
					window.desktop.git.repository.diff(sessionId, {
						ignoreWhitespace: requestIgnoreWhitespace,
						paths: paths.staged,
						target: { kind: "staged" },
					})
				);
			}
			if (paths.working.length > 0) {
				requests.push(
					window.desktop.git.repository.diff(sessionId, {
						ignoreWhitespace: requestIgnoreWhitespace,
						paths: paths.working,
						target: { kind: "working" },
					})
				);
			}
			const results = await Promise.all(requests);
			if (requestId !== diffRequestIdRef.current) {
				return;
			}
			setDiffs(results.map(resultValue));
			setVisibleBranchComparison(null);
		},
		[ignoreWhitespace]
	);

	const loadRevisionDiff = useCallback(
		async (
			sessionId: RepositorySessionId,
			kind: "commit" | "stash",
			revision: string,
			requestIgnoreWhitespace = ignoreWhitespace
		): Promise<FileDiff | null> => {
			const requestId = diffRequestIdRef.current + 1;
			diffRequestIdRef.current = requestId;
			let diff: FileDiff;
			if (kind === "commit") {
				diff = resultValue(
					await window.desktop.git.repository.diff(sessionId, {
						ignoreWhitespace: requestIgnoreWhitespace,
						target: { kind: "commit", revision },
					})
				);
			} else {
				const [trackedTarget, untrackedTarget] =
					repositoryStashDiffTargets(revision);
				const [trackedResult, untrackedResult] = await Promise.all([
					window.desktop.git.repository.diff(sessionId, {
						ignoreWhitespace: requestIgnoreWhitespace,
						target: trackedTarget,
					}),
					window.desktop.git.repository.diff(sessionId, {
						ignoreWhitespace: requestIgnoreWhitespace,
						target: untrackedTarget,
					}),
				]);
				diff = combineRepositoryStashDiffs(
					resultValue(trackedResult),
					untrackedResult.ok ? untrackedResult.value : null
				);
			}
			if (requestId !== diffRequestIdRef.current) {
				return null;
			}
			setDiffs([diff]);
			setVisibleBranchComparison(null);
			return diff;
		},
		[ignoreWhitespace]
	);
	const clearDiff = useCallback((): void => {
		diffRequestIdRef.current += 1;
		setDiffs([]);
		setVisibleBranchComparison(null);
	}, []);
	const presentRevision = useCallback(
		async (
			sessionId: RepositorySessionId,
			kind: "commit" | "stash",
			revision: string | null
		): Promise<void> => {
			setSelectedCommitOid(kind === "commit" ? revision : null);
			setSelectedStashOid(kind === "stash" ? revision : null);
			setSelectedFilePath(null);
			clearDiff();
			if (!revision) {
				return;
			}
			setSelectedFilePath(
				firstDiffPath(await loadRevisionDiff(sessionId, kind, revision))
			);
		},
		[clearDiff, loadRevisionDiff]
	);
	const refreshChangesDiff = useCallback(
		(sessionId: RepositorySessionId, files: readonly FileChange[]): void => {
			if (files.length === 0) {
				clearDiff();
				return;
			}
			loadChangesDiff(sessionId, files).catch((cause: unknown) => {
				setError(errorMessage(cause));
			});
		},
		[clearDiff, loadChangesDiff]
	);
	const dismissDiscardUndo = useCallback((token: string): void => {
		setDiscardUndo((currentUndo) =>
			currentUndo?.token === token ? null : currentUndo
		);
	}, []);

	const loadSession = useCallback(
		async (
			session: RepositorySessionRecord,
			preferredFilePath?: string | null,
			preferredCommitOid?: string | null,
			knownSnapshot?: RepositorySnapshot
		): Promise<void> => {
			const [
				nextSnapshot,
				branchResult,
				historyResult,
				remotesResult,
				stashesResult,
			] = await Promise.all([
				repositorySnapshot(session.id, knownSnapshot),
				window.desktop.git.branches.list(session.id),
				window.desktop.git.repository.history(session.id, {
					limit: HISTORY_LIMIT,
				}),
				window.desktop.git.remotes.list(session.id),
				window.desktop.git.stashes.list(session.id),
			]);
			const nextBranches = resultValue(branchResult);
			const nextHistory = resultValue(historyResult);
			const nextRemotes = remotesResult.ok ? remotesResult.value : [];
			const nextOwner = remotesResult.ok
				? getRepositoryOwner(nextRemotes, nextSnapshot.head.upstream)
				: undefined;
			applySnapshot(session.id, nextSnapshot, nextOwner);
			setBranches(nextBranches);
			setHistory(nextHistory);
			setRemotes(nextRemotes);
			const nextStashes = resultValue(stashesResult);
			setStashes(nextStashes);

			if (tab === "history") {
				const commit =
					nextHistory.commits.find((item) => item.oid === preferredCommitOid) ??
					nextHistory.commits[0];
				await presentRevision(session.id, "commit", commit?.oid ?? null);
				return;
			}
			if (tab === "stashes") {
				const stash =
					nextStashes.find(
						(item) => item.oid === selectedStashOidRef.current
					) ?? nextStashes[0];
				await presentRevision(session.id, "stash", stash?.oid ?? null);
				return;
			}

			const file =
				nextSnapshot.files.find((item) => item.path === preferredFilePath) ??
				nextSnapshot.files[0];
			setSelectedFilePath(file?.path ?? null);
			setSelectedCommitOid(null);
			setSelectedStashOid(null);
			if (nextSnapshot.files.length > 0) {
				await loadChangesDiff(session.id, nextSnapshot.files);
			} else {
				clearDiff();
			}
		},
		[applySnapshot, clearDiff, loadChangesDiff, presentRevision, tab]
	);

	const refreshManager =
		useCallback(async (): Promise<RepositoryManagerState> => {
			const nextManager = await window.desktop.git.sessions.state();
			applyManagerState(nextManager);
			return nextManager;
		}, [applyManagerState]);

	const refresh = useCallback(async (): Promise<void> => {
		const session = activeSessionFromManager(manager);
		if (!session || pendingAction) {
			return;
		}

		setPendingAction("refresh");
		try {
			setError(null);
			await loadSession(session, selectedFilePath, selectedCommitOid);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setPendingAction(null);
		}
	}, [
		loadSession,
		manager,
		pendingAction,
		selectedCommitOid,
		selectedFilePath,
	]);

	useEffect(() => {
		let isDisposed = false;

		const initialize = async (): Promise<void> => {
			try {
				const nextManager = await window.desktop.git.sessions.state();
				if (isDisposed) {
					return;
				}
				applyManagerState(nextManager);
				const session = activeSessionFromManager(nextManager);
				if (session) {
					const nextSnapshot = await stageOnFirstPresentation(session.id);
					await loadSession(
						session,
						undefined,
						undefined,
						nextSnapshot ?? undefined
					);
				}
			} catch (cause) {
				if (!isDisposed) {
					setError(errorMessage(cause));
				}
			} finally {
				if (!isDisposed) {
					setIsInitialLoading(false);
				}
			}
		};

		initialize().catch((cause: unknown) => {
			if (!isDisposed) {
				setError(errorMessage(cause));
				setIsInitialLoading(false);
			}
		});
		return () => {
			isDisposed = true;
		};
	}, [applyManagerState, loadSession, stageOnFirstPresentation]);

	useRepositoryRefresh(presentedSessionId, (refreshEvent) => {
		if (
			refreshEvent.source === "mutation" &&
			refreshEvent.operationId &&
			ignoredRefreshOperationIdsRef.current.delete(refreshEvent.operationId)
		) {
			return;
		}
		refresh().catch((cause: unknown) => {
			setError(errorMessage(cause));
		});
	});

	const finishOpeningRepository = async (
		opened: OpenedRepositorySession,
		activate: boolean
	): Promise<void> => {
		const stagedSnapshot =
			(await stageOnFirstPresentation(opened.session.id, opened.snapshot)) ??
			opened.snapshot;
		if (!activate) {
			const [nextManager, remotesResult] = await Promise.all([
				window.desktop.git.sessions.state(),
				window.desktop.git.remotes.list(opened.session.id),
			]);
			const session =
				nextManager.sessions.find((item) => item.id === opened.session.id) ??
				opened.session;
			const owner = remotesResult.ok
				? getRepositoryOwner(remotesResult.value, stagedSnapshot.head.upstream)
				: undefined;
			applyManagerState(nextManager);
			rememberSnapshot(session.id, stagedSnapshot, owner);
			return;
		}

		const nextManager = await refreshManager();
		const session =
			nextManager.sessions.find((item) => item.id === opened.session.id) ??
			opened.session;
		applySnapshot(session.id, stagedSnapshot);
		setTabState("changes");
		setSelectedCommitOid(null);
		setSelectedStashOid(null);
		await loadSession(session, undefined, undefined, stagedSnapshot);
	};

	const openRepository = async (
		path: string,
		options: OpenRepositoryOptions = {}
	): Promise<void> => {
		if (pendingAction) {
			return;
		}
		const activate = options.activate ?? true;
		if (activate) {
			setPendingAction("open");
		}
		try {
			setError(null);
			const opened = resultValue(
				await window.desktop.git.sessions.open({ activate, path })
			);
			await finishOpeningRepository(opened, activate);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			if (activate) {
				setPendingAction(null);
			}
			setIsInitialLoading(false);
		}
	};

	const createRepositorySession = async (
		create: (path: string) => Promise<OpenedRepositorySession>
	): Promise<boolean> => {
		if (pendingAction) {
			return false;
		}
		setPendingAction("open");
		try {
			setError(null);
			const selection = await window.desktop.git.sessions.pickDirectory();
			if (selection.status === "cancelled") {
				return false;
			}
			await finishOpeningRepository(await create(selection.path), true);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
			setIsInitialLoading(false);
		}
	};

	const cloneRepository = async (remoteUrl: string): Promise<boolean> =>
		await createRepositorySession(async (path) =>
			resultValue(
				await window.desktop.git.sessions.clone({
					path,
					remoteUrl,
				})
			)
		);

	const createRepository = async (): Promise<boolean> =>
		await createRepositorySession(async (path) =>
			resultValue(await window.desktop.git.sessions.initialize({ path }))
		);

	const pickRepository = async (): Promise<void> => {
		const selection = await window.desktop.git.sessions.pickDirectory();
		if (selection.status === "selected") {
			await openRepository(selection.path);
		}
	};

	const openRecentRepository = async (
		path: string,
		options?: OpenRepositoryOptions
	): Promise<void> => {
		await openRepository(path, options);
	};

	const forgetRecentRepository = async (path: string): Promise<void> => {
		try {
			setError(null);
			applyManagerState(await window.desktop.git.sessions.forgetRecent(path));
		} catch (cause) {
			setError(errorMessage(cause));
		}
	};

	const cancelSyncForSession = async (
		sessionId: RepositorySessionId
	): Promise<void> => {
		const activeSync = activeSyncsRef.current.get(sessionId);
		if (!activeSync) {
			return;
		}
		activeSync.cancelRequested = true;
		if (activeSync.operationId) {
			await window.desktop.git.operations.cancel(activeSync.operationId);
		}
	};

	const cancelSync = async (): Promise<void> => {
		if (activeSession) {
			await cancelSyncForSession(activeSession.id);
		}
	};

	const activateWorkspace = async (
		sessionId: RepositorySessionId
	): Promise<void> => {
		if (manager.activeSessionId === sessionId || pendingAction) {
			return;
		}

		setPendingAction("workspace");
		try {
			setError(null);
			if (activeSession && snapshot) {
				rememberSnapshot(activeSession.id, snapshot);
			}
			const nextManager = managerResultValue(
				await window.desktop.git.sessions.activate(sessionId)
			);
			applyManagerState(nextManager);
			const session = nextManager.sessions.find(
				(item) => item.id === sessionId
			);
			if (!session) {
				throw new Error("The selected repository session is unavailable.");
			}
			const nextSnapshot = await stageOnFirstPresentation(session.id);
			await loadSession(
				session,
				undefined,
				undefined,
				nextSnapshot ?? undefined
			);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setPendingAction(null);
		}
	};

	const closeWorkspace = async (
		sessionId: RepositorySessionId
	): Promise<void> => {
		if (pendingAction) {
			return;
		}

		setPendingAction("workspace");
		try {
			setError(null);
			await cancelSyncForSession(sessionId);
			const wasActive = manager.activeSessionId === sessionId;
			const nextManager = managerResultValue(
				await window.desktop.git.sessions.close(sessionId)
			);
			applyManagerState(nextManager);
			setWorkspaceSummaries((current) => {
				const { [sessionId]: _closedSummary, ...remaining } = current;
				return remaining;
			});
			setPendingSyncActions((current) => {
				const next = { ...current };
				delete next[sessionId];
				return next;
			});
			setSyncFailures((current) => {
				const next = { ...current };
				delete next[sessionId];
				return next;
			});
			activeSyncsRef.current.delete(sessionId);

			if (!wasActive) {
				return;
			}

			const nextSession = activeSessionFromManager(nextManager);
			if (nextSession) {
				await loadSession(nextSession);
				return;
			}

			setSessionSnapshot(null);
			setBranches(null);
			setRemotes([]);
			setHistory(null);
			clearDiff();
			setSelectedFilePath(null);
			setSelectedCommitOid(null);
			setSelectedStashOid(null);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setPendingAction(null);
		}
	};

	const selectFile = (file: FileChange): Promise<void> => {
		if (!activeSession || pendingAction === "stage") {
			return Promise.resolve();
		}
		setError(null);
		setSelectedFilePath(file.path);
		setSelectedCommitOid(null);
		setSelectedStashOid(null);
		return Promise.resolve();
	};

	const selectCommit = async (commit: CommitInfo): Promise<void> => {
		if (!activeSession) {
			return;
		}
		try {
			setError(null);
			await presentRevision(activeSession.id, "commit", commit.oid);
		} catch (cause) {
			setError(errorMessage(cause));
		}
	};

	const selectStash = async (stash: StashInfo): Promise<void> => {
		if (!activeSession) {
			return;
		}
		try {
			setError(null);
			await presentRevision(activeSession.id, "stash", stash.oid);
		} catch (cause) {
			setError(errorMessage(cause));
		}
	};

	const selectRevisionFile = (path: string): Promise<void> => {
		if (!activeSession || (tab === "changes" && !visibleBranchComparison)) {
			return Promise.resolve();
		}
		setSelectedFilePath(path);
		return Promise.resolve();
	};

	const setTab = async (nextTab: RepositoryTab): Promise<void> => {
		if (nextTab === tab) {
			return;
		}
		setTabState(nextTab);
		if (!activeSession) {
			return;
		}

		try {
			setError(null);
			if (nextTab === "history") {
				const commit = history?.commits[0];
				await presentRevision(activeSession.id, "commit", commit?.oid ?? null);
				return;
			}
			if (nextTab === "stashes") {
				const [stash] = stashes;
				await presentRevision(activeSession.id, "stash", stash?.oid ?? null);
				return;
			}

			const file = snapshot?.files[0];
			setSelectedCommitOid(null);
			setSelectedStashOid(null);
			setSelectedFilePath(file?.path ?? null);
			if (snapshot && snapshot.files.length > 0) {
				await loadChangesDiff(activeSession.id, snapshot.files);
			} else {
				clearDiff();
			}
		} catch (cause) {
			setError(errorMessage(cause));
		}
	};

	const setFilesStaged = async (
		files: readonly FileChange[],
		shouldStage: boolean
	): Promise<boolean> => {
		if (!activeSession || pendingAction || files.length === 0) {
			return false;
		}
		setPendingAction("stage");
		try {
			setError(null);
			const paths = [...new Set(files.map((file) => file.path))];
			const result = shouldStage
				? await window.desktop.git.changes.stage(activeSession.id, {
						paths,
					})
				: await window.desktop.git.changes.unstage(activeSession.id, {
						paths,
					});
			const nextSnapshot = resultValue(result);
			applySnapshot(activeSession.id, nextSnapshot);
			const nextFile = nextSnapshot.files.find(
				(item) => item.path === selectedFilePath
			);
			setSelectedFilePath(
				nextFile?.path ?? nextSnapshot.files[0]?.path ?? null
			);
			refreshChangesDiff(activeSession.id, nextSnapshot.files);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const setFileStaged = async (
		file: FileChange,
		shouldStage: boolean
	): Promise<boolean> => await setFilesStaged([file], shouldStage);

	const changeHunk = async (input: ChangeHunkInput): Promise<boolean> => {
		if (!activeSession || pendingAction) {
			return false;
		}
		setPendingAction("hunk");
		try {
			setError(null);
			const result = await window.desktop.git.changes.changeHunk(
				activeSession.id,
				input
			);
			const changeResult = resultValue(result);
			const nextSnapshot = changeResult.snapshot;
			if (changeResult.undo) {
				setDiscardUndo({
					...changeResult.undo,
					detail: fileNameFromPath(changeResult.undo.path),
					message: "Hunk discarded from",
					sessionId: activeSession.id,
				});
			}
			applySnapshot(activeSession.id, nextSnapshot);
			const nextFile =
				nextSnapshot.files.find((item) => item.path === input.path) ??
				nextSnapshot.files[0];
			setSelectedFilePath(nextFile?.path ?? null);
			if (nextSnapshot.files.length > 0) {
				await loadChangesDiff(activeSession.id, nextSnapshot.files);
			} else {
				clearDiff();
			}
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const discardFiles = async (
		files: readonly FileChange[]
	): Promise<boolean> => {
		if (!activeSession || pendingAction || files.length === 0) {
			return false;
		}
		const discardedPaths = new Set(files.map((file) => file.path));
		const previousFileIndex =
			snapshot?.files.findIndex((file) => discardedPaths.has(file.path)) ?? -1;
		setPendingAction("discard");
		try {
			setError(null);
			const result = await window.desktop.git.changes.discardFiles(
				activeSession.id,
				{
					allowDestructive: true,
					paths: [...discardedPaths],
				}
			);
			const discardResult = resultValue(result);
			const nextSnapshot = discardResult.snapshot;
			setDiscardUndo({
				...discardResult.undo,
				detail:
					files.length === 1
						? fileNameFromPath(files[0]?.path ?? discardResult.undo.path)
						: `${files.length} files`,
				message:
					files.length === 1 ? "Changes discarded from" : "Changes discarded",
				sessionId: activeSession.id,
			});
			applySnapshot(activeSession.id, nextSnapshot);
			const nextFile =
				nextSnapshot.files.find(
					(candidate) => candidate.path === selectedFilePath
				) ??
				nextSnapshot.files[
					Math.min(
						Math.max(previousFileIndex, 0),
						nextSnapshot.files.length - 1
					)
				];
			setSelectedFilePath(nextFile?.path ?? null);
			if (nextSnapshot.files.length > 0) {
				await loadChangesDiff(activeSession.id, nextSnapshot.files);
			} else {
				clearDiff();
			}
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const undoDiscard = async (): Promise<boolean> => {
		const pendingUndo = discardUndo;
		if (!pendingUndo || pendingAction) {
			return false;
		}
		setPendingAction("discard");
		try {
			setError(null);
			const result = await window.desktop.git.changes.undoDiscard(
				pendingUndo.sessionId,
				{ token: pendingUndo.token }
			);
			const nextSnapshot = resultValue(result);
			setDiscardUndo((currentUndo) =>
				currentUndo?.token === pendingUndo.token ? null : currentUndo
			);
			if (activeSession?.id !== pendingUndo.sessionId) {
				rememberSnapshot(pendingUndo.sessionId, nextSnapshot);
				return true;
			}

			applySnapshot(pendingUndo.sessionId, nextSnapshot);
			const nextFile =
				nextSnapshot.files.find((item) => item.path === pendingUndo.path) ??
				nextSnapshot.files[0];
			setSelectedFilePath(nextFile?.path ?? null);
			if (nextSnapshot.files.length > 0) {
				await loadChangesDiff(pendingUndo.sessionId, nextSnapshot.files);
			} else {
				clearDiff();
			}
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			setDiscardUndo((currentUndo) =>
				currentUndo?.token === pendingUndo.token ? null : currentUndo
			);
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	useEffect(() => {
		if (!discardUndo) {
			return;
		}
		const sessionIsOpen = manager.sessions.some(
			(session) => session.id === discardUndo.sessionId
		);
		const remainingMs = Date.parse(discardUndo.expiresAt) - Date.now();
		if (!sessionIsOpen || remainingMs <= 0) {
			setDiscardUndo(null);
			return;
		}
		const timeoutId = globalThis.setTimeout(() => {
			setDiscardUndo((currentUndo) =>
				currentUndo?.token === discardUndo.token ? null : currentUndo
			);
		}, remainingMs);
		return () => globalThis.clearTimeout(timeoutId);
	}, [discardUndo, manager.sessions]);

	const toggleAllFiles = async (): Promise<void> => {
		if (!(activeSession && snapshot) || pendingAction) {
			return;
		}
		setPendingAction("stage");
		try {
			setError(null);
			const allStaged =
				snapshot.files.length > 0 && snapshot.files.every(isFileStaged);
			const result = allStaged
				? await window.desktop.git.changes.unstageAll(activeSession.id)
				: await window.desktop.git.changes.stageAll(activeSession.id);
			const nextSnapshot = resultValue(result);
			applySnapshot(activeSession.id, nextSnapshot);
			const nextFile =
				nextSnapshot.files.find((item) => item.path === selectedFilePath) ??
				nextSnapshot.files[0];
			setSelectedFilePath(nextFile?.path ?? null);
			if (nextSnapshot.files.length > 0) {
				await loadChangesDiff(activeSession.id, nextSnapshot.files);
			} else {
				clearDiff();
			}
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setPendingAction(null);
		}
	};

	const createCommit = async (
		summary: string,
		description: string
	): Promise<boolean> => {
		if (!(activeSession && snapshot) || pendingAction || !summary.trim()) {
			return false;
		}
		setPendingAction("commit");
		try {
			setError(null);
			const result = await window.desktop.git.changes.commit(activeSession.id, {
				description: description.trim() || undefined,
				summary: summary.trim(),
			});
			const value = resultValue(result);
			applySnapshot(activeSession.id, value.snapshot);
			setHistory(
				await window.desktop.git.repository
					.history(activeSession.id, { limit: HISTORY_LIMIT })
					.then(resultValue)
			);
			setSelectedFilePath(value.snapshot.files[0]?.path ?? null);
			if (value.snapshot.files.length > 0) {
				await loadChangesDiff(activeSession.id, value.snapshot.files);
			} else {
				clearDiff();
			}
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const runHistoryAction = async (
		action: (sessionId: RepositorySessionId) => Promise<HistoryActionResult>
	): Promise<boolean> => {
		if (!activeSession || pendingAction) {
			return false;
		}
		setPendingAction("history");
		try {
			setError(null);
			const result = await action(activeSession.id);
			applySnapshot(activeSession.id, result.snapshot);
			await loadSession(activeSession, null, result.selectedCommitOid);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const amendCommit = async (
		commit: CommitInfo,
		summary: string,
		description: string
	): Promise<boolean> => {
		if (
			!(
				snapshot &&
				canAmendRepositoryCommit(commit, snapshot.head.oid) &&
				summary.trim()
			)
		) {
			return false;
		}
		return await runHistoryAction(async (sessionId) => {
			const result = await window.desktop.git.changes.commit(sessionId, {
				amend: true,
				description: description.trim() || undefined,
				summary: summary.trim(),
			});
			const value = resultValue(result);
			return {
				selectedCommitOid: value.commit.oid,
				snapshot: value.snapshot,
			};
		});
	};

	const cherryPickCommit = async (
		commit: CommitInfo,
		branchName: string
	): Promise<boolean> => {
		const targetBranch = getRepositoryCherryPickTargets(branches).find(
			(branch) => branch.name === branchName
		);
		if (!(activeSession && targetBranch) || pendingAction) {
			return false;
		}
		setPendingAction("history");
		try {
			setError(null);
			const checkoutResult = await window.desktop.git.branches.checkout(
				activeSession.id,
				{ name: targetBranch.name }
			);
			const checkout = resultValue(checkoutResult);
			setBranches(checkout.branches);
			applySnapshot(activeSession.id, checkout.snapshot);
			const cherryPickResult = await window.desktop.git.sequences.cherryPick(
				activeSession.id,
				{ revisions: [commit.oid] }
			);
			const nextSnapshot = resultValue(cherryPickResult);
			applySnapshot(activeSession.id, nextSnapshot);
			await loadSession(activeSession, null, nextSnapshot.head.oid);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			try {
				await loadSession(activeSession);
			} catch {
				// Keep the original Git error visible when recovery also fails.
			}
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const resetToCommit = async (
		commit: CommitInfo,
		mode: ResetMode
	): Promise<boolean> =>
		await runHistoryAction(async (sessionId) => {
			const result = await window.desktop.git.changes.reset(sessionId, {
				allowDestructive: mode === "hard",
				mode,
				target: commit.oid,
			});
			const nextSnapshot = resultValue(result);
			return {
				selectedCommitOid: nextSnapshot.head.oid,
				snapshot: nextSnapshot,
			};
		});

	const revertCommit = async (commit: CommitInfo): Promise<boolean> => {
		if (!canRevertRepositoryCommit(commit)) {
			return false;
		}
		return await runHistoryAction(async (sessionId) => {
			const result = await window.desktop.git.sequences.revert(sessionId, {
				revisions: [commit.oid],
			});
			const nextSnapshot = resultValue(result);
			return {
				selectedCommitOid: nextSnapshot.head.oid,
				snapshot: nextSnapshot,
			};
		});
	};

	const switchBranch = async (name: string): Promise<BranchSwitchResult> => {
		const targetBranch = getRepositoryLocalBranch(branches, name);
		if (
			!(activeSession && snapshot) ||
			pendingAction ||
			!targetBranch ||
			name === snapshot.head.branch ||
			repositoryBranchSwitchDisabledReason(
				targetBranch,
				snapshot.head.branch
			) !== null
		) {
			return "failed";
		}
		setPendingAction("branch");
		try {
			setError(null);
			const result = await window.desktop.git.branches.checkout(
				activeSession.id,
				{ name }
			);
			if (!result.ok) {
				if (shouldOfferStashAndSwitch(result.error)) {
					return "needs-stash";
				}
				setError(result.error.message);
				return "failed";
			}
			const { value } = result;
			setBranches(value.branches);
			applySnapshot(activeSession.id, value.snapshot);
			await loadSession(
				activeSession,
				value.snapshot.files[0]?.path,
				undefined,
				value.snapshot
			);
			return "switched";
		} catch (cause) {
			setError(errorMessage(cause));
			return "failed";
		} finally {
			setPendingAction(null);
		}
	};

	const runBranchMutation = async (
		action: (
			sessionId: RepositorySessionId
		) => Promise<GitResult<BranchMutationResult>>
	): Promise<boolean> => {
		if (!activeSession || pendingAction) {
			return false;
		}
		setPendingAction("branch");
		try {
			setError(null);
			const value = resultValue(await action(activeSession.id));
			setBranches(value.branches);
			applySnapshot(activeSession.id, value.snapshot);
			await loadSession(
				activeSession,
				selectedFilePath,
				selectedCommitOid,
				value.snapshot
			);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const createBranch = async (
		name: string,
		startPoint?: string
	): Promise<boolean> => {
		const branchName = name.trim();
		if (!branchName) {
			return false;
		}
		return await runBranchMutation(
			async (sessionId) =>
				await window.desktop.git.branches.create(sessionId, {
					checkout: true,
					name: branchName,
					startPoint,
				})
		);
	};

	const renameBranch = async (newName: string): Promise<boolean> => {
		const currentBranch = getRepositoryCurrentBranch(branches);
		const branchName = newName.trim();
		if (!(currentBranch && branchName) || branchName === currentBranch.name) {
			return false;
		}
		return await runBranchMutation(
			async (sessionId) =>
				await window.desktop.git.branches.rename(sessionId, {
					currentName: currentBranch.name,
					newName: branchName,
				})
		);
	};

	const deleteBranch = async (name: string): Promise<boolean> => {
		const targetBranch = getRepositoryDeletableBranches(branches).find(
			(branch) => branch.name === name
		);
		if (!targetBranch) {
			return false;
		}
		return await runBranchMutation(
			async (sessionId) =>
				await window.desktop.git.branches.delete(sessionId, {
					name: targetBranch.name,
				})
		);
	};

	const setBranchUpstream = async (upstream: string): Promise<boolean> => {
		const currentBranch = getRepositoryCurrentBranch(branches);
		const remoteBranch = getRepositoryRemoteBranches(branches).find(
			(branch) => branch.name === upstream
		);
		if (!(currentBranch && remoteBranch)) {
			return false;
		}
		return await runBranchMutation(
			async (sessionId) =>
				await window.desktop.git.branches.setUpstream(sessionId, {
					branch: currentBranch.name,
					upstream: remoteBranch.name,
				})
		);
	};

	const invokeRepositorySyncStep = async (
		sessionId: RepositorySessionId,
		activeSync: ActiveRepositorySync,
		step: RepositorySyncStep
	): Promise<SyncResult | null> => {
		if (activeSync.cancelRequested) {
			return null;
		}

		const operationId = window.desktop.git.operations.createId();
		activeSync.operationId = operationId;
		ignoredRefreshOperationIdsRef.current.add(operationId);

		let result: GitResult<SyncResult>;
		try {
			if (step.kind === "fetch") {
				result = await window.desktop.git.sync.fetch(sessionId, step.input, {
					operationId,
				});
			} else if (step.kind === "pull") {
				result = await window.desktop.git.sync.pull(sessionId, step.input, {
					operationId,
				});
			} else {
				result = await window.desktop.git.sync.push(sessionId, step.input, {
					operationId,
				});
			}
		} catch (cause) {
			ignoredRefreshOperationIdsRef.current.delete(operationId);
			throw cause;
		}

		if (result.ok) {
			activeSync.repositoryMayHaveChanged = true;
			return activeSync.cancelRequested ? null : result.value;
		}

		if (syncFailureMayHaveChangedRepository(result.error)) {
			activeSync.repositoryMayHaveChanged = true;
		} else {
			ignoredRefreshOperationIdsRef.current.delete(operationId);
		}
		if (activeSync.cancelRequested && result.error.code === "aborted") {
			return null;
		}
		throw new Error(syncErrorMessage(result.error));
	};

	const runRepositorySyncSteps = async (
		sessionId: RepositorySessionId,
		activeSync: ActiveRepositorySync,
		steps: readonly RepositorySyncStep[],
		index = 0
	): Promise<RepositorySnapshot | undefined> => {
		const step = steps[index];
		if (!step) {
			return;
		}
		const result = await invokeRepositorySyncStep(sessionId, activeSync, step);
		if (!result) {
			return;
		}
		const laterSnapshot = await runRepositorySyncSteps(
			sessionId,
			activeSync,
			steps,
			index + 1
		);
		return laterSnapshot ?? result.snapshot;
	};

	const setRepositorySyncFailure = (
		sessionId: RepositorySessionId,
		message: string
	): void => {
		setSyncFailures((current) => ({
			...current,
			[sessionId]: { message },
		}));
	};

	const beginRepositorySync = (
		sessionId: RepositorySessionId,
		action: RepositorySyncAction
	): ActiveRepositorySync => {
		const activeSync: ActiveRepositorySync = {
			cancelRequested: false,
			operationId: null,
			repositoryMayHaveChanged: false,
		};
		activeSyncsRef.current.set(sessionId, activeSync);
		setPendingSyncActions((current) => ({
			...current,
			[sessionId]: action.kind,
		}));
		setSyncFailures((current) => {
			const next = { ...current };
			delete next[sessionId];
			return next;
		});
		setError(null);
		return activeSync;
	};

	const finishRepositorySync = (
		sessionId: RepositorySessionId,
		activeSync: ActiveRepositorySync,
		failureMessage: string | null
	): void => {
		if (failureMessage) {
			setRepositorySyncFailure(sessionId, failureMessage);
		}
		if (activeSyncsRef.current.get(sessionId) === activeSync) {
			activeSyncsRef.current.delete(sessionId);
		}
		setPendingSyncActions((current) => {
			const next = { ...current };
			delete next[sessionId];
			return next;
		});
	};

	const refreshAfterRepositorySync = async (
		session: RepositorySessionRecord,
		activeSync: ActiveRepositorySync,
		latestSnapshot?: RepositorySnapshot
	): Promise<void> => {
		if (!activeSync.repositoryMayHaveChanged) {
			return;
		}
		if (presentedSessionIdRef.current === session.id) {
			await loadSession(
				session,
				selectedFilePath,
				selectedCommitOid,
				latestSnapshot
			);
			return;
		}
		if (latestSnapshot) {
			rememberSnapshot(session.id, latestSnapshot);
		}
	};

	const performRepositorySync = async (
		session: RepositorySessionRecord,
		action: RepositorySyncAction,
		steps: readonly RepositorySyncStep[]
	): Promise<void> => {
		const activeSync = beginRepositorySync(session.id, action);
		let failureMessage: string | null = null;
		let latestSnapshot: RepositorySnapshot | undefined;
		try {
			latestSnapshot = await runRepositorySyncSteps(
				session.id,
				activeSync,
				steps
			);
		} catch (cause) {
			if (!activeSync.cancelRequested) {
				failureMessage = errorMessage(cause);
			}
		}

		try {
			await refreshAfterRepositorySync(session, activeSync, latestSnapshot);
		} catch (cause) {
			if (!activeSync.cancelRequested) {
				failureMessage = errorMessage(cause);
			}
		}
		finishRepositorySync(session.id, activeSync, failureMessage);
	};

	const syncRepository = async (): Promise<void> => {
		if (
			!(activeSession && snapshot && syncAction) ||
			pendingAction ||
			activeSyncsRef.current.has(activeSession.id)
		) {
			return;
		}
		const { disabledReason } = syncAction;
		const blockedMessage =
			snapshot.operationState === "normal"
				? disabledReason
				: "Finish the current Git operation before syncing.";
		if (blockedMessage) {
			setRepositorySyncFailure(activeSession.id, blockedMessage);
			return;
		}

		const steps = getRepositorySyncSteps(syncAction, snapshot.head.branch);
		if (steps.length === 0) {
			return;
		}
		await performRepositorySync(activeSession, syncAction, steps);
	};

	const previewBranchComparison = async (): Promise<void> => {
		await previewRepositoryBranchComparison({
			comparison: branchComparison,
			ignoreWhitespace,
			isBlocked: pendingAction !== null,
			onError: setError,
			onPendingChange: setPendingAction,
			onPresent: (comparison, diff) => {
				setDiffs([diff]);
				setVisibleBranchComparison(comparison);
				setSelectedFilePath(firstDiffPath(diff));
				setSelectedCommitOid(null);
				setSelectedStashOid(null);
			},
			sessionId: activeSession?.id,
		});
	};

	const setIgnoreWhitespace = (nextIgnoreWhitespace: boolean): void => {
		if (nextIgnoreWhitespace === ignoreWhitespace) {
			return;
		}
		setIgnoreWhitespaceState(nextIgnoreWhitespace);
		if (!activeSession) {
			return;
		}
		const refreshDiff = async (): Promise<void> => {
			if (visibleBranchComparison) {
				const diff = resultValue(
					await window.desktop.git.repository.diff(activeSession.id, {
						ignoreWhitespace: nextIgnoreWhitespace,
						target: {
							base: visibleBranchComparison.baseRevision,
							head: "HEAD",
							kind: "range",
							mergeBase: true,
						},
					})
				);
				setDiffs([diff]);
				return;
			}
			if (tab === "history" && selectedCommitOid) {
				await loadRevisionDiff(
					activeSession.id,
					"commit",
					selectedCommitOid,
					nextIgnoreWhitespace
				);
				return;
			}
			if (tab === "stashes" && selectedStashOid) {
				await loadRevisionDiff(
					activeSession.id,
					"stash",
					selectedStashOid,
					nextIgnoreWhitespace
				);
				return;
			}
			if (snapshot?.files.length) {
				await loadChangesDiff(
					activeSession.id,
					snapshot.files,
					nextIgnoreWhitespace
				);
			}
		};
		refreshDiff().catch((cause: unknown) => {
			setError(errorMessage(cause));
		});
	};

	const openBranchComparison = async (): Promise<void> => {
		const comparison = visibleBranchComparison ?? branchComparison;
		try {
			setError(null);
			await openExternalBranchComparison(comparison);
		} catch (cause) {
			setError(errorMessage(cause));
		}
	};

	const closeBranchComparison = (): void => {
		clearDiff();
		setSelectedFilePath(null);
	};

	const mergeBranch = async (name: string): Promise<boolean> => {
		if (
			!(activeSession && snapshot) ||
			pendingAction ||
			name === snapshot.head.branch
		) {
			return false;
		}
		setPendingAction("merge");
		try {
			setError(null);
			const result = await window.desktop.git.branches.merge(activeSession.id, {
				revision: name,
			});
			const nextSnapshot = resultValue(result);
			applySnapshot(activeSession.id, nextSnapshot);
			await loadSession(activeSession, selectedFilePath, selectedCommitOid);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const recoverRepository = async (
		action: RepositoryRecoveryAction
	): Promise<boolean> => {
		if (
			!(activeSession && snapshot) ||
			pendingAction ||
			!isRepositoryRecoveryActionAllowed(snapshot.operationState, action)
		) {
			return false;
		}
		const { operationState } = snapshot;
		setPendingAction("recovery");
		try {
			setError(null);
			const result = await runRepositoryRecovery(
				activeSession.id,
				operationState,
				action
			);
			if (!result.ok) {
				await loadSession(activeSession, selectedFilePath, selectedCommitOid);
				setError(
					repositoryRecoveryErrorMessage(result.error, operationState, action)
				);
				return false;
			}
			applySnapshot(activeSession.id, result.value);
			await loadSession(
				activeSession,
				selectedFilePath,
				selectedCommitOid,
				result.value
			);
			return true;
		} catch (cause) {
			setError(`Could not ${action} the Git operation. ${errorMessage(cause)}`);
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const openRepositoryInEditor = async (): Promise<void> => {
		if (!activeSession) {
			return;
		}
		try {
			setError(null);
			await window.desktop.integrations.openInApplication(
				"zed",
				activeSession.repository.root
			);
		} catch {
			setError("The repository could not be opened in Zed.");
		}
	};

	const openRepositoryFileInEditor = async (path: string): Promise<void> => {
		if (!activeSession) {
			return;
		}
		try {
			setError(null);
			const { root } = activeSession.repository;
			const repositoryRoot = root.endsWith("/") ? root.slice(0, -1) : root;
			await window.desktop.integrations.openInApplication(
				"zed",
				`${repositoryRoot}/${path}`
			);
		} catch {
			setError("The file could not be opened in Zed.");
		}
	};

	const stashChanges = async (): Promise<boolean> => {
		if (
			!(activeSession && snapshot) ||
			pendingAction ||
			snapshot.files.length === 0
		) {
			return false;
		}
		setPendingAction("stash");
		try {
			setError(null);
			const result = await window.desktop.git.stashes.create(activeSession.id, {
				includeUntracked: true,
			});
			const nextSnapshot = resultValue(result);
			applySnapshot(activeSession.id, nextSnapshot);
			await loadSession(
				activeSession,
				selectedFilePath,
				selectedCommitOid,
				nextSnapshot
			);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const applyRepositoryStash = async (
		stash: StashInfo,
		action: RepositoryStashAction
	): Promise<boolean> => {
		if (
			!(activeSession && snapshot) ||
			pendingAction ||
			snapshot.operationState !== "normal"
		) {
			return false;
		}
		setPendingAction("stash");
		try {
			setError(null);
			const result =
				action === "apply"
					? await window.desktop.git.stashes.apply(activeSession.id, {
							reference: stash.reference,
						})
					: await window.desktop.git.stashes.pop(activeSession.id, {
							reference: stash.reference,
						});
			if (!result.ok) {
				await loadSession(activeSession, selectedFilePath, selectedCommitOid);
				setError(repositoryStashErrorMessage(result.error, action));
				return false;
			}
			applySnapshot(activeSession.id, result.value);
			await loadSession(
				activeSession,
				selectedFilePath,
				selectedCommitOid,
				result.value
			);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const applyStash = async (stash: StashInfo): Promise<boolean> =>
		await applyRepositoryStash(stash, "apply");

	const popStash = async (stash: StashInfo): Promise<boolean> =>
		await applyRepositoryStash(stash, "pop");

	const dropStash = async (stash: StashInfo): Promise<boolean> => {
		if (!(activeSession && snapshot) || pendingAction) {
			return false;
		}
		setPendingAction("stash");
		try {
			setError(null);
			const result = await window.desktop.git.stashes.drop(activeSession.id, {
				reference: stash.reference,
			});
			const nextStashes = resultValue(result);
			setStashes(nextStashes);
			applySnapshot(activeSession.id, {
				...snapshot,
				stashCount: nextStashes.length,
			});
			if (tab === "stashes" && selectedStashOid === stash.oid) {
				const [nextStash] = nextStashes;
				await presentRevision(
					activeSession.id,
					"stash",
					nextStash?.oid ?? null
				);
			}
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const stashAndSwitchBranch = async (name: string): Promise<boolean> => {
		const targetBranch = getRepositoryLocalBranch(branches, name);
		if (
			!(activeSession && snapshot) ||
			pendingAction ||
			!targetBranch ||
			snapshot.operationState !== "normal" ||
			name === snapshot.head.branch ||
			repositoryBranchSwitchDisabledReason(
				targetBranch,
				snapshot.head.branch
			) !== null
		) {
			return false;
		}
		setPendingAction("branch");
		try {
			setError(null);
			const stashedSnapshot = resultValue(
				await window.desktop.git.stashes.create(activeSession.id, {
					includeUntracked: true,
					message: `Switch from ${snapshot.head.branch ?? "detached HEAD"} to ${name}`,
				})
			);
			const checkoutResult = await window.desktop.git.branches.checkout(
				activeSession.id,
				{ name }
			);
			if (!checkoutResult.ok) {
				await loadSession(
					activeSession,
					selectedFilePath,
					selectedCommitOid,
					stashedSnapshot
				);
				setError(
					`Changes were stashed, but the branch could not be switched. ${checkoutResult.error.message}`
				);
				return false;
			}
			setBranches(checkoutResult.value.branches);
			applySnapshot(activeSession.id, checkoutResult.value.snapshot);
			await loadSession(
				activeSession,
				checkoutResult.value.snapshot.files[0]?.path,
				undefined,
				checkoutResult.value.snapshot
			);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const reorderWorkspace = (
		activeSessionId: RepositorySessionId,
		overSessionId: RepositorySessionId
	): void => {
		setWorkspaceOrder((currentOrder) =>
			moveWorkspaceInOrder(currentOrder, activeSessionId, overSessionId)
		);
	};
	const sessionsById = new Map(
		manager.sessions.map((session) => [session.id, session])
	);
	const orderedWorkspaceIds = reconcileWorkspaceOrder(
		workspaceOrder,
		manager.sessions
	);
	const workspaces: WorkspaceTabState[] = [];
	for (const sessionId of orderedWorkspaceIds) {
		const session = sessionsById.get(sessionId);
		if (!session) {
			continue;
		}
		const summary =
			session.id === activeSession?.id && snapshot
				? {
						branch: snapshot.head.branch,
						changedFiles: snapshot.files.length,
						owner: workspaceSummaries[session.id]?.owner ?? null,
					}
				: workspaceSummaries[session.id];
		workspaces.push({
			branch: summary?.branch ?? null,
			changedFiles: summary?.changedFiles ?? null,
			owner: summary?.owner ?? null,
			pendingSyncAction: pendingSyncActions[session.id] ?? null,
			session,
		});
	}

	return {
		activateWorkspace,
		activeSession,
		amendCommit,
		applyStash,
		branchComparison: visibleBranchComparison,
		branches,
		cancelSync,
		canRetrySync: Boolean(
			syncFailure &&
				syncAction &&
				!syncAction.disabledReason &&
				!pendingSyncAction
		),
		changeHunk,
		cherryPickCommit,
		cleanAction,
		clearError: () => {
			setError(null);
			if (presentedSessionId) {
				setSyncFailures((current) => {
					const next = { ...current };
					delete next[presentedSessionId];
					return next;
				});
			}
		},
		cloneRepository,
		closeBranchComparison,
		closeWorkspace,
		commit: createCommit,
		createBranch,
		createRepository,
		deleteBranch,
		diffs,
		discardFiles,
		discardUndo,
		dismissDiscardUndo,
		dropStash,
		error: visibleError,
		forgetRecentRepository,
		history,
		ignoreWhitespace,
		isInitialLoading,
		manager,
		mergeBranch,
		openBranchComparison,
		openRecentRepository,
		openRepositoryFileInEditor,
		openRepositoryInEditor,
		pendingAction: visiblePendingAction,
		pickRepository,
		popStash,
		previewBranchComparison,
		recoverRepository,
		renameBranch,
		reorderWorkspace,
		resetToCommit,
		revertCommit,
		selectCommit,
		selectedCommitOid,
		selectedFilePath,
		selectedStashOid,
		selectFile,
		selectRevisionFile,
		selectStash,
		setBranchUpstream,
		setFileStaged,
		setFilesStaged,
		setIgnoreWhitespace,
		setTab,
		snapshot,
		stashAndSwitchBranch,
		stashChanges,
		stashes,
		switchBranch,
		syncAction,
		syncRepository,
		tab,
		toggleAllFiles,
		undoDiscard,
		workspaces,
	};
};
