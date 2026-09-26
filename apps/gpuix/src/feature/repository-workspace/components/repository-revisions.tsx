import { lightColors } from "@1git/design-tokens";
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
import type { RevisionView } from "../types";
import { RepositoryList } from "./repository-list";
import { RepositoryReadNotice } from "./repository-read-notice";

const dividerHeight = 9;

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
		hover: { backgroundColor: lightColors.editorSunken },
	},
	header: {
		height: 28,
		flexShrink: 0,
		paddingLeft: 14,
		paddingRight: 14,
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
	},
	muted: { fontSize: 10, color: lightColors.editorMuted },
});

/** Stacked revision/files navigation with a captured, keyboard-accessible split; no Git actions. */
export function RepositoryRevisions({
	view,
	state,
	onAction,
	children,
	loadingFiles = false,
	onRetryFiles,
}: {
	view: RevisionView;
	state: RepositoryWorkspaceState;
	onAction: (action: RepositoryWorkspaceAction) => void;
	children: ReactNode;
	loadingFiles?: boolean;
	onRetryFiles?: () => void;
}) {
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
								? lightColors.brand
								: lightColors.editorHairline,
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
					{revision ? (
						<text style={styles.muted}>{revision.files.length}</text>
					) : null}
				</div>
				<RepositoryList
					key={revision?.id ?? "unselected"}
					testId="revision-files"
					label={
						view === "history"
							? "Files in selected commit"
							: "Files in selected stash"
					}
					entries={revision?.files ?? []}
					state={current.files}
					emptyMessage={
						loadingFiles
							? "Reading committed files…"
							: revision?.filesError
								? "Could not read committed files."
								: revision
									? "No file changes in this revision."
									: view === "history"
										? "Select a commit to see its files."
										: "Select a stash to see its files."
					}
					onSelect={(id) =>
						onAction({ type: "select-revision-file", view, id })
					}
					onScroll={(y) => onAction({ type: "scroll-revision-files", view, y })}
				/>
				{revision?.filesError && onRetryFiles ? (
					<RepositoryReadNotice
						testId="retry-history-files"
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
