import type { CommitInfo, FileDiff, RepositorySnapshot } from "@1git/git";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type { ReactElement } from "react";
import type {
	RecentRepositoryRecord,
	RepositorySessionRecord,
} from "../../shared/repository-session.js";
import { CleanState } from "./clean-state.js";
import { DiffView } from "./diff-view.js";
import { RepositoryWelcome } from "./repository-welcome.js";
import type { RepositoryTab } from "./use-git-workspace.js";
import { getRepositoryName } from "./workspace-model.js";

interface WorkspaceContentProps {
	readonly activeSession: RepositorySessionRecord | null;
	readonly diff: FileDiff | null;
	readonly historyCommit: CommitInfo | null;
	readonly isInitialLoading: boolean;
	readonly onFetch: () => Promise<void>;
	readonly onOpenRecent: (path: string) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
	readonly selectedFilePath: string | null;
	readonly snapshot: RepositorySnapshot | null;
	readonly tab: RepositoryTab;
}

export const WorkspaceContent = ({
	activeSession,
	diff,
	historyCommit,
	isInitialLoading,
	onFetch,
	onOpenRecent,
	onPickRepository,
	recentRepositories,
	selectedFilePath,
	snapshot,
	tab,
}: WorkspaceContentProps): ReactElement => {
	if (!activeSession) {
		return (
			<RepositoryWelcome
				isLoading={isInitialLoading}
				onOpenRecent={onOpenRecent}
				onPickRepository={onPickRepository}
				recentRepositories={recentRepositories}
			/>
		);
	}

	if (!snapshot) {
		return (
			<main
				className="flex min-h-0 flex-1 items-center justify-center bg-editor-surface"
				data-name="WorkspaceLoading"
			>
				<SpinnerGapIcon
					aria-label={`Loading ${getRepositoryName(
						activeSession.repository.root
					)}`}
					className="size-5 animate-spin text-editor-faint"
					weight="bold"
				/>
			</main>
		);
	}

	if (tab === "changes" && snapshot.files.length === 0) {
		return (
			<main
				className="min-h-0 flex-1 overflow-y-auto bg-editor-surface"
				data-name="WorkspaceContent"
			>
				<CleanState onFetch={onFetch} snapshot={snapshot} />
			</main>
		);
	}

	return (
		<main
			className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-editor-surface"
			data-name="WorkspaceContent"
		>
			{diff ? (
				<DiffView
					commit={historyCommit}
					diff={diff}
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
						<p className="mt-3 font-medium text-[13px] text-editor-ink">
							Select an item to inspect
						</p>
						<p className="mt-1 text-[11px] text-editor-faint">
							Choose a changed file or commit from the sidebar.
						</p>
					</div>
				</section>
			)}
		</main>
	);
};
