import type {
	BranchCollection,
	CommitInfo,
	CommitPage,
	FileChange,
	RepositorySnapshot,
	ResetMode,
} from "@1git/git";
import type { ReactElement } from "react";
import { useCallback } from "react";
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
import { RepositoryWorkspaceToolbar } from "@/fixture/repository-workspace/components/repository-workspace-toolbar.js";
import { useRepositoryFileNavigation } from "@/fixture/repository-workspace/hooks/use-repository-file-navigation.js";
import { getRepositoryDiffElementId } from "@/fixture/repository-workspace/lib/repository-navigation.js";
import { scrollElementIntoViewport } from "@/fixture/repository-workspace/lib/scroll-element-into-viewport.js";
import type { RepositorySessionRecord } from "../../../../../shared/repository-session.js";

export interface RepositoryNavigationRailProps {
	readonly activeSession: RepositorySessionRecord;
	readonly branches: BranchCollection | null;
	readonly history: CommitPage | null;
	readonly isLoading: boolean;
	readonly onAmendCommit: (
		commit: CommitInfo,
		summary: string,
		description: string
	) => Promise<boolean>;
	readonly onCancelSync: () => Promise<void>;
	readonly onCherryPickCommit: (
		commit: CommitInfo,
		branchName: string
	) => Promise<boolean>;
	readonly onCommit: (summary: string, description: string) => Promise<boolean>;
	readonly onDiscardFiles: (files: readonly FileChange[]) => Promise<boolean>;
	readonly onMergeBranch: (name: string) => Promise<boolean>;
	readonly onResetCommit: (
		commit: CommitInfo,
		mode: ResetMode
	) => Promise<boolean>;
	readonly onRevertCommit: (commit: CommitInfo) => Promise<boolean>;
	readonly onSelectCommit: (commit: CommitInfo) => Promise<void>;
	readonly onSelectFile: (file: FileChange) => Promise<void>;
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
	readonly snapshot: RepositorySnapshot | null;
	readonly syncAction: RepositorySyncAction | null;
	readonly tab: RepositoryTab;
}

export function RepositoryNavigationRail({
	activeSession,
	branches,
	history,
	isLoading,
	onAmendCommit,
	onCherryPickCommit,
	onCommit,
	onCancelSync,
	onDiscardFiles,
	onMergeBranch,
	onResetCommit,
	onRevertCommit,
	onSelectCommit,
	onSelectFile,
	onSetFileStaged,
	onSetFilesStaged,
	onSetTab,
	onStashChanges,
	onSync,
	onToggleAllFiles,
	pendingAction,
	selectedCommitOid,
	selectedFilePath,
	snapshot,
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
				onSelectCommit={onSelectCommit}
				selectedCommitOid={selectedCommitOid}
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
				onCancelSync={onCancelSync}
				onMergeBranch={onMergeBranch}
				onSetTab={onSetTab}
				onStashChanges={onStashChanges}
				onSync={onSync}
				onToggleAllFiles={onToggleAllFiles}
				pendingAction={pendingAction}
				snapshot={snapshot}
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
			{content}
		</aside>
	);
}
