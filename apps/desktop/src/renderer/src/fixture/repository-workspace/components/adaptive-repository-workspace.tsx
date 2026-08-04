import type {
	BranchCollection,
	CommitInfo,
	CommitPage,
	FileChange,
	FileDiff,
	RepositorySnapshot,
} from "@1git/git";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type { ReactElement } from "react";
import { useCallback } from "react";
import type {
	PendingWorkspaceAction,
	RepositoryTab,
} from "@/feature/workspace/hooks/use-git-workspace.js";
import {
	getRepositoryName,
	isFileStaged,
} from "@/feature/workspace/lib/workspace-model.js";
import { RepositoryCommitDock } from "@/fixture/repository-workspace/components/repository-commit-dock.js";
import { RepositoryFileRail } from "@/fixture/repository-workspace/components/repository-file-navigator.js";
import { RepositoryHistoryRail } from "@/fixture/repository-workspace/components/repository-history-rail.js";
import { RepositoryWorkspaceToolbar } from "@/fixture/repository-workspace/components/repository-workspace-toolbar.js";
import { useRepositoryFileNavigation } from "@/fixture/repository-workspace/hooks/use-repository-file-navigation.js";
import { getRepositoryDiffElementId } from "@/fixture/repository-workspace/lib/repository-navigation.js";
import { CleanState } from "@/fixture/workspace-content/components/clean-state.js";
import { DiffView } from "@/fixture/workspace-content/components/diff-view.js";
import type { RepositorySessionRecord } from "../../../../../shared/repository-session.js";

export interface AdaptiveRepositoryWorkspaceProps {
	readonly activeSession: RepositorySessionRecord;
	readonly branches: BranchCollection | null;
	readonly diffs: readonly FileDiff[];
	readonly history: CommitPage | null;
	readonly isFetching: boolean;
	readonly isLoading: boolean;
	readonly onCommit: (summary: string, description: string) => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onMergeBranch: (name: string) => Promise<boolean>;
	readonly onSelectCommit: (commit: CommitInfo) => Promise<void>;
	readonly onSelectFile: (file: FileChange) => Promise<void>;
	readonly onSetFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly onSetTab: (tab: RepositoryTab) => Promise<void>;
	readonly onStashChanges: () => Promise<boolean>;
	readonly onToggleAllFiles: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly selectedCommitOid: string | null;
	readonly selectedFilePath: string | null;
	readonly snapshot: RepositorySnapshot | null;
	readonly tab: RepositoryTab;
}

const DiffLoadingState = (): ReactElement => (
	<section
		aria-busy="true"
		className="flex min-h-full items-center justify-center"
		data-name="RepositoryDiffLoading"
	>
		<p
			className="flex items-center gap-2 text-editor-faint text-xss"
			role="status"
		>
			<SpinnerGapIcon
				aria-hidden
				className="size-4 animate-spin"
				weight="bold"
			/>
			Loading diff
		</p>
	</section>
);

const DiffEmptyState = (): ReactElement => (
	<section
		className="flex min-h-full items-center justify-center px-8 py-16 text-center"
		data-name="RepositoryDiffEmpty"
	>
		<div>
			<GitDiffIcon
				aria-hidden
				className="mx-auto size-6 text-editor-faint"
				weight="duotone"
			/>
			<h1 className="mt-3 font-medium text-[13px] text-editor-ink">
				Select an item to inspect
			</h1>
			<p className="mt-1 text-editor-faint text-xss">
				Choose a changed file or commit to preview its diff.
			</p>
		</div>
	</section>
);

export function AdaptiveRepositoryWorkspace({
	activeSession,
	branches,
	diffs,
	history,
	isFetching,
	isLoading,
	onCommit,
	onFetch,
	onMergeBranch,
	onSelectCommit,
	onSelectFile,
	onSetFileStaged,
	onSetTab,
	onStashChanges,
	onToggleAllFiles,
	pendingAction,
	selectedCommitOid,
	selectedFilePath,
	snapshot,
	tab,
}: AdaptiveRepositoryWorkspaceProps): ReactElement {
	const requestChanges = useCallback(async (): Promise<void> => {
		await onSetTab("changes");
	}, [onSetTab]);
	const files = snapshot?.files ?? [];
	const selectFileAndReveal = useCallback(
		async (file: FileChange): Promise<void> => {
			await onSelectFile(file);
			document
				.getElementById(getRepositoryDiffElementId(file.path))
				?.scrollIntoView({ block: "start" });
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
	const selectVisibleFile = useCallback(
		(path: string): void => {
			if (path === selectedFilePath) {
				return;
			}
			const file = files.find((candidate) => candidate.path === path);
			if (file) {
				onSelectFile(file).catch(() => {
					// The workspace hook exposes the operation error in the app notice.
				});
			}
		},
		[files, onSelectFile, selectedFilePath]
	);

	if (!snapshot || isLoading) {
		return (
			<main
				aria-busy="true"
				className="flex min-h-0 flex-1 items-center justify-center bg-editor-surface"
				data-name="RepositoryWorkspaceLoading"
			>
				<p
					className="flex items-center gap-2 text-editor-faint text-xss"
					role="status"
				>
					<SpinnerGapIcon
						aria-hidden
						className="size-5 animate-spin"
						weight="bold"
					/>
					<span className="sr-only">
						Loading {getRepositoryName(activeSession.repository.root)}
					</span>
				</p>
			</main>
		);
	}

	const historyCommit =
		history?.commits.find((commit) => commit.oid === selectedCommitOid) ?? null;
	const stagedCount = files.filter(isFileStaged).length;
	let mainContent: ReactElement;
	if (tab === "changes" && files.length === 0) {
		mainContent = (
			<CleanState
				isFetching={isFetching}
				onFetch={onFetch}
				snapshot={snapshot}
			/>
		);
	} else if (diffs.length > 0) {
		mainContent = (
			<DiffView
				commit={historyCommit}
				diffs={diffs}
				files={files}
				onActiveFileChange={selectVisibleFile}
				selectedFilePath={selectedFilePath}
				sessionId={activeSession.id}
				tab={tab}
			/>
		);
	} else if (selectedFilePath || selectedCommitOid) {
		mainContent = <DiffLoadingState />;
	} else {
		mainContent = <DiffEmptyState />;
	}
	let navigationRail: ReactElement | null = null;
	if (tab === "history") {
		navigationRail = (
			<RepositoryHistoryRail
				history={history}
				onSelectCommit={onSelectCommit}
				selectedCommitOid={selectedCommitOid}
			/>
		);
	} else {
		navigationRail = (
			<>
				<RepositoryFileRail
					allFiles={files}
					navigation={navigation}
					onSetFileStaged={onSetFileStaged}
					onToggleAllFiles={onToggleAllFiles}
					pendingAction={pendingAction}
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
		<section
			className="flex min-h-0 min-w-0 flex-1 bg-editor-surface"
			data-layout="adaptive"
			data-name="AdaptiveRepositoryWorkspace"
		>
			<div
				className="flex w-[310px] shrink-0 flex-col bg-editor-surface"
				data-name="RepositoryNavigationRail"
			>
				<RepositoryWorkspaceToolbar
					branches={branches}
					navigation={navigation}
					onFetch={onFetch}
					onMergeBranch={onMergeBranch}
					onSetFileStaged={onSetFileStaged}
					onSetTab={onSetTab}
					onStashChanges={onStashChanges}
					onToggleAllFiles={onToggleAllFiles}
					pendingAction={pendingAction}
					selectedFilePath={selectedFilePath}
					snapshot={snapshot}
					tab={tab}
				/>
				{navigationRail}
			</div>
			<main
				className="min-h-0 min-w-0 flex-1 overflow-hidden bg-editor-surface"
				data-name="RepositoryDiffWorkspace"
			>
				{mainContent}
			</main>
		</section>
	);
}
