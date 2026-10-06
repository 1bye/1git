import {
	spacing,
	radius,
	typography,
	fontWeight,
	lightColors,
} from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import {
	useGpuixRequired,
	useWindowSize,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";

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
const scrollSaveDelayMs = 150;
const windowChunkSize = 64;
const windowThreshold = 500;

const styles = StyleSheet.create({
	viewport: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		flexBasis: 0,
		height: "100%",
		minHeight: 0,
	},
	row: {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: spacing[2],
		height: fileRowHeight,
		flexShrink: 0,
		paddingLeft: spacing[2],
		paddingRight: spacing[2],
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: "transparent",
		cursor: "pointer",
		hover: { backgroundColor: lightColors.editorHairline },
	},
	selected: {
		backgroundColor: lightColors.editorSunken2,
		hover: { backgroundColor: lightColors.editorSunken2 },
	},
	label: {
		...typography.sm,
		fontWeight: fontWeight.regular,
		color: lightColors.editorInk,
		minWidth: 0,
		overflowX: "hidden",
		whiteSpace: "nowrap",
		textOverflow: "ellipsis",
		pointerEvents: "none",
	},
	detail: {
		...typography["2xs"],
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
	onContextMenu,
	onPreviewIntent,
}: {
	entry: WorkspaceEntry;
	selected: boolean;
	tabbable: boolean;
	rowRef: (node: PublicInstance | null) => void;
	onSelect: (event: EventPayload) => void;
	onKeyDown: (event: EventPayload) => void;
	onReveal: () => void;
	included?: boolean;
	onInclude?: (included: boolean) => void;
	inclusionDisabled?: boolean;
	fileActions?: FileMenuActions;
	onContextMenu?: (entry: WorkspaceEntry, event: EventPayload) => void;
	onPreviewIntent?: (entry: WorkspaceEntry | null) => void;
}) {
	const row = (onMenu?: (event: EventPayload) => void) => (
		<div
			role={onInclude ? "row" : "presentation"}
			testId={`row-${entry.id}`}
			onMouseEnter={onPreviewIntent ? () => onPreviewIntent(entry) : undefined}
			onMouseLeave={onPreviewIntent ? () => onPreviewIntent(null) : undefined}
			style={StyleSheet.compose(
				styles.row,
				!!entry.status && {
					borderRadius: radius.sm,
					paddingRight: spacing[1],
					gap: spacing[1],
				},
				!!entry.detail && { height: revisionRowHeight },
				selected && styles.selected
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
				onClick={(event) => {
					if (event.modifiers?.ctrl && onMenu) onMenu(event);
					else onSelect(event);
				}}
				onAuxClick={(event) => {
					if (event.button === 2 || event.isRightClick) onMenu?.(event);
				}}
				onFocus={() => {
					onPreviewIntent?.(entry);
					onReveal();
				}}
				onBlur={() => {
					onPreviewIntent?.(null);
				}}
				onKeyDown={(event) => {
					if (event.key === "f10" && event.modifiers?.shift) {
						onMenu?.(event);

						return;
					}

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
							gap: spacing[1],
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
		row(onContextMenu ? (event) => onContextMenu(entry, event) : undefined)
	);
}

/** Shared file/revision list with native scrolling and roving focus; remount when its data owner changes. */
export function RepositoryList({
	entries,
	label,
	testId = "repository-list",
	emptyMessage,
	emptyContent,
	state,
	inclusion,
	onSelect,
	onScroll,
	onEndReached,
	fileActions,
	onContextMenu,
	onPreviewIntent,
}: {
	entries: readonly WorkspaceEntry[];
	label: string;
	testId?: string;
	emptyMessage: string;
	emptyContent?: ReactNode;
	state: RepositoryListState;
	inclusion?: {
		ids: readonly string[];
		disabled?: boolean;
		onChange: (id: string, included: boolean) => void;
	};
	onSelect: (id: string, mode?: "toggle" | "range" | "context") => void;
	onScroll: (y: number) => void;
	onEndReached?: () => void;
	fileActions?: FileMenuActions;
	onContextMenu?: (entry: WorkspaceEntry, event: EventPayload) => void;
	onPreviewIntent?: (entry: WorkspaceEntry | null) => void;
}) {
	const renderer = useGpuixRequired();
	const viewport = useRef<PublicInstance>(null);
	const container = useRef<PublicInstance>(null);
	const rows = useRef(new Map<string, PublicInstance>());
	const initialScroll = useRef(state.scrollY);
	const rowHeight = entries[0]?.detail ? revisionRowHeight : fileRowHeight;
	const windowed = entries.length > windowThreshold;
	const window = useWindowSize();

	const windowSize = Math.max(
		windowChunkSize * 2,
		Math.ceil(window.height / rowHeight) + windowChunkSize * 2
	);

	const [windowStart, setWindowStart] = useState(
		Math.max(
			0,
			Math.floor(-state.scrollY / rowHeight / windowChunkSize) *
				windowChunkSize -
				windowChunkSize
		)
	);

	const start = windowed
		? Math.min(windowStart, Math.max(0, entries.length - windowSize))
		: 0;

	const end = windowed
		? Math.min(entries.length, start + windowSize)
		: entries.length;

	const pendingFocus = useRef<{ id: string; y: number } | null>(null);
	const backwardTab = useRef(false);
	const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const scrollCallback = useRef(onScroll);

	useLayoutEffect(() => {
		scrollCallback.current = onScroll;
	});
	useLayoutEffect(() => {
		if (!windowed || !viewport.current) return;

		// A newly loaded history page can cross the buffering threshold while already scrolled.
		const anchor = renderer.getListScrollTop?.(viewport.current.id);

		if (anchor)
			setWindowStart(
				Math.max(
					0,
					Math.floor((anchor[0] ?? 0) / windowChunkSize) * windowChunkSize -
						windowChunkSize
				)
			);
	}, [renderer, windowed]);
	useLayoutEffect(() => {
		const node = viewport.current;

		return () => {
			if (scrollTimer.current) clearTimeout(scrollTimer.current);

			// Save before the native list is removed, even if the view changes mid-gesture.
			if (node) {
				const y = renderer.getScrollOffset?.(node.id)?.[1];

				if (y !== undefined) scrollCallback.current(y);
			}
		};
	}, [renderer]);
	const includedIds = useMemo(() => new Set(inclusion?.ids), [inclusion?.ids]);

	const selectedIds = useMemo(
		() => new Set(state.selectedIds),
		[state.selectedIds]
	);

	const [focusId, setFocusId] = useState(state.selectedId ?? entries[0]?.id);

	const tabbableId = entries.some((entry) => entry.id === focusId)
		? focusId
		: (entries.find((entry) => entry.id === state.selectedId)?.id ??
			entries[0]?.id);

	useEffect(() => {
		if (viewport.current)
			renderer.scrollTo?.(viewport.current.id, 0, initialScroll.current);
	}, [renderer]);

	const saveScroll = (): void => {
		if (!viewport.current) return;

		if (scrollTimer.current) clearTimeout(scrollTimer.current);

		const node = viewport.current;
		// GPUI's visible-range event describes the previous frame; read the current anchor.
		const anchor = renderer.getListScrollTop?.(node.id);
		const first = anchor?.[0] ?? 0;

		const last =
			first + Math.ceil(((anchor?.[1] ?? 0) + (anchor?.[2] ?? 0)) / rowHeight);

		// Shift a generously buffered React window in chunks, not on every wheel tick.
		if (windowed && anchor) {
			if (first < start || last > end - windowChunkSize / 2)
				setWindowStart(
					Math.max(
						0,
						Math.floor(first / windowChunkSize) * windowChunkSize -
							windowChunkSize
					)
				);
		}

		// Native scrolling owns the hot path; React only remembers the settled offset.
		scrollTimer.current = setTimeout(() => {
			scrollTimer.current = null;
			scrollCallback.current(renderer.getScrollOffset?.(node.id)?.[1] ?? 0);
		}, scrollSaveDelayMs);

		if (anchor && last >= entries.length - 3) onEndReached?.();
	};

	const revealRow = (id: string, previousY?: number): void => {
		const node = viewport.current;

		const box =
			container.current && renderer.getElementBounds?.(container.current.id);

		const index = entries.findIndex((entry) => entry.id === id);

		if (!node || !box || index < 0) return;

		const top = -(previousY ?? renderer.getScrollOffset?.(node.id)?.[1] ?? 0);
		const height = renderer.getListScrollTop?.(node.id)?.[2] ?? box.height;
		const targetTop = index * rowHeight;

		const nextTop =
			targetTop < top
				? targetTop
				: Math.max(top, targetTop + rowHeight - height);

		const anchor = Math.floor(nextTop / rowHeight);

		// Override native focus's top anchor with the smallest scroll that reveals the row.
		renderer.scrollToItem?.(node.id, anchor, nextTop - anchor * rowHeight);
	};

	useLayoutEffect(() => {
		const pending = pendingFocus.current;
		const row = pending && rows.current.get(pending.id);

		if (pending && row) {
			pendingFocus.current = null;
			renderer.focusElement?.(row.id);
			revealRow(pending.id, pending.y);
		}
	});

	const focusRow = (id: string): void => {
		const row = rows.current.get(id);

		const y = viewport.current
			? (renderer.getScrollOffset?.(viewport.current.id)?.[1] ?? 0)
			: 0;

		if (!row) {
			const index = entries.findIndex((entry) => entry.id === id);

			if (!windowed || index < 0) return;

			pendingFocus.current = { id, y };
			setWindowStart(Math.max(0, index - windowChunkSize));

			return;
		}

		renderer.focusElement?.(row.id);
		revealRow(id, y);
	};

	const select = (id: string, mode?: "toggle" | "range" | "context"): void => {
		onSelect(id, mode);
		setFocusId(id);
		focusRow(id);
	};

	const navigate = (id: string, event: EventPayload): void => {
		if (event.key === "tab") backwardTab.current = !!event.modifiers?.shift;

		if (
			event.modifiers?.cmd ||
			event.modifiers?.ctrl ||
			event.modifiers?.alt ||
			(event.modifiers?.shift && !inclusion)
		)
			return;

		const key = event.key ?? "";

		if (key === "enter" || key === "space") {
			if (
				key === "space" &&
				inclusion &&
				!inclusion.disabled &&
				!event.modifiers?.shift
			) {
				inclusion.onChange(id, !includedIds.has(id));

				return;
			}

			select(id);

			return;
		}

		const height = container.current
			? (renderer.getElementBounds?.(container.current.id)?.height ?? 0)
			: 0;

		const rowHeight = entries[0]?.detail ? revisionRowHeight : fileRowHeight;

		const next = RepositoryWorkspaceModel.destination(
			entries,
			id,
			key,
			Math.max(1, Math.floor(height / rowHeight) - 1)
		);

		if (next) select(next, event.modifiers?.shift ? "range" : undefined);
	};

	return (
		<div
			ref={container}
			testId={`${testId}-viewport`}
			style={{ ...styles.viewport, paddingBottom: spacing[1.5] }}
			role={inclusion ? "grid" : "listbox"}
			aria-label={label}
			aria-multiselectable={!!inclusion}
			aria-description={entries.length === 0 ? emptyMessage : undefined}
			tabIndex={entries.length ? 0 : -1}
			onFocus={() => {
				if (backwardTab.current) {
					backwardTab.current = false;
					renderer.focusPrevious?.();
				} else if (tabbableId) focusRow(tabbableId);
			}}
		>
			<virtual-list
				ref={viewport}
				testId={testId}
				role="presentation"
				{...(windowed
					? {
							itemCount: entries.length,
							estimatedItemHeight: rowHeight,
							windowStart: start,
						}
					: { estimatedItemHeight: entries.length ? rowHeight : undefined })}
				overdraw={rowHeight * 2}
				onVisibleRange={saveScroll}
				style={styles.viewport}
			>
				{entries.length === 0 ? (
					<div
						style={{ paddingLeft: spacing[1.5], paddingRight: spacing[1.5] }}
					>
						{emptyContent ?? (
							<text style={{ ...styles.detail, padding: spacing[3.5] }}>
								{emptyMessage}
							</text>
						)}
					</div>
				) : null}
				{entries.slice(start, end).map((entry) => (
					<div
						key={entry.id}
						style={{
							height: rowHeight,
							paddingLeft: spacing[1.5],
							paddingRight: spacing[1.5],
						}}
					>
						<RepositoryRow
							entry={entry}
							onContextMenu={onContextMenu}
							onPreviewIntent={onPreviewIntent}
							fileActions={
								fileActions
									? {
											...fileActions,
											selection: (id) => {
												const ids =
													state.selectedIds ??
													(state.selectedId ? [state.selectedId] : []);

												if (ids.includes(id)) {
													const selection = new Set(ids);

													return entries.filter((item) =>
														selection.has(item.id)
													);
												}

												select(id, "context");

												return [entry];
											},
										}
									: undefined
							}
							selected={
								inclusion && state.selectedIds
									? selectedIds.has(entry.id)
									: state.selectedId === entry.id
							}
							included={includedIds.has(entry.id)}
							inclusionDisabled={inclusion?.disabled}
							onInclude={
								inclusion
									? (included) => inclusion.onChange(entry.id, included)
									: undefined
							}
							tabbable={
								tabbableId === entry.id ||
								(entry.id === entries[start]?.id &&
									!entries
										.slice(start, end)
										.some((item) => item.id === tabbableId))
							}
							rowRef={(node) => {
								if (node) rows.current.set(entry.id, node);
								else rows.current.delete(entry.id);
							}}
							onSelect={(event) =>
								select(
									entry.id,
									inclusion
										? event.modifiers?.shift
											? "range"
											: event.modifiers?.cmd
												? "toggle"
												: undefined
										: undefined
								)
							}
							onReveal={() => {
								setFocusId(entry.id);
								revealRow(entry.id);
							}}
							onKeyDown={(event) => navigate(entry.id, event)}
						/>
					</div>
				))}
			</virtual-list>
		</div>
	);
}
