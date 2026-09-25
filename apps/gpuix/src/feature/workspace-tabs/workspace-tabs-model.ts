/** A shell tab, not a Git session. Repository integration will supply real metadata later. */
export interface WorkspaceTabRecord {
	readonly id: string;
	readonly name: string;
	readonly branch?: string;
}

/** In-memory tabs and their active selection belong to one app instance. */
export interface WorkspaceTabsState {
	readonly tabs: readonly WorkspaceTabRecord[];
	readonly activeId: string | null;
	readonly nextId: number;
}

/** Tab mutations are independent of the renderer and never perform filesystem work. */
export type WorkspaceTabsAction =
	| { type: "add" }
	| { type: "activate"; id: string }
	| { type: "reorder"; id: string; overId: string }
	| { type: "close"; id: string };

/** Pure tab transitions; closing the active tab selects its right neighbor, then its left. */
export class WorkspaceTabsModel {
	private constructor() {}

	/** Seed at least one sample workspace; extra tabs use the same action as +. */
	static create(initialTabCount = 1): WorkspaceTabsState {
		if (!Number.isInteger(initialTabCount) || initialTabCount < 1) {
			throw new Error("Initial tab count must be a positive integer");
		}
		let state: WorkspaceTabsState = {
			tabs: [{ id: "workspace-1", name: "1git", branch: "main" }],
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
			};

			return {
				tabs: [...state.tabs, tab],
				activeId: tab.id,
				nextId: state.nextId + 1,
			};
		}

		const index = state.tabs.findIndex((tab) => tab.id === action.id);
		if (index === -1) return state;
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
