import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import {
	useGpuixRequired,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { useEffect, useRef, useState } from "react";

import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceAction,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import {
	sampleEntries,
	type RepositoryView,
	type WorkspaceEntry,
} from "../lib/sample-workspace";
import { RepositoryChangeLabel } from "./repository-change-details";
import { appTokens } from "../../../styles/tokens";

const fileRowHeight = 28;
const revisionRowHeight = 48;

const styles = StyleSheet.create({
	viewport: {
		flexGrow: 1,
		minHeight: 0,
		overflowY: "scroll",
		overflowX: "hidden",
	},
	list: {
		display: "flex",
		flexDirection: "column",
		paddingLeft: 6,
		paddingRight: 6,
		paddingBottom: 6,
	},
	row: {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		height: fileRowHeight,
		flexShrink: 0,
		paddingLeft: 8,
		paddingRight: 8,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: "transparent",
		cursor: "pointer",
		hover: { backgroundColor: lightColors.editorHairline },
	},
	selected: {
		backgroundColor: lightColors.editorSunken2,
		hover: { backgroundColor: lightColors.editorSunken2 },
	},
	focused: { borderColor: lightColors.brand },
	label: {
		fontSize: 11,
		fontWeight: 400,
		color: lightColors.editorInk,
		minWidth: 0,
		overflowX: "hidden",
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
		pointerEvents: "none",
	},
	detail: {
		fontSize: 9,
		color: lightColors.editorFaint,
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
		overflowX: "hidden",
		pointerEvents: "none",
	},
});

function RepositoryRow({
	entry,
	selected,
	tabbable,
	rowRef,
	onSelect,
	onKeyDown,
	onReveal,
	included,
	onInclude,
}: {
	entry: WorkspaceEntry;
	selected: boolean;
	tabbable: boolean;
	rowRef: (node: PublicInstance | null) => void;
	onSelect: () => void;
	onKeyDown: (event: EventPayload) => void;
	onReveal: () => void;
	included: boolean;
	onInclude: (included: boolean) => void;
}) {
	const [focused, setFocused] = useState(false);
	const [keyboard, setKeyboard] = useState(true);
	const [hovered, setHovered] = useState(false);

	return (
		<div
			role={entry.status ? "row" : "presentation"}
			testId={`row-${entry.id}`}
			style={StyleSheet.compose(
				styles.row,
				!!entry.status && { borderRadius: 4, paddingRight: 4, gap: 4 },
				!!entry.detail && { height: revisionRowHeight },
				hovered && { backgroundColor: lightColors.editorHairline },
				selected && styles.selected,
				focused && keyboard && styles.focused
			)}
		>
			<div
				ref={rowRef}
				testId={`entry-${entry.id}`}
				role={entry.status ? "gridcell" : "option"}
				aria-label={
					entry.status
						? `${entry.title}, ${entry.status === "A" ? "added" : entry.status === "D" ? "deleted" : "modified"}`
						: entry.title
				}
				aria-selected={selected}
				tabIndex={tabbable ? 0 : -1}
				onMouseDown={() => setKeyboard(false)}
				onClick={onSelect}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				onFocus={() => {
					setFocused(true);
					onReveal();
				}}
				onBlur={() => {
					setFocused(false);
					setKeyboard(true);
				}}
				onKeyDown={(event) => {
					setKeyboard(true);
					onKeyDown(event);
				}}
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					flexGrow: 1,
					minWidth: 0,
					height: "100%",
				}}
			>
				{entry.status ? (
					<RepositoryChangeLabel entry={entry} />
				) : (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							flexGrow: 1,
							minWidth: 0,
							gap: 4,
							pointerEvents: "none",
						}}
					>
						<text style={styles.label}>{entry.title}</text>
						{entry.detail ? (
							<text style={styles.detail}>{entry.detail}</text>
						) : null}
					</div>
				)}
			</div>
			{entry.status ? (
				<div role="gridcell" style={{ flexShrink: 0 }}>
					<Checkbox
						testId={`include-${entry.id}`}
						aria-label={`Include ${entry.title} in commit`}
						checked={included}
						onCheckedChange={onInclude}
						tokens={appTokens}
						tabIndex={tabbable ? 0 : -1}
						onFocus={onReveal}
						onMouseEnter={() => setHovered(true)}
						onMouseLeave={() => setHovered(false)}
						onKeyDown={(event) => {
							if (event.key !== "space" && event.key !== "enter")
								onKeyDown(event);
						}}
					/>
				</div>
			) : null}
		</div>
	);
}

/** Native scrolling and roving row focus; remount per tab/view to restore that view's viewport. */
export function RepositoryList({
	view,
	state,
	includedFileIds,
	onAction,
}: {
	view: RepositoryView;
	state: RepositoryWorkspaceState["views"][RepositoryView];
	includedFileIds: readonly string[];
	onAction: (action: RepositoryWorkspaceAction) => void;
}) {
	const renderer = useGpuixRequired();
	const viewport = useRef<PublicInstance>(null);
	const rows = useRef(new Map<string, PublicInstance>());
	const initialScroll = useRef(state.scrollY);
	const entries = sampleEntries[view];

	const [focusId, setFocusId] = useState(state.selectedId ?? entries[0]?.id);

	useEffect(() => {
		if (viewport.current)
			renderer.scrollTo?.(viewport.current.id, 0, initialScroll.current);
	}, [renderer]);

	const saveScroll = (): void => {
		if (!viewport.current) return;

		const y = renderer.getScrollOffset?.(viewport.current.id)?.[1] ?? 0;

		onAction({ type: "scroll", view, y });
	};

	const reveal = (row: PublicInstance): void => {
		const node = viewport.current;
		const box = node && renderer.getElementBounds?.(node.id);
		const target = renderer.getElementBounds?.(row.id);

		if (!node || !box || !target) return;

		const offset = renderer.getScrollOffset?.(node.id)?.[1] ?? 0;
		// Native bounds use the scrolled content origin, not the clip's origin.
		const top = box.y - offset;

		const delta =
			target.y < top
				? target.y - top
				: Math.max(0, target.y + target.height - top - box.height);

		renderer.scrollTo?.(node.id, 0, offset - delta);
		saveScroll();
	};

	const revealRow = (id: string): void => {
		const row = rows.current.get(id);

		if (row) reveal(row);
	};

	const select = (id: string, reveal: boolean): void => {
		const row = rows.current.get(id);

		if (!row) return;

		onAction({ type: "select", view, id });
		setFocusId(id);
		renderer.focusElement?.(row.id);

		if (reveal) revealRow(id);
	};

	const navigate = (id: string, event: EventPayload): void => {
		if (
			event.modifiers?.cmd ||
			event.modifiers?.ctrl ||
			event.modifiers?.alt ||
			event.modifiers?.shift
		)
			return;

		const key = event.key ?? "";

		if (key === "enter" || key === "space") {
			select(id, true);

			return;
		}

		const height = viewport.current
			? (renderer.getElementBounds?.(viewport.current.id)?.height ?? 0)
			: 0;

		const rowHeight = view === "changes" ? fileRowHeight : revisionRowHeight;

		const next = RepositoryWorkspaceModel.destination(
			view,
			id,
			key,
			Math.max(1, Math.floor(height / rowHeight) - 1)
		);

		if (next) select(next, true);
	};

	return (
		<div
			ref={viewport}
			testId="repository-list"
			role={view === "changes" ? "grid" : "listbox"}
			aria-label={
				view === "changes"
					? "Changed files"
					: view === "history"
						? "Commit history"
						: "Saved stashes"
			}
			onScroll={saveScroll}
			style={styles.viewport}
		>
			<div style={styles.list}>
				{entries.map((entry) => (
					<RepositoryRow
						key={entry.id}
						entry={entry}
						selected={state.selectedId === entry.id}
						included={includedFileIds.includes(entry.id)}
						onInclude={(included) =>
							onAction({ type: "include-file", id: entry.id, included })
						}
						tabbable={focusId === entry.id}
						rowRef={(node) => {
							if (node) rows.current.set(entry.id, node);
							else rows.current.delete(entry.id);
						}}
						onSelect={() => select(entry.id, false)}
						onReveal={() => {
							setFocusId(entry.id);
							revealRow(entry.id);
						}}
						onKeyDown={(event) => navigate(entry.id, event)}
					/>
				))}
			</div>
		</div>
	);
}
