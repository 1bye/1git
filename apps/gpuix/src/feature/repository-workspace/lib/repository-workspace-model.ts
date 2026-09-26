import { sampleEntries, type RepositoryView } from "./sample-workspace";

/** Each workspace remembers a separate selection and native scroll offset per view. */
export interface RepositoryWorkspaceState {
	readonly view: RepositoryView;
	readonly views: Readonly<
		Record<
			RepositoryView,
			{
				readonly selectedId: string | null;
				readonly scrollY: number;
			}
		>
	>;
}

/** Preview-only transitions; no filesystem, Git, or persistent storage effects. */
export type RepositoryWorkspaceAction =
	| { type: "view"; view: RepositoryView }
	| { type: "select"; view: RepositoryView; id: string }
	| { type: "scroll"; view: RepositoryView; y: number };

/** Pure workspace UI state, owned by the containing tab's lifetime. */
export class RepositoryWorkspaceModel {
	private constructor() {}

	static create(): RepositoryWorkspaceState {
		return {
			view: "changes",
			views: {
				changes: { selectedId: null, scrollY: 0 },
				history: { selectedId: null, scrollY: 0 },
				stashes: { selectedId: null, scrollY: 0 },
			},
		};
	}

	static reduce(
		state: RepositoryWorkspaceState,
		action: RepositoryWorkspaceAction
	): RepositoryWorkspaceState {
		if (action.type === "view") {
			return state.view === action.view
				? state
				: { ...state, view: action.view };
		}

		const current = state.views[action.view];

		if (action.type === "select") {
			if (
				current.selectedId === action.id ||
				!sampleEntries[action.view].some((entry) => entry.id === action.id)
			)
				return state;

			return {
				...state,
				views: {
					...state.views,
					[action.view]: { ...current, selectedId: action.id },
				},
			};
		}

		if (!Number.isFinite(action.y)) return state;

		const scrollY = Math.min(0, action.y);

		if (scrollY === current.scrollY) return state;

		return {
			...state,
			views: { ...state.views, [action.view]: { ...current, scrollY } },
		};
	}

	static destination(
		view: RepositoryView,
		id: string,
		key: string,
		pageSize: number
	): string | undefined {
		const entries = sampleEntries[view];
		const index = entries.findIndex((entry) => entry.id === id);

		if (index < 0) return undefined;

		if (key === "home") return entries[0]?.id;

		if (key === "end") return entries.at(-1)?.id;

		const offsets: Readonly<Record<string, number>> = {
			up: -1,
			down: 1,
			pageup: -pageSize,
			pagedown: pageSize,
		};

		const offset = offsets[key];

		if (offset === undefined) return undefined;

		return entries[Math.max(0, Math.min(entries.length - 1, index + offset))]
			?.id;
	}
}
