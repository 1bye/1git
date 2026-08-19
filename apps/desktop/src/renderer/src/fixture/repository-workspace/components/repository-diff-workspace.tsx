import type {
	ChangeHunkInput,
	FileChange,
	FileDiff,
	RepositorySnapshot,
	StashInfo,
} from "@1git/git";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ReactElement } from "react";
import { useCallback, useMemo } from "react";
import type {
	RepositoryBranchComparison,
	RepositoryCleanAction,
} from "@/feature/workspace/lib/repository-clean-state.js";
import { getRepositoryName } from "@/feature/workspace/lib/workspace-model.js";
import type {
	PendingWorkspaceAction,
	RepositoryTab,
} from "@/feature/workspace/types/git-workspace.js";
import { CleanState } from "@/fixture/repository-workspace/components/clean-state.js";
import { DiffView } from "@/fixture/repository-workspace/components/diff-view.js";
import { RepositoryRevisionFileRail } from "@/fixture/repository-workspace/components/repository-revision-rail.js";
import { createRepositoryDiffFileEntries } from "@/fixture/repository-workspace/lib/repository-diff-files.js";
import type { RepositorySessionRecord } from "../../../../../shared/repository-session.js";

const EMPTY_FILE_CHANGES: readonly FileChange[] = [];

export interface RepositoryDiffWorkspaceProps {
	readonly activeSession: RepositorySessionRecord;
	readonly branchComparison: RepositoryBranchComparison | null;
	readonly cleanAction: RepositoryCleanAction | null;
	readonly diffs: readonly FileDiff[];
	readonly ignoreWhitespace: boolean;
	readonly isLoading: boolean;
	readonly onApplyStash: (stash: StashInfo) => Promise<boolean>;
	readonly onCancelSync: () => Promise<void>;
	readonly onChangeHunk: (input: ChangeHunkInput) => Promise<boolean>;
	readonly onCloseBranchComparison: () => void;
	readonly onDropStash: (stash: StashInfo) => Promise<boolean>;
	readonly onOpenBranchComparison: () => Promise<void>;
	readonly onOpenFile: (path: string) => Promise<void>;
	readonly onPopStash: (stash: StashInfo) => Promise<boolean>;
	readonly onPreviewBranchComparison: () => Promise<void>;
	readonly onSelectFile: (file: FileChange) => Promise<void>;
	readonly onSelectRevisionFile: (path: string) => Promise<void>;
	readonly onSync: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly selectedCommitOid: string | null;
	readonly selectedFilePath: string | null;
	readonly selectedStash: StashInfo | null;
	readonly selectedStashOid: string | null;
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

export function RepositoryDiffWorkspace({
	activeSession,
	branchComparison,
	cleanAction,
	diffs,
	ignoreWhitespace,
	isLoading,
	onApplyStash,
	onCancelSync,
	onCloseBranchComparison,
	onChangeHunk,
	onDropStash,
	onSelectFile,
	onSelectRevisionFile,
	onOpenBranchComparison,
	onOpenFile,
	onPopStash,
	onPreviewBranchComparison,
	onSync,
	pendingAction,
	selectedCommitOid,
	selectedFilePath,
	selectedStashOid,
	selectedStash,
	snapshot,
	tab,
}: RepositoryDiffWorkspaceProps): ReactElement {
	const files = snapshot?.files ?? [];
	const isPending = Boolean(pendingAction);
	const revisionOid = selectedCommitOid ?? selectedStashOid ?? undefined;
	const diffFiles = tab === "changes" ? files : EMPTY_FILE_CHANGES;
	const diffEntries = useMemo(
		() => createRepositoryDiffFileEntries(diffs, diffFiles, revisionOid, tab),
		[diffFiles, diffs, revisionOid, tab]
	);
	const selectVisibleFile = useCallback(
		(path: string): void => {
			if (path === selectedFilePath) {
				return;
			}
			if (tab !== "changes" || branchComparison) {
				onSelectRevisionFile(path).catch(() => {
					// The workspace hook exposes the operation error in the app notice.
				});
				return;
			}
			const file = files.find((candidate) => candidate.path === path);
			if (file) {
				onSelectFile(file).catch(() => {
					// The workspace hook exposes the operation error in the app notice.
				});
			}
		},
		[
			branchComparison,
			files,
			onSelectFile,
			onSelectRevisionFile,
			selectedFilePath,
			tab,
		]
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

	let mainContent: ReactElement;
	if (
		tab === "changes" &&
		files.length === 0 &&
		cleanAction &&
		!branchComparison
	) {
		mainContent = (
			<CleanState
				cleanAction={cleanAction}
				onCancelSync={onCancelSync}
				onPreviewComparison={onPreviewBranchComparison}
				onSync={onSync}
				pendingAction={pendingAction}
				snapshot={snapshot}
			/>
		);
	} else if (diffs.length > 0) {
		mainContent = (
			<div className="flex h-full min-h-0 flex-col">
				{branchComparison ? (
					<header className="flex h-11 shrink-0 items-center gap-3 px-4 text-xs">
						<p className="min-w-0 flex-1 truncate text-editor-muted">
							<span className="font-medium text-editor-ink">
								{branchComparison.baseBranch}
							</span>{" "}
							into {branchComparison.headBranch}
						</p>
						<button
							className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-medium outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20"
							onClick={onOpenBranchComparison}
							type="button"
						>
							<ArrowSquareOutIcon aria-hidden className="size-3.5" />
							{branchComparison.browserActionLabel}
						</button>
						<button
							aria-label="Close branch comparison"
							className="flex size-7 items-center justify-center rounded-lg text-editor-muted outline-none hover:bg-hover hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-brand/20"
							onClick={onCloseBranchComparison}
							type="button"
						>
							<XIcon aria-hidden className="size-3.5" weight="bold" />
						</button>
					</header>
				) : null}
				<DiffView
					diffs={diffs}
					emptyDescription={
						branchComparison
							? `No changes between ${branchComparison.baseBranch} and ${branchComparison.headBranch}.`
							: undefined
					}
					emptyTitle={branchComparison ? "Branches match" : undefined}
					entries={diffEntries}
					ignoreWhitespace={ignoreWhitespace}
					isHunkActionPending={pendingAction === "hunk"}
					onActiveFileChange={selectVisibleFile}
					onChangeHunk={branchComparison ? undefined : onChangeHunk}
					onOpenFile={onOpenFile}
					selectedFilePath={selectedFilePath}
					sessionId={activeSession.id}
				/>
			</div>
		);
	} else if (selectedFilePath || selectedCommitOid || selectedStashOid) {
		mainContent = <DiffLoadingState />;
	} else {
		mainContent = <DiffEmptyState />;
	}

	return (
		<section
			className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-editor-surface shadow-[0_1px_2px_rgb(0_0_0/0.03)]"
			data-layout="adaptive"
			data-name="AdaptiveRepositoryWorkspace"
		>
			<RepositoryRevisionFileRail
				diffs={diffs}
				entries={diffEntries}
				isPending={isPending}
				onApplyStash={onApplyStash}
				onDropStash={onDropStash}
				onPopStash={onPopStash}
				onSelectFile={onSelectRevisionFile}
				selectedFilePath={selectedFilePath}
				selectedStash={selectedStash}
				tab={tab}
			/>
			<main
				className="relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden bg-editor-surface"
				data-name="RepositoryDiffCanvas"
			>
				{mainContent}
			</main>
		</section>
	);
}
