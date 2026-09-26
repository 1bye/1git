/** Repository navigation views; only Changes currently reads live repository data. */
export type RepositoryView = "changes" | "history" | "stashes";

/** Views whose selected revision owns a second file list. */
export type RevisionView = Exclude<RepositoryView, "changes">;

/** File/revision presentation data, independent of the native renderer. */
export interface WorkspaceEntry {
	readonly id: string;
	readonly title: string;
	readonly detail?: string;
	readonly status?: "M" | "A" | "D" | "R" | "C" | "U" | "T";
	readonly statusDescription?: string;
}

/** Commit or stash presentation with its own changed files. */
export interface WorkspaceRevision extends WorkspaceEntry {
	readonly files: readonly WorkspaceEntry[];
}

/** Lists owned by a workspace; unavailable live views remain empty, never sample-filled. */
export interface WorkspaceEntries {
	readonly changes: readonly WorkspaceEntry[];
	readonly history: readonly WorkspaceRevision[];
	readonly stashes: readonly WorkspaceRevision[];
}

/** Shared labels and keyboard order for the three view pills. */
export const repositoryViews: readonly {
	value: RepositoryView;
	label: string;
}[] = [
	{ value: "changes", label: "Changes" },
	{ value: "history", label: "History" },
	{ value: "stashes", label: "Stashes" },
];
