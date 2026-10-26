import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, typography } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import {
	useGpuixRequired,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { useRef, useState, type ReactNode } from "react";

import {
	RepositoryWorkspaceModel,
	revisionSplit,
	type RepositoryWorkspaceAction,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import type { RevisionView, WorkspaceEntry } from "../types";
import { RepositoryList } from "./repository-list";
import { RepositoryFileLayoutToggle } from "./repository-file-view";
import type { FileMenuActions } from "./repository-file-menu";
import { RepositoryReadNotice } from "./repository-read-notice";
import { EmptyListPlaceholder } from "../../../fixture/empty-list-placeholder";
import { StateMessage } from "../../../fixture/state-message";

const dividerHeight = 9;

const themedStyles = createThemedStyles(({ colors: appColors }) => {
	const styles = StyleSheet.create({
		column: {
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			minHeight: 0,
		},
		pane: {
			display: "flex",
			flexDirection: "column",
			flexBasis: 0,
			minHeight: 0,
			overflowY: "hidden",
		},
		divider: {
			height: dividerHeight,
			flexShrink: 0,
			cursor: "row-resize",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			hover: { backgroundColor: appColors.editorSunken },
		},
		header: {
			height: 28,
			flexShrink: 0,
			paddingLeft: spacing[3.5],
			paddingRight: spacing[3.5],
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
		},
		muted: { ...typography.xs, color: appColors.editorMuted },
	});

	return { styles };
});

/** Stacked revision/files navigation with a keyboard-accessible split and read-only saved-file menus. */
export function RepositoryRevisions({
	view,
	workspaceId,
	state,
	onAction,
	children,
	loadingFiles = false,
	onRetryFiles,
	onPreviewIntent,
	fileActions,
}: {
	view: RevisionView;
	workspaceId?: string;
	state: RepositoryWorkspaceState;
	onAction: (action: RepositoryWorkspaceAction) => void;
	children: ReactNode;
	loadingFiles?: boolean;
	onRetryFiles?: () => void;
	onPreviewIntent?: (entry: WorkspaceEntry | null) => void;
	fileActions?: Extract<FileMenuActions, { kind: "revision" }>;
}) {
	const theme = useAppTheme();
	const { colors: appColors } = theme;
	const { styles } = themedStyles.get(theme);

	const renderer = useGpuixRequired();
	const container = useRef<PublicInstance>(null);
	const divider = useRef<PublicInstance>(null);

	const gesture = useRef<{ y: number; ratio: number; height: number } | null>(
		null
	);

	const [focused, setFocused] = useState(false);
	const [pointerFocus, setPointerFocus] = useState(false);
	const current = state.views[view];
	const revision = RepositoryWorkspaceModel.revision(state, view);

	const emptyListReady =
		view === "history"
			? state.history.nextOffset !== 0 &&
				!state.history.error &&
				!state.history.file &&
				!state.history.query?.trim()
			: state.stashes.loaded && !state.stashes.error;

	const emptyView =
		!state.preview &&
		state.repository &&
		!state.loading &&
		!state.error &&
		!loadingFiles &&
		emptyListReady &&
		state.entries[view].length === 0;

	const emptyMessage = loadingFiles
		? "Reading saved files…"
		: revision?.filesError
			? "Could not read saved files."
			: revision
				? "No file changes in this revision."
				: view === "history"
					? "Select a commit to see its files."
					: "Select a stash to see its files.";

	const resize = (ratio: number): void =>
		onAction({ type: "resize-revisions", view, ratio });

	const cancel = (): void => {
		const start = gesture.current;

		gesture.current = null;

		if (start) resize(start.ratio);
	};

	const update = (event: EventPayload): void => {
		const start = gesture.current;

		if (start && event.y !== undefined)
			resize(start.ratio + (event.y - start.y) / start.height);
	};

	return (
		<div ref={container} testId="revision-panes" style={styles.column}>
			<div
				testId="revision-pane"
				style={StyleSheet.compose(styles.pane, {
					flexGrow: current.splitRatio,
				})}
			>
				{children}
			</div>
			<div
				ref={divider}
				testId="revision-divider"
				role="separator"
				aria-label="Resize revision and file lists"
				aria-description="Drag or use Up and Down to resize. Home and End set the limits. Escape cancels a drag."
				aria-valuetext={`${Math.round(current.splitRatio * 100)}% for revisions`}
				tabIndex={0}
				style={styles.divider}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					cancel();
					setFocused(false);
					setPointerFocus(false);
				}}
				onMouseDown={(event) => {
					if (event.button !== 0 || event.y === undefined) return;

					const box =
						container.current &&
						renderer.getElementBounds?.(container.current.id);

					if (!box || box.height <= dividerHeight) return;

					setPointerFocus(true);

					if (divider.current) renderer.focusElement?.(divider.current.id);

					gesture.current = {
						y: event.y,
						ratio: current.splitRatio,
						height: box.height - dividerHeight,
					};
				}}
				onMouseMove={(event) => {
					if (event.pressedButton !== 0) cancel();
					else update(event);
				}}
				onMouseUp={(event) => {
					if (event.button !== 0) return;

					update(event);
					gesture.current = null;
				}}
				onKeyDown={(event) => {
					setPointerFocus(false);

					if (event.key === "escape") {
						cancel();

						return;
					}

					if (
						gesture.current ||
						event.modifiers?.cmd ||
						event.modifiers?.ctrl ||
						event.modifiers?.alt ||
						event.modifiers?.shift
					)
						return;

					if (event.key === "up")
						resize(current.splitRatio - revisionSplit.step);
					else if (event.key === "down")
						resize(current.splitRatio + revisionSplit.step);
					else if (event.key === "home") resize(revisionSplit.min);
					else if (event.key === "end") resize(revisionSplit.max);
				}}
			>
				<div
					style={{
						width: "100%",
						height: 1,
						pointerEvents: "none",
						backgroundColor:
							focused && !pointerFocus
								? appColors.brand
								: appColors.editorHairline,
					}}
				/>
			</div>
			<div
				testId="revision-files-pane"
				style={StyleSheet.compose(styles.pane, {
					flexGrow: 1 - current.splitRatio,
				})}
			>
				<div style={styles.header}>
					<text style={styles.muted}>
						{view === "history" ? "Changed files" : "Stashed files"}
					</text>
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: spacing[2],
						}}
					>
						{revision ? (
							<text style={styles.muted}>{revision.files.length}</text>
						) : null}
						<RepositoryFileLayoutToggle testId="revision-file-layout" />
					</div>
				</div>
				<RepositoryList
					fileActions={fileActions}
					onPreviewIntent={onPreviewIntent}
					key={revision?.id ?? "unselected"}
					testId="revision-files"
					label={
						view === "history"
							? "Files in selected commit"
							: "Files in selected stash"
					}
					entries={revision?.files ?? []}
					fileTree={{
						owner: revision?.id,
						scope: JSON.stringify([workspaceId, state.repository?.root, view]),
					}}
					state={current.files}
					emptyContent={
						emptyView ? (
							<EmptyListPlaceholder />
						) : (
							<StateMessage
								compact
								artwork={
									loadingFiles
										? "loading"
										: revision?.filesError
											? "error"
											: revision
												? "file"
												: view === "history"
													? "history"
													: "stash"
								}
								title={emptyMessage}
								description={revision?.filesError}
								role={revision?.filesError ? "alert" : "status"}
							/>
						)
					}
					emptyMessage={emptyMessage}
					onSelect={(id) =>
						onAction({ type: "select-revision-file", view, id })
					}
					onScroll={(y) =>
						onAction({
							type: "scroll-revision-files",
							view,
							revisionId: revision?.id ?? null,
							y,
						})
					}
				/>
				{revision?.filesError && onRetryFiles ? (
					<RepositoryReadNotice
						testId={`retry-${view}-files`}
						loading={loadingFiles}
						error={revision.filesError}
						onPress={onRetryFiles}
						label="Retry"
					/>
				) : null}
			</div>
		</div>
	);
}
