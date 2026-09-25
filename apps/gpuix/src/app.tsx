import { useReducer } from "react";

import { WorkspaceTabs } from "./feature/workspace-tabs/workspace-tabs";
import { WorkspaceTabsModel } from "./feature/workspace-tabs/workspace-tabs-model";
import { AppShell } from "./fixture/app-shell";

/** Owns one window's in-memory workspaces; no Git or persistence side effects yet. */
export function App() {
	const [state, dispatch] = useReducer(
		WorkspaceTabsModel.reduce,
		undefined,
		WorkspaceTabsModel.create
	);
	const activeTab = state.tabs.find((tab) => tab.id === state.activeId);

	return (
		<AppShell
			toolbar={<WorkspaceTabs state={state} dispatch={dispatch} />}
			workspaceLabel={
				activeTab ? `${activeTab.name} workspace` : "No workspace open"
			}
		/>
	);
}
