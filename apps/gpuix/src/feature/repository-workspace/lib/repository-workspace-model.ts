import { basename } from "node:path";
import type {
	CommitPage,
	CommitFilesResult,
	FileChange,
	FileStatus,
	RepositorySnapshot,
	RepositoryOperationState,
	StashInfo,
} from "@1git/git";

import { sampleEntries } from "./sample-workspace";
import { RepositoryHistory } from "./repository-history";
import { RepositoryStashes } from "./repository-stashes";
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
	readonly branchPending: boolean;
	readonly fetch: {
		readonly pending: boolean;
		readonly error: string | null;
		readonly fetchedAt: number | null;
		readonly version: number;
	};
	readonly entries: WorkspaceEntries;
	readonly repository: {
		readonly root: string;
		readonly gitDirectory: string;
		readonly commonDirectory: string;
		readonly name: string;
		readonly branch: string;
		readonly head: string | null;
		readonly branchName: string | null;
		readonly operation: RepositoryOperationState;
	} | null;
	readonly commit: {
		readonly pending: boolean;
		readonly error: string | null;
		readonly notice: string | null;
		readonly needsReview: boolean;
	};
	readonly history: {
		readonly nextOffset: number | null;
		readonly error: string | null;
	};
	readonly stashes: {
		readonly generation: number;
		readonly loaded: boolean;
		readonly error: string | null;
	};
	readonly loading: boolean;
	readonly watchError: string | null;
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
	| { type: "fetch-started" }
	| {
			type: "fetch-finished";
			snapshot?: RepositorySnapshot;
			error: string | null;
			fetchedAt: number | null;
			refreshError?: string;
	  }
	| { type: "branch-started" }
	| { type: "branch-finished"; snapshot?: RepositorySnapshot; error?: string }
	| { type: "commit-started" }
	| { type: "commit-failed"; message: string; uncertain?: boolean }
	| {
			type: "commit-finished";
			result: CommitFilesResult;
			submittedMessage?: string;
	  }
	| {
			type: "stashes-loaded";
			root: string;
			generation: number;
			stashes: readonly StashInfo[];
	  }
	| { type: "stashes-error"; root: string; generation: number; message: string }
	| {
			type: "stash-files";
			root: string;
			generation: number;
			oid: string;
			files: readonly WorkspaceEntry[];
	  }
	| {
			type: "stash-files-error";
			root: string;
			generation: number;
			oid: string;
			message: string;
	  }
	| {
			type: "history-page";
			root: string;
			head: string;
			offset: number;
			page: CommitPage;
	  }
	| { type: "history-error"; root: string; head: string; message: string }
	| {
			type: "history-files";
			root: string;
			head: string;
			commit: string;
			files: readonly WorkspaceEntry[];
	  }
	| {
			type: "history-files-error";
			root: string;
			head: string;
			commit: string;
			message: string;
	  }
	| { type: "loading" }
	| { type: "load-error"; message: string }
	| { type: "loaded"; snapshot: RepositorySnapshot; automatic?: boolean }
	| { type: "watch-error"; message: string }
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
			branchPending: false,
			fetch: { pending: false, error: null, fetchedAt: null, version: 0 },
			entries,
			repository: null,
			commit: { pending: false, error: null, notice: null, needsReview: false },
			history: { nextOffset: 0, error: null },
			stashes: { generation: 0, loaded: false, error: null },
			loading: false,
			watchError: null,
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

	/** A whole-file action never silently replaces a user's partial staging choice. */
	static commitBlockReason(state: RepositoryWorkspaceState): string | null {
		if (state.repository?.operation !== "normal" && state.repository)
			return "Finish the current Git operation before committing here.";

		if (
			state.entries.changes.some(
				(entry) => entry.change?.recordType === "unmerged"
			)
		)
			return "Resolve merge conflicts before committing.";

		for (const entry of state.entries.changes) {
			if (!state.includedFileIds.includes(entry.id) || !entry.change) continue;

			const file = entry.change;

			if (file.submodule !== "N...")
				return "Commit selected submodule changes in Git first.";

			if (
				file.recordType !== "untracked" &&
				file.indexStatus !== "unmodified" &&
				file.worktreeStatus !== "unmodified"
			)
				return "A selected file is partially staged. Stage or unstage it in Git, then refresh, or uncheck it.";
		}

		return null;
	}

	static canCommit(state: RepositoryWorkspaceState): boolean {
		return (
			!!state.repository &&
			!state.preview &&
			!RepositoryWorkspaceModel.isBusy(state) &&
			!state.commit.needsReview &&
			!state.commitMessage.includes("\0") &&
			RepositoryWorkspaceModel.canPreviewCommit(state) &&
			!RepositoryWorkspaceModel.commitBlockReason(state)
		);
	}

	static isBusy(state: RepositoryWorkspaceState): boolean {
		return state.commit.pending || state.branchPending || state.fetch.pending;
	}

	static reduce(
		state: RepositoryWorkspaceState,
		action: RepositoryWorkspaceAction
	): RepositoryWorkspaceState {
		if (action.type === "fetch-started")
			return {
				...state,
				loading: false,
				fetch: { ...state.fetch, pending: true, error: null },
			};

		if (action.type === "fetch-finished") {
			const next = {
				...state,
				fetch: {
					pending: false,
					error: action.error,
					fetchedAt: action.fetchedAt ?? state.fetch.fetchedAt,
					version: state.fetch.version + 1,
				},
			};

			const refreshed = action.snapshot
				? RepositoryWorkspaceModel.reduce(next, {
						type: "loaded",
						snapshot: action.snapshot,
						automatic: true,
					})
				: next;

			return action.refreshError
				? { ...refreshed, error: action.refreshError }
				: refreshed;
		}

		if (action.type === "branch-started")
			return { ...state, branchPending: true, loading: false };

		if (action.type === "branch-finished") {
			const next = { ...state, branchPending: false };

			return action.snapshot
				? RepositoryWorkspaceModel.reduce(next, {
						type: "loaded",
						snapshot: action.snapshot,
					})
				: {
						...next,
						error:
							action.error ??
							"Refresh to confirm the current branch before continuing.",
					};
		}

		if (action.type === "commit-started")
			return {
				...state,
				loading: false,
				commit: {
					pending: true,
					error: null,
					notice: null,
					needsReview: false,
				},
			};

		if (action.type === "commit-failed")
			return {
				...state,
				commit: {
					pending: false,
					error: action.message,
					notice: null,
					needsReview: action.uncertain ?? false,
				},
			};

		if (action.type === "commit-finished") {
			const next = { ...state, commit: { ...state.commit, pending: false } };

			const refreshed = action.result.snapshot
				? RepositoryWorkspaceModel.reduce(next, {
						type: "loaded",
						snapshot: action.result.snapshot,
					})
				: next;

			const confirmed = action.result.outcome === "committed";

			return {
				...refreshed,
				commitMessage:
					confirmed && action.submittedMessage === state.commitMessage
						? ""
						: state.commitMessage,
				commit: {
					pending: false,
					error: null,
					needsReview:
						!confirmed || !!action.result.warning || !action.result.snapshot,
					notice:
						action.result.warning ??
						(confirmed
							? `Committed${action.result.oid ? ` ${action.result.oid.slice(0, 7)}` : ""}.`
							: "Commit outcome uncertain. Inspect History before retrying."),
				},
			};
		}

		if (
			RepositoryWorkspaceModel.isBusy(state) &&
			(action.type === "loading" ||
				action.type === "loaded" ||
				action.type === "load-error" ||
				action.type === "edit-commit-message" ||
				action.type === "include-file" ||
				action.type === "include-all")
		)
			return state;

		if (
			action.type === "stashes-loaded" ||
			action.type === "stashes-error" ||
			action.type === "stash-files" ||
			action.type === "stash-files-error"
		) {
			if (
				state.loading ||
				state.repository?.root !== action.root ||
				state.stashes.generation !== action.generation
			)
				return state;

			if (action.type === "stashes-error")
				return {
					...state,
					stashes: { ...state.stashes, error: action.message },
				};

			const current = state.views.stashes;

			if (action.type === "stashes-loaded") {
				const cached = new Map(
					state.entries.stashes.map((entry) => [entry.id, entry])
				);

				const entries = action.stashes.map((stash) => {
					const previous = cached.get(stash.oid);

					return {
						...RepositoryStashes.entry(stash),
						files: previous?.files ?? [],
						filesLoaded: previous?.filesLoaded,
					};
				});

				const selected =
					entries.find((entry) => entry.id === current.selectedId) ??
					entries[0];

				const sameSelection = selected?.id === current.selectedId;

				return {
					...state,
					stashes: { ...state.stashes, loaded: true, error: null },
					entries: { ...state.entries, stashes: entries },
					views: {
						...state.views,
						stashes: {
							...current,
							selectedId: selected?.id ?? null,
							scrollY: sameSelection ? current.scrollY : 0,
							files: sameSelection
								? current.files
								: { selectedId: selected?.files[0]?.id ?? null, scrollY: 0 },
						},
					},
				};
			}

			const entries = state.entries.stashes.map((entry) =>
				entry.id !== action.oid
					? entry
					: action.type === "stash-files"
						? {
								...entry,
								files: action.files,
								filesLoaded: true,
								filesError: undefined,
							}
						: { ...entry, filesError: action.message }
			);

			const selectFirstFile =
				action.type === "stash-files" &&
				current.selectedId === action.oid &&
				current.files.selectedId === null;

			return {
				...state,
				entries: { ...state.entries, stashes: entries },
				views: selectFirstFile
					? {
							...state.views,
							stashes: {
								...current,
								files: { selectedId: action.files[0]?.id ?? null, scrollY: 0 },
							},
						}
					: state.views,
			};
		}

		if (
			action.type === "history-page" ||
			action.type === "history-error" ||
			action.type === "history-files" ||
			action.type === "history-files-error"
		) {
			if (
				state.repository?.root !== action.root ||
				state.repository.head !== action.head
			)
				return state;

			if (action.type === "history-error")
				return {
					...state,
					history: { ...state.history, error: action.message },
				};

			if (action.type === "history-page") {
				if (state.history.nextOffset !== action.offset) return state;

				const cached = new Map(
					state.entries.history.map((entry) => [entry.id, entry])
				);

				const previous = action.offset === 0 ? [] : state.entries.history;
				const known = new Set(previous.map((entry) => entry.id));

				const entries = [
					...previous,
					...action.page.commits
						.filter((commit) => !known.has(commit.oid))
						.map(
							(commit) =>
								cached.get(commit.oid) ?? RepositoryHistory.entry(commit)
						),
				];

				const history = state.views.history;

				const retained = entries.some(
					(entry) => entry.id === history.selectedId
				);

				return {
					...state,
					history: { nextOffset: action.page.nextOffset, error: null },
					entries: { ...state.entries, history: entries },
					views: {
						...state.views,
						history: {
							...state.views.history,
							selectedId: retained
								? history.selectedId
								: (entries[0]?.id ?? null),
							files: retained
								? history.files
								: { selectedId: entries[0]?.files[0]?.id ?? null, scrollY: 0 },
							scrollY: retained ? history.scrollY : 0,
						},
					},
				};
			}

			const entries = state.entries.history.map((entry) =>
				entry.id !== action.commit
					? entry
					: action.type === "history-files"
						? {
								...entry,
								files: action.files,
								filesLoaded: true,
								filesError: undefined,
							}
						: { ...entry, filesError: action.message }
			);

			const history = state.views.history;

			const selectFirstFile =
				action.type === "history-files" &&
				history.selectedId === action.commit &&
				history.files.selectedId === null;

			return {
				...state,
				entries: { ...state.entries, history: entries },
				views: selectFirstFile
					? {
							...state.views,
							history: {
								...history,
								files: { selectedId: action.files[0]?.id ?? null, scrollY: 0 },
							},
						}
					: state.views,
			};
		}

		if (action.type === "watch-error")
			return { ...state, watchError: action.message };

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

			const sameHistory =
				sameRepository && state.repository?.head === snapshot.head.oid;

			const retainHistory =
				sameHistory ||
				(sameRepository && action.automatic && snapshot.head.oid !== null);

			const selectedId = state.views.changes.selectedId;

			const branch = snapshot.head.detached
				? `detached ${snapshot.head.oid?.slice(0, 7) ?? "HEAD"}`
				: (snapshot.head.branch ?? "unborn HEAD");

			return {
				...state,
				preview: false,
				loading: false,
				error: null,
				watchError: sameRepository ? state.watchError : null,
				fetch: sameRepository
					? state.fetch
					: { pending: false, error: null, fetchedAt: null, version: 0 },
				repository: {
					root: snapshot.repository.root,
					gitDirectory: snapshot.repository.gitDirectory,
					commonDirectory: snapshot.repository.commonDirectory,
					name: basename(snapshot.repository.root),
					branch,
					head: snapshot.head.oid,
					branchName: snapshot.head.branch,
					operation: snapshot.operationState,
				},
				commit: {
					...state.commit,
					needsReview: action.automatic ? state.commit.needsReview : false,
				},
				history: sameHistory
					? state.history
					: { nextOffset: snapshot.head.oid ? 0 : null, error: null },
				stashes: {
					generation: state.stashes.generation + 1,
					loaded: false,
					error: null,
				},
				entries: {
					changes,
					history: retainHistory ? state.entries.history : [],
					stashes: sameRepository ? state.entries.stashes : [],
				},
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
					stashes: sameRepository
						? state.views.stashes
						: {
								...state.views.stashes,
								selectedId: null,
								scrollY: 0,
								files: { selectedId: null, scrollY: 0 },
							},
					history: retainHistory
						? state.views.history
						: {
								...state.views.history,
								selectedId: null,
								scrollY: 0,
								files: { selectedId: null, scrollY: 0 },
							},
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
				: {
						...state,
						commitMessage: action.value,
						commit: RepositoryWorkspaceModel.editedCommit(state),
					};
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
				commit: RepositoryWorkspaceModel.editedCommit(state),
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
				commit: RepositoryWorkspaceModel.editedCommit(state),
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
							files: {
								selectedId:
									state.entries[action.view].find(
										(entry) => entry.id === action.id
									)?.files[0]?.id ?? null,
								scrollY: 0,
							},
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

	private static editedCommit(
		state: RepositoryWorkspaceState
	): RepositoryWorkspaceState["commit"] {
		return state.commit.needsReview
			? state.commit
			: { ...state.commit, error: null, notice: null };
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
