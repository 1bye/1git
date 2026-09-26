/** Views supported by the in-memory workspace preview. */
export type RepositoryView = "changes" | "history" | "stashes";

/** Display-only entries; these never refer to files or revisions on disk. */
export interface WorkspaceEntry {
	readonly id: string;
	readonly title: string;
	readonly detail?: string;
	readonly status?: "M" | "A" | "D";
}

/** Reuses the desktop's three views without exposing unfinished Git commands. */
export const repositoryViews: readonly {
	value: RepositoryView;
	label: string;
}[] = [
	{ value: "changes", label: "Changes" },
	{ value: "history", label: "History" },
	{ value: "stashes", label: "Stashes" },
];

const paths = [
	"src/app.tsx",
	"src/styles/tokens.ts",
	"src/fixture/app-shell.tsx",
	"src/main.tsx",
	"README.md",
	"src/feature/workspace/tabs.tsx",
	"src/feature/workspace/sidebar.tsx",
	"src/feature/workspace/file-row.tsx",
	"src/feature/workspace/history.tsx",
	"src/feature/workspace/stashes.tsx",
	"src/feature/workspace/diff.tsx",
	"src/feature/workspace/toolbar.tsx",
	"src/feature/workspace/model.ts",
	"src/feature/workspace/selection.ts",
	"src/styles/layout.ts",
	"src/styles/typography.ts",
	"src/styles/colors.ts",
	"src/assets/file.svg",
	"src/assets/branch.svg",
	"src/assets/legacy-icon.svg",
	"tests/workspace/layout.test.tsx",
	"tests/workspace/selection.test.tsx",
	"tests/workspace/scroll.test.tsx",
	"tests/workspace/keyboard.test.tsx",
	"tests/workspace/tabs.test.tsx",
	"tests/workspace/model.test.ts",
	"docs/architecture.md",
	"docs/keyboard.md",
	"package.json",
	"tsconfig.json",
];

const summaries = [
	"Refine workspace tab spacing",
	"Add smooth tab reordering",
	"Keep workspace selection per tab",
	"Align native and desktop tokens",
	"Polish sidebar navigation",
	"Scaffold the native workspace",
];

/** Fixed, clearly labeled preview data with enough rows to exercise scrolling. */
export const sampleEntries: Readonly<
	Record<RepositoryView, readonly WorkspaceEntry[]>
> = {
	changes: paths.map((path, index) => ({
		id: path,
		title: path,
		status: index === 19 ? "D" : index % 4 === 1 ? "A" : "M",
	})),
	history: Array.from({ length: 24 }, (_, index) => ({
		id: `commit-${index + 1}`,
		title: summaries[index % summaries.length] ?? "Update workspace",
		detail: `Sample author · ${index + 1}h ago · ${(0xa31f29c - index * 137).toString(16)}`,
	})),
	stashes: [
		"Sidebar layout exploration",
		"Keyboard navigation polish",
		"Diff header experiment",
		"Compact file rows",
		"History view refinements",
		"Workspace empty states",
	].map((title, index) => ({
		id: `stash-${index + 1}`,
		title,
		detail: `stash@{${index}} · main · ${index + 1}d ago`,
	})),
};
