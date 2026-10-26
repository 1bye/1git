import { basename } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type {
	CommitPage,
	CommitFilesResult,
	FileChange,
	FileStatus,
	RepositorySnapshot,
	RepositoryOperationState,
	StashInfo,
	GitTransferProgress,
	GitCommitProgress,
} from "@1git/git";

import { sampleEntries } from "./sample-workspace";
import { RepositoryHistory, type FileHistoryScope } from "./repository-history";
import { RepositoryStashes } from "./repository-stashes";
import type { RemoteAccountAccess } from "../../accounts/lib/remote-accounts";
import type { StashRequest } from "./repository-stashes";
import type {
	RepositoryView,
	RepositoryListView,
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

/** Retained hook output is bounded independently of Git's process collection limit. */
export const commitOutputLimit = 32 * 1024;

/** Selection and native vertical scroll offset for one independently scrolling list. */
export interface RepositoryListState {
	readonly selectedId: string | null;
	/** Changes-only highlight selection, independent of commit inclusion and diff focus. */
	readonly selectedIds?: readonly string[];
	readonly anchorId?: string;
	readonly scrollY: number;
}

/** A revision view preserves its file selection and sidebar split within its workspace tab. */
export interface RepositoryRevisionState extends RepositoryListState {
	readonly files: RepositoryListState;
	readonly splitRatio: number;
}

/** Each workspace owns commit inclusion independently of its viewed row and scroll offsets. */
export interface RepositoryWorkspaceState {
	/** Full branch count survives pagination/search and belongs to this refreshed workspace. */
	readonly historyCount?: {
		readonly total: number | null;
		readonly error: string | null;
	};
	/** Invalidates mutable local metadata such as tags even when HEAD has not changed. */
	readonly metadataVersion?: number;
	/** Bounded lazy history search for a restored selection; cleared once resolved. */
	readonly restoreHistoryLimit?: number;
	readonly preview: boolean;
	/** Saved root retained even while unavailable; fresh metadata still comes from repository reads. */
	readonly repositoryPath: string | null;
	readonly branchPending: boolean;
	readonly conflictPending: boolean;
	readonly operationMutation: {
		readonly recoveryDirectory?: string;
		readonly pending: boolean;
		readonly error: string | null;
		readonly notice: string | null;
	};
	readonly stashMutation: {
		readonly pending: StashRequest["kind"] | null;
		readonly error: string | null;
		readonly notice: string | null;
	};
	readonly sync: {
		readonly progress?: GitTransferProgress;
		readonly pending: "fetch" | "pull" | "push" | "publish" | "sync" | null;
		readonly error: string | null;
		readonly accountAccess?: RemoteAccountAccess;
		readonly notice: string | null;
		readonly fetchedAt: number | null;
		readonly version: number;
	};
	readonly entries: WorkspaceEntries;
	readonly repository: {
		readonly root: string;
		readonly gitDirectory: string;
		readonly commonDirectory: string;
		readonly name: string;
		readonly isShallow?: boolean;
		readonly branch: string;
		readonly head: string | null;
		readonly branchName: string | null;
		readonly upstream: string | null;
		readonly remoteCount?: number;
		readonly ahead?: number;
		readonly behind?: number;
		readonly operation: RepositoryOperationState;
		readonly operationToken?: string;
	} | null;
	readonly commit: {
		readonly pending: boolean;
		readonly progress?: GitCommitProgress["phase"];
		readonly output?: string;
		readonly cancelling?: boolean;
		readonly cancellable?: boolean;
		readonly error: string | null;
		readonly notice: string | null;
		readonly needsReview: boolean;
	};
	readonly history: {
		readonly file?: FileHistoryScope;
		readonly query?: string;
		readonly normal?: {
			readonly entries: readonly WorkspaceRevision[];
			readonly view: RepositoryRevisionState;
			readonly nextOffset: number | null;
			readonly error: string | null;
		};
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
	/** Temporary intent, pinned to the reviewed tip; the ordinary draft survives cancel and restart. */
	readonly amend?: {
		readonly root: string;
		readonly head: string;
		readonly branch: string;
		readonly previousMessage: string;
	};
	readonly includedFileIds: readonly string[];
	readonly partialFiles?: Readonly<
		Record<
			string,
			{
				readonly expectedPatch: string;
				readonly includedLines: readonly string[];
			}
		>
	>;
	readonly views: {
		readonly changes: RepositoryListState;
		readonly history: RepositoryRevisionState;
		readonly stashes: RepositoryRevisionState;
	};
}

/** Presentation transitions; no filesystem, Git mutations, or persistent storage effects. */
export type RepositoryWorkspaceAction =
	| { type: "operation-started" }
	| {
			type: "operation-finished";
			recoveryDirectory?: string;
			snapshot?: RepositorySnapshot;
			error: string | null;
			refreshError?: string;
			notice?: string;
	  }
	| { type: "stash-started"; kind: StashRequest["kind"] }
	| {
			type: "stash-finished";
			snapshot?: RepositorySnapshot;
			error: string | null;
			refreshError?: string;
			notice?: string;
			view?: RepositoryView;
	  }
	| {
			type: "sync-started";
			kind: NonNullable<RepositoryWorkspaceState["sync"]["pending"]>;
	  }
	| { type: "sync-error-dismissed" }
	| { type: "sync-progress"; progress: GitTransferProgress }
	| {
			type: "sync-finished";
			snapshot?: RepositorySnapshot;
			error: string | null;
			accountAccess?: RemoteAccountAccess;
			fetchedAt: number | null;
			refreshError?: string;
			notice?: string;
	  }
	| { type: "branch-started" }
	| { type: "conflict-started" }
	| { type: "conflict-finished"; snapshot?: RepositorySnapshot; error?: string }
	| { type: "branch-finished"; snapshot?: RepositorySnapshot; error?: string }
	| { type: "commit-started"; cancellable?: boolean }
	| { type: "commit-progress"; progress: GitCommitProgress }
	| { type: "commit-cancelling" }
	| { type: "amend-commit"; head: string; branch: string; message: string }
	| { type: "cancel-amend" }
	| { type: "commit-failed"; message: string; uncertain?: boolean }
	| {
			type: "commit-finished";
			result: CommitFilesResult;
			submittedMessage?: string;
			undoMessage?: string;
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
			type: "history-count";
			root: string;
			head: string;
			metadataVersion: number;
			total: number | null;
			error: string | null;
	  }
	| {
			type: "history-page";
			file?: FileHistoryScope;
			query?: string;
			root: string;
			head: string;
			offset: number;
			page: CommitPage;
	  }
	| {
			type: "history-error";
			file?: FileHistoryScope;
			root: string;
			head: string;
			message: string;
			query?: string;
	  }
	| { type: "history-search"; value: string }
	| { type: "history-file"; file: FileHistoryScope | null }
	| {
			type: "history-files";
			file?: FileHistoryScope;
			root: string;
			head: string;
			commit: string;
			files: readonly WorkspaceEntry[];
	  }
	| {
			type: "history-files-error";
			file?: FileHistoryScope;
			root: string;
			head: string;
			commit: string;
			message: string;
	  }
	| { type: "loading" }
	| { type: "load-error"; message: string }
	| {
			type: "loaded";
			snapshot: RepositorySnapshot & { readonly remoteCount?: number };
			automatic?: boolean;
	  }
	| { type: "watch-error"; message: string }
	| { type: "view"; view: RepositoryView }
	| { type: "edit-commit-message"; value: string }
	| {
			type: "select";
			view: RepositoryListView;
			id: string;
			mode?: "toggle" | "range" | "context";
			visibleIds?: readonly string[];
	  }
	| { type: "include-files"; ids: readonly string[]; included: boolean }
	| { type: "include-file"; id: string; included: boolean }
	| {
			type: "include-lines";
			id: string;
			expectedPatch: string;
			includedLines: readonly string[];
			total: number;
	  }
	| { type: "include-all"; included: boolean }
	| { type: "scroll"; view: RepositoryListView; y: number }
	| { type: "select-revision-file"; view: RevisionView; id: string }
	| {
			type: "scroll-revision-files";
			view: RevisionView;
			revisionId: string | null;
			y: number;
	  }
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
			repositoryPath: null,
			branchPending: false,
			conflictPending: false,
			operationMutation: { pending: false, error: null, notice: null },
			stashMutation: { pending: null, error: null, notice: null },
			sync: {
				pending: null,
				error: null,
				notice: null,
				fetchedAt: null,
				version: 0,
			},
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

	/** Checked files include their current contents; conflicts and submodules need separate handling. */
	static commitBlockReason(state: RepositoryWorkspaceState): string | null {
		if (
			state.amend &&
			(state.amend.root !== state.repository?.root ||
				state.amend.head !== state.repository.head ||
				state.amend.branch !== state.repository?.branchName)
		)
			return "The last commit changed. Cancel amend and review it again.";

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
			!state.loading &&
			!state.error &&
			!!state.commitMessage.split("\n", 1)[0]?.trim() &&
			(state.includedFileIds.length > 0 || !!state.amend) &&
			!RepositoryWorkspaceModel.commitBlockReason(state)
		);
	}

	/** Final publication and identity checks are repeated by the Git backend before writing. */
	static canRecoverCommit(state: RepositoryWorkspaceState): boolean {
		return (
			!state.preview &&
			!state.loading &&
			!state.error &&
			!state.commit.needsReview &&
			!RepositoryWorkspaceModel.isBusy(state) &&
			!!state.repository?.head &&
			!!state.repository.branchName &&
			!RepositoryWorkspaceModel.commitBlockReason(state)
		);
	}

	/** Sync is independent of checkbox inclusion and never commits working files. */
	static canSync(state: RepositoryWorkspaceState): boolean {
		return (
			!state.preview &&
			!state.loading &&
			!state.error &&
			!state.commit.needsReview &&
			!RepositoryWorkspaceModel.isBusy(state) &&
			!!state.repository?.head &&
			!!state.repository.branchName &&
			!!state.repository.upstream &&
			state.repository.operation === "normal"
		);
	}

	static isBusy(state: RepositoryWorkspaceState): boolean {
		return (
			state.commit.pending ||
			state.branchPending ||
			state.conflictPending ||
			state.operationMutation.pending ||
			state.sync.pending !== null ||
			state.stashMutation.pending !== null
		);
	}

	static reduce(
		state: RepositoryWorkspaceState,
		action: RepositoryWorkspaceAction,
		autoIncludeChanges = false
	): RepositoryWorkspaceState {
		if (action.type === "stash-started")
			return {
				...state,
				loading: false,
				stashMutation: { pending: action.kind, error: null, notice: null },
			};

		if (action.type === "stash-finished") {
			const next = {
				...state,
				stashMutation: {
					pending: null,
					error: action.error,
					notice: action.notice ?? null,
				},
			};

			const refreshed = action.snapshot
				? RepositoryWorkspaceModel.reduce(
						next,
						{
							type: "loaded",
							snapshot: action.snapshot,
							automatic: true,
						},
						autoIncludeChanges
					)
				: next;

			return {
				...refreshed,
				error: action.refreshError ?? refreshed.error,
				view: action.view ?? refreshed.view,
				stashes: {
					...refreshed.stashes,
					loaded: false,
					generation: refreshed.stashes.generation + 1,
				},
				...(action.view === "stashes" && {
					views: {
						...refreshed.views,
						stashes: {
							...refreshed.views.stashes,
							selectedId: null,
							files: { selectedId: null, scrollY: 0 },
						},
					},
				}),
			};
		}

		if (action.type === "sync-error-dismissed")
			return state.sync.pending
				? state
				: {
						...state,
						sync: { ...state.sync, error: null, accountAccess: undefined },
					};

		if (action.type === "sync-progress") {
			if (!state.sync.pending) return state;

			if (
				state.sync.progress?.phase === action.progress.phase &&
				state.sync.progress.percent === action.progress.percent
			)
				return state;

			return { ...state, sync: { ...state.sync, progress: action.progress } };
		}

		if (action.type === "sync-started")
			return {
				...state,
				loading: false,
				sync: {
					...state.sync,
					pending: action.kind,
					progress: { phase: "connecting", percent: null },
					error: null,
					accountAccess: undefined,
					notice: null,
				},
			};

		if (action.type === "sync-finished") {
			const next = {
				...state,
				sync: {
					pending: null,
					error: action.error,
					...(action.error && action.accountAccess
						? { accountAccess: action.accountAccess }
						: {}),
					notice: action.notice ?? null,
					fetchedAt: action.fetchedAt ?? state.sync.fetchedAt,
					version: state.sync.version + 1,
				},
			};

			const refreshed = action.snapshot
				? RepositoryWorkspaceModel.reduce(
						next,
						{
							type: "loaded",
							snapshot: action.snapshot,
							automatic: true,
						},
						autoIncludeChanges
					)
				: next;

			return action.refreshError
				? { ...refreshed, error: action.refreshError }
				: refreshed;
		}

		if (action.type === "operation-started")
			return {
				...state,
				loading: false,
				operationMutation: { pending: true, error: null, notice: null },
			};

		if (action.type === "operation-finished") {
			const next = {
				...state,
				operationMutation: {
					pending: false,
					recoveryDirectory: action.recoveryDirectory,
					error: action.error,
					notice: action.notice ?? null,
				},
			};

			const refreshed = action.snapshot
				? RepositoryWorkspaceModel.reduce(
						next,
						{
							type: "loaded",
							snapshot: action.snapshot,
							automatic: true,
						},
						autoIncludeChanges
					)
				: next;

			return action.refreshError
				? { ...refreshed, error: action.refreshError }
				: refreshed;
		}

		if (action.type === "conflict-started")
			return { ...state, conflictPending: true, loading: false };

		if (action.type === "conflict-finished") {
			const next = { ...state, conflictPending: false };

			return action.snapshot
				? RepositoryWorkspaceModel.reduce(
						next,
						{
							type: "loaded",
							snapshot: action.snapshot,
							automatic: true,
						},
						autoIncludeChanges
					)
				: {
						...next,
						error:
							action.error ?? "Refresh to confirm the conflict resolution.",
					};
		}

		if (action.type === "branch-started")
			return {
				...state,
				branchPending: true,
				loading: false,
				operationMutation: {
					...state.operationMutation,
					error: null,
					notice: null,
				},
			};

		if (action.type === "branch-finished") {
			const next = {
				...state,
				branchPending: false,
				operationMutation: {
					...state.operationMutation,
					error: action.error ?? null,
					notice: null,
				},
			};

			return action.snapshot
				? RepositoryWorkspaceModel.reduce(
						next,
						{
							type: "loaded",
							snapshot: action.snapshot,
						},
						autoIncludeChanges
					)
				: {
						...next,
						error:
							action.error ??
							"Refresh to confirm the current branch before continuing.",
					};
		}

		if (action.type === "amend-commit") {
			if (
				state.amend ||
				!RepositoryWorkspaceModel.canRecoverCommit(state) ||
				state.repository?.head !== action.head ||
				state.repository.branchName !== action.branch
			)
				return state;

			return {
				...state,
				view: "changes",
				amend: {
					root: state.repository.root,
					head: action.head,
					branch: action.branch,
					previousMessage: state.commitMessage,
				},
				commitMessage: action.message,
				commit: { ...state.commit, error: null, notice: null },
			};
		}

		if (action.type === "cancel-amend")
			return state.amend && !RepositoryWorkspaceModel.isBusy(state)
				? {
						...state,
						commitMessage: state.amend.previousMessage,
						amend: undefined,
						commit: RepositoryWorkspaceModel.editedCommit(state),
					}
				: state;

		if (action.type === "commit-started")
			return {
				...state,
				loading: false,
				commit: {
					pending: true,
					cancellable: action.cancellable,
					error: null,
					notice: null,
					needsReview: false,
				},
			};

		if (action.type === "commit-failed")
			return {
				...state,
				commit: {
					...state.commit,
					pending: false,
					cancelling: false,
					error: action.message,
					notice: null,
					needsReview: action.uncertain ?? false,
				},
			};

		if (action.type === "commit-progress")
			return state.commit.pending
				? {
						...state,
						commit: {
							...state.commit,
							progress: action.progress.phase,
							output: stripVTControlCharacters(
								(state.commit.output ?? "") + (action.progress.output ?? "")
							)
								.replace(/\r\n?/g, "\n")
								.slice(-commitOutputLimit),
						},
					}
				: state;

		if (action.type === "commit-cancelling")
			return state.commit.pending
				? { ...state, commit: { ...state.commit, cancelling: true } }
				: state;

		if (action.type === "commit-finished") {
			const next = { ...state, commit: { ...state.commit, pending: false } };

			const refreshed = action.result.snapshot
				? RepositoryWorkspaceModel.reduce(
						next,
						{
							type: "loaded",
							snapshot: action.result.snapshot,
						},
						autoIncludeChanges
					)
				: next;

			const confirmed = action.result.outcome === "committed";

			const amended =
				confirmed && !!state.amend && action.submittedMessage !== undefined;

			return {
				...refreshed,
				amend: amended ? undefined : refreshed.amend,
				commitMessage: amended
					? (state.amend?.previousMessage ?? "")
					: confirmed && action.undoMessage !== undefined
						? state.commitMessage || action.undoMessage
						: confirmed && action.submittedMessage === state.commitMessage
							? ""
							: refreshed.commitMessage,
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
				action.type === "include-lines" ||
				action.type === "include-files" ||
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
				!action.files.some((file) => file.id === current.files.selectedId);

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

		if (action.type === "history-file") {
			if (
				state.preview ||
				state.loading ||
				!state.repository ||
				RepositoryWorkspaceModel.isBusy(state)
			)
				return state;

			const normal = state.history.normal ?? {
				entries: state.entries.history,
				view: state.views.history,
				nextOffset: state.history.nextOffset,
				error: state.history.error,
			};

			if (!action.file) {
				if (!state.history.file) return state;

				return {
					...state,
					view: "history",
					history: {
						nextOffset: state.history.normal
							? state.history.normal.nextOffset
							: state.repository.head
								? 0
								: null,
						error: state.history.normal?.error ?? null,
					},
					entries: {
						...state.entries,
						history: state.history.normal?.entries ?? [],
					},
					views: {
						...state.views,
						history: state.history.normal?.view ?? {
							...state.views.history,
							selectedId: null,
							selectedIds: undefined,
							anchorId: undefined,
							scrollY: 0,
							files: { selectedId: null, scrollY: 0 },
						},
					},
				};
			}

			return {
				...state,
				view: "history",
				restoreHistoryLimit: undefined,
				history: {
					file: action.file,
					normal: state.history.file ? state.history.normal : normal,
					nextOffset: state.repository.head ? 0 : null,
					error: null,
				},
				entries: { ...state.entries, history: [] },
				views: {
					...state.views,
					history: {
						...state.views.history,
						selectedId: null,
						selectedIds: undefined,
						anchorId: undefined,
						scrollY: 0,
						files: { selectedId: null, scrollY: 0 },
					},
				},
			};
		}

		if (action.type === "history-search") {
			const query = action.value;

			if (query === (state.history.query ?? "")) return state;

			const normal = state.history.normal ?? {
				entries: state.entries.history,
				view: state.views.history,
				nextOffset: state.history.nextOffset,
				error: state.history.error,
			};

			if (!query.trim() && !state.history.file)
				return {
					...state,
					history: { nextOffset: normal.nextOffset, error: normal.error },
					entries: { ...state.entries, history: normal.entries },
					views: { ...state.views, history: normal.view },
				};

			return {
				...state,
				restoreHistoryLimit: undefined,
				history: {
					file: state.history.file,
					query,
					normal: state.history.file ? state.history.normal : normal,
					nextOffset:
						state.preview || (!state.repository?.head && state.history.file)
							? null
							: 0,
					error: null,
				},
				entries: {
					...state.entries,
					history: state.preview
						? normal.entries.filter((entry) =>
								entry.commit
									? RepositoryHistory.matches(entry.commit, query)
									: `${entry.title} ${entry.detail ?? ""}`
											.toLowerCase()
											.includes(query.trim().toLowerCase())
							)
						: [],
				},
				views: {
					...state.views,
					history: { ...state.views.history, scrollY: 0 },
				},
			};
		}

		if (action.type === "history-count") {
			if (
				state.repository?.root !== action.root ||
				state.repository.head !== action.head ||
				(state.metadataVersion ?? 0) !== action.metadataVersion
			)
				return state;

			return {
				...state,
				historyCount: { total: action.total, error: action.error },
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
				state.repository.head !== action.head ||
				state.history.file?.path !== action.file?.path ||
				state.history.file?.revision !== action.file?.revision
			)
				return state;

			if (
				(action.type === "history-page" || action.type === "history-error") &&
				(action.query ?? "") !== (state.history.query ?? "")
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

				const found = entries.some((entry) => entry.id === history.selectedId);

				const searching =
					!found &&
					action.page.nextOffset !== null &&
					action.page.nextOffset < (state.restoreHistoryLimit ?? 0);

				const retained = found || searching;

				return {
					...state,
					restoreHistoryLimit: searching
						? state.restoreHistoryLimit
						: undefined,
					history: {
						...state.history,
						nextOffset: action.page.nextOffset,
						error: null,
					},
					entries: { ...state.entries, history: entries },
					views: {
						...state.views,
						history: {
							...state.views.history,
							selectedId: retained
								? history.selectedId
								: (entries[0]?.id ?? null),
							selectedIds: retained ? history.selectedIds : undefined,
							anchorId: retained ? history.anchorId : undefined,
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
				!action.files.some((file) => file.id === history.files.selectedId);

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

			const files = new Map<string, FileChange>();

			for (const file of snapshot.files) {
				if (file.recordType === "ignored") continue;

				const existing = files.get(file.path);

				// A file removed from Git's index then recreated has two status records, but one checkbox.
				files.set(
					file.path,
					existing && file.recordType === "untracked"
						? { ...existing, worktreeStatus: "modified" }
						: file
				);
			}

			const changes = [...files.values()].map(
				RepositoryWorkspaceModel.fileEntry
			);

			const previous = new Set(state.entries.changes.map((entry) => entry.id));
			const included = new Set(state.includedFileIds);

			const sameRepository =
				state.repository?.root === snapshot.repository.root;

			const restoring =
				!state.repository && state.repositoryPath === snapshot.repository.root;

			const sameHistory =
				sameRepository && state.repository?.head === snapshot.head.oid;

			const retainHistory =
				sameHistory ||
				(sameRepository && action.automatic && snapshot.head.oid !== null);

			const selectedId = state.views.changes.selectedId;

			const branch = snapshot.head.detached
				? `detached ${snapshot.head.oid?.slice(0, 7) ?? "HEAD"}`
				: (snapshot.head.branch ?? "unborn HEAD");

			const includedFileIds = changes
				.filter((entry) => {
					if (!sameHistory && state.partialFiles?.[entry.id]) return false;

					return sameRepository && previous.has(entry.id)
						? included.has(entry.id)
						: autoIncludeChanges;
				})
				.map((entry) => entry.id);

			// Stable selections let pending work survive unrelated background refreshes.
			const sameInclusion =
				sameRepository &&
				includedFileIds.length === state.includedFileIds.length &&
				includedFileIds.every(
					(id, index) => id === state.includedFileIds[index]
				);

			let partialFiles: RepositoryWorkspaceState["partialFiles"] = {};

			if (sameHistory) {
				const partials = Object.entries(state.partialFiles ?? {});
				const remaining = partials.filter(([id]) => files.has(id));

				partialFiles =
					remaining.length === partials.length
						? state.partialFiles
						: Object.fromEntries(remaining);
			}

			return {
				...state,
				preview: false,
				restoreHistoryLimit:
					(restoring || retainHistory) && snapshot.head.oid
						? state.restoreHistoryLimit
						: undefined,
				repositoryPath: snapshot.repository.root,
				metadataVersion: (state.metadataVersion ?? 0) + 1,
				historyCount:
					sameHistory && action.automatic && !snapshot.repository.isShallow
						? state.historyCount
						: undefined,
				loading: false,
				error: null,
				watchError: sameRepository ? state.watchError : null,
				sync: sameRepository
					? state.sync
					: {
							pending: null,
							error: null,
							notice: null,
							fetchedAt: null,
							version: 0,
						},
				repository: {
					root: snapshot.repository.root,
					gitDirectory: snapshot.repository.gitDirectory,
					commonDirectory: snapshot.repository.commonDirectory,
					name: basename(snapshot.repository.root),
					isShallow: snapshot.repository.isShallow,
					branch,
					head: snapshot.head.oid,
					branchName: snapshot.head.branch,
					upstream: snapshot.head.upstream,
					remoteCount: snapshot.remoteCount,
					ahead: snapshot.head.ahead,
					behind: snapshot.head.behind,
					operation: snapshot.operationState,
					operationToken: snapshot.operationToken,
				},
				commit: {
					...state.commit,
					error: state.commit.error,
					needsReview: action.automatic ? state.commit.needsReview : false,
				},
				history: sameHistory
					? state.history
					: {
							file: sameRepository ? state.history.file : undefined,
							nextOffset: snapshot.head.oid ? 0 : null,
							error: null,
						},
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
				partialFiles,
				includedFileIds: sameInclusion
					? state.includedFileIds
					: includedFileIds,
				views: {
					...state.views,
					stashes:
						sameRepository || restoring
							? state.views.stashes
							: {
									...state.views.stashes,
									selectedId: null,
									scrollY: 0,
									files: { selectedId: null, scrollY: 0 },
								},
					history:
						retainHistory || (restoring && snapshot.head.oid !== null)
							? state.views.history
							: {
									...state.views.history,
									selectedId: null,
									selectedIds: undefined,
									anchorId: undefined,
									scrollY: 0,
									files: { selectedId: null, scrollY: 0 },
								},
					changes: {
						...(state.views.changes.selectedIds
							? {
									selectedIds: state.views.changes.selectedIds.filter((id) =>
										changes.some((entry) => entry.id === id)
									),
									anchorId: changes.some(
										(entry) => entry.id === state.views.changes.anchorId
									)
										? state.views.changes.anchorId
										: undefined,
								}
							: {}),
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

		if (action.type === "include-lines") {
			if (!state.entries.changes.some((entry) => entry.id === action.id))
				return state;

			const partialFiles = { ...state.partialFiles };

			if (
				action.includedLines.length > 0 &&
				action.includedLines.length < action.total
			)
				partialFiles[action.id] = {
					expectedPatch: action.expectedPatch,
					includedLines: action.includedLines,
				};
			else delete partialFiles[action.id];

			const included = new Set(state.includedFileIds);

			if (action.includedLines.length) included.add(action.id);
			else included.delete(action.id);

			return {
				...state,
				partialFiles,
				includedFileIds: [...included],
				commit: RepositoryWorkspaceModel.editedCommit(state),
			};
		}

		if (action.type === "include-files") {
			const targets = new Set(action.ids);
			const included = new Set(state.includedFileIds);

			return {
				...state,
				partialFiles: Object.fromEntries(
					Object.entries(state.partialFiles ?? {}).filter(
						([id]) => !targets.has(id)
					)
				),
				includedFileIds: state.entries.changes
					.filter((entry) =>
						targets.has(entry.id) ? action.included : included.has(entry.id)
					)
					.map((entry) => entry.id),
				commit: RepositoryWorkspaceModel.editedCommit(state),
			};
		}

		if (action.type === "include-file") {
			if (
				!state.entries.changes.some((entry) => entry.id === action.id) ||
				(state.includedFileIds.includes(action.id) === action.included &&
					!state.partialFiles?.[action.id])
			)
				return state;

			return {
				...state,
				partialFiles: Object.fromEntries(
					Object.entries(state.partialFiles ?? {}).filter(
						([id]) => id !== action.id
					)
				),
				includedFileIds: action.included
					? [...new Set([...state.includedFileIds, action.id])]
					: state.includedFileIds.filter((id) => id !== action.id),
				commit: RepositoryWorkspaceModel.editedCommit(state),
			};
		}

		if (action.type === "include-all") {
			const count = action.included ? state.entries.changes.length : 0;

			if (
				state.includedFileIds.length === count &&
				!Object.keys(state.partialFiles ?? {}).length
			)
				return state;

			return {
				...state,
				partialFiles: {},
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

			if (
				action.type === "scroll-revision-files" &&
				action.revisionId !== revision.id
			)
				return state;

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
			if (action.view === "changes" || action.view === "history") {
				const byId = new Map(
					state.entries[action.view].map((entry) => [entry.id, entry])
				);

				const entries = action.visibleIds
					? [...new Set(action.visibleIds)].flatMap((id) => {
							const entry = byId.get(id);

							return entry ? [entry] : [];
						})
					: state.entries[action.view];

				if (!entries.some((entry) => entry.id === action.id)) return state;

				const ids =
					current.selectedIds ??
					(current.selectedId ? [current.selectedId] : []);

				if (action.mode === "context" && ids.includes(action.id)) return state;

				if (
					action.view === "history" &&
					!action.mode &&
					current.selectedId === action.id &&
					ids.length === 1 &&
					ids[0] === action.id
				)
					return state;

				let selectedIds = [action.id];
				let anchorId = action.id;

				if (action.mode === "toggle")
					selectedIds = ids.includes(action.id)
						? ids.filter((id) => id !== action.id)
						: [...ids, action.id];

				if (action.mode === "range") {
					anchorId = current.anchorId ?? current.selectedId ?? action.id;

					if (!entries.some((entry) => entry.id === anchorId))
						anchorId = action.id;

					const anchor = Math.max(
						0,
						entries.findIndex((entry) => entry.id === anchorId)
					);

					const target = entries.findIndex((entry) => entry.id === action.id);

					selectedIds = entries
						.slice(Math.min(anchor, target), Math.max(anchor, target) + 1)
						.map((entry) => entry.id);
				}

				return {
					...state,
					restoreHistoryLimit:
						action.view === "history" ? undefined : state.restoreHistoryLimit,
					views: {
						...state.views,
						[action.view]: {
							...current,
							selectedId: action.id,
							selectedIds,
							anchorId,
							...(action.view === "history" && current.selectedId !== action.id
								? {
										files: {
											selectedId:
												state.entries.history.find(
													(entry) => entry.id === action.id
												)?.files[0]?.id ?? null,
											scrollY: 0,
										},
									}
								: {}),
						},
					},
				};
			}

			if (
				current.selectedId === action.id ||
				!state.entries[action.view].some((entry) => entry.id === action.id)
			)
				return state;

			return {
				...state,
				views: {
					...state.views,
					stashes: {
						...state.views.stashes,
						selectedId: action.id,
						files: {
							selectedId:
								state.entries[action.view].find(
									(entry) => entry.id === action.id
								)?.files[0]?.id ?? null,
							scrollY: 0,
						},
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
		entries: readonly { readonly id: string }[],
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

	/** Presents one file's changes without exposing Git's staging model. */
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
			statusDescription: `${file.originalPath ? `renamed from ${file.originalPath}; ` : ""}${file.recordType === "unmerged" ? "conflicted" : file.worktreeStatus === "unmodified" ? file.indexStatus : file.worktreeStatus}${file.submodule !== "N..." ? "; submodule changes" : ""}`,
		};
	}
}
