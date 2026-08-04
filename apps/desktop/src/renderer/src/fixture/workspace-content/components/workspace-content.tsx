import type { CommitInfo, FileDiff, RepositorySnapshot } from "@1git/git";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type { ReactElement } from "react";
import type {
	OpenRepositoryOptions,
	RepositoryTab,
	WorkspaceTabState,
} from "@/feature/workspace/hooks/use-git-workspace.js";
import { getRepositoryName } from "@/feature/workspace/lib/workspace-model.js";
import { CleanState } from "@/fixture/workspace-content/components/clean-state.js";
import { DiffView } from "@/fixture/workspace-content/components/diff-view.js";
import { RepositoryWelcome } from "@/fixture/workspace-content/components/repository-welcome.js";
import type {
	RecentRepositoryRecord,
	RepositorySessionRecord,
} from "../../../../../shared/repository-session.js";

interface WorkspaceContentProps {
	readonly activeSession: RepositorySessionRecord | null;
	readonly diffs: readonly FileDiff[];
	readonly historyCommit: CommitInfo | null;
	readonly isFetching: boolean;
	readonly isRepositoryLoading: boolean;
	readonly onCloneRepository: (remoteUrl: string) => Promise<boolean>;
	readonly onCreateRepository: () => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onForgetRecent: (path: string) => Promise<void>;
	readonly onOpenRecent: (
		path: string,
		options?: OpenRepositoryOptions
	) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
	readonly selectedFilePath: string | null;
	readonly snapshot: RepositorySnapshot | null;
	readonly tab: RepositoryTab;
	readonly workspaces: readonly WorkspaceTabState[];
}

export function WorkspaceContent({
	activeSession,
	diffs,
	historyCommit,
	isFetching,
	isRepositoryLoading,
	onCloneRepository,
	onCreateRepository,
	onFetch,
	onForgetRecent,
	onOpenRecent,
	onPickRepository,
	recentRepositories,
	selectedFilePath,
	snapshot,
	tab,
	workspaces,
}: WorkspaceContentProps): ReactElement {
	if (!activeSession) {
		return (
			<RepositoryWelcome
				isLoading={isRepositoryLoading}
				onCloneRepository={onCloneRepository}
				onCreateRepository={onCreateRepository}
				onForgetRecent={onForgetRecent}
				onOpenRecent={onOpenRecent}
				onPickRepository={onPickRepository}
				recentRepositories={recentRepositories}
				workspaces={workspaces}
			/>
		);
	}

	if (!snapshot) {
		return (
			<main
				aria-busy="true"
				className="flex min-h-0 flex-1 items-center justify-center bg-editor-surface"
				data-name="WorkspaceLoading"
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

	if (tab === "changes" && snapshot.files.length === 0) {
		return (
			<main
				className="min-h-0 flex-1 overflow-y-auto bg-editor-surface"
				data-name="WorkspaceContent"
			>
				<CleanState
					isFetching={isFetching}
					onFetch={onFetch}
					snapshot={snapshot}
				/>
			</main>
		);
	}

	return (
		<main
			className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-editor-surface"
			data-name="WorkspaceContent"
		>
			{diffs.length > 0 ? (
				<DiffView
					commit={historyCommit}
					diffs={diffs}
					files={snapshot.files}
					selectedFilePath={selectedFilePath}
					tab={tab}
				/>
			) : (
				<section
					className="flex min-h-full items-center justify-center px-8 py-16 text-center"
					data-name="DiffEmptyState"
				>
					<div>
						<GitDiffIcon
							aria-hidden
							className="mx-auto size-6 text-editor-faint"
							weight="regular"
						/>
						<h1 className="mt-3 font-medium text-[13px] text-editor-ink">
							Select an item to inspect
						</h1>
						<p className="mt-1 text-editor-faint text-xss">
							Choose a changed file or commit from the sidebar.
						</p>
					</div>
				</section>
			)}
		</main>
	);
}
