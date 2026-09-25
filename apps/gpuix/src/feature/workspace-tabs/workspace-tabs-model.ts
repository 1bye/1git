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
	| { type: "close"; id: string };

/** Pure tab transitions; closing the active tab selects its right neighbor, then its left. */
export class WorkspaceTabsModel {
	private constructor() {}

	static create(): WorkspaceTabsState {
		return {
			tabs: [{ id: "workspace-1", name: "1git", branch: "main" }],
			activeId: "workspace-1",
			nextId: 2,
		};
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
