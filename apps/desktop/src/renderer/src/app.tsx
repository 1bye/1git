import { Button } from "@1git/ui/components/button";
import { Toaster } from "@1git/ui/components/sonner";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type ReactElement, useCallback, useRef } from "react";

import { CommandLensProvider } from "@/feature/command-lens/components/command-lens-provider.js";
import { useGitWorkspace } from "@/feature/workspace/hooks/use-git-workspace.js";
import { DesktopToolbar } from "@/fixture/desktop-toolbar/components/desktop-toolbar.js";
import { LiquidMenuStackProvider } from "@/fixture/liquid-menu/components/liquid-menu-stack-provider.js";
import { RepositoryWelcome } from "@/fixture/repository-picker/components/repository-welcome.js";
import { RepositoryDiscardUndoToast } from "@/fixture/repository-workspace/components/repository-discard-undo-toast.js";
import { RepositoryWorkspace } from "@/fixture/repository-workspace/components/repository-workspace.js";

export function App(): ReactElement {
	const workspace = useGitWorkspace();
	const workspaceRootRef = useRef<HTMLElement>(null);

	const setWorkspaceRoot = useCallback((element: HTMLElement | null): void => {
		workspaceRootRef.current = element;
	}, []);

	const desktopToolbar = (
		<DesktopToolbar
			activeSessionId={
				workspace.activeSession ? workspace.activeSession.id : null
			}
			branches={workspace.branches}
			onActivateWorkspace={workspace.activateWorkspace}
			onCancelSync={workspace.cancelSync}
			onCloseWorkspace={workspace.closeWorkspace}
			onCreateBranch={workspace.createBranch}
			onDeleteBranch={workspace.deleteBranch}
			onForgetRecent={workspace.forgetRecentRepository}
			onOpenRecent={workspace.openRecentRepository}
			onPickRepository={workspace.pickRepository}
			onRenameBranch={workspace.renameBranch}
			onReorderWorkspace={workspace.reorderWorkspace}
			onSetBranchUpstream={workspace.setBranchUpstream}
			onStashAndSwitchBranch={workspace.stashAndSwitchBranch}
			onSwitchBranch={workspace.switchBranch}
			onSync={workspace.syncRepository}
			pendingAction={workspace.pendingAction}
			recentRepositories={workspace.manager.recentRepositories}
			snapshot={workspace.snapshot}
			syncAction={workspace.syncAction}
			workspaceRootRef={workspaceRootRef}
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
							branchComparison={workspace.branchComparison}
							branches={workspace.branches}
							cleanAction={workspace.cleanAction}
							commitIdentity={workspace.commitIdentity}
							diffs={workspace.diffs}
							history={workspace.history}
							ignoreWhitespace={workspace.ignoreWhitespace}
							isLoading={
								workspace.isInitialLoading || workspace.pendingAction === "open"
							}
							onAmendCommit={workspace.amendCommit}
							onApplyStash={workspace.applyStash}
							onCancelSync={workspace.cancelSync}
							onChangeHunk={workspace.changeHunk}
							onCherryPickCommit={workspace.cherryPickCommit}
							onCloseBranchComparison={workspace.closeBranchComparison}
							onCommit={workspace.commit}
							onCreateBranch={workspace.createBranch}
							onDiscardFiles={workspace.discardFiles}
							onDropStash={workspace.dropStash}
							onOpenBranchComparison={workspace.openBranchComparison}
							onOpenFile={workspace.openRepositoryFileInEditor}
							onPopStash={workspace.popStash}
							onPreviewBranchComparison={workspace.previewBranchComparison}
							onResetCommit={workspace.resetToCommit}
							onRevertCommit={workspace.revertCommit}
							onSelectCommit={workspace.selectCommit}
							onSelectFile={workspace.selectFile}
							onSelectRevisionFile={workspace.selectRevisionFile}
							onSelectStash={workspace.selectStash}
							onSetFileStaged={workspace.setFileStaged}
							onSetFilesStaged={workspace.setFilesStaged}
							onSetIgnoreWhitespace={workspace.setIgnoreWhitespace}
							onSetTab={workspace.setTab}
							onSync={workspace.syncRepository}
							pendingAction={workspace.pendingAction}
							ref={setWorkspaceRoot}
							selectedCommitOid={workspace.selectedCommitOid}
							selectedFilePath={workspace.selectedFilePath}
							selectedStashOid={workspace.selectedStashOid}
							snapshot={workspace.snapshot}
							stashes={workspace.stashes}
							syncAction={workspace.syncAction}
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
								ref={setWorkspaceRoot}
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
							{workspace.canRetrySync ? (
								<Button
									onClick={workspace.syncRepository}
									size="sm"
									variant="secondary"
								>
									Retry
								</Button>
							) : null}
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
