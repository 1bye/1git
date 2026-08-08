import { Button } from "@1git/ui/components/button";
import { Toaster } from "@1git/ui/components/sonner";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ReactElement } from "react";
import { CommandLensProvider } from "@/feature/command-lens/components/command-lens-provider.js";
import { useGitWorkspace } from "@/feature/workspace/hooks/use-git-workspace.js";
import { DesktopToolbar } from "@/fixture/desktop-toolbar/components/desktop-toolbar.js";
import { LiquidMenuStackProvider } from "@/fixture/liquid-menu/components/liquid-menu-stack-provider.js";
import { RepositoryWelcome } from "@/fixture/repository-picker/components/repository-welcome.js";
import { RepositoryDiscardUndoToast } from "@/fixture/repository-workspace/components/repository-discard-undo-toast.js";
import { RepositoryWorkspace } from "@/fixture/repository-workspace/components/repository-workspace.js";

export function App(): ReactElement {
	const workspace = useGitWorkspace();
	const desktopToolbar = (
		<DesktopToolbar
			activeSessionId={
				workspace.activeSession ? workspace.activeSession.id : null
			}
			branches={workspace.branches}
			onActivateWorkspace={workspace.activateWorkspace}
			onCloseWorkspace={workspace.closeWorkspace}
			onCreateBranch={workspace.createBranch}
			onFetch={workspace.fetchRepository}
			onForgetRecent={workspace.forgetRecentRepository}
			onOpenRecent={workspace.openRecentRepository}
			onPickRepository={workspace.pickRepository}
			onReorderWorkspace={workspace.reorderWorkspace}
			onSwitchBranch={workspace.switchBranch}
			pendingAction={workspace.pendingAction}
			recentRepositories={workspace.manager.recentRepositories}
			snapshot={workspace.snapshot}
			workspaces={workspace.workspaces}
		/>
	);

	return (
		<LiquidMenuStackProvider>
			<CommandLensProvider>
				<div
					className="light relative flex h-full min-h-0 flex-col overflow-hidden text-editor-ink"
					data-name="App"
				>
					{workspace.activeSession ? (
						<RepositoryWorkspace
							activeSession={workspace.activeSession}
							branches={workspace.branches}
							diffs={workspace.diffs}
							history={workspace.history}
							isFetching={workspace.pendingAction === "fetch"}
							isLoading={
								workspace.isInitialLoading || workspace.pendingAction === "open"
							}
							onAmendCommit={workspace.amendCommit}
							onChangeHunk={workspace.changeHunk}
							onCherryPickCommit={workspace.cherryPickCommit}
							onCommit={workspace.commit}
							onDiscardFiles={workspace.discardFiles}
							onFetch={workspace.fetchRepository}
							onMergeBranch={workspace.mergeBranch}
							onResetCommit={workspace.resetToCommit}
							onRevertCommit={workspace.revertCommit}
							onSelectCommit={workspace.selectCommit}
							onSelectFile={workspace.selectFile}
							onSetFileStaged={workspace.setFileStaged}
							onSetFilesStaged={workspace.setFilesStaged}
							onSetTab={workspace.setTab}
							onStashChanges={workspace.stashChanges}
							onToggleAllFiles={workspace.toggleAllFiles}
							pendingAction={workspace.pendingAction}
							selectedCommitOid={workspace.selectedCommitOid}
							selectedFilePath={workspace.selectedFilePath}
							snapshot={workspace.snapshot}
							tab={workspace.tab}
							titlebar={desktopToolbar}
						/>
					) : (
						<>
							{desktopToolbar}
							<div
								className="flex min-h-0 flex-1 overflow-hidden bg-transparent"
								data-name="RepositoryWorkspace"
								id="repository-workspace"
							>
								<RepositoryWelcome
									isLoading={
										workspace.isInitialLoading ||
										workspace.pendingAction === "open"
									}
									onCloneRepository={workspace.cloneRepository}
									onCreateRepository={workspace.createRepository}
									onForgetRecent={workspace.forgetRecentRepository}
									onOpenRecent={workspace.openRecentRepository}
									onPickRepository={workspace.pickRepository}
									recentRepositories={workspace.manager.recentRepositories}
									workspaces={workspace.workspaces}
								/>
							</div>
						</>
					)}

					{workspace.error ? (
						<div
							className="absolute right-4 bottom-4 z-50 flex max-w-[440px] items-start gap-3 rounded-2xl border border-rose-200/70 bg-surface-3 p-3.5 text-left shadow-surface-6"
							data-name="ErrorNotice"
							role="alert"
						>
							<span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
								<WarningCircleIcon
									aria-hidden
									className="size-4"
									weight="fill"
								/>
							</span>
							<div className="min-w-0 flex-1">
								<p className="font-semibold text-editor-ink text-xs">
									Git operation failed
								</p>
								<p className="mt-1 text-editor-muted text-xss leading-4">
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
					{workspace.discardUndo ? (
						<RepositoryDiscardUndoToast
							detail={workspace.discardUndo.detail}
							message={workspace.discardUndo.message}
							onDismiss={workspace.dismissDiscardUndo}
							onUndo={workspace.undoDiscard}
							token={workspace.discardUndo.token}
						/>
					) : null}
					<Toaster position="bottom-right" />
				</div>
			</CommandLensProvider>
		</LiquidMenuStackProvider>
	);
}
