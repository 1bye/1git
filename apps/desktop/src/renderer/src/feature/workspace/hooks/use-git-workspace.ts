import type {
	BranchCollection,
	CommitInfo,
	CommitPage,
	FileChange,
	FileDiff,
	GitError,
	GitResult,
	RepositorySnapshot,
} from "@1git/git";
import { useCallback, useEffect, useState } from "react";
import { useRepositoryRefresh } from "@/feature/workspace/hooks/use-repository-refresh.js";
import {
	getRepositoryOwner,
	type RepositoryOwner,
} from "@/feature/workspace/lib/repository-owner.js";
import { isFileStaged } from "@/feature/workspace/lib/workspace-model.js";
import {
	moveWorkspaceInOrder,
	reconcileWorkspaceOrder,
} from "@/feature/workspace/lib/workspace-order.js";
import {
	type SessionSnapshotState,
	snapshotForSession,
} from "@/feature/workspace/lib/workspace-snapshot.js";
import type {
	RepositoryManagerResult,
	RepositoryManagerState,
	RepositorySessionId,
	RepositorySessionRecord,
} from "../../../../../shared/repository-session.js";

export type RepositoryTab = "changes" | "history";
export type PendingWorkspaceAction =
	| "branch"
	| "commit"
	| "fetch"
	| "open"
	| "refresh"
	| "stage"
	| "workspace"
	| null;

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

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : "The repository operation failed.";

interface WorkspaceSummary {
	readonly branch: string | null;
	readonly changedFiles: number;
	readonly owner: RepositoryOwner | null;
}

export interface WorkspaceTabState {
	readonly branch: string | null;
	readonly changedFiles: number | null;
	readonly owner: RepositoryOwner | null;
	readonly session: RepositorySessionRecord;
}

export interface GitWorkspace {
	readonly activateWorkspace: (sessionId: RepositorySessionId) => Promise<void>;
	readonly activeSession: RepositorySessionRecord | null;
	readonly branches: BranchCollection | null;
	readonly clearError: () => void;
	readonly closeWorkspace: (sessionId: RepositorySessionId) => Promise<void>;
	readonly commit: (summary: string, description: string) => Promise<boolean>;
	readonly createBranch: (name: string) => Promise<boolean>;
	readonly diff: FileDiff | null;
	readonly error: string | null;
	readonly fetchRepository: () => Promise<void>;
	readonly history: CommitPage | null;
	readonly isInitialLoading: boolean;
	readonly lastFetchedAt: string | null;
	readonly manager: RepositoryManagerState;
	readonly openRecentRepository: (path: string) => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly pickRepository: () => Promise<void>;
	readonly refresh: () => Promise<void>;
	readonly reorderWorkspace: (
		activeSessionId: RepositorySessionId,
		overSessionId: RepositorySessionId
	) => void;
	readonly selectCommit: (commit: CommitInfo) => Promise<void>;
	readonly selectedCommitOid: string | null;
	readonly selectedFilePath: string | null;
	readonly selectFile: (file: FileChange) => Promise<void>;
	readonly setFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly setTab: (tab: RepositoryTab) => Promise<void>;
	readonly snapshot: RepositorySnapshot | null;
	readonly switchBranch: (name: string) => Promise<void>;
	readonly tab: RepositoryTab;
	readonly toggleAllFiles: () => Promise<void>;
	readonly workspaces: readonly WorkspaceTabState[];
}

const activeSessionFromManager = (
	manager: RepositoryManagerState
): RepositorySessionRecord | null =>
	manager.sessions.find((session) => session.id === manager.activeSessionId) ??
	null;

export const useGitWorkspace = (): GitWorkspace => {
	const [manager, setManager] =
		useState<RepositoryManagerState>(EMPTY_MANAGER_STATE);
	const [workspaceOrder, setWorkspaceOrder] = useState<
		readonly RepositorySessionId[]
	>([]);
	const [sessionSnapshot, setSessionSnapshot] =
		useState<SessionSnapshotState | null>(null);
	const [branches, setBranches] = useState<BranchCollection | null>(null);
	const [history, setHistory] = useState<CommitPage | null>(null);
	const [diff, setDiff] = useState<FileDiff | null>(null);
	const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
	const [selectedCommitOid, setSelectedCommitOid] = useState<string | null>(
		null
	);
	const [tab, setTabState] = useState<RepositoryTab>("changes");
	const [pendingAction, setPendingAction] =
		useState<PendingWorkspaceAction>(null);
	const [isInitialLoading, setIsInitialLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
	const [workspaceSummaries, setWorkspaceSummaries] = useState<
		Readonly<Record<RepositorySessionId, WorkspaceSummary>>
	>({});
	const activeSession = activeSessionFromManager(manager);
	const snapshot = snapshotForSession(
		sessionSnapshot,
		activeSession?.id ?? null
	);
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

	const loadFileDiff = useCallback(
		async (sessionId: RepositorySessionId, file: FileChange): Promise<void> => {
			const result = await window.desktop.git.repository.diff(sessionId, {
				paths: [file.path],
				target: { kind: isFileStaged(file) ? "staged" : "working" },
			});
			setDiff(resultValue(result));
		},
		[]
	);

	const loadCommitDiff = useCallback(
		async (
			sessionId: RepositorySessionId,
			commit: CommitInfo
		): Promise<void> => {
			const result = await window.desktop.git.repository.diff(sessionId, {
				target: { kind: "commit", revision: commit.oid },
			});
			setDiff(resultValue(result));
		},
		[]
	);

	const loadSession = useCallback(
		async (
			session: RepositorySessionRecord,
			preferredFilePath?: string | null,
			preferredCommitOid?: string | null
		): Promise<void> => {
			const [snapshotResult, branchResult, historyResult, remotesResult] =
				await Promise.all([
					window.desktop.git.repository.snapshot(session.id),
					window.desktop.git.branches.list(session.id),
					window.desktop.git.repository.history(session.id, {
						limit: HISTORY_LIMIT,
					}),
					window.desktop.git.remotes.list(session.id),
				]);
			const nextSnapshot = resultValue(snapshotResult);
			const nextBranches = resultValue(branchResult);
			const nextHistory = resultValue(historyResult);
			const nextOwner = remotesResult.ok
				? getRepositoryOwner(remotesResult.value, nextSnapshot.head.upstream)
				: undefined;
			applySnapshot(session.id, nextSnapshot, nextOwner);
			setBranches(nextBranches);
			setHistory(nextHistory);

			if (tab === "history") {
				const commit =
					nextHistory.commits.find((item) => item.oid === preferredCommitOid) ??
					nextHistory.commits[0];
				setSelectedCommitOid(commit?.oid ?? null);
				setSelectedFilePath(null);
				if (commit) {
					await loadCommitDiff(session.id, commit);
				} else {
					setDiff(null);
				}
				return;
			}

			const file =
				nextSnapshot.files.find((item) => item.path === preferredFilePath) ??
				nextSnapshot.files[0];
			setSelectedFilePath(file?.path ?? null);
			setSelectedCommitOid(null);
			if (file) {
				await loadFileDiff(session.id, file);
			} else {
				setDiff(null);
			}
		},
		[applySnapshot, loadCommitDiff, loadFileDiff, tab]
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
					await loadSession(session);
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
	}, [applyManagerState, loadSession]);

	useRepositoryRefresh(activeSession?.id ?? null, () => {
		refresh().catch((cause: unknown) => {
			setError(errorMessage(cause));
		});
	});

	const openRepository = async (path: string): Promise<void> => {
		if (pendingAction) {
			return;
		}
		setPendingAction("open");
		try {
			setError(null);
			const opened = resultValue(
				await window.desktop.git.sessions.open({ path })
			);
			const nextManager = await refreshManager();
			const session =
				nextManager.sessions.find((item) => item.id === opened.session.id) ??
				opened.session;
			applySnapshot(session.id, opened.snapshot);
			setTabState("changes");
			setSelectedCommitOid(null);
			await loadSession(session);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setPendingAction(null);
			setIsInitialLoading(false);
		}
	};

	const pickRepository = async (): Promise<void> => {
		const selection = await window.desktop.git.sessions.pickDirectory();
		if (selection.status === "selected") {
			await openRepository(selection.path);
		}
	};

	const openRecentRepository = async (path: string): Promise<void> => {
		await openRepository(path);
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
			await loadSession(session);
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
			const wasActive = manager.activeSessionId === sessionId;
			const nextManager = managerResultValue(
				await window.desktop.git.sessions.close(sessionId)
			);
			applyManagerState(nextManager);
			setWorkspaceSummaries((current) => {
				const { [sessionId]: _closedSummary, ...remaining } = current;
				return remaining;
			});

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
			setHistory(null);
			setDiff(null);
			setSelectedFilePath(null);
			setSelectedCommitOid(null);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setPendingAction(null);
		}
	};

	const selectFile = async (file: FileChange): Promise<void> => {
		if (!activeSession || pendingAction === "stage") {
			return;
		}
		setSelectedFilePath(file.path);
		setSelectedCommitOid(null);
		try {
			setError(null);
			await loadFileDiff(activeSession.id, file);
		} catch (cause) {
			setError(errorMessage(cause));
		}
	};

	const selectCommit = async (commit: CommitInfo): Promise<void> => {
		if (!activeSession) {
			return;
		}
		setSelectedCommitOid(commit.oid);
		setSelectedFilePath(null);
		try {
			setError(null);
			await loadCommitDiff(activeSession.id, commit);
		} catch (cause) {
			setError(errorMessage(cause));
		}
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
				setSelectedFilePath(null);
				setSelectedCommitOid(commit?.oid ?? null);
				if (commit) {
					await loadCommitDiff(activeSession.id, commit);
				} else {
					setDiff(null);
				}
				return;
			}

			const file = snapshot?.files[0];
			setSelectedCommitOid(null);
			setSelectedFilePath(file?.path ?? null);
			if (file) {
				await loadFileDiff(activeSession.id, file);
			} else {
				setDiff(null);
			}
		} catch (cause) {
			setError(errorMessage(cause));
		}
	};

	const setFileStaged = async (
		file: FileChange,
		shouldStage: boolean
	): Promise<void> => {
		if (!activeSession || pendingAction) {
			return;
		}
		setPendingAction("stage");
		try {
			setError(null);
			const result = shouldStage
				? await window.desktop.git.changes.stage(activeSession.id, {
						paths: [file.path],
					})
				: await window.desktop.git.changes.unstage(activeSession.id, {
						paths: [file.path],
					});
			const nextSnapshot = resultValue(result);
			applySnapshot(activeSession.id, nextSnapshot);
			const nextFile = nextSnapshot.files.find(
				(item) => item.path === file.path
			);
			if (nextFile) {
				await loadFileDiff(activeSession.id, nextFile);
			} else {
				setSelectedFilePath(nextSnapshot.files[0]?.path ?? null);
				setDiff(null);
			}
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setPendingAction(null);
		}
	};

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
			if (nextFile) {
				await loadFileDiff(activeSession.id, nextFile);
			} else {
				setDiff(null);
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
			setDiff(null);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const switchBranch = async (name: string): Promise<void> => {
		if (
			!(activeSession && snapshot) ||
			pendingAction ||
			name === snapshot.head.branch
		) {
			return;
		}
		setPendingAction("branch");
		try {
			setError(null);
			const result = await window.desktop.git.branches.checkout(
				activeSession.id,
				{ name }
			);
			const value = resultValue(result);
			setBranches(value.branches);
			applySnapshot(activeSession.id, value.snapshot);
			await loadSession(activeSession, value.snapshot.files[0]?.path);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setPendingAction(null);
		}
	};

	const createBranch = async (name: string): Promise<boolean> => {
		if (!activeSession || pendingAction || !name.trim()) {
			return false;
		}
		setPendingAction("branch");
		try {
			setError(null);
			const result = await window.desktop.git.branches.create(
				activeSession.id,
				{
					checkout: true,
					name: name.trim(),
				}
			);
			const value = resultValue(result);
			setBranches(value.branches);
			applySnapshot(activeSession.id, value.snapshot);
			await loadSession(activeSession, value.snapshot.files[0]?.path);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setPendingAction(null);
		}
	};

	const fetchRepository = async (): Promise<void> => {
		if (!activeSession || pendingAction) {
			return;
		}
		setPendingAction("fetch");
		try {
			setError(null);
			const result = await window.desktop.git.sync.fetch(activeSession.id, {
				prune: true,
			});
			applySnapshot(activeSession.id, resultValue(result).snapshot);
			setLastFetchedAt(new Date().toISOString());
			await loadSession(activeSession, selectedFilePath, selectedCommitOid);
		} catch (cause) {
			setError(errorMessage(cause));
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
			session,
		});
	}

	return {
		activateWorkspace,
		activeSession,
		branches,
		clearError: () => setError(null),
		closeWorkspace,
		commit: createCommit,
		createBranch,
		diff,
		error,
		fetchRepository,
		history,
		isInitialLoading,
		lastFetchedAt,
		manager,
		openRecentRepository,
		pendingAction,
		pickRepository,
		refresh,
		reorderWorkspace,
		selectCommit,
		selectedCommitOid,
		selectedFilePath,
		selectFile,
		setFileStaged,
		setTab,
		snapshot,
		switchBranch,
		tab,
		toggleAllFiles,
		workspaces,
	};
};
