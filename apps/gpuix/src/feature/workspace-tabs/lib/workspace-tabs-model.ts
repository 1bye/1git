import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
	type RepositoryWorkspaceAction,
} from "../../repository-workspace/lib/repository-workspace-model";

/** A workspace tab with presentation state and optional live repository metadata. */
export interface WorkspaceTabRecord {
	readonly id: string;
	readonly name: string;
	readonly branch?: string;
	readonly workspace: RepositoryWorkspaceState;
}

/** In-memory tabs and their active selection belong to one app instance. */
export interface WorkspaceTabsState {
	readonly preview: boolean;
	readonly tabs: readonly WorkspaceTabRecord[];
	readonly activeId: string | null;
	readonly nextId: number;
}

/** Tab mutations are independent of the renderer and never perform filesystem work. */
export type WorkspaceTabsAction =
	| { type: "add" }
	| { type: "activate"; id: string }
	| { type: "reorder"; id: string; overId: string }
	| { type: "workspace"; id: string; action: RepositoryWorkspaceAction }
	| { type: "close"; id: string };

/** Pure tab transitions; closing the active tab selects its right neighbor, then its left. */
export class WorkspaceTabsModel {
	private constructor() {}

	/** Seed empty workspaces; preview mode explicitly opts into sample data. */
	static create(initialTabCount = 1, preview = false): WorkspaceTabsState {
		if (!Number.isInteger(initialTabCount) || initialTabCount < 1) {
			throw new Error("Initial tab count must be a positive integer");
		}

		let state: WorkspaceTabsState = {
			preview,
			tabs: [
				{
					id: "workspace-1",
					name: preview ? "1git" : "Open repository",
					branch: preview ? "main" : undefined,
					workspace: RepositoryWorkspaceModel.create(preview),
				},
			],
			activeId: "workspace-1",
			nextId: 2,
		};

		for (let index = 1; index < initialTabCount; index += 1) {
			state = WorkspaceTabsModel.reduce(state, { type: "add" });
		}

		return WorkspaceTabsModel.reduce(state, {
			type: "activate",
			id: "workspace-1",
		});
	}

	static reduce(
		state: WorkspaceTabsState,
		action: WorkspaceTabsAction
	): WorkspaceTabsState {
		if (action.type === "add") {
			const tab = {
				id: `workspace-${state.nextId}`,
				name: `Workspace ${state.nextId}`,
				workspace: RepositoryWorkspaceModel.create(state.preview),
			};

			return {
				...state,
				tabs: [...state.tabs, tab],
				activeId: tab.id,
				nextId: state.nextId + 1,
			};
		}

		const index = state.tabs.findIndex((tab) => tab.id === action.id);

		if (index === -1) return state;

		if (action.type === "workspace") {
			const tab = state.tabs[index];

			if (!tab) return state;

			const workspace = RepositoryWorkspaceModel.reduce(
				tab.workspace,
				action.action
			);

			if (workspace === tab.workspace) return state;

			return {
				...state,
				tabs: state.tabs.map((item) =>
					item.id === tab.id
						? {
								...tab,
								workspace,
								name: workspace.repository?.name ?? tab.name,
								branch: workspace.repository?.branch ?? tab.branch,
							}
						: item
				),
			};
		}

		if (action.type === "activate") {
			return state.activeId === action.id
				? state
				: { ...state, activeId: action.id };
		}

		if (action.type === "reorder") {
			const target = state.tabs.findIndex((tab) => tab.id === action.overId);
			const tab = state.tabs[index];

			if (!tab || target < 0 || target === index) return state;

			const tabs = [...state.tabs];

			tabs.splice(index, 1);
			tabs.splice(target, 0, tab);

			return { ...state, tabs };
		}

		if (state.tabs[index]?.workspace.commit.pending) return state;

		const tabs = state.tabs.filter((tab) => tab.id !== action.id);

		const activeId =
			state.activeId === action.id
				? ((tabs[index] ?? tabs[index - 1])?.id ?? null)
				: state.activeId;

		return { ...state, tabs, activeId };
	}

	static destination(
		tabs: readonly WorkspaceTabRecord[],
		id: string,
		key: string
	): string | undefined {
		const index = tabs.findIndex((tab) => tab.id === id);

		if (index === -1) return undefined;

		if (key === "home") return tabs[0]?.id;

		if (key === "end") return tabs.at(-1)?.id;

		if (key !== "left" && key !== "right") return undefined;

		const offset = key === "left" ? -1 : 1;

		return tabs[(index + offset + tabs.length) % tabs.length]?.id;
	}
}
