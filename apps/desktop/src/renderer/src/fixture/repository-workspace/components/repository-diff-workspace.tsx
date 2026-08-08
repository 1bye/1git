import type {
	ChangeHunkInput,
	CommitPage,
	FileChange,
	FileDiff,
	RepositorySnapshot,
} from "@1git/git";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type { ReactElement } from "react";
import { useCallback } from "react";
import { getRepositoryName } from "@/feature/workspace/lib/workspace-model.js";
import type {
	PendingWorkspaceAction,
	RepositoryTab,
} from "@/feature/workspace/types/git-workspace.js";
import { CleanState } from "@/fixture/repository-workspace/components/clean-state.js";
import { DiffView } from "@/fixture/repository-workspace/components/diff-view.js";
import type { RepositorySessionRecord } from "../../../../../shared/repository-session.js";

export interface RepositoryDiffWorkspaceProps {
	readonly activeSession: RepositorySessionRecord;
	readonly diffs: readonly FileDiff[];
	readonly history: CommitPage | null;
	readonly isFetching: boolean;
	readonly isLoading: boolean;
	readonly onChangeHunk: (input: ChangeHunkInput) => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onSelectFile: (file: FileChange) => Promise<void>;
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

export function RepositoryDiffWorkspace({
	activeSession,
	diffs,
	history,
	isFetching,
	isLoading,
	onChangeHunk,
	onFetch,
	onSelectFile,
	pendingAction,
	selectedCommitOid,
	selectedFilePath,
	snapshot,
	tab,
}: RepositoryDiffWorkspaceProps): ReactElement {
	const files = snapshot?.files ?? [];
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
				isHunkActionPending={pendingAction === "hunk"}
				onActiveFileChange={selectVisibleFile}
				onChangeHunk={onChangeHunk}
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

	return (
		<section
			className="flex min-h-0 min-w-0 flex-1 bg-transparent"
			data-layout="adaptive"
			data-name="AdaptiveRepositoryWorkspace"
		>
			<main
				className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-editor-hairline-strong bg-editor-surface shadow-[0_1px_2px_rgb(0_0_0/0.03)]"
				data-name="RepositoryDiffWorkspace"
			>
				{mainContent}
			</main>
		</section>
	);
}
