import { basename } from "node:path";
import type { FileChange, FileStatus, RepositorySnapshot } from "@1git/git";

import { sampleEntries } from "./sample-workspace";
import type {
	RepositoryView,
	RevisionView,
	WorkspaceEntry,
	WorkspaceEntries,
	WorkspaceRevision,
} from "../types";

/** Sidebar proportions leave both revision and file lists usable at the minimum window height. */
export const revisionSplit = {
	initial: 0.5,
	min: 0.25,
	max: 0.75,
	step: 0.05,
} as const;

/** Selection and native vertical scroll offset for one independently scrolling list. */
export interface RepositoryListState {
	readonly selectedId: string | null;
	readonly scrollY: number;
}

/** A revision view preserves its file selection and sidebar split within its workspace tab. */
export interface RepositoryRevisionState extends RepositoryListState {
	readonly files: RepositoryListState;
	readonly splitRatio: number;
}

/** Each workspace owns commit inclusion independently of its viewed row and scroll offsets. */
export interface RepositoryWorkspaceState {
	readonly preview: boolean;
	readonly entries: WorkspaceEntries;
	readonly repository: {
		readonly root: string;
		readonly name: string;
		readonly branch: string;
	} | null;
	readonly loading: boolean;
	readonly error: string | null;
	readonly view: RepositoryView;
	readonly commitMessage: string;
	readonly includedFileIds: readonly string[];
	readonly views: {
		readonly changes: RepositoryListState;
		readonly history: RepositoryRevisionState;
		readonly stashes: RepositoryRevisionState;
	};
}

/** Presentation transitions; no filesystem, Git mutations, or persistent storage effects. */
export type RepositoryWorkspaceAction =
	| { type: "loading" }
	| { type: "load-error"; message: string }
	| { type: "loaded"; snapshot: RepositorySnapshot }
	| { type: "view"; view: RepositoryView }
	| { type: "edit-commit-message"; value: string }
	| { type: "select"; view: RepositoryView; id: string }
	| { type: "include-file"; id: string; included: boolean }
	| { type: "include-all"; included: boolean }
	| { type: "scroll"; view: RepositoryView; y: number }
	| { type: "select-revision-file"; view: RevisionView; id: string }
	| { type: "scroll-revision-files"; view: RevisionView; y: number }
	| { type: "resize-revisions"; view: RevisionView; ratio: number };

/** Pure workspace UI state, owned by the containing tab's lifetime. */
export class RepositoryWorkspaceModel {
	private constructor() {}

	static create(preview = false): RepositoryWorkspaceState {
		const entries: WorkspaceEntries = preview
			? sampleEntries
			: { changes: [], history: [], stashes: [] };

		return {
			preview,
			entries,
			repository: null,
			loading: false,
			error: null,
			view: "changes",
			commitMessage: "",
			includedFileIds: entries.changes.map((entry) => entry.id),
			views: {
				changes: { selectedId: null, scrollY: 0 },
				history: {
					selectedId: null,
					scrollY: 0,
					splitRatio: revisionSplit.initial,
					files: { selectedId: null, scrollY: 0 },
				},
				stashes: {
					selectedId: null,
					scrollY: 0,
					splitRatio: revisionSplit.initial,
					files: { selectedId: null, scrollY: 0 },
				},
			},
		};
	}

	/** The preview requires a first-line summary and at least one included file. */
	static canPreviewCommit(state: RepositoryWorkspaceState): boolean {
		return (
			!state.loading &&
			!state.error &&
			(state.commitMessage.split("\n", 1)[0]?.trim().length ?? 0) > 0 &&
			state.includedFileIds.length > 0
		);
	}

	static reduce(
		state: RepositoryWorkspaceState,
		action: RepositoryWorkspaceAction
	): RepositoryWorkspaceState {
		if (action.type === "loading")
			return { ...state, loading: true, error: null };

		if (action.type === "load-error")
			return { ...state, loading: false, error: action.message };

		if (action.type === "loaded") {
			const { snapshot } = action;

			const changes = snapshot.files
				.filter((file) => file.recordType !== "ignored")
				.map(RepositoryWorkspaceModel.fileEntry);

			const previous = new Set(state.entries.changes.map((entry) => entry.id));
			const included = new Set(state.includedFileIds);

			const sameRepository =
				state.repository?.root === snapshot.repository.root;

			const selectedId = state.views.changes.selectedId;

			const branch = snapshot.head.detached
				? `detached ${snapshot.head.oid?.slice(0, 7) ?? "HEAD"}`
				: (snapshot.head.branch ?? "unborn HEAD");

			return {
				...state,
				preview: false,
				loading: false,
				error: null,
				repository: {
					root: snapshot.repository.root,
					name: basename(snapshot.repository.root),
					branch,
				},
				entries: { changes, history: [], stashes: [] },
				includedFileIds: changes
					.filter(
						(entry) =>
							!sameRepository ||
							!previous.has(entry.id) ||
							included.has(entry.id)
					)
					.map((entry) => entry.id),
				views: {
					...state.views,
					changes: {
						selectedId: changes.some((entry) => entry.id === selectedId)
							? selectedId
							: null,
						scrollY: changes.length ? state.views.changes.scrollY : 0,
					},
				},
			};
		}

		if (action.type === "edit-commit-message") {
			return state.commitMessage === action.value
				? state
				: { ...state, commitMessage: action.value };
		}

		if (action.type === "view") {
			return state.view === action.view
				? state
				: { ...state, view: action.view };
		}

		if (action.type === "include-file") {
			if (
				!state.entries.changes.some((entry) => entry.id === action.id) ||
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
			const count = action.included ? state.entries.changes.length : 0;

			if (state.includedFileIds.length === count) return state;

			return {
				...state,
				includedFileIds: action.included
					? state.entries.changes.map((entry) => entry.id)
					: [],
			};
		}

		if (action.type === "resize-revisions") {
			if (!Number.isFinite(action.ratio)) return state;

			const current = state.views[action.view];

			const splitRatio = Math.max(
				revisionSplit.min,
				Math.min(revisionSplit.max, action.ratio)
			);

			if (current.splitRatio === splitRatio) return state;

			return {
				...state,
				views: { ...state.views, [action.view]: { ...current, splitRatio } },
			};
		}

		if (
			action.type === "select-revision-file" ||
			action.type === "scroll-revision-files"
		) {
			const current = state.views[action.view];
			const revision = RepositoryWorkspaceModel.revision(state, action.view);

			if (!revision) return state;

			let files = current.files;

			if (action.type === "select-revision-file") {
				if (
					files.selectedId === action.id ||
					!revision.files.some((file) => file.id === action.id)
				)
					return state;

				files = { ...files, selectedId: action.id };
			} else {
				if (!Number.isFinite(action.y)) return state;

				const scrollY = Math.min(0, action.y);

				if (files.scrollY === scrollY) return state;

				files = { ...files, scrollY };
			}

			return {
				...state,
				views: { ...state.views, [action.view]: { ...current, files } },
			};
		}

		const current = state.views[action.view];

		if (action.type === "select") {
			if (
				current.selectedId === action.id ||
				!state.entries[action.view].some((entry) => entry.id === action.id)
			)
				return state;

			return {
				...state,
				views: {
					...state.views,
					[action.view]: {
						...current,
						selectedId: action.id,
						...(action.view !== "changes" && {
							files: { selectedId: null, scrollY: 0 },
						}),
					},
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
		entries: readonly WorkspaceEntry[],
		id: string,
		key: string,
		pageSize: number
	): string | undefined {
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

	/** Selected revision from the workspace's presentation data. */
	static revision(
		state: RepositoryWorkspaceState,
		view: RevisionView
	): WorkspaceRevision | undefined {
		return state.entries[view].find(
			(entry) => entry.id === state.views[view].selectedId
		);
	}

	/** Collapses index and worktree records into one row while retaining both statuses for accessibility. */
	static fileEntry(file: FileChange): WorkspaceEntry {
		const symbols: Partial<Record<FileStatus, WorkspaceEntry["status"]>> = {
			added: "A",
			untracked: "A",
			deleted: "D",
			renamed: "R",
			copied: "C",
			unmerged: "U",
			"type-changed": "T",
			modified: "M",
		};

		const status =
			file.recordType === "unmerged"
				? "U"
				: (symbols[file.worktreeStatus] ?? symbols[file.indexStatus] ?? "M");

		return {
			id: file.path,
			title: file.path,
			change: file,
			status,
			statusDescription: `${file.originalPath ? `renamed from ${file.originalPath}; ` : ""}index: ${file.indexStatus}; working tree: ${file.worktreeStatus}${file.submodule !== "N..." ? "; submodule changes" : ""}`,
		};
	}
}
