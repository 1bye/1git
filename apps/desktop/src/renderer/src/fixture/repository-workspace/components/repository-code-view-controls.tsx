import { cn } from "@1git/ui/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import type {
	CodeViewItem,
	DiffLineAnnotation,
	GetHoveredLineResult,
	LineAnnotation,
} from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { ReactElement, RefObject } from "react";
import { useCallback, useState } from "react";
import {
	getNextRepositoryCodeViewItemVersion,
	type RepositoryCodeViewAnnotation,
} from "@/fixture/repository-workspace/lib/repository-code-view.js";
import {
	getRepositoryRevisionFileStatus,
	type RepositoryDiffFileEntry,
} from "@/fixture/repository-workspace/lib/repository-diff-files.js";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";
import {
	type HunkActionHandler,
	HunkActionPocket,
	type HunkActionSelection,
} from "./hunk-action-pocket.js";
import { RepositoryCodeViewPreview } from "./repository-code-view-preview.js";
import { RepositoryFileStats } from "./repository-file-item.js";
import {
	RepositoryFileStatus,
	RepositoryFileStatusBadge,
} from "./repository-file-status.js";

interface RepositoryCodeViewControlsProps {
	readonly areHunkActionsEnabled: boolean;
	readonly entriesByKey: ReadonlyMap<string, RepositoryDiffFileEntry>;
	readonly isHunkActionPending: boolean;
	readonly onChangeHunk: HunkActionHandler;
	readonly onOpenFile: (path: string) => Promise<void>;
	readonly sessionId: RepositorySessionId;
	readonly showTarget: boolean;
	readonly viewerRef: RefObject<CodeViewHandle<RepositoryCodeViewAnnotation> | null>;
}

interface RepositoryCodeViewControls {
	readonly hunkActionPocket: ReactElement | null;
	readonly renderAnnotation: (
		annotation:
			| DiffLineAnnotation<RepositoryCodeViewAnnotation>
			| LineAnnotation<RepositoryCodeViewAnnotation>,
		item: CodeViewItem<RepositoryCodeViewAnnotation>
	) => ReactElement | null;
	readonly renderGutterUtility: (
		getHoveredLine:
			| (() => GetHoveredLineResult<"diff"> | undefined)
			| (() => GetHoveredLineResult<"file"> | undefined),
		item: CodeViewItem<RepositoryCodeViewAnnotation>
	) => ReactElement | null;
	readonly renderHeaderMetadata: (
		item: CodeViewItem<RepositoryCodeViewAnnotation>
	) => ReactElement | null;
	readonly renderHeaderPrefix: (
		item: CodeViewItem<RepositoryCodeViewAnnotation>
	) => ReactElement;
	readonly toggleItemCollapsed: (itemId: string) => void;
}

interface RepositoryDiffCollapseButtonProps {
	readonly collapsed: boolean;
	readonly itemId: string;
	readonly onToggle: (itemId: string) => void;
}

const findHunkIndex = (
	entry: RepositoryDiffFileEntry,
	hoveredLine: GetHoveredLineResult<"diff">
): number => {
	const hunks = entry.file?.hunks ?? [];
	return hunks.findIndex((hunk) => {
		const start =
			hoveredLine.side === "additions"
				? hunk.additionStart
				: hunk.deletionStart;
		const count =
			hoveredLine.side === "additions"
				? hunk.additionCount
				: hunk.deletionCount;
		return (
			hoveredLine.lineNumber >= start && hoveredLine.lineNumber < start + count
		);
	});
};

const isHoveredDiffLine = (
	hoveredLine:
		| GetHoveredLineResult<"diff">
		| GetHoveredLineResult<"file">
		| undefined
): hoveredLine is GetHoveredLineResult<"diff"> =>
	hoveredLine !== undefined &&
	"side" in hoveredLine &&
	(hoveredLine.side === "additions" || hoveredLine.side === "deletions");

const RepositoryDiffCollapseButton = ({
	collapsed,
	itemId,
	onToggle,
}: RepositoryDiffCollapseButtonProps): ReactElement => (
	<button
		aria-expanded={!collapsed}
		aria-label={`${collapsed ? "Expand" : "Collapse"} diff`}
		className="flex size-4 shrink-0 items-center justify-center rounded-sm text-editor-faint outline-none hover:bg-hover hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-brand/20"
		onClick={(event) => {
			event.preventDefault();
			event.stopPropagation();
			onToggle(itemId);
		}}
		type="button"
	>
		<CaretRightIcon
			aria-hidden
			className={cn(
				"size-3 transition-transform duration-150",
				!collapsed && "rotate-90"
			)}
			weight="bold"
		/>
	</button>
);

export function useRepositoryCodeViewControls({
	areHunkActionsEnabled,
	entriesByKey,
	isHunkActionPending,
	onChangeHunk,
	onOpenFile,
	sessionId,
	showTarget,
	viewerRef,
}: RepositoryCodeViewControlsProps): RepositoryCodeViewControls {
	const [isHunkActionOpen, setIsHunkActionOpen] = useState(false);
	const [hunkActionSelection, setHunkActionSelection] =
		useState<HunkActionSelection | null>(null);

	const toggleItemCollapsed = useCallback(
		(itemId: string): void => {
			const viewerHandle = viewerRef.current;
			const viewer = viewerHandle?.getInstance();
			const item = viewerHandle?.getItem(itemId);
			if (!(viewerHandle && viewer && item)) {
				return;
			}
			const itemTop = viewer.getTopForItem(itemId);
			item.collapsed = item.collapsed !== true;
			item.version = getNextRepositoryCodeViewItemVersion(item);
			if (!viewerHandle.updateItem(item)) {
				return;
			}
			if (
				item.collapsed &&
				hunkActionSelection?.path === entriesByKey.get(itemId)?.path
			) {
				setIsHunkActionOpen(false);
			}
			if (itemTop !== undefined && itemTop < viewer.getScrollTop()) {
				viewer.scrollTo({ align: "start", id: item.id, type: "item" });
			}
		},
		[entriesByKey, hunkActionSelection?.path, viewerRef]
	);

	const renderHeaderPrefix = useCallback(
		(item: CodeViewItem<RepositoryCodeViewAnnotation>): ReactElement => {
			const entry = entriesByKey.get(item.id);
			let fileStatus: ReactElement | null = null;
			if (entry?.change) {
				fileStatus = <RepositoryFileStatus file={entry.change} />;
			} else if (entry) {
				fileStatus = (
					<RepositoryFileStatusBadge
						status={getRepositoryRevisionFileStatus(entry.file)}
					/>
				);
			}
			return (
				<span className="inline-flex shrink-0 items-center gap-2">
					<RepositoryDiffCollapseButton
						collapsed={item.collapsed === true}
						itemId={item.id}
						onToggle={toggleItemCollapsed}
					/>
					{fileStatus}
				</span>
			);
		},
		[entriesByKey, toggleItemCollapsed]
	);

	const renderHeaderMetadata = useCallback(
		(item: CodeViewItem<RepositoryCodeViewAnnotation>): ReactElement | null => {
			const entry = entriesByKey.get(item.id);
			if (!entry) {
				return null;
			}
			return (
				<>
					{showTarget ? (
						<span className="shrink-0 text-[9px] text-editor-faint">
							{entry.targetLabel}
						</span>
					) : null}
					<RepositoryFileStats
						addedLines={entry.stat?.addedLines}
						deletedLines={entry.stat?.deletedLines}
					/>
				</>
			);
		},
		[entriesByKey, showTarget]
	);

	const renderAnnotation = useCallback(
		(
			annotation:
				| DiffLineAnnotation<RepositoryCodeViewAnnotation>
				| LineAnnotation<RepositoryCodeViewAnnotation>,
			item: CodeViewItem<RepositoryCodeViewAnnotation>
		): ReactElement | null => {
			const entry = entriesByKey.get(item.id);
			const { metadata } = annotation;
			if (!(entry && metadata?.kind === "preview")) {
				return null;
			}
			return (
				<RepositoryCodeViewPreview
					entry={entry}
					onOpenFile={onOpenFile}
					previewKind={metadata.previewKind}
					sessionId={sessionId}
				/>
			);
		},
		[entriesByKey, onOpenFile, sessionId]
	);

	const renderGutterUtility = useCallback(
		(
			getHoveredLine:
				| (() => GetHoveredLineResult<"diff"> | undefined)
				| (() => GetHoveredLineResult<"file"> | undefined),
			item: CodeViewItem<RepositoryCodeViewAnnotation>
		): ReactElement | null => {
			const entry = entriesByKey.get(item.id);
			const target =
				entry?.target.kind === "staged" || entry?.target.kind === "working"
					? entry.target.kind
					: null;
			if (!(areHunkActionsEnabled && item.type === "diff" && entry && target)) {
				return null;
			}
			return (
				<button
					aria-label="Open actions for this hunk"
					className="pointer-events-auto relative z-[4] flex size-5 items-center justify-center rounded-md bg-editor-ink text-white outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-editor-muted/30"
					data-name="RepositoryHunkActionTrigger"
					data-utility-button=""
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						const hoveredLine = getHoveredLine();
						if (!isHoveredDiffLine(hoveredLine)) {
							return;
						}
						const hunkIndex = findHunkIndex(entry, hoveredLine);
						const viewportElement = viewerRef.current
							?.getInstance()
							?.getContainerElement();
						if (hunkIndex < 0 || !viewportElement) {
							return;
						}
						const anchorRect = event.currentTarget.getBoundingClientRect();
						const selection: HunkActionSelection = {
							anchorBounds: {
								height: anchorRect.height,
								left: anchorRect.left,
								top: anchorRect.top,
								width: anchorRect.width,
							},
							anchorElement: event.currentTarget,
							hunkIndex,
							path: entry.path,
							target,
							viewportElement,
						};
						window.setTimeout(() => {
							setHunkActionSelection(selection);
							setIsHunkActionOpen(true);
						}, 0);
					}}
					type="button"
				>
					<DotsThreeIcon aria-hidden className="size-3.5" weight="bold" />
				</button>
			);
		},
		[areHunkActionsEnabled, entriesByKey, viewerRef]
	);

	return {
		hunkActionPocket: hunkActionSelection ? (
			<HunkActionPocket
				isPending={isHunkActionPending}
				onChangeHunk={onChangeHunk}
				onOpenChange={setIsHunkActionOpen}
				onPresenceChange={(isPresent) => {
					if (!isPresent) {
						setHunkActionSelection(null);
					}
				}}
				open={isHunkActionOpen}
				selection={hunkActionSelection}
			/>
		) : null,
		renderAnnotation,
		renderGutterUtility,
		renderHeaderMetadata,
		renderHeaderPrefix,
		toggleItemCollapsed,
	};
}
