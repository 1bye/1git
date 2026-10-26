import { useState } from "react";
import { spacing, typography } from "@1git/design-tokens";
import { useAppTheme } from "../../../styles/theme";
import { repositoryConflictTheme } from "../lib/repository-conflict-theme";
import type { RepositoryListState } from "../lib/repository-workspace-model";
import type { WorkspaceEntry } from "../types";
import type { FileMenuActions } from "./repository-file-menu";
import { RepositoryList, fileRowHeight } from "./repository-list";

const groupHeaderHeight = typography.xs.lineHeight + spacing[2.5] * 2;
const groupInset = groupHeaderHeight + spacing[1.5];

/** Resolution progress replaces commit-inclusion checkboxes while a Git operation owns the index. */
export function RepositoryConflictFiles({
	entries,
	state,
	onSelect,
	onPreviewIntent,
	fileActions,
}: {
	entries: readonly WorkspaceEntry[];
	state: RepositoryListState;
	onSelect: (id: string) => void;
	onPreviewIntent?: (entry: WorkspaceEntry | null) => void;
	fileActions?: FileMenuActions;
}) {
	const theme = useAppTheme();
	const palette = repositoryConflictTheme.get(theme);
	const [scroll, setScroll] = useState({ conflicts: 0, changes: 0 });

	const conflicts = entries.filter(
		(entry) => entry.change?.recordType === "unmerged"
	);

	const changes = entries.filter(
		(entry) => entry.change?.recordType !== "unmerged"
	);

	const groups = [
		{ id: "conflicts" as const, title: "Conflicts", entries: conflicts },
		{ id: "changes" as const, title: "Other changes", entries: changes },
	];

	return (
		<div
			testId="conflict-files"
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
			}}
		>
			{!entries.length ? (
				<text
					role="status"
					style={{
						...typography.xs,
						color: theme.colors.editorMuted,
						padding: spacing[3],
					}}
				>
					No files to show.
				</text>
			) : null}
			{groups
				.filter((group) => group.entries.length > 0)
				.map((group) => (
					<div
						key={group.id}
						style={{
							display: "flex",
							flexDirection: "column",
							minHeight: groupInset + fileRowHeight,
							...(group.id === "conflicts" && changes.length
								? {
										height: group.entries.length * fileRowHeight + groupInset,
										maxHeight: "60%",
										flexShrink: 1,
									}
								: { flexGrow: 1, flexBasis: 0 }),
						}}
					>
						<text
							testId={`conflict-group-${group.id}`}
							style={{
								...typography.xs,
								padding: spacing[2.5],
								flexShrink: 0,
								color:
									group.id === "conflicts"
										? palette.warning.ink
										: theme.colors.editorMuted,
							}}
						>
							{`${group.title} · ${group.entries.length}`}
						</text>
						<RepositoryList
							testId={`operation-${group.id}`}
							label={group.title}
							entries={group.entries}
							emptyMessage=""
							state={{
								selectedId: state.selectedId,
								scrollY: scroll[group.id],
							}}
							onSelect={onSelect}
							onScroll={(y) =>
								setScroll((previous) =>
									previous[group.id] === y
										? previous
										: { ...previous, [group.id]: y }
								)
							}
							onPreviewIntent={onPreviewIntent}
							fileActions={fileActions}
						/>
					</div>
				))}
		</div>
	);
}
