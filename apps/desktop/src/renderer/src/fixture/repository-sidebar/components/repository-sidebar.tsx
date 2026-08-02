import type {
	CommitInfo,
	CommitPage,
	FileChange,
	RepositorySnapshot,
} from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import type { KeyboardEvent, ReactElement } from "react";
import type {
	PendingWorkspaceAction,
	RepositoryTab,
} from "@/feature/workspace/hooks/use-git-workspace.js";
import { RepositoryChanges } from "@/fixture/repository-sidebar/components/repository-changes.js";
import { RepositoryHistory } from "@/fixture/repository-sidebar/components/repository-history.js";

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

const REPOSITORY_PANEL_ID = "repository-sidebar-panel";
const REPOSITORY_TAB_IDS: Record<RepositoryTab, string> = {
	changes: "repository-changes-tab",
	history: "repository-history-tab",
};

export function RepositorySidebar({
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
}: RepositorySidebarProps): ReactElement {
	const changedFileCount = snapshot?.files.length ?? 0;
	const setChangesTab = async (): Promise<void> => {
		await onSetTab("changes");
	};
	const setHistoryTab = async (): Promise<void> => {
		await onSetTab("history");
	};
	const navigateTabs = async (
		event: KeyboardEvent<HTMLButtonElement>
	): Promise<void> => {
		let nextTab: RepositoryTab | null = null;
		if (event.key === "Home") {
			nextTab = "changes";
		} else if (event.key === "End") {
			nextTab = "history";
		} else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			nextTab = tab === "changes" ? "history" : "changes";
		}
		if (!nextTab) {
			return;
		}

		event.preventDefault();
		event.currentTarget.parentElement
			?.querySelector<HTMLButtonElement>(`#${REPOSITORY_TAB_IDS[nextTab]}`)
			?.focus();
		await onSetTab(nextTab);
	};

	return (
		<aside
			aria-label="Repository activity"
			className="flex h-full w-[346px] shrink-0 flex-col border-editor-hairline border-r bg-transparent"
			data-name="RepositorySidebar"
		>
			<div
				aria-orientation="horizontal"
				className="grid h-11 shrink-0 grid-cols-2 border-editor-hairline border-b"
				data-name="RepositoryTabs"
				role="tablist"
			>
				<button
					aria-controls={REPOSITORY_PANEL_ID}
					aria-selected={tab === "changes"}
					className={cn(
						"relative text-xs outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset",
						tab === "changes"
							? "font-semibold text-editor-ink"
							: "text-editor-faint hover:text-editor-ink"
					)}
					id={REPOSITORY_TAB_IDS.changes}
					onClick={setChangesTab}
					onKeyDown={navigateTabs}
					role="tab"
					tabIndex={tab === "changes" ? 0 : -1}
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
					aria-controls={REPOSITORY_PANEL_ID}
					aria-selected={tab === "history"}
					className={cn(
						"relative text-xs outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset",
						tab === "history"
							? "font-semibold text-editor-ink"
							: "text-editor-faint hover:text-editor-ink"
					)}
					id={REPOSITORY_TAB_IDS.history}
					onClick={setHistoryTab}
					onKeyDown={navigateTabs}
					role="tab"
					tabIndex={tab === "history" ? 0 : -1}
					type="button"
				>
					History
				</button>
			</div>

			<div
				aria-busy={pendingAction !== null}
				aria-labelledby={REPOSITORY_TAB_IDS[tab]}
				className="flex min-h-0 flex-1 flex-col"
				id={REPOSITORY_PANEL_ID}
				role="tabpanel"
			>
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
			</div>
		</aside>
	);
}
