import { useCallback, useReducer } from "react";
import { Button } from "@1git/gpuix-ui/button";
import { appTokens } from "./styles/tokens";
import {
	WorkspaceSession,
	type WorkspaceSessionDocument,
} from "./feature/workspace-tabs/lib/workspace-session";
import { useWorkspaceSession } from "./feature/workspace-tabs/hooks/use-workspace-session";

import { RepositoryNavigation } from "./feature/repository-workspace/components/repository-navigation";
import { RepositoryFileActions } from "./feature/repository-workspace/lib/repository-file-actions";
import { RepositoryDiffEmpty } from "./feature/repository-workspace/components/repository-diff-empty";
import { RepositoryDiff } from "./feature/repository-workspace/components/repository-diff";
import { RepositoryDiff as DiffReader } from "./feature/repository-workspace/lib/repository-diff";
import { RepositoryReader } from "./feature/repository-workspace/lib/repository-reader";
import type { RepositoryWatcher } from "./feature/repository-workspace/lib/repository-watcher";
import { useRepositoryAutoRefresh } from "./feature/repository-workspace/hooks/use-repository-auto-refresh";
import { RepositoryHistory } from "./feature/repository-workspace/lib/repository-history";
import { useRepositoryHistory } from "./feature/repository-workspace/hooks/use-repository-history";
import { RepositoryStashes } from "./feature/repository-workspace/lib/repository-stashes";
import { useRepositoryStashes } from "./feature/repository-workspace/hooks/use-repository-stashes";
import { useRepositoryConnection } from "./feature/repository-workspace/hooks/use-repository-connection";
import { useRepositoryMutations } from "./feature/repository-workspace/hooks/use-repository-mutations";
import { RepositoryBranches } from "./feature/workspace-tabs/lib/repository-branches";
import { RepositoryWorktrees } from "./feature/workspace-tabs/lib/repository-worktrees";
import { RepositoryCommit } from "./feature/repository-workspace/lib/repository-commit";
import { RepositoryCloseNotice } from "./feature/repository-workspace/components/repository-close-notice";
import { RepositorySync } from "./feature/repository-workspace/lib/repository-sync";
import { RepositoryConflicts } from "./feature/repository-workspace/lib/repository-conflicts";
import { RepositoryOperation } from "./feature/repository-workspace/lib/repository-operation";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceAction,
} from "./feature/repository-workspace/lib/repository-workspace-model";
import { WorkspaceTabs } from "./feature/workspace-tabs/workspace-tabs";
import { WorkspaceTabsModel } from "./feature/workspace-tabs/lib/workspace-tabs-model";
import { AppShell } from "./fixture/app-shell";

/** Owns one window's workspaces, cancellable reads and explicit commit transactions. */
export function App({
	initialTabCount = 1,
	preview = false,
	initialSession,
	sessionError,
	saveSession,
	readRepository = RepositoryReader.read,
	readDiff = DiffReader.read,
	readHistory = RepositoryHistory.read,
	readCommitFiles = RepositoryHistory.readFiles,
	readStashes = RepositoryStashes.read,
	readStashFiles = RepositoryStashes.readFiles,
	writeCommit = RepositoryCommit.write,
	readBranches = RepositoryBranches.read,
	writeBranch = RepositoryBranches.write,
	writeWorktree = RepositoryWorktrees.create,
	fetchRepository = RepositorySync.fetch,
	writeSyncRepository = RepositorySync.write,
	writeStash = RepositoryStashes.write,
	watchRepository,
	resolveConflict = RepositoryConflicts.write,
	openConflictEditor = RepositoryConflicts.openEditor,
	writeOperation = RepositoryOperation.write,
	discardFile = RepositoryFileActions.discard,
	openFile = RepositoryFileActions.open,
}: {
	initialTabCount?: number;
	preview?: boolean;
	initialSession?: WorkspaceSessionDocument;
	sessionError?: string;
	saveSession?: (document: WorkspaceSessionDocument) => void;
	readRepository?: typeof RepositoryReader.read;
	readDiff?: typeof DiffReader.read;
	readHistory?: typeof RepositoryHistory.read;
	readCommitFiles?: typeof RepositoryHistory.readFiles;
	readStashes?: typeof RepositoryStashes.read;
	readStashFiles?: typeof RepositoryStashes.readFiles;
	writeCommit?: typeof RepositoryCommit.write;
	readBranches?: typeof RepositoryBranches.read;
	writeBranch?: typeof RepositoryBranches.write;
	writeWorktree?: typeof RepositoryWorktrees.create;
	fetchRepository?: typeof RepositorySync.fetch;
	writeSyncRepository?: typeof RepositorySync.write;
	writeStash?: typeof RepositoryStashes.write;
	watchRepository?: typeof RepositoryWatcher.watch;
	resolveConflict?: typeof RepositoryConflicts.write;
	openConflictEditor?: typeof RepositoryConflicts.openEditor;
	writeOperation?: typeof RepositoryOperation.write;
	discardFile?: typeof RepositoryFileActions.discard;
	openFile?: typeof RepositoryFileActions.open;
}) {
	const [state, dispatch] = useReducer(
		WorkspaceTabsModel.reduce,
		{ initialTabCount, preview, initialSession },
		(options) =>
			options.initialSession && !options.preview
				? WorkspaceSession.restore(options.initialSession)
				: WorkspaceTabsModel.create(options.initialTabCount, options.preview)
	);

	const session = useWorkspaceSession(
		state,
		saveSession,
		preview ? undefined : sessionError
	);

	const connection = useRepositoryConnection(state, dispatch, readRepository);

	const mutations = useRepositoryMutations(
		state,
		dispatch,
		writeCommit,
		writeBranch,
		readRepository,
		fetchRepository,
		writeSyncRepository,
		session.retry,
		writeStash,
		resolveConflict,
		writeOperation,
		discardFile,
		writeWorktree
	);

	useRepositoryAutoRefresh(state, dispatch, readRepository, watchRepository);

	const activeTab = state.tabs.find((tab) => tab.id === state.activeId);
	const workspace = activeTab?.workspace;

	const workspaceAction = useCallback(
		(id: string, action: RepositoryWorkspaceAction): void =>
			dispatch({ type: "workspace", id, action }),
		[]
	);

	const history = useRepositoryHistory(
		activeTab?.id,
		workspace,
		workspaceAction,
		readHistory,
		readCommitFiles
	);

	const stashes = useRepositoryStashes(
		activeTab?.id,
		workspace,
		workspaceAction,
		readStashes,
		readStashFiles
	);

	const revision =
		workspace && workspace.view !== "changes"
			? RepositoryWorkspaceModel.revision(workspace, workspace.view)
			: undefined;

	const selectedId = workspace
		? workspace.view === "changes"
			? workspace.views.changes.selectedId
			: workspace.views[workspace.view].files.selectedId
		: null;

	const files =
		workspace?.view === "changes" ? workspace.entries.changes : revision?.files;

	const selected = files?.find((file) => file.id === selectedId);
	const comparison = selected?.change ?? selected?.commitFile;

	return (
		<AppShell
			navigation={
				activeTab && workspace ? (
					<RepositoryNavigation
						openFile={openFile}
						onDiscard={(request) =>
							mutations.discardFile(activeTab.id, request)
						}
						key={activeTab.id}
						workspaceId={activeTab.id}
						state={workspace}
						history={history}
						stashes={stashes}
						onCommit={() => {
							void mutations.commit(activeTab.id);
						}}
						onStash={(request) => mutations.stash(activeTab.id, request)}
						onOperation={(request) =>
							mutations.finishOperation(activeTab.id, request)
						}
						onRefresh={() => {
							void connection.refresh(activeTab.id);
						}}
						onAction={(action) =>
							dispatch({ type: "workspace", id: activeTab.id, action })
						}
					/>
				) : undefined
			}
			toolbar={
				<WorkspaceTabs
					state={state}
					dispatch={dispatch}
					readBranches={readBranches}
					readRepository={readRepository}
					onChangeBranch={mutations.changeBranch}
					onCreateWorktree={mutations.createWorktree}
					onFetch={mutations.fetch}
					onSync={mutations.synchronize}
					onCancelSync={mutations.cancelSync}
				/>
			}
			workspaceLabel={
				activeTab ? `${activeTab.name} workspace` : "No workspace open"
			}
		>
			{mutations.closeProtection.requested ? (
				<RepositoryCloseNotice
					state={state}
					onDismiss={mutations.closeProtection.dismiss}
					onStop={mutations.cancelSync}
				/>
			) : null}
			{session.error ? (
				<div style={{ padding: 10, flexShrink: 0, gap: 6 }}>
					<text
						testId="session-notice"
						role="alert"
						style={{ fontSize: 11, color: appTokens.colors.textMuted }}
					>
						{session.error}
					</text>
					{saveSession ? (
						<Button
							testId="retry-session-save"
							tokens={appTokens}
							size="sm"
							variant="ghost"
							onPress={session.retry}
						>
							Retry saving session
						</Button>
					) : null}
				</div>
			) : null}
			{activeTab && workspace?.repository && comparison ? (
				<RepositoryDiff
					key={`${activeTab.id}:${revision?.id ?? "changes"}:${comparison.path}`}
					root={workspace.repository.root}
					change={comparison}
					refreshing={
						workspace.loading || RepositoryWorkspaceModel.isBusy(workspace)
					}
					statusError={workspace.error}
					readDiff={readDiff}
					onResolve={(hash) =>
						mutations.resolve(activeTab.id, comparison.path, hash)
					}
					openConflictEditor={openConflictEditor}
				/>
			) : (
				<RepositoryDiffEmpty
					selected={selected}
					revision={revision}
					view={workspace?.view}
					hasWorkspace={!!activeTab}
					workspace={workspace}
					picking={connection.pickingId !== null}
					onOpen={() => {
						if (!activeTab) return;

						if (workspace?.repositoryPath)
							void connection.refresh(activeTab.id);
						else void connection.open(activeTab.id);
					}}
				/>
			)}
		</AppShell>
	);
}
