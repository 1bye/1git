import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";

import type {
	RepositoryView,
	WorkspaceEntry,
	WorkspaceRevision,
} from "../lib/sample-workspace";
import { RepositoryIcon } from "./repository-icon";

const styles = StyleSheet.create({
	header: {
		height: 40,
		flexShrink: 0,
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: 16,
		paddingLeft: 20,
		paddingRight: 20,
		borderBottomWidth: 1,
		borderColor: lightColors.editorHairline,
	},
	title: {
		fontSize: 11,
		color: lightColors.editorMuted,
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
		overflowX: "hidden",
		flexGrow: 1,
	},
	empty: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		minHeight: 0,
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
		padding: 24,
	},
	heading: { fontSize: 13, fontWeight: 500, color: lightColors.editorInk },
	hint: { fontSize: 11, color: lightColors.editorFaint },
});

/** Intentionally empty preview surface; selection is real, diff content is not wired yet. */
export function RepositoryDiffEmpty({
	selected,
	revision,
	view = "changes",
	hasWorkspace = true,
}: {
	selected?: WorkspaceEntry;
	revision?: WorkspaceRevision;
	view?: RepositoryView;
	hasWorkspace?: boolean;
}) {
	let heading = "Select an item to inspect";
	let hint = "Choose a changed file, commit, or stash from the list.";

	if (!hasWorkspace) {
		heading = "No workspace open";
		hint = "Use + to create a sample workspace.";
	} else if (selected) {
		heading = "Diff preview comes next";
		hint = "This workspace uses sample data. No repository is connected.";
	} else if (view !== "changes") {
		const kind = view === "history" ? "commit" : "stash";

		heading = revision
			? revision.files.length === 0
				? "No file changes"
				: "Select a file to inspect"
			: `Select a ${kind} to inspect`;
		hint = revision
			? revision.files.length === 0
				? `This sample ${kind} has no changed files.`
				: `Choose a file below the ${kind} list. This is sample data.`
			: `Choose a ${kind} to see its files. No repository is connected.`;
	}

	return (
		<>
			{selected ? (
				<div testId="diff-header" style={styles.header}>
					<text testId="diff-selection" style={styles.title}>
						{selected.title}
					</text>
					<text style={{ fontSize: 9, color: lightColors.editorFaint }}>
						Preview
					</text>
				</div>
			) : null}
			<div testId="diff-empty" style={styles.empty}>
				<RepositoryIcon name="diff" />
				<text style={styles.heading}>{heading}</text>
				<text style={styles.hint}>{hint}</text>
			</div>
		</>
	);
}
