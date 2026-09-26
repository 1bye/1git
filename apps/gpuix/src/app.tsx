import { useReducer } from "react";

import { RepositoryNavigation } from "./feature/repository-workspace/components/repository-navigation";
import { RepositoryDiffEmpty } from "./feature/repository-workspace/components/repository-diff-empty";
import { sampleEntries } from "./feature/repository-workspace/lib/sample-workspace";
import { RepositoryWorkspaceModel } from "./feature/repository-workspace/lib/repository-workspace-model";
import { WorkspaceTabs } from "./feature/workspace-tabs/workspace-tabs";
import { WorkspaceTabsModel } from "./feature/workspace-tabs/lib/workspace-tabs-model";
import { AppShell } from "./fixture/app-shell";

/** Owns one window's in-memory workspaces; no Git or persistence side effects yet. */
export function App({ initialTabCount = 1 }: { initialTabCount?: number }) {
	const [state, dispatch] = useReducer(
		WorkspaceTabsModel.reduce,
		initialTabCount,
		WorkspaceTabsModel.create
	);

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
		workspace?.view === "changes" ? sampleEntries.changes : revision?.files;

	const selected = files?.find((file) => file.id === selectedId);

	return (
		<AppShell
			navigation={
				activeTab && workspace ? (
					<RepositoryNavigation
						key={activeTab.id}
						workspaceId={activeTab.id}
						state={workspace}
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
			<RepositoryDiffEmpty
				selected={selected}
				revision={revision}
				view={workspace?.view}
				hasWorkspace={!!activeTab}
			/>
		</AppShell>
	);
}
