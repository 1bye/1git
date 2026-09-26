import { useReducer } from "react";

import { RepositoryNavigation } from "./feature/repository-workspace/components/repository-navigation";
import { RepositoryDiffEmpty } from "./feature/repository-workspace/components/repository-diff-empty";
import { RepositoryDiff } from "./feature/repository-workspace/components/repository-diff";
import { RepositoryDiff as DiffReader } from "./feature/repository-workspace/lib/repository-diff";
import { RepositoryReader } from "./feature/repository-workspace/lib/repository-reader";
import { useRepositoryConnection } from "./feature/repository-workspace/hooks/use-repository-connection";
import { RepositoryWorkspaceModel } from "./feature/repository-workspace/lib/repository-workspace-model";
import { WorkspaceTabs } from "./feature/workspace-tabs/workspace-tabs";
import { WorkspaceTabsModel } from "./feature/workspace-tabs/lib/workspace-tabs-model";
import { AppShell } from "./fixture/app-shell";

/** Owns one window's in-memory workspaces; Git access is read-only. */
export function App({
	initialTabCount = 1,
	preview = false,
	readRepository = RepositoryReader.read,
	readDiff = DiffReader.read,
}: {
	initialTabCount?: number;
	preview?: boolean;
	readRepository?: typeof RepositoryReader.read;
	readDiff?: typeof DiffReader.read;
}) {
	const [state, dispatch] = useReducer(
		WorkspaceTabsModel.reduce,
		{ initialTabCount, preview },
		(options) =>
			WorkspaceTabsModel.create(options.initialTabCount, options.preview)
	);

	const connection = useRepositoryConnection(state, dispatch, readRepository);

	const activeTab = state.tabs.find((tab) => tab.id === state.activeId);
	const workspace = activeTab?.workspace;

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

	return (
		<AppShell
			navigation={
				activeTab && workspace ? (
					<RepositoryNavigation
						key={activeTab.id}
						workspaceId={activeTab.id}
						state={workspace}
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
			{activeTab &&
			workspace?.repository &&
			workspace.view === "changes" &&
			selected?.change ? (
				<RepositoryDiff
					key={`${activeTab.id}:${selected.id}`}
					root={workspace.repository.root}
					change={selected.change}
					refreshing={workspace.loading}
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
