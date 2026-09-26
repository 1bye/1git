import { useCallback, useReducer } from "react";

import { RepositoryNavigation } from "./feature/repository-workspace/components/repository-navigation";
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
import { useRepositoryCommit } from "./feature/repository-workspace/hooks/use-repository-commit";
import { RepositoryCommit } from "./feature/repository-workspace/lib/repository-commit";
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
	readRepository = RepositoryReader.read,
	readDiff = DiffReader.read,
	readHistory = RepositoryHistory.read,
	readCommitFiles = RepositoryHistory.readFiles,
	readStashes = RepositoryStashes.read,
	readStashFiles = RepositoryStashes.readFiles,
	writeCommit = RepositoryCommit.write,
	watchRepository,
}: {
	initialTabCount?: number;
	preview?: boolean;
	readRepository?: typeof RepositoryReader.read;
	readDiff?: typeof DiffReader.read;
	readHistory?: typeof RepositoryHistory.read;
	readCommitFiles?: typeof RepositoryHistory.readFiles;
	readStashes?: typeof RepositoryStashes.read;
	readStashFiles?: typeof RepositoryStashes.readFiles;
	writeCommit?: typeof RepositoryCommit.write;
	watchRepository?: typeof RepositoryWatcher.watch;
}) {
	const [state, dispatch] = useReducer(
		WorkspaceTabsModel.reduce,
		{ initialTabCount, preview },
		(options) =>
			WorkspaceTabsModel.create(options.initialTabCount, options.preview)
	);

	const connection = useRepositoryConnection(state, dispatch, readRepository);
	const commits = useRepositoryCommit(state, dispatch, writeCommit);

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
						key={activeTab.id}
						workspaceId={activeTab.id}
						state={workspace}
						history={history}
						stashes={stashes}
						onCommit={() => {
							void commits.commit(activeTab.id);
						}}
						onRefresh={() => {
							void connection.refresh(activeTab.id);
						}}
						onAction={(action) =>
							dispatch({ type: "workspace", id: activeTab.id, action })
						}
					/>
				) : undefined
			}
			toolbar={<WorkspaceTabs state={state} dispatch={dispatch} />}
			workspaceLabel={
				activeTab ? `${activeTab.name} workspace` : "No workspace open"
			}
		>
			{activeTab && workspace?.repository && comparison ? (
				<RepositoryDiff
					key={`${activeTab.id}:${revision?.id ?? "changes"}:${comparison.path}`}
					root={workspace.repository.root}
					change={comparison}
					refreshing={workspace.loading || workspace.commit.pending}
					statusError={workspace.error}
					readDiff={readDiff}
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
						if (activeTab) void connection.open(activeTab.id);
					}}
				/>
			)}
		</AppShell>
	);
}
