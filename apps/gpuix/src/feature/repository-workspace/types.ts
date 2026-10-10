import type {
	CommitFileChange,
	CommitInfo,
	FileChange,
	StashInfo,
	TagInfo,
} from "@1git/git";

/** Immutable committed comparison, never an index or working-tree selection. */
export interface CommitFileSelection extends CommitFileChange {
	readonly base?: string;
	readonly commit: string;
}

/** Repository navigation views. */
export type RepositoryView = "changes" | "history" | "stashes";

/** Views whose selected revision owns a second file list. */
export type RevisionView = Exclude<RepositoryView, "changes">;

/** File/revision presentation data, independent of the native renderer. */
export interface WorkspaceEntry {
	readonly id: string;
	readonly title: string;
	readonly detail?: string;
	/** Mutable local labels attached to historical commits; never imply publication. */
	readonly tags?: readonly TagInfo[];
	readonly status?: "M" | "A" | "D" | "R" | "C" | "U" | "T";
	readonly statusDescription?: string;
	/** Original Git status, present only for live Changes rows. */
	readonly change?: FileChange;
	readonly commitFile?: CommitFileSelection;
}

/** Commit or stash presentation with its own changed files. */
export interface WorkspaceRevision extends WorkspaceEntry {
	readonly files: readonly WorkspaceEntry[];
	readonly commit?: CommitInfo;
	readonly stash?: StashInfo;
	readonly filesLoaded?: boolean;
	readonly filesError?: string;
}

/** Lists owned by a workspace; unavailable live views remain empty, never sample-filled. */
export interface WorkspaceEntries {
	readonly changes: readonly WorkspaceEntry[];
	readonly history: readonly WorkspaceRevision[];
	readonly stashes: readonly WorkspaceRevision[];
}

/** Shared labels and keyboard order for the repository rail tabs. */
export const repositoryViews: readonly {
	value: RepositoryView;
	label: string;
}[] = [
	{ value: "changes", label: "Changes" },
	{ value: "history", label: "History" },
	{ value: "stashes", label: "Stashes" },
];
