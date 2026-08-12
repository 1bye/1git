import { cn } from "@1git/ui/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type { ReactElement } from "react";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import {
	REPOSITORY_DIFF_ESTIMATED_LINE_HEIGHT,
	REPOSITORY_DIFF_ESTIMATED_SEPARATOR_HEIGHT,
	REPOSITORY_DIFF_HUNK_ACTION_RENDER_OPTIONS,
	REPOSITORY_DIFF_MINIMUM_BODY_HEIGHT,
	REPOSITORY_DIFF_RENDER_OPTIONS,
} from "@/fixture/repository-workspace/constants/repository-diff.js";
import type { RepositoryDiffFileEntry } from "@/fixture/repository-workspace/lib/repository-diff-files.js";
import {
	type HunkActionHandler,
	type HunkActionSelection,
	HunkActionPocket,
} from "./hunk-action-pocket.js";
import { RepositoryFileStatus } from "./repository-file-status.js";
import { RepositoryImageDiff } from "./repository-image-diff.js";
import { getRepositoryDiffPreviewKind } from "@/fixture/repository-workspace/lib/repository-diff-preview.js";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

interface DiffFileAccordionProps {
	readonly areHunkActionsEnabled: boolean;
	readonly entry: RepositoryDiffFileEntry;
	readonly isBodyMounted: boolean;
	readonly isHunkActionPending: boolean;
	readonly ignoreWhitespace: boolean;
	readonly onChangeHunk: HunkActionHandler;
	readonly onElementChange: (key: string, element: HTMLElement | null) => void;
	readonly onOpenFile: (path: string) => Promise<void>;
	readonly onRequestExpandableFile: (
		entry: RepositoryDiffFileEntry
	) => Promise<unknown>;
	readonly showTarget: boolean;
	readonly sessionId: RepositorySessionId;
}

interface HoveredDiffLine {
	readonly lineNumber: number;
	readonly side: "additions" | "deletions";
}

type GetHoveredDiffLine = () => HoveredDiffLine | undefined;

const isElement = (value: EventTarget | undefined): value is Element =>
	value instanceof Element;

const isUnmodifiedLineInteraction = (event: MouseEvent): boolean => {
	const path = event.composedPath();
	return path.some(
		(target) =>
			isElement(target) &&
			(target.hasAttribute("data-expand-button") ||
				target.hasAttribute("data-separator-content") ||
				target.hasAttribute("data-unmodified-lines"))
	);
};

const findHunkIndex = (
	entry: RepositoryDiffFileEntry,
	hoveredLine: HoveredDiffLine
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

const DiffFileAccordionComponent = ({
	areHunkActionsEnabled,
	entry,
	isBodyMounted,
	isHunkActionPending,
	ignoreWhitespace,
	onChangeHunk,
	onElementChange,
	onOpenFile,
	onRequestExpandableFile,
	showTarget,
	sessionId,
}: DiffFileAccordionProps): ReactElement => {
	const [isOpen, setIsOpen] = useState(true);
	const [isPreparingContext, setIsPreparingContext] = useState(false);
	const [isHunkActionOpen, setIsHunkActionOpen] = useState(false);
	const [hunkActionSelection, setHunkActionSelection] =
		useState<HunkActionSelection | null>(null);
	const articleElementRef = useRef<HTMLElement | null>(null);
	const bodyId = `repository-diff-body:${encodeURIComponent(entry.key)}`;
	const addedLines = entry.stat?.addedLines;
	const deletedLines = entry.stat?.deletedLines;
	const setArticleElement = useCallback(
		(element: HTMLElement | null): void => {
			articleElementRef.current = element;
			onElementChange(entry.key, element);
		},
		[entry.key, onElementChange]
	);
	const renderHunkAction = useCallback(
		(getHoveredLine: GetHoveredDiffLine): ReactElement => {
			const openActions = (anchor: HTMLButtonElement): void => {
				const hoveredLine = getHoveredLine();
				if (!hoveredLine) {
					return;
				}
				const hunkIndex = findHunkIndex(entry, hoveredLine);
				let target: "staged" | "working" | null = null;
				if (entry.target.kind === "staged" || entry.target.kind === "working") {
					target = entry.target.kind;
				}
				if (hunkIndex < 0 || !target) {
					return;
				}
				const viewportElement = articleElementRef.current?.closest<HTMLElement>(
					"[data-repository-diff-viewport]"
				);
				if (!viewportElement) {
					return;
				}
				const anchorRect = anchor.getBoundingClientRect();
				const selection = {
					anchorBounds: {
						height: anchorRect.height,
						left: anchorRect.left,
						top: anchorRect.top,
						width: anchorRect.width,
					},
					anchorElement: anchor,
					hunkIndex,
					path: entry.path,
					target,
					viewportElement,
				} as const;
				// Mount after the originating click has passed document-level dismiss handlers.
				window.setTimeout(() => {
					setHunkActionSelection(selection);
					setIsHunkActionOpen(true);
				}, 0);
			};

			return (
				<button
					aria-label="Open actions for this hunk"
					className="pointer-events-auto relative z-[4] flex size-5 items-center justify-center rounded-md bg-editor-ink text-white outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-editor-muted/30"
					data-name="RepositoryHunkActionTrigger"
					data-utility-button=""
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						openActions(event.currentTarget);
					}}
					type="button"
				>
					<DotsThreeIcon aria-hidden className="size-3.5" weight="bold" />
				</button>
			);
		},
		[entry]
	);
	const handleClickCapture = useCallback(
		(event: MouseEvent): void => {
			if (!isUnmodifiedLineInteraction(event)) {
				return;
			}
			if (entry.file?.isPartial === false) {
				return;
			}
			if (isPreparingContext) {
				return;
			}
			setIsPreparingContext(true);
			onRequestExpandableFile(entry)
				.catch(() => undefined)
				.finally(() => {
					setIsPreparingContext(false);
				});
		},
		[entry, isPreparingContext, onRequestExpandableFile]
	);
	useLayoutEffect(() => {
		if (!(isBodyMounted && isOpen)) {
			return;
		}
		const article = articleElementRef.current;
		if (!article) {
			return;
		}
		article.addEventListener("click", handleClickCapture, { capture: true });
		return () => {
			article.removeEventListener("click", handleClickCapture, {
				capture: true,
			});
		};
	}, [handleClickCapture, isBodyMounted, isOpen]);
	useLayoutEffect(() => {
		if (isHunkActionOpen && !(isBodyMounted && isOpen && hunkActionSelection)) {
			setIsHunkActionOpen(false);
		}
	});
	const estimatedBodyHeight = entry.file
		? Math.max(
				REPOSITORY_DIFF_MINIMUM_BODY_HEIGHT,
				entry.file.unifiedLineCount * REPOSITORY_DIFF_ESTIMATED_LINE_HEIGHT +
					entry.file.hunks.length * REPOSITORY_DIFF_ESTIMATED_SEPARATOR_HEIGHT
			)
		: 0;
	const previewKind = getRepositoryDiffPreviewKind({
		file: entry.file,
		ignoreWhitespace,
		patchOmittedReason: entry.patchOmittedReason,
		path: entry.path,
		stat: entry.stat,
	});
	let bodyContent: ReactElement;
	if (previewKind === "image") {
		bodyContent = (
			<RepositoryImageDiff
				entry={entry}
				onOpenFile={onOpenFile}
				sessionId={sessionId}
			/>
		);
	} else if (previewKind !== "text") {
		const message =
			previewKind === "large"
				? "This diff is too large to preview safely."
				: previewKind === "binary"
					? "Binary files cannot be displayed as text."
					: previewKind === "rename"
						? `Renamed from ${entry.file?.prevName ?? "the previous path"}.`
						: previewKind === "ignored-whitespace"
							? "No changes remain when whitespace is ignored."
							: "No text preview is available for this file.";
		bodyContent = (
			<div className="px-4 py-8 text-center">
				<p className="text-editor-faint text-xss">{message}</p>
				{previewKind === "ignored-whitespace" ? null : (
					<button
						className="mt-2 rounded-lg px-2.5 py-1.5 font-medium text-editor-muted text-xss outline-none hover:bg-hover hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-brand/20"
						onClick={() => onOpenFile(entry.path)}
						type="button"
					>
						Open in Zed
					</button>
				)}
			</div>
		);
	} else if (entry.file && isBodyMounted) {
		const supportsHunkActions =
			areHunkActionsEnabled &&
			(entry.target.kind === "staged" || entry.target.kind === "working");
		bodyContent = (
			<PierreFileDiff
				className="block"
				fileDiff={entry.file}
				options={
					supportsHunkActions
						? REPOSITORY_DIFF_HUNK_ACTION_RENDER_OPTIONS
						: REPOSITORY_DIFF_RENDER_OPTIONS
				}
				renderGutterUtility={supportsHunkActions ? renderHunkAction : undefined}
			/>
		);
	} else {
		bodyContent = (
			<div
				aria-hidden
				data-name="RepositoryDiffPlaceholder"
				style={{ height: estimatedBodyHeight }}
			/>
		);
	}

	return (
		<article
			aria-busy={isPreparingContext}
			className="overflow-clip bg-editor-surface"
			data-name="DiffFile"
			data-repository-diff-key={entry.key}
			data-repository-diff-path={entry.path}
			id={entry.id}
			ref={setArticleElement}
		>
			<button
				aria-controls={bodyId}
				aria-expanded={isOpen}
				className="sticky top-0 z-10 flex h-8 w-full items-center gap-2 bg-editor-surface px-3 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset"
				data-name="RepositoryDiffFileHeader"
				onClick={() => setIsOpen((current) => !current)}
				type="button"
			>
				<CaretRightIcon
					aria-hidden
					className={cn(
						"size-3 shrink-0 text-editor-faint transition-transform duration-150",
						isOpen && "rotate-90"
					)}
					weight="bold"
				/>
				<h2 className="min-w-0 flex-1 truncate font-semibold text-editor-ink text-xss">
					{entry.path}
				</h2>
				{showTarget ? (
					<span className="shrink-0 text-[9px] text-editor-faint">
						{entry.targetLabel}
					</span>
				) : null}
				<div className="flex shrink-0 items-center gap-1.5 font-medium font-mono text-[9px] tabular-nums">
					{addedLines === null || addedLines === undefined ? null : (
						<span className="text-[#22863a]">+{addedLines}</span>
					)}
					{deletedLines === null || deletedLines === undefined ? null : (
						<span className="text-[#cb2431]">−{deletedLines}</span>
					)}
				</div>
				{entry.change ? <RepositoryFileStatus file={entry.change} /> : null}
			</button>
			<div hidden={!isOpen} id={bodyId}>
				{bodyContent}
			</div>
			{hunkActionSelection ? (
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
			) : null}
		</article>
	);
};

export const DiffFileAccordion = memo(DiffFileAccordionComponent);
