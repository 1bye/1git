import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";

import type { WorkspaceEntry } from "../lib/sample-workspace";
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
	hasWorkspace = true,
}: {
	selected?: WorkspaceEntry;
	hasWorkspace?: boolean;
}) {
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
				<text style={styles.heading}>
					{!hasWorkspace
						? "No workspace open"
						: selected
							? "Diff preview comes next"
							: "Select an item to inspect"}
				</text>
				<text style={styles.hint}>
					{!hasWorkspace
						? "Use + to create a sample workspace."
						: selected
							? "This workspace uses sample data. No repository is connected."
							: "Choose a changed file, commit, or stash from the list."}
				</text>
			</div>
		</>
	);
}
