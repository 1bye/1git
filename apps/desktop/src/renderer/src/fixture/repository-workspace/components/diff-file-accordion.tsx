import { cn } from "@1git/ui/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type { ReactElement } from "react";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import {
	REPOSITORY_DIFF_ELEMENT_NAME,
	REPOSITORY_DIFF_ESTIMATED_LINE_HEIGHT,
	REPOSITORY_DIFF_ESTIMATED_SEPARATOR_HEIGHT,
	REPOSITORY_DIFF_HUNK_ACTION_RENDER_OPTIONS,
	REPOSITORY_DIFF_MINIMUM_BODY_HEIGHT,
	REPOSITORY_DIFF_RENDER_OPTIONS,
} from "@/fixture/repository-workspace/constants/repository-diff.js";
import type { RepositoryDiffFileEntry } from "@/fixture/repository-workspace/lib/repository-diff-files.js";
import type {
	HunkActionHandler,
	HunkActionSelection,
} from "./hunk-action-pocket.js";
import { HunkActionPocket } from "./hunk-action-pocket.js";
import { RepositoryFileStatus } from "./repository-file-status.js";

interface DiffFileAccordionProps {
	readonly areHunkActionsEnabled: boolean;
	readonly entry: RepositoryDiffFileEntry;
	readonly isBodyMounted: boolean;
	readonly isHunkActionPending: boolean;
	readonly onChangeHunk: HunkActionHandler;
	readonly onElementChange: (key: string, element: HTMLElement | null) => void;
	readonly onRequestExpandableFile: (
		entry: RepositoryDiffFileEntry
	) => Promise<unknown>;
	readonly showTarget: boolean;
}

interface UnmodifiedLineInteraction {
	readonly direction: "down" | "up";
	readonly index: number;
}

interface HoveredDiffLine {
	readonly lineNumber: number;
	readonly side: "additions" | "deletions";
}

type GetHoveredDiffLine = () => HoveredDiffLine | undefined;

const isElement = (value: EventTarget | undefined): value is Element =>
	value instanceof Element;

const visibleUnmodifiedLineSeparators = (
	host: HTMLElement
): readonly HTMLElement[] => {
	const separators = host.shadowRoot?.querySelectorAll<HTMLElement>(
		'[data-separator="line-info"]'
	);
	if (!separators) {
		return [];
	}
	return Array.from(separators).filter(
		(separator) =>
			separator.querySelector("[data-unmodified-lines]") &&
			separator.getClientRects().length > 0
	);
};

const unmodifiedLineInteraction = (
	event: MouseEvent
): UnmodifiedLineInteraction | null => {
	const path = event.composedPath();
	const content = path.find(
		(target) =>
			isElement(target) && target.hasAttribute("data-separator-content")
	);
	const host = path.find(
		(target) =>
			target instanceof HTMLElement &&
			target.tagName.toLowerCase() === REPOSITORY_DIFF_ELEMENT_NAME
	);
	const separator =
		content instanceof HTMLElement
			? content.closest<HTMLElement>('[data-separator="line-info"]')
			: null;
	if (
		!(
			content instanceof HTMLElement &&
			host instanceof HTMLElement &&
			separator
		)
	) {
		return null;
	}
	const separators = visibleUnmodifiedLineSeparators(host);
	const index = separators.indexOf(separator);
	if (index < 0) {
		return null;
	}
	const contentRect = content.getBoundingClientRect();
	return {
		direction:
			event.clientY < contentRect.top + contentRect.height / 2 ? "up" : "down",
		index,
	};
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
	onChangeHunk,
	onElementChange,
	onRequestExpandableFile,
	showTarget,
}: DiffFileAccordionProps): ReactElement => {
	const [isOpen, setIsOpen] = useState(true);
	const [isPreparingContext, setIsPreparingContext] = useState(false);
	const [isHunkActionOpen, setIsHunkActionOpen] = useState(false);
	const [hunkActionSelection, setHunkActionSelection] =
		useState<HunkActionSelection | null>(null);
	const articleElementRef = useRef<HTMLElement | null>(null);
	const pendingExpansionRef = useRef<UnmodifiedLineInteraction | null>(null);
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
				const selection = {
					anchorElement: anchor,
					hunkIndex,
					path: entry.path,
					target,
				} as const;
				// Mount after the originating click has passed document-level dismiss handlers.
				window.setTimeout(() => {
					if (!anchor.isConnected) {
						return;
					}
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
			if (!entry.file?.isPartial || isPreparingContext) {
				return;
			}
			const interaction = unmodifiedLineInteraction(event);
			if (!interaction) {
				return;
			}
			pendingExpansionRef.current = interaction;
			setIsPreparingContext(true);
			onRequestExpandableFile(entry)
				.then((file) => {
					if (!file) {
						pendingExpansionRef.current = null;
					}
				})
				.catch(() => {
					pendingExpansionRef.current = null;
				})
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
		const host = articleElementRef.current?.querySelector<HTMLElement>(
			REPOSITORY_DIFF_ELEMENT_NAME
		);
		if (!host) {
			return;
		}
		host.addEventListener("click", handleClickCapture, { capture: true });
		return () => {
			host.removeEventListener("click", handleClickCapture, {
				capture: true,
			});
		};
	}, [handleClickCapture, isBodyMounted, isOpen]);
	useLayoutEffect(() => {
		if (
			isHunkActionOpen &&
			!(
				isBodyMounted &&
				isOpen &&
				hunkActionSelection?.anchorElement.isConnected
			)
		) {
			setIsHunkActionOpen(false);
		}
	});
	useLayoutEffect(() => {
		const pendingExpansion = pendingExpansionRef.current;
		if (entry.file?.isPartial !== false || !pendingExpansion) {
			return;
		}
		const animationFrameId = requestAnimationFrame(() => {
			const host = articleElementRef.current?.querySelector<HTMLElement>(
				REPOSITORY_DIFF_ELEMENT_NAME
			);
			const separator = host
				? visibleUnmodifiedLineSeparators(host)[pendingExpansion.index]
				: undefined;
			const directionButton = separator?.querySelector<HTMLElement>(
				`[data-expand-${pendingExpansion.direction}]`
			);
			const fallbackButton = separator?.querySelector<HTMLElement>(
				"[data-expand-both], [data-expand-button]"
			);
			const fallbackLabel = separator?.querySelector<HTMLElement>(
				"[data-unmodified-lines]"
			);
			pendingExpansionRef.current = null;
			(directionButton ?? fallbackButton ?? fallbackLabel)?.click();
		});
		return () => {
			cancelAnimationFrame(animationFrameId);
		};
	}, [entry.file]);
	const estimatedBodyHeight = entry.file
		? Math.max(
				REPOSITORY_DIFF_MINIMUM_BODY_HEIGHT,
				entry.file.unifiedLineCount * REPOSITORY_DIFF_ESTIMATED_LINE_HEIGHT +
					entry.file.hunks.length * REPOSITORY_DIFF_ESTIMATED_SEPARATOR_HEIGHT
			)
		: 0;
	let bodyContent: ReactElement;
	if (!entry.file) {
		bodyContent = (
			<p className="px-4 py-8 text-center text-editor-faint text-xss">
				No text diff available for this file.
			</p>
		);
	} else if (isBodyMounted) {
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
