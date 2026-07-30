import type {
	CommitInfo,
	CommitPage,
	FileChange,
	RepositorySnapshot,
} from "@1git/git";
import type { ReactElement } from "react";
import { RepositoryChanges } from "./repository-changes.js";
import { RepositoryHistory } from "./repository-history.js";
import type {
	PendingWorkspaceAction,
	RepositoryTab,
} from "./use-git-workspace.js";

interface RepositorySidebarProps {
	readonly history: CommitPage | null;
	readonly onCommit: (summary: string, description: string) => Promise<boolean>;
	readonly onSelectCommit: (commit: CommitInfo) => Promise<void>;
	readonly onSelectFile: (file: FileChange) => Promise<void>;
	readonly onSetFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly onSetTab: (tab: RepositoryTab) => Promise<void>;
	readonly onToggleAllFiles: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly selectedCommitOid: string | null;
	readonly selectedFilePath: string | null;
	readonly snapshot: RepositorySnapshot | null;
	readonly tab: RepositoryTab;
}

export const RepositorySidebar = ({
	history,
	onCommit,
	onSelectCommit,
	onSelectFile,
	onSetFileStaged,
	onSetTab,
	onToggleAllFiles,
	pendingAction,
	selectedCommitOid,
	selectedFilePath,
	snapshot,
	tab,
}: RepositorySidebarProps): ReactElement => {
	const changedFileCount = snapshot?.files.length ?? 0;
	const setChangesTab = async (): Promise<void> => {
		await onSetTab("changes");
	};
	const setHistoryTab = async (): Promise<void> => {
		await onSetTab("history");
	};

	return (
		<aside
			aria-label="Repository activity"
			className="flex h-full w-[346px] shrink-0 flex-col border-editor-hairline border-r bg-transparent"
			data-name="RepositorySidebar"
		>
			<div
				className="grid h-11 shrink-0 grid-cols-2 border-editor-hairline border-b"
				data-name="RepositoryTabs"
				role="tablist"
			>
				<button
					aria-selected={tab === "changes"}
					className={
						tab === "changes"
							? "relative font-semibold text-editor-ink text-xs after:absolute after:inset-x-5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-editor-ink"
							: "text-editor-faint text-xs outline-none hover:bg-hover hover:text-editor-ink focus-visible:bg-hover"
					}
					onClick={setChangesTab}
					role="tab"
					type="button"
				>
					Changes
					{changedFileCount > 0 ? (
						<span className="ml-1.5 rounded-full bg-editor-sunken px-1.5 py-0.5 font-semibold text-[9px] text-editor-muted">
							{changedFileCount}
						</span>
					) : null}
				</button>
				<button
					aria-selected={tab === "history"}
					className={
						tab === "history"
							? "relative font-semibold text-editor-ink text-xs after:absolute after:inset-x-5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-editor-ink"
							: "text-editor-faint text-xs outline-none hover:bg-hover hover:text-editor-ink focus-visible:bg-hover"
					}
					onClick={setHistoryTab}
					role="tab"
					type="button"
				>
					History
				</button>
			</div>

			{tab === "changes" ? (
				<RepositoryChanges
					onCommit={onCommit}
					onSelectFile={onSelectFile}
					onSetFileStaged={onSetFileStaged}
					onToggleAllFiles={onToggleAllFiles}
					pendingAction={pendingAction}
					selectedFilePath={selectedFilePath}
					snapshot={snapshot}
				/>
			) : (
				<RepositoryHistory
					history={history}
					onSelectCommit={onSelectCommit}
					selectedCommitOid={selectedCommitOid}
				/>
			)}
		</aside>
	);
};
