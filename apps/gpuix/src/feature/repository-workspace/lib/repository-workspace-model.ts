import { sampleEntries, type RepositoryView } from "./sample-workspace";

/** Each workspace owns commit inclusion independently of its viewed row and scroll offsets. */
export interface RepositoryWorkspaceState {
	readonly view: RepositoryView;
	readonly includedFileIds: readonly string[];
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
	| { type: "include-file"; id: string; included: boolean }
	| { type: "include-all"; included: boolean }
	| { type: "scroll"; view: RepositoryView; y: number };

/** Pure workspace UI state, owned by the containing tab's lifetime. */
export class RepositoryWorkspaceModel {
	private constructor() {}

	static create(): RepositoryWorkspaceState {
		return {
			view: "changes",
			includedFileIds: sampleEntries.changes.map((entry) => entry.id),
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

		if (action.type === "include-file") {
			if (
				!sampleEntries.changes.some((entry) => entry.id === action.id) ||
				state.includedFileIds.includes(action.id) === action.included
			)
				return state;

			return {
				...state,
				includedFileIds: action.included
					? [...state.includedFileIds, action.id]
					: state.includedFileIds.filter((id) => id !== action.id),
			};
		}

		if (action.type === "include-all") {
			const count = action.included ? sampleEntries.changes.length : 0;

			if (state.includedFileIds.length === count) return state;

			return {
				...state,
				includedFileIds: action.included
					? sampleEntries.changes.map((entry) => entry.id)
					: [],
			};
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
