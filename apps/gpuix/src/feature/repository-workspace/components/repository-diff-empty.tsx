import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, typography, fontWeight } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";

import type {
	RepositoryView,
	WorkspaceEntry,
	WorkspaceRevision,
} from "../types";
import type { RepositoryWorkspaceState } from "../lib/repository-workspace-model";

import { ComparisonArtwork } from "../../../fixture/comparison-artwork";
import {
	StateArtwork,
	type StateArtworkName,
} from "../../../fixture/state-artwork";

const themedStyles = createThemedStyles(({ colors: appColors }) => {
	const styles = StyleSheet.create({
		header: {
			height: 40,
			flexShrink: 0,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: spacing[4],
			paddingLeft: spacing[5],
			paddingRight: spacing[5],
			borderBottomWidth: 1,
			borderColor: appColors.editorHairline,
		},
		title: {
			...typography.sm,
			color: appColors.editorMuted,
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
			gap: spacing[2],
			padding: spacing[6],
		},
		heading: {
			...typography.lg,
			fontWeight: fontWeight.medium,
			color: appColors.editorInk,
		},
		hint: {
			...typography.sm,
			color: appColors.editorFaint,
			textAlign: "center",
			maxWidth: 420,
		},
	});

	return { styles };
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
	const theme = useAppTheme();
	const { tokens: appTokens, colors: appColors } = theme;
	const { styles } = themedStyles.get(theme);

	let heading = "Select an item to inspect";
	let hint = "Choose a changed file, commit, or stash from the list.";

	if (!hasWorkspace) {
		heading = "No workspace open";
		hint = "Open Home to choose a repository.";
	} else if (selected) {
		heading = "Diff preview comes next";
		hint = "This workspace uses sample data. No repository is connected.";
	} else if (view === "graph") {
		heading = "Open a repository to explore its graph";
		hint =
			"Branches, tags and commit connections appear here for a connected repository.";
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
					: "Start a workspace";
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
				: workspace.stashes.loaded && !workspace.entries.stashes.length
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

			hint = workspace.entries.changes.some(
				(entry) => entry.change?.recordType === "unmerged"
			)
				? "Choose a conflicted file to compare its versions and review the working result."
				: workspace.repository.operation !== "normal"
					? "Choose a file to review before continuing the Git operation."
					: "Choose a file to inspect its diff. Check the whole files you want to commit.";
		}
	}

	let artwork: StateArtworkName =
		selected || revision || view === "changes"
			? "file"
			: view === "history"
				? "history"
				: "stash";

	let error: string | null | undefined;

	if (!hasWorkspace || (workspace && !workspace.repository))
		artwork = workspace?.repositoryPath ? "error" : "repository";

	if (workspace && !workspace.preview) {
		error =
			workspace.error ??
			(view === "history" ? workspace.history.error : null) ??
			(view === "stashes" ? workspace.stashes.error : null) ??
			revision?.filesError;

		const reading =
			workspace.loading ||
			(workspace.repository &&
				((view === "history" &&
					workspace.history.nextOffset === 0 &&
					!workspace.entries.history.length) ||
					(view === "stashes" && !workspace.stashes.loaded) ||
					(revision && !revision.filesLoaded)));

		if (error) {
			artwork = "error";
			heading = "Could not read repository";
			hint = error;
		} else if (reading) {
			artwork = "loading";
			heading = "Reading repository…";
			hint = "Your files and saved history will appear here.";
		} else if (
			view === "history" &&
			workspace.history.query?.trim() &&
			!workspace.entries.history.length
		) {
			artwork = "search";
			heading = "No matching commits";
			hint = workspace.history.file
				? "Try another search or clear the filter to see this file's history."
				: "Try another search or clear the filter to see all commits.";
		} else if (
			view === "history" &&
			workspace.history.file &&
			!workspace.entries.history.length
		) {
			artwork = "history";
			heading = "No commits for this file";
			hint = "This file has no committed changes at the selected revision.";
		} else if (revision?.filesLoaded && !revision.files.length) {
			artwork = "file";
			heading = "No file changes";
		}
	}

	const clean = heading === "Working tree clean";

	const illustratedEmpty =
		(clean ||
			heading === "No commits yet" ||
			heading === "No stashed changes") &&
		!workspace?.loading &&
		!error &&
		(view !== "history" || !workspace?.history.query?.trim());

	if (clean) hint = "No uncommitted changes.";

	return (
		<>
			{selected ? (
				<div testId="diff-header" style={styles.header}>
					<text testId="diff-selection" style={styles.title}>
						{selected.title}
					</text>
					<text style={{ ...typography["2xs"], color: appColors.editorFaint }}>
						Preview
					</text>
				</div>
			) : null}
			<div
				testId="diff-empty"
				role={error ? "alert" : "status"}
				aria-label={heading}
				style={styles.empty}
			>
				{illustratedEmpty ? (
					<ComparisonArtwork name="empty" />
				) : (
					<StateArtwork name={artwork} />
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
