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
	type RepositoryListState,
} from "../lib/repository-workspace-model";
import type { WorkspaceEntry } from "../types";
import { RepositoryChangeLabel } from "./repository-change-details";
import { appTokens } from "../../../styles/tokens";
import {
	RepositoryFileMenu,
	type FileMenuActions,
} from "./repository-file-menu";

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
	inclusionDisabled,
	fileActions,
}: {
	entry: WorkspaceEntry;
	selected: boolean;
	tabbable: boolean;
	rowRef: (node: PublicInstance | null) => void;
	onSelect: () => void;
	onKeyDown: (event: EventPayload) => void;
	onReveal: () => void;
	included?: boolean;
	onInclude?: (included: boolean) => void;
	inclusionDisabled?: boolean;
	fileActions?: FileMenuActions;
}) {
	const [focused, setFocused] = useState(false);
	const [keyboard, setKeyboard] = useState(true);
	const [hovered, setHovered] = useState(false);

	const row = (onMenu?: (event: EventPayload) => void) => (
		<div
			role={onInclude ? "row" : "presentation"}
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
				role={onInclude ? "gridcell" : "option"}
				aria-label={
					entry.status
						? `${entry.title}, ${entry.statusDescription ?? (entry.status === "A" ? "added" : entry.status === "D" ? "deleted" : "modified")}`
						: entry.title
				}
				aria-description={entry.detail}
				aria-selected={selected}
				tabIndex={tabbable ? 0 : -1}
				onMouseDown={() => setKeyboard(false)}
				onClick={(event) => {
					if (event.modifiers?.ctrl && onMenu) onMenu(event);
					else onSelect();
				}}
				onAuxClick={(event) => {
					if (event.button === 2 || event.isRightClick) onMenu?.(event);
				}}
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
					if (event.key === "f10" && event.modifiers?.shift) {
						onMenu?.(event);

						return;
					}

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
			{onInclude ? (
				<div role="gridcell" style={{ flexShrink: 0 }}>
					<Checkbox
						testId={`include-${entry.id}`}
						aria-label={`Include ${entry.title} in commit`}
						checked={included ?? false}
						disabled={inclusionDisabled}
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

	return fileActions ? (
		<RepositoryFileMenu entry={entry} actions={fileActions}>
			{row}
		</RepositoryFileMenu>
	) : (
		row()
	);
}

/** Shared file/revision list with native scrolling and roving focus; remount when its data owner changes. */
export function RepositoryList({
	entries,
	label,
	testId = "repository-list",
	emptyMessage,
	state,
	inclusion,
	onSelect,
	onScroll,
	onEndReached,
	fileActions,
}: {
	entries: readonly WorkspaceEntry[];
	label: string;
	testId?: string;
	emptyMessage: string;
	state: RepositoryListState;
	inclusion?: {
		ids: readonly string[];
		disabled?: boolean;
		onChange: (id: string, included: boolean) => void;
	};
	onSelect: (id: string) => void;
	onScroll: (y: number) => void;
	onEndReached?: () => void;
	fileActions?: FileMenuActions;
}) {
	const renderer = useGpuixRequired();
	const viewport = useRef<PublicInstance>(null);
	const rows = useRef(new Map<string, PublicInstance>());
	const initialScroll = useRef(state.scrollY);

	const [focusId, setFocusId] = useState(state.selectedId ?? entries[0]?.id);

	const tabbableId = entries.some((entry) => entry.id === focusId)
		? focusId
		: (state.selectedId ?? entries[0]?.id);

	useEffect(() => {
		if (viewport.current)
			renderer.scrollTo?.(viewport.current.id, 0, initialScroll.current);
	}, [renderer]);

	const saveScroll = (): void => {
		if (!viewport.current) return;

		const y = renderer.getScrollOffset?.(viewport.current.id)?.[1] ?? 0;

		onScroll(y);

		if (onEndReached) {
			const box = renderer.getElementBounds?.(viewport.current.id);
			const last = entries.at(-1);
			const row = last && rows.current.get(last.id);
			const bounds = row && renderer.getElementBounds?.(row.id);

			if (
				box &&
				bounds &&
				bounds.y + bounds.height <=
					box.y - y + box.height + revisionRowHeight * 3
			)
				onEndReached();
		}
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

		onSelect(id);
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

		const rowHeight = entries[0]?.detail ? revisionRowHeight : fileRowHeight;

		const next = RepositoryWorkspaceModel.destination(
			entries,
			id,
			key,
			Math.max(1, Math.floor(height / rowHeight) - 1)
		);

		if (next) select(next, true);
	};

	return (
		<div
			ref={viewport}
			testId={testId}
			role={inclusion ? "grid" : "listbox"}
			aria-label={label}
			onScroll={saveScroll}
			style={styles.viewport}
		>
			<div style={styles.list}>
				{entries.length === 0 ? (
					<text style={{ ...styles.detail, padding: 14 }}>{emptyMessage}</text>
				) : null}
				{entries.map((entry) => (
					<RepositoryRow
						key={entry.id}
						entry={entry}
						fileActions={fileActions}
						selected={state.selectedId === entry.id}
						included={inclusion?.ids.includes(entry.id)}
						inclusionDisabled={inclusion?.disabled}
						onInclude={
							inclusion
								? (included) => inclusion.onChange(entry.id, included)
								: undefined
						}
						tabbable={tabbableId === entry.id}
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
