import type {
	BranchCollection,
	CommitInfo,
	CommitPage,
	FileChange,
	RepositorySnapshot,
	ResetMode,
	StashInfo,
} from "@1git/git";
import type { ReactElement } from "react";
import { useCallback, useRef } from "react";
import type { RepositoryCommitIdentity } from "@/feature/workspace/lib/repository-commit-identity.js";
import type { RepositoryRecoveryAction } from "@/feature/workspace/lib/repository-recovery.js";
import type { RepositorySyncAction } from "@/feature/workspace/lib/repository-sync.js";
import { isFileStaged } from "@/feature/workspace/lib/workspace-model.js";
import type {
	PendingWorkspaceAction,
	RepositoryTab,
} from "@/feature/workspace/types/git-workspace.js";
import { RepositoryCommitDock } from "@/fixture/repository-workspace/components/repository-commit-dock.js";
import {
	RepositoryFileNavigator,
	RepositoryFileRail,
} from "@/fixture/repository-workspace/components/repository-file-navigator.js";
import { RepositoryHistoryRail } from "@/fixture/repository-workspace/components/repository-history-rail.js";
import { RepositoryStashRail } from "@/fixture/repository-workspace/components/repository-revision-rail.js";
import { RepositoryWorkspaceToolbar } from "@/fixture/repository-workspace/components/repository-workspace-toolbar.js";
import { useRepositoryFileNavigation } from "@/fixture/repository-workspace/hooks/use-repository-file-navigation.js";
import type { RepositorySessionRecord } from "../../../../../shared/repository-session.js";

export interface RepositoryNavigationRailProps {
	readonly activeSession: RepositorySessionRecord;
	readonly branches: BranchCollection | null;
	readonly commitIdentity: RepositoryCommitIdentity | null;
	readonly history: CommitPage | null;
	readonly ignoreWhitespace: boolean;
	readonly isLoading: boolean;
	readonly onAmendCommit: (
		commit: CommitInfo,
		summary: string,
		description: string
	) => Promise<boolean>;
	readonly onApplyStash: (stash: StashInfo) => Promise<boolean>;
	readonly onCancelSync: () => Promise<void>;
	readonly onCherryPickCommit: (
		commit: CommitInfo,
		branchName: string
	) => Promise<boolean>;
	readonly onCommit: (
		summary: string,
		description: string,
		identity?: RepositoryCommitIdentity
	) => Promise<boolean>;
	readonly onCreateBranch: (
		name: string,
		startPoint?: string
	) => Promise<boolean>;
	readonly onDiscardFiles: (files: readonly FileChange[]) => Promise<boolean>;
	readonly onDropStash: (stash: StashInfo) => Promise<boolean>;
	readonly onMergeBranch: (name: string) => Promise<boolean>;
	readonly onOpenInEditor: () => Promise<void>;
	readonly onPopStash: (stash: StashInfo) => Promise<boolean>;
	readonly onRecover: (action: RepositoryRecoveryAction) => Promise<boolean>;
	readonly onResetCommit: (
		commit: CommitInfo,
		mode: ResetMode
	) => Promise<boolean>;
	readonly onRevertCommit: (commit: CommitInfo) => Promise<boolean>;
	readonly onSelectCommit: (commit: CommitInfo) => Promise<void>;
	readonly onSelectFile: (file: FileChange) => Promise<void>;
	readonly onSelectStash: (stash: StashInfo) => Promise<void>;
	readonly onSetFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<boolean>;
	readonly onSetFilesStaged: (
		files: readonly FileChange[],
		shouldStage: boolean
	) => Promise<boolean>;
	readonly onSetIgnoreWhitespace: (ignoreWhitespace: boolean) => void;
	readonly onSetTab: (tab: RepositoryTab) => Promise<void>;
	readonly onStashChanges: () => Promise<boolean>;
	readonly onSync: () => Promise<void>;
	readonly onToggleAllFiles: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly selectedCommitOid: string | null;
	readonly selectedFilePath: string | null;
	readonly selectedStashOid: string | null;
	readonly snapshot: RepositorySnapshot | null;
	readonly stashes: readonly StashInfo[];
	readonly syncAction: RepositorySyncAction | null;
	readonly tab: RepositoryTab;
}

export function RepositoryNavigationRail({
	activeSession,
	branches,
	commitIdentity,
	history,
	ignoreWhitespace,
	isLoading,
	onAmendCommit,
	onApplyStash,
	onCherryPickCommit,
	onCreateBranch,
	onCommit,
	onCancelSync,
	onDiscardFiles,
	onDropStash,
	onMergeBranch,
	onOpenInEditor,
	onPopStash,
	onRecover,
	onResetCommit,
	onRevertCommit,
	onSelectCommit,
	onSelectFile,
	onSelectStash,
	onSetFileStaged,
	onSetFilesStaged,
	onSetIgnoreWhitespace,
	onSetTab,
	onStashChanges,
	onSync,
	onToggleAllFiles,
	pendingAction,
	selectedCommitOid,
	selectedFilePath,
	selectedStashOid,
	snapshot,
	stashes,
	syncAction,
	tab,
}: RepositoryNavigationRailProps): ReactElement {
	const files = snapshot?.files ?? [];
	const discardFilesRef = useRef(onDiscardFiles);
	const selectFileRef = useRef(onSelectFile);
	const setFileStagedRef = useRef(onSetFileStaged);
	const setFilesStagedRef = useRef(onSetFilesStaged);
	discardFilesRef.current = onDiscardFiles;
	selectFileRef.current = onSelectFile;
	setFileStagedRef.current = onSetFileStaged;
	setFilesStagedRef.current = onSetFilesStaged;
	const discardFiles = useCallback(
		(filesToDiscard: readonly FileChange[]): Promise<boolean> =>
			discardFilesRef.current(filesToDiscard),
		[]
	);
	const setFileStaged = useCallback(
		(file: FileChange, shouldStage: boolean): Promise<boolean> =>
			setFileStagedRef.current(file, shouldStage),
		[]
	);
	const setFilesStaged = useCallback(
		(
			filesToStage: readonly FileChange[],
			shouldStage: boolean
		): Promise<boolean> => setFilesStagedRef.current(filesToStage, shouldStage),
		[]
	);
	const requestChanges = useCallback(async (): Promise<void> => {
		await onSetTab("changes");
	}, [onSetTab]);
	const selectFileAndReveal = useCallback(
		async (file: FileChange): Promise<void> => {
			await selectFileRef.current(file);
		},
		[]
	);
	const navigation = useRepositoryFileNavigation({
		files,
		onRequestChanges: requestChanges,
		onSelectFile: selectFileAndReveal,
		selectedFilePath,
		sessionId: activeSession.id,
		tab,
	});

	if (!(snapshot && syncAction) || isLoading) {
		return (
			<aside
				aria-busy="true"
				className="w-(--repository-rail-width) shrink-0 bg-transparent"
				data-desktop-drag
				data-name="RepositoryNavigationRail"
			/>
		);
	}

	const stagedCount = files.filter(isFileStaged).length;
	let content: ReactElement;
	if (tab === "history") {
		content = (
			<RepositoryHistoryRail
				branches={branches}
				currentBranch={snapshot.head.branch}
				headOid={snapshot.head.oid}
				history={history}
				isPending={pendingAction !== null}
				onAmendCommit={onAmendCommit}
				onCherryPickCommit={onCherryPickCommit}
				onCreateBranch={onCreateBranch}
				onResetCommit={onResetCommit}
				onRevertCommit={onRevertCommit}
				onSelectCommit={onSelectCommit}
				selectedCommitOid={selectedCommitOid}
			/>
		);
	} else if (tab === "stashes") {
		content = (
			<RepositoryStashRail
				isPending={pendingAction !== null}
				onSelectStash={onSelectStash}
				selectedStashOid={selectedStashOid}
				stashes={stashes}
			/>
		);
	} else {
		content = (
			<>
				<RepositoryFileRail
					allFiles={files}
					navigation={navigation}
					onDiscardFiles={discardFiles}
					onSetFileStaged={setFileStaged}
					onSetFilesStaged={setFilesStaged}
					pendingAction={pendingAction}
					repositoryRoot={activeSession.repository.root}
					selectedFilePath={selectedFilePath}
				/>
				{files.length > 0 ? (
					<RepositoryCommitDock
						branch={snapshot.head.branch}
						commitIdentity={commitIdentity}
						isPending={pendingAction === "commit"}
						onCommit={onCommit}
						stagedCount={stagedCount}
					/>
				) : null}
			</>
		);
	}

	return (
		<aside
			className="relative isolate z-20 flex min-h-0 w-(--repository-rail-width) shrink-0 flex-col bg-transparent"
			data-desktop-drag
			data-name="RepositoryNavigationRail"
		>
			<RepositoryWorkspaceToolbar
				branches={branches}
				ignoreWhitespace={ignoreWhitespace}
				onApplyStash={onApplyStash}
				onCancelSync={onCancelSync}
				onDropStash={onDropStash}
				onMergeBranch={onMergeBranch}
				onOpenInEditor={onOpenInEditor}
				onPopStash={onPopStash}
				onRecover={onRecover}
				onSetIgnoreWhitespace={onSetIgnoreWhitespace}
				onSetTab={onSetTab}
				onStashChanges={onStashChanges}
				onSync={onSync}
				onToggleAllFiles={onToggleAllFiles}
				pendingAction={pendingAction}
				snapshot={snapshot}
				stashes={stashes}
				syncAction={syncAction}
				tab={tab}
			/>
			{tab === "changes" ? (
				<RepositoryFileNavigator
					navigation={navigation}
					onDiscardFiles={discardFiles}
					onSetFileStaged={setFileStaged}
					onSetFilesStaged={setFilesStaged}
					pendingAction={pendingAction}
					repositoryRoot={activeSession.repository.root}
					selectedFilePath={selectedFilePath}
				/>
			) : null}
			{content}
		</aside>
	);
}
