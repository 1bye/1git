import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";

import type {
	RepositoryView,
	WorkspaceEntry,
	WorkspaceRevision,
} from "../types";
import type { RepositoryWorkspaceState } from "../lib/repository-workspace-model";
import { appTokens } from "../../../styles/tokens";
import { RepositoryIcon } from "./repository-icon";
import { ComparisonArtwork } from "../../../fixture/comparison-artwork";

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

/** Empty, sample-only and not-yet-connected views without invented repository data. */
export function RepositoryDiffEmpty({
	selected,
	revision,
	view = "changes",
	hasWorkspace = true,
	workspace,
	picking = false,
	onOpen,
}: {
	selected?: WorkspaceEntry;
	revision?: WorkspaceRevision;
	view?: RepositoryView;
	hasWorkspace?: boolean;
	workspace?: RepositoryWorkspaceState;
	picking?: boolean;
	onOpen?: () => void;
}) {
	let heading = "Select an item to inspect";
	let hint = "Choose a changed file, commit, or stash from the list.";

	if (!hasWorkspace) {
		heading = "No workspace open";
		hint = "Use + to create a workspace.";
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

	if (hasWorkspace && workspace && !workspace.preview) {
		if (!workspace.repository) {
			heading = workspace.loading
				? "Reading repository…"
				: workspace.repositoryPath
					? "Repository unavailable"
					: "Open a Git repository";
			hint =
				workspace.repositoryPath ??
				workspace.error ??
				"Choose a local repository to view its changed files.";
		} else if (view === "history") {
			heading = !workspace.repository.head
				? "No commits yet"
				: revision
					? "Select a file to inspect"
					: "Select a commit to inspect";
			hint = !workspace.repository.head
				? "This repository has no committed history."
				: revision?.filesLoaded && !revision.files.length
					? "This commit has no file changes compared with its first parent."
					: "Choose a commit and a changed file. History is read-only.";
		} else if (view === "stashes") {
			heading = revision
				? "Select a file to inspect"
				: workspace.stashes.loaded
					? "No stashed changes"
					: "Select a stash to inspect";
			hint =
				revision?.filesLoaded && !revision.files.length
					? "This stash has no file changes compared with its base."
					: "Save changes with New stash, then inspect, apply or delete saved work here.";
		} else {
			if (selected) heading = "Diff preview comes next";
			else if (workspace.loading) heading = "Reading repository…";
			else if (workspace.error) heading = "Could not refresh repository";
			else
				heading = workspace.entries.changes.length
					? "Select a file to inspect"
					: "Working tree clean";

			hint =
				"Choose a file to inspect its diff. Check the whole files you want to commit.";
		}
	}

	const clean = heading === "Working tree clean";

	if (clean) hint = "No uncommitted changes.";

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
				{clean ? (
					<ComparisonArtwork name="empty" />
				) : (
					<RepositoryIcon name="diff" />
				)}
				<text style={styles.heading}>{heading}</text>
				<text style={styles.hint}>{hint}</text>
				{workspace && !workspace.preview && !workspace.repository ? (
					<Button
						testId="open-repository"
						tokens={appTokens}
						size="sm"
						disabled={picking || workspace.loading}
						onPress={onOpen}
					>
						{picking
							? "Opening…"
							: workspace.repositoryPath
								? "Retry repository"
								: "Open repository…"}
					</Button>
				) : null}
			</div>
		</>
	);
}
