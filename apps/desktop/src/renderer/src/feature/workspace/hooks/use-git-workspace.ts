import type {
	BranchCollection,
	ChangeHunkInput,
	CommitInfo,
	CommitPage,
	FileChange,
	FileDiff,
	GitError,
	GitResult,
	RepositorySnapshot,
	ResetMode,
} from "@1git/git";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRepositoryRefresh } from "@/feature/workspace/hooks/use-repository-refresh.js";
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

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : "The repository operation failed.";

const fileNameFromPath = (path: string): string =>
	path.split("/").at(-1) ?? path;

interface WorkspaceSummary {
	readonly branch: string | null;
	readonly changedFiles: number;
	readonly owner: RepositoryOwner | null;
}

interface HistoryActionResult {
	readonly selectedCommitOid: string | null;
	readonly snapshot: RepositorySnapshot;
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
	const [diffs, setDiffs] = useState<readonly FileDiff[]>([]);
	const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
	const [selectedCommitOid, setSelectedCommitOid] = useState<string | null>(
		null
	);
	const [tab, setTabState] = useState<RepositoryTab>("changes");
	const [pendingAction, setPendingAction] =
		useState<PendingWorkspaceAction>(null);
	const [isInitialLoading, setIsInitialLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [discardUndo, setDiscardUndo] = useState<WorkspaceDiscardUndo | null>(
		null
	);
	const [workspaceSummaries, setWorkspaceSummaries] = useState<
		Readonly<Record<RepositorySessionId, WorkspaceSummary>>
	>({});
	const diffRequestIdRef = useRef(0);
	const stagedOnFirstPresentationRef = useRef(new Set<RepositorySessionId>());
	const managerActiveSession = activeSessionFromManager(manager);
	const snapshotSession = sessionForSnapshot(sessionSnapshot, manager.sessions);
	const activeSession = presentedSession(
		managerActiveSession,
		snapshotSession,
		pendingAction === "workspace"
	);
	const presentedSessionId = activeSession ? activeSession.id : null;
	const stageOnFirstPresentation = useCallback(
		async (
			sessionId: RepositorySessionId
		): Promise<RepositorySnapshot | null> => {
			if (stagedOnFirstPresentationRef.current.has(sessionId)) {
				return null;
			}
			stagedOnFirstPresentationRef.current.add(sessionId);
			try {
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
			files: readonly FileChange[]
		): Promise<void> => {
			const requestId = diffRequestIdRef.current + 1;
			diffRequestIdRef.current = requestId;
			const paths = groupRepositoryDiffPaths(files);
			const requests: Promise<GitResult<FileDiff>>[] = [];
			if (paths.staged.length > 0) {
				requests.push(
					window.desktop.git.repository.diff(sessionId, {
						paths: paths.staged,
						target: { kind: "staged" },
					})
				);
			}
			if (paths.working.length > 0) {
				requests.push(
					window.desktop.git.repository.diff(sessionId, {
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
		},
		[]
	);

	const loadCommitDiff = useCallback(
		async (
			sessionId: RepositorySessionId,
			commit: CommitInfo
		): Promise<void> => {
			const requestId = diffRequestIdRef.current + 1;
			diffRequestIdRef.current = requestId;
			const result = await window.desktop.git.repository.diff(sessionId, {
				target: { kind: "commit", revision: commit.oid },
			});
			if (requestId !== diffRequestIdRef.current) {
				return;
			}
			setDiffs([resultValue(result)]);
		},
		[]
	);
	const clearDiff = useCallback((): void => {
		diffRequestIdRef.current += 1;
		setDiffs([]);
	}, []);
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
					clearDiff();
				}
				return;
			}

			const file =
				nextSnapshot.files.find((item) => item.path === preferredFilePath) ??
				nextSnapshot.files[0];
			setSelectedFilePath(file?.path ?? null);
			setSelectedCommitOid(null);
			if (nextSnapshot.files.length > 0) {
				await loadChangesDiff(session.id, nextSnapshot.files);
			} else {
				clearDiff();
			}
		},
		[applySnapshot, clearDiff, loadChangesDiff, loadCommitDiff, tab]
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
					await stageOnFirstPresentation(session.id);
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
	}, [applyManagerState, loadSession, stageOnFirstPresentation]);

	useRepositoryRefresh(presentedSessionId, () => {
		refresh().catch((cause: unknown) => {
			setError(errorMessage(cause));
		});
	});

	const finishOpeningRepository = async (
		opened: OpenedRepositorySession,
		activate: boolean
	): Promise<void> => {
		const stagedSnapshot =
			(await stageOnFirstPresentation(opened.session.id)) ?? opened.snapshot;
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
		await loadSession(session);
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
			await stageOnFirstPresentation(session.id);
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
			clearDiff();
			setSelectedFilePath(null);
			setSelectedCommitOid(null);
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
		return Promise.resolve();
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
					clearDiff();
				}
				return;
			}

			const file = snapshot?.files[0];
			setSelectedCommitOid(null);
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
			await loadSession(activeSession, selectedFilePath, selectedCommitOid);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setPendingAction(null);
		}
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
			await loadSession(activeSession);
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
			session,
		});
	}

	return {
		activateWorkspace,
		activeSession,
		amendCommit,
		branches,
		changeHunk,
		cherryPickCommit,
		clearError: () => setError(null),
		cloneRepository,
		closeWorkspace,
		commit: createCommit,
		createBranch,
		createRepository,
		diffs,
		discardFiles,
		discardUndo,
		dismissDiscardUndo,
		error,
		fetchRepository,
		forgetRecentRepository,
		history,
		isInitialLoading,
		manager,
		mergeBranch,
		openRecentRepository,
		pendingAction,
		pickRepository,
		reorderWorkspace,
		resetToCommit,
		revertCommit,
		selectCommit,
		selectedCommitOid,
		selectedFilePath,
		selectFile,
		setFileStaged,
		setFilesStaged,
		setTab,
		snapshot,
		stashChanges,
		switchBranch,
		tab,
		toggleAllFiles,
		undoDiscard,
		workspaces,
	};
};
