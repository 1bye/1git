import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, radius, typography, fontWeight } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Scrollbars } from "@1git/gpuix-ui/scrollbar";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import {
	OverflowingLabel,
	type OverflowingLabelHandle,
} from "../../../fixture/overflowing-label";
import {
	useGpuixRequired,
	useWindowSize,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import {
	useCallback,
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
import {
	RepositoryFileTree,
	type RepositoryFileTreeRow,
} from "../lib/repository-file-tree";
import { useRepositoryFileView } from "./repository-file-view";
import { RepositoryChangeLabel } from "./repository-change-details";
import { RepositoryCommitSubject } from "./repository-commit-subject";
import { WorkspaceTabIcon } from "../../workspace-tabs/components/workspace-tab-icon";

import {
	RepositoryFileMenu,
	type FileMenuActions,
} from "./repository-file-menu";

/** Shared by bounded file groups and their native list rows. */
export const fileRowHeight = 28;
const revisionRowHeight = 48;
const scrollSaveDelayMs = 150;
const windowChunkSize = 64;
const windowThreshold = 500;

const themedStyles = createThemedStyles(({ colors: appColors }) => {
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
			width: "100%",
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
			hover: { backgroundColor: appColors.editorHairline },
		},
		selected: {
			backgroundColor: appColors.editorSunken2,
			hover: { backgroundColor: appColors.editorSunken2 },
		},
		label: {
			...typography.sm,
			fontWeight: fontWeight.regular,
			color: appColors.editorInk,
			minWidth: 0,
			overflowX: "hidden",
			whiteSpace: "nowrap",
			textOverflow: "ellipsis",
			pointerEvents: "none",
		},
		detail: {
			...typography["2xs"],
			color: appColors.editorFaint,
			whiteSpace: "nowrap",
			textOverflow: "ellipsis",
			overflowX: "hidden",
			pointerEvents: "none",
		},
	});

	return { styles };
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
	children,
	itemHeight,
	treeDepth,
}: {
	entry: WorkspaceEntry;
	selected: boolean;
	tabbable: boolean;
	rowRef: (node: PublicInstance | null) => void;
	onSelect: (event: EventPayload) => void;
	onKeyDown: (event: EventPayload) => void;
	onReveal: () => void;
	included?: boolean | "indeterminate";
	onInclude?: (included: boolean) => void;
	inclusionDisabled?: boolean;
	fileActions?: FileMenuActions;
	onContextMenu?: (entry: WorkspaceEntry, event: EventPayload) => void;
	onPreviewIntent?: (entry: WorkspaceEntry | null) => void;
	children?: ReactNode;
	itemHeight?: number;
	treeDepth?: number;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens, colors: appColors } = theme;
	const { styles } = themedStyles.get(theme);
	const hovered = useRef(false);
	const focused = useRef(false);
	const label = useRef<OverflowingLabelHandle>(null);

	const description = [
		entry.detail,
		entry.tags?.length
			? `Tags: ${entry.tags.map((tag) => tag.name).join(", ")}`
			: undefined,
		entry.unpushed ? "Not pushed (based on last fetch)" : undefined,
	]
		.filter(Boolean)
		.join(" · ");

	const row = (onMenu?: (event: EventPayload) => void) => (
		<div
			role={onInclude ? "row" : "presentation"}
			aria-level={
				onInclude && treeDepth !== undefined ? treeDepth + 1 : undefined
			}
			aria-selected={
				onInclude && treeDepth !== undefined ? selected : undefined
			}
			testId={`row-${entry.id}`}
			onMouseEnter={() => {
				hovered.current = true;
				label.current?.setRevealed(true);

				onPreviewIntent?.(entry);
			}}
			onMouseLeave={() => {
				hovered.current = false;
				label.current?.setRevealed(focused.current);

				onPreviewIntent?.(null);
			}}
			style={StyleSheet.compose(
				styles.row,
				!!entry.status && {
					borderRadius: radius.sm,
					paddingRight: spacing[1],
					gap: spacing[1],
				},
				!!entry.detail && { height: revisionRowHeight },
				itemHeight !== undefined && { height: itemHeight },
				treeDepth !== undefined && {
					paddingLeft: spacing[2] + treeDepth * spacing[4],
				},
				selected && styles.selected
			)}
		>
			<div
				ref={rowRef}
				testId={`entry-${entry.id}`}
				role={
					onInclude
						? "gridcell"
						: treeDepth !== undefined
							? "treeitem"
							: "option"
				}
				aria-level={
					!onInclude && treeDepth !== undefined ? treeDepth + 1 : undefined
				}
				aria-label={
					entry.status
						? `${entry.title}, ${entry.statusDescription ?? (entry.status === "A" ? "added" : entry.status === "D" ? "deleted" : "modified")}`
						: entry.title
				}
				aria-description={description || undefined}
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
					focused.current = true;
					label.current?.setRevealed(true);

					onPreviewIntent?.(entry);
					onReveal();
				}}
				onBlur={() => {
					focused.current = false;
					label.current?.setRevealed(hovered.current);

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
				{children ??
					(entry.status ? (
						<RepositoryChangeLabel
							ref={label}
							entry={entry}
							showDirectory={treeDepth === undefined}
						/>
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
							<div
								style={{
									display: "flex",
									flexDirection: "row",
									alignItems: "center",
									gap: spacing[1],
								}}
							>
								{"commit" in entry ? (
									<RepositoryCommitSubject
										subject={entry.title}
										testId={`commit-subject-${entry.id}`}
									/>
								) : (
									<text style={{ ...styles.label, flexGrow: 1 }}>
										{entry.title}
									</text>
								)}
								{entry.tags?.length ? (
									<text
										testId={`tags-${entry.id}`}
										style={{
											...typography["2xs"],
											color: appColors.editorMuted,
											backgroundColor: appColors.editorSunken,
											borderRadius: radius.sm,
											paddingLeft: spacing[1],
											paddingRight: spacing[1],
											flexShrink: 0,
											maxWidth: 120,
											overflowX: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>{`${entry.tags[0]?.name}${entry.tags.length > 1 ? ` +${entry.tags.length - 1}` : ""}`}</text>
								) : null}
							</div>
							{entry.detail ? (
								<text style={styles.detail}>{entry.detail}</text>
							) : null}
						</div>
					))}
				{entry.unpushed ? (
					<div
						style={{
							flexShrink: 0,
							marginLeft: spacing[2],
							pointerEvents: "none",
						}}
					>
						<WorkspaceTabIcon name="push" testId={`unpushed-${entry.id}`} />
					</div>
				) : null}
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
						onFocus={() => {
							focused.current = true;
							label.current?.setRevealed(true);
							onReveal();
						}}
						onBlur={() => {
							focused.current = false;
							label.current?.setRevealed(hovered.current);
						}}
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

function RepositoryFolderRow({
	node,
	expanded,
	tabbable,
	rowRef,
	onToggle,
	onReveal,
	onKeyDown,
	included,
	onInclude,
	disabled,
}: {
	node: Extract<RepositoryFileTreeRow, { kind: "folder" }>;
	expanded: boolean;
	tabbable: boolean;
	rowRef: (node: PublicInstance | null) => void;
	onToggle: () => void;
	onReveal: () => void;
	onKeyDown: (event: EventPayload) => void;
	included: boolean | "indeterminate";
	onInclude?: (included: boolean) => void;
	disabled?: boolean;
}) {
	const theme = useAppTheme();
	const { styles } = themedStyles.get(theme);
	const [focused, setFocused] = useState(false);
	const hovered = useRef(false);
	const label = useRef<OverflowingLabelHandle>(null);

	return (
		<div
			role={onInclude ? "row" : "presentation"}
			onMouseEnter={() => {
				hovered.current = true;
				label.current?.setRevealed(true);
			}}
			onMouseLeave={() => {
				hovered.current = false;
				label.current?.setRevealed(focused);
			}}
			aria-level={onInclude ? node.depth + 1 : undefined}
			aria-expanded={onInclude ? expanded : undefined}
			style={{
				...styles.row,
				borderColor: focused ? theme.colors.brand : "transparent",
				borderRadius: radius.sm,
				paddingLeft: spacing[2] + node.depth * spacing[4],
				paddingRight: spacing[1],
				gap: spacing[1],
			}}
		>
			<div
				ref={rowRef}
				testId={`entry-${node.id}`}
				role={onInclude ? "gridcell" : "treeitem"}
				aria-label={`${node.path}, ${node.fileIds.length} changed files`}
				aria-expanded={expanded}
				aria-level={onInclude ? undefined : node.depth + 1}
				tabIndex={tabbable ? 0 : -1}
				onClick={onToggle}
				onFocus={() => {
					setFocused(true);
					label.current?.setRevealed(true);
					onReveal();
				}}
				onBlur={() => {
					setFocused(false);
					label.current?.setRevealed(hovered.current);
				}}
				onKeyDown={onKeyDown}
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: spacing[1.5],
					flexGrow: 1,
					minWidth: 0,
					height: "100%",
				}}
			>
				<WorkspaceTabIcon
					name={expanded ? "caretDown" : "caretRight"}
					size={12}
				/>
				<WorkspaceTabIcon name="folder" size={12} />
				<OverflowingLabel
					ref={label}
					testId={`folder-label-${node.id}`}
					contentKey={node.name}
					style={{ flexGrow: 1, flexBasis: 0 }}
				>
					<text
						testId={`folder-name-${node.id}`}
						style={{
							...styles.label,
							color: theme.colors.editorMuted,
							flexGrow: 1,
							flexShrink: 0,
							textOverflow: undefined,
							overflowX: undefined,
						}}
					>
						{node.name}
					</text>
				</OverflowingLabel>
				<text
					testId={`folder-count-${node.id}`}
					style={{
						...typography.xs,
						color: theme.colors.editorFaint,
						flexShrink: 0,
						pointerEvents: "none",
					}}
				>
					{node.fileIds.length}
				</text>
			</div>
			{onInclude ? (
				<div role="gridcell" style={{ flexShrink: 0 }}>
					<Checkbox
						testId={`include-${node.id}`}
						aria-label={`Include all ${node.fileIds.length} changed files under ${node.path} in commit`}
						checked={included}
						disabled={disabled}
						tokens={theme.tokens}
						tabIndex={tabbable ? 0 : -1}
						onCheckedChange={onInclude}
						onFocus={() => {
							setFocused(true);
							onReveal();
						}}
						onBlur={() => setFocused(false)}
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

/** Shared file/revision list with native scrolling and roving focus; remount when its data owner changes. */
export function RepositoryList({
	entries,
	label,
	testId = "repository-list",
	emptyMessage,
	emptyContent,
	state,
	inclusion,
	multiselect = false,
	onSelect,
	onScroll,
	onEndReached,
	fileActions,
	onContextMenu,
	onPreviewIntent,
	renderEntry,
	itemHeight,
	fileTree,
}: {
	entries: readonly WorkspaceEntry[];
	label: string;
	testId?: string;
	emptyMessage: string;
	emptyContent?: ReactNode;
	state: RepositoryListState;
	inclusion?: {
		ids: readonly string[];
		partialIds?: readonly string[];
		disabled?: boolean;
		onChange: (id: string, included: boolean) => void;
	};
	multiselect?: boolean;
	onSelect: (
		id: string,
		mode?: "toggle" | "range" | "context",
		visibleIds?: readonly string[]
	) => void;
	onScroll: (y: number) => void;
	onEndReached?: () => void;
	fileActions?: FileMenuActions;
	onContextMenu?: (entry: WorkspaceEntry, event: EventPayload) => void;
	onPreviewIntent?: (entry: WorkspaceEntry | null) => void;
	/** Custom native row contents retain this list's selection, focus and virtualization. */
	renderEntry?: (entry: WorkspaceEntry) => ReactNode;
	itemHeight?: number;
	/** Only file panes opt in; revision lists retain their chronological ordering. */
	fileTree?: {
		scope: string;
		owner?: string;
		allEntries?: readonly WorkspaceEntry[];
		filtering?: boolean;
		onInclude?: (ids: readonly string[], included: boolean) => void;
	};
}) {
	const theme = useAppTheme();
	const { styles } = themedStyles.get(theme);

	const { layout, collapsed, toggle, reveal } = useRepositoryFileView(
		fileTree?.scope
	);

	const treeEnabled = !!fileTree && layout === "tree";
	const treeAvailable = !!fileTree;
	const sourceEntries = fileTree?.allEntries ?? entries;

	const treeNodes = useMemo(
		() => (treeEnabled ? RepositoryFileTree.build(sourceEntries) : []),
		[sourceEntries, treeEnabled]
	);

	const filtering = !!fileTree?.filtering;

	const matches = useMemo(
		() => (filtering ? new Set(entries.map((entry) => entry.id)) : undefined),
		[entries, filtering]
	);

	const displayRows = useMemo<readonly RepositoryFileTreeRow[]>(
		() =>
			treeEnabled
				? RepositoryFileTree.rows(treeNodes, collapsed, matches)
				: entries.map((entry) => ({
						kind: "file",
						id: entry.id,
						entry,
						depth: 0,
						parentId: null,
					})),
		[treeEnabled, treeNodes, collapsed, matches, entries]
	);

	const visibleFileIds = useMemo(
		() =>
			displayRows.filter((node) => node.kind === "file").map((node) => node.id),
		[displayRows]
	);

	const renderer = useGpuixRequired();
	const viewport = useRef<PublicInstance>(null);
	const container = useRef<PublicInstance>(null);
	const rows = useRef(new Map<string, PublicInstance>());
	const initialScroll = useRef(state.scrollY);
	const restoringScroll = useRef(state.scrollY !== 0);

	const rowHeight =
		itemHeight ?? (entries[0]?.detail ? revisionRowHeight : fileRowHeight);

	const windowed = displayRows.length > windowThreshold;
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
		? Math.min(windowStart, Math.max(0, displayRows.length - windowSize))
		: 0;

	const end = windowed
		? Math.min(displayRows.length, start + windowSize)
		: displayRows.length;

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

	const partialIds = useMemo(
		() => new Set(inclusion?.partialIds),
		[inclusion?.partialIds]
	);

	const selectedIds = useMemo(
		() => new Set(state.selectedIds),
		[state.selectedIds]
	);

	const [focusId, setFocusId] = useState(
		state.selectedId ?? displayRows[0]?.id
	);

	const tabbableId = displayRows.some((entry) => entry.id === focusId)
		? focusId
		: (displayRows.find((entry) => entry.id === state.selectedId)?.id ??
			displayRows[0]?.id);

	const selectedPath = sourceEntries.find(
		(entry) => entry.id === state.selectedId
	);

	const pathToReveal = selectedPath
		? RepositoryFileTree.path(selectedPath)
		: null;

	const pendingReveal = useRef<string | null>(null);
	const previousLayout = useRef(treeEnabled);
	const treeOwner = fileTree?.owner ?? "";

	useLayoutEffect(() => {
		if (treeEnabled && pathToReveal)
			reveal(pathToReveal, treeOwner, previousLayout.current !== treeEnabled);

		// A remounted pane restores its saved position before following new selections.
		if (
			treeAvailable &&
			(!restoringScroll.current || previousLayout.current !== treeEnabled)
		)
			pendingReveal.current = state.selectedId;

		restoringScroll.current = false;
	}, [
		treeEnabled,
		pathToReveal,
		state.selectedId,
		reveal,
		treeAvailable,
		treeOwner,
	]);

	useLayoutEffect(() => {
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

		if (anchor && last >= displayRows.length - 3) onEndReached?.();
	};

	const revealRow = useCallback(
		(id: string, previousY?: number): void => {
			const node = viewport.current;

			const box =
				container.current && renderer.getElementBounds?.(container.current.id);

			const index = displayRows.findIndex((entry) => entry.id === id);

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
		},
		[displayRows, renderer, rowHeight]
	);

	useLayoutEffect(() => {
		if (pendingReveal.current) {
			const index = displayRows.findIndex(
				(node) => node.id === pendingReveal.current
			);

			if (index >= 0) {
				revealRow(pendingReveal.current);

				if (windowed) setWindowStart(Math.max(0, index - windowChunkSize));

				pendingReveal.current = null;
			}
		}

		if (previousLayout.current !== treeEnabled) {
			previousLayout.current = treeEnabled;
			setFocusId(state.selectedId ?? displayRows[0]?.id);
		}

		const pending = pendingFocus.current;
		const row = pending && rows.current.get(pending.id);

		if (pending && row) {
			pendingFocus.current = null;
			renderer.focusElement?.(row.id);
			revealRow(pending.id, pending.y);
		}
	}, [
		displayRows,
		end,
		renderer,
		revealRow,
		start,
		state.selectedId,
		treeEnabled,
		windowed,
	]);

	const focusRow = (id: string): void => {
		const row = rows.current.get(id);

		const y = viewport.current
			? (renderer.getScrollOffset?.(viewport.current.id)?.[1] ?? 0)
			: 0;

		if (!row) {
			const index = displayRows.findIndex((entry) => entry.id === id);

			if (!windowed || index < 0) return;

			pendingFocus.current = { id, y };
			setWindowStart(Math.max(0, index - windowChunkSize));

			return;
		}

		renderer.focusElement?.(row.id);
		revealRow(id, y);
	};

	const select = (id: string, mode?: "toggle" | "range" | "context"): void => {
		if (displayRows.find((node) => node.id === id)?.kind === "file")
			onSelect(id, mode, treeEnabled ? visibleFileIds : undefined);

		setFocusId(id);
		focusRow(id);
	};

	const navigate = (id: string, event: EventPayload): void => {
		if (event.key === "tab") backwardTab.current = !!event.modifiers?.shift;

		if (
			event.modifiers?.cmd ||
			event.modifiers?.ctrl ||
			event.modifiers?.alt ||
			(event.modifiers?.shift && !inclusion && !multiselect)
		)
			return;

		const key = event.key ?? "";
		const node = displayRows.find((row) => row.id === id);

		if (treeEnabled && node) {
			const expanded =
				node.kind === "folder" &&
				(filtering || !node.paths.some((path) => collapsed.has(path)));

			if (key === "left") {
				if (node.kind === "folder" && expanded && !filtering)
					toggle(node.paths);
				else if (node.parentId) select(node.parentId);

				return;
			}

			if (key === "right") {
				if (node.kind === "folder") {
					if (!expanded) toggle(node.paths);
					else {
						const child = displayRows[displayRows.indexOf(node) + 1];

						if (child?.parentId === node.id) select(child.id);
					}
				}

				return;
			}

			if (node.kind === "folder" && (key === "enter" || key === "space")) {
				if (
					key === "space" &&
					inclusion &&
					fileTree?.onInclude &&
					!inclusion.disabled
				)
					fileTree.onInclude(
						node.fileIds,
						RepositoryFileTree.inclusion(
							node.fileIds,
							includedIds,
							partialIds
						) !== true
					);
				else if (!filtering) toggle(node.paths);

				return;
			}
		}

		if (key === "enter" || key === "space") {
			if (
				key === "space" &&
				inclusion &&
				!inclusion.disabled &&
				!event.modifiers?.shift
			) {
				inclusion.onChange(
					id,
					inclusion.partialIds?.includes(id) || !includedIds.has(id)
				);

				return;
			}

			select(id);

			return;
		}

		const height = container.current
			? (renderer.getElementBounds?.(container.current.id)?.height ?? 0)
			: 0;

		const next = RepositoryWorkspaceModel.destination(
			displayRows,
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
			role={
				treeEnabled
					? inclusion
						? "treegrid"
						: "tree"
					: inclusion
						? "grid"
						: "listbox"
			}
			aria-label={label}
			aria-multiselectable={!!inclusion || multiselect}
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
							itemCount: displayRows.length,
							estimatedItemHeight: rowHeight,
							windowStart: start,
						}
					: {
							estimatedItemHeight: displayRows.length ? rowHeight : undefined,
						})}
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
				{displayRows.slice(start, end).map((node) => {
					const tabbable =
						tabbableId === node.id ||
						(node.id === displayRows[start]?.id &&
							!displayRows
								.slice(start, end)
								.some((item) => item.id === tabbableId));

					const rowRef = (element: PublicInstance | null): void => {
						if (element) rows.current.set(node.id, element);
						else rows.current.delete(node.id);
					};

					const onReveal = (): void => {
						setFocusId(node.id);
						revealRow(node.id);
					};

					const entry = node.kind === "file" ? node.entry : null;

					return (
						<div
							key={node.id}
							style={{
								height: rowHeight,
								paddingLeft: spacing[1.5],
								paddingRight: spacing[1.5],
							}}
						>
							{node.kind === "folder" ? (
								<RepositoryFolderRow
									node={node}
									expanded={
										filtering || !node.paths.some((path) => collapsed.has(path))
									}
									tabbable={tabbable}
									rowRef={rowRef}
									onReveal={onReveal}
									onToggle={() => {
										select(node.id);

										if (!filtering) toggle(node.paths);
									}}
									onKeyDown={(event) => navigate(node.id, event)}
									included={RepositoryFileTree.inclusion(
										node.fileIds,
										includedIds,
										partialIds
									)}
									disabled={inclusion?.disabled}
									onInclude={
										inclusion && fileTree?.onInclude
											? (included) =>
													fileTree.onInclude?.(node.fileIds, included)
											: undefined
									}
								/>
							) : entry ? (
								<RepositoryRow
									entry={entry}
									treeDepth={treeEnabled ? node.depth : undefined}
									itemHeight={itemHeight}
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
										(inclusion || multiselect) && state.selectedIds
											? selectedIds.has(entry.id)
											: state.selectedId === entry.id
									}
									included={
										inclusion?.partialIds?.includes(entry.id)
											? "indeterminate"
											: includedIds.has(entry.id)
									}
									inclusionDisabled={inclusion?.disabled}
									onInclude={
										inclusion
											? (included) => inclusion.onChange(entry.id, included)
											: undefined
									}
									tabbable={tabbable}
									rowRef={rowRef}
									onSelect={(event) =>
										select(
											entry.id,
											inclusion || multiselect
												? event.modifiers?.shift
													? "range"
													: event.modifiers?.cmd
														? "toggle"
														: undefined
												: undefined
										)
									}
									onReveal={onReveal}
									onKeyDown={(event) => navigate(entry.id, event)}
								>
									{renderEntry?.(entry)}
								</RepositoryRow>
							) : null}
						</div>
					);
				})}
			</virtual-list>
			<Scrollbars
				vertical={viewport}
				tokens={theme.tokens}
				testId={`${testId}-scrollbar`}
			/>
		</div>
	);
}
