import type {
	BranchCollection,
	CommitInfo,
	CommitPage,
	FileChange,
	FileDiff,
	RepositorySnapshot,
	ResetMode,
	StashInfo,
} from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import type { ReactElement } from "react";
import { useCallback } from "react";
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
import {
	RepositoryRevisionFileRail,
	RepositoryStashRail,
} from "@/fixture/repository-workspace/components/repository-revision-rail.js";
import { RepositoryWorkspaceToolbar } from "@/fixture/repository-workspace/components/repository-workspace-toolbar.js";
import { useRepositoryFileNavigation } from "@/fixture/repository-workspace/hooks/use-repository-file-navigation.js";
import { getRepositoryDiffElementId } from "@/fixture/repository-workspace/lib/repository-navigation.js";
import { scrollElementIntoViewport } from "@/fixture/repository-workspace/lib/scroll-element-into-viewport.js";
import type { RepositorySessionRecord } from "../../../../../shared/repository-session.js";

export interface RepositoryNavigationRailProps {
	readonly activeSession: RepositorySessionRecord;
	readonly branches: BranchCollection | null;
	readonly diffs: readonly FileDiff[];
	readonly history: CommitPage | null;
	readonly isLoading: boolean;
	readonly isRevisionDetailOpen: boolean;
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
	readonly onCommit: (summary: string, description: string) => Promise<boolean>;
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
	readonly onRevisionDetailOpenChange: (isOpen: boolean) => void;
	readonly onSelectCommit: (commit: CommitInfo) => Promise<void>;
	readonly onSelectFile: (file: FileChange) => Promise<void>;
	readonly onSelectRevisionFile: (path: string) => Promise<void>;
	readonly onSelectStash: (stash: StashInfo) => Promise<void>;
	readonly onSetFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<boolean>;
	readonly onSetFilesStaged: (
		files: readonly FileChange[],
		shouldStage: boolean
	) => Promise<boolean>;
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
	diffs,
	history,
	isLoading,
	isRevisionDetailOpen,
	onAmendCommit,
	onApplyStash,
	onCherryPickCommit,
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
	onRevisionDetailOpenChange,
	onSelectCommit,
	onSelectFile,
	onSelectRevisionFile,
	onSelectStash,
	onSetFileStaged,
	onSetFilesStaged,
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
	const requestChanges = useCallback(async (): Promise<void> => {
		await onSetTab("changes");
	}, [onSetTab]);
	const selectFileAndReveal = useCallback(
		async (file: FileChange): Promise<void> => {
			await onSelectFile(file);
			const diffElement = document.getElementById(
				getRepositoryDiffElementId(file.path)
			);
			const diffViewport = diffElement?.closest<HTMLElement>(
				"[data-repository-diff-viewport]"
			);
			if (diffElement && diffViewport) {
				scrollElementIntoViewport(diffViewport, diffElement, {
					block: "start",
				});
			}
		},
		[onSelectFile]
	);
	const navigation = useRepositoryFileNavigation({
		files,
		onRequestChanges: requestChanges,
		onSelectFile: selectFileAndReveal,
		selectedFilePath,
		sessionId: activeSession.id,
		tab,
	});
	const selectedCommit =
		history?.commits.find((commit) => commit.oid === selectedCommitOid) ?? null;
	const selectedStash =
		stashes.find((stash) => stash.oid === selectedStashOid) ?? null;
	const isRevisionTab = tab === "history" || tab === "stashes";
	const isStackOpen = isRevisionTab && isRevisionDetailOpen;
	const revisionTitle =
		(tab === "history" ? selectedCommit?.summary : selectedStash?.summary) ??
		"Selected revision";
	const selectCommitAndOpen = useCallback(
		async (commit: CommitInfo): Promise<void> => {
			if (commit.oid !== selectedCommitOid) {
				await onSelectCommit(commit);
			}
			onRevisionDetailOpenChange(true);
		},
		[onRevisionDetailOpenChange, onSelectCommit, selectedCommitOid]
	);
	const selectStashAndOpen = useCallback(
		async (stash: StashInfo): Promise<void> => {
			if (stash.oid !== selectedStashOid) {
				await onSelectStash(stash);
			}
			onRevisionDetailOpenChange(true);
		},
		[onRevisionDetailOpenChange, onSelectStash, selectedStashOid]
	);
	const closeRevisionDetail = useCallback((): void => {
		onRevisionDetailOpenChange(false);
	}, [onRevisionDetailOpenChange]);

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
				onResetCommit={onResetCommit}
				onRevertCommit={onRevertCommit}
				onSelectCommit={selectCommitAndOpen}
				selectedCommitOid={selectedCommitOid}
			/>
		);
	} else if (tab === "stashes") {
		content = (
			<RepositoryStashRail
				isPending={pendingAction !== null}
				onSelectStash={selectStashAndOpen}
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
					onDiscardFiles={onDiscardFiles}
					onSetFileStaged={onSetFileStaged}
					onSetFilesStaged={onSetFilesStaged}
					pendingAction={pendingAction}
					repositoryRoot={activeSession.repository.root}
					selectedFilePath={selectedFilePath}
				/>
				{files.length > 0 ? (
					<RepositoryCommitDock
						branch={snapshot.head.branch}
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
				onApplyStash={onApplyStash}
				onCancelSync={onCancelSync}
				onDropStash={onDropStash}
				onMergeBranch={onMergeBranch}
				onOpenInEditor={onOpenInEditor}
				onPopStash={onPopStash}
				onRecover={onRecover}
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
					onDiscardFiles={onDiscardFiles}
					onSetFileStaged={onSetFileStaged}
					onSetFilesStaged={onSetFilesStaged}
					pendingAction={pendingAction}
					repositoryRoot={activeSession.repository.root}
					selectedFilePath={selectedFilePath}
				/>
			) : null}
			<div className="relative min-h-0 flex-1 overflow-hidden">
				<div
					aria-hidden={isStackOpen ? true : undefined}
					className={cn(
						"absolute inset-0 flex min-h-0 flex-col transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
						isStackOpen
							? "-translate-x-2 scale-[0.985] opacity-25"
							: "translate-x-0 scale-100 opacity-100"
					)}
					data-name="RepositoryRevisionMasterLayer"
					inert={isStackOpen ? true : undefined}
				>
					{content}
				</div>
				<RepositoryRevisionFileRail
					diffs={diffs}
					isOpen={isStackOpen}
					isPending={pendingAction !== null}
					onApplyStash={onApplyStash}
					onBack={closeRevisionDetail}
					onDropStash={onDropStash}
					onPopStash={onPopStash}
					onSelectFile={onSelectRevisionFile}
					revisionTitle={revisionTitle}
					selectedFilePath={selectedFilePath}
					selectedStash={selectedStash}
					tab={tab}
				/>
			</div>
		</aside>
	);
}
