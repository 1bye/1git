import { Button } from "@1git/ui/components/button";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ReactElement } from "react";
import { DesktopToolbar } from "./desktop-toolbar.js";
import { RepositorySidebar } from "./repository-sidebar.js";
import { useGitWorkspace } from "./use-git-workspace.js";
import { WorkspaceContent } from "./workspace-content.js";

export const App = (): ReactElement => {
	const workspace = useGitWorkspace();
	const historyCommit =
		workspace.history?.commits.find(
			(commit) => commit.oid === workspace.selectedCommitOid
		) ?? null;

	return (
		<div
			className="light relative flex h-full min-h-0 flex-col overflow-hidden text-editor-ink"
			data-name="App"
		>
			<DesktopToolbar
				activeSessionId={
					workspace.activeSession ? workspace.activeSession.id : null
				}
				branches={workspace.branches}
				lastFetchedAt={workspace.lastFetchedAt}
				onActivateWorkspace={workspace.activateWorkspace}
				onCloseWorkspace={workspace.closeWorkspace}
				onCreateBranch={workspace.createBranch}
				onFetch={workspace.fetchRepository}
				onOpenRecent={workspace.openRecentRepository}
				onPickRepository={workspace.pickRepository}
				onSwitchBranch={workspace.switchBranch}
				pendingAction={workspace.pendingAction}
				recentRepositories={workspace.manager.recentRepositories}
				snapshot={workspace.snapshot}
				workspaces={workspace.workspaces}
			/>

			<div
				className="flex min-h-0 flex-1"
				data-name="RepositoryWorkspace"
				id="repository-workspace"
			>
				{workspace.activeSession ? (
					<RepositorySidebar
						history={workspace.history}
						onCommit={workspace.commit}
						onSelectCommit={workspace.selectCommit}
						onSelectFile={workspace.selectFile}
						onSetFileStaged={workspace.setFileStaged}
						onSetTab={workspace.setTab}
						onToggleAllFiles={workspace.toggleAllFiles}
						pendingAction={workspace.pendingAction}
						selectedCommitOid={workspace.selectedCommitOid}
						selectedFilePath={workspace.selectedFilePath}
						snapshot={workspace.snapshot}
						tab={workspace.tab}
					/>
				) : null}
				<WorkspaceContent
					activeSession={workspace.activeSession}
					diff={workspace.diff}
					historyCommit={historyCommit}
					isInitialLoading={workspace.isInitialLoading}
					onFetch={workspace.fetchRepository}
					onOpenRecent={workspace.openRecentRepository}
					onPickRepository={workspace.pickRepository}
					recentRepositories={workspace.manager.recentRepositories}
					selectedFilePath={workspace.selectedFilePath}
					snapshot={workspace.snapshot}
					tab={workspace.tab}
				/>
			</div>

			{workspace.error ? (
				<div
					className="absolute right-4 bottom-4 z-50 flex max-w-[440px] items-start gap-3 rounded-2xl border border-rose-200/70 bg-white/92 p-3.5 text-left shadow-surface-6 backdrop-blur-2xl"
					data-name="ErrorNotice"
					role="alert"
				>
					<span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
						<WarningCircleIcon aria-hidden className="size-4" weight="fill" />
					</span>
					<div className="min-w-0 flex-1">
						<p className="font-semibold text-[12px] text-editor-ink">
							Git operation failed
						</p>
						<p className="mt-1 text-[11px] text-editor-muted leading-4">
							{workspace.error}
						</p>
					</div>
					<Button
						aria-label="Dismiss error"
						className="-mt-1 -mr-1"
						onClick={workspace.clearError}
						size="icon-sm"
						variant="ghost"
					>
						<XIcon aria-hidden className="size-3.5" weight="bold" />
					</Button>
				</div>
			) : null}
		</div>
	);
};
