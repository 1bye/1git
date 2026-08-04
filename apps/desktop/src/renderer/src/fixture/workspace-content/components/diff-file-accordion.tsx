import { cn } from "@1git/ui/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type { ReactElement } from "react";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import {
	REPOSITORY_DIFF_ESTIMATED_LINE_HEIGHT,
	REPOSITORY_DIFF_ESTIMATED_SEPARATOR_HEIGHT,
	REPOSITORY_DIFF_ELEMENT_NAME,
	REPOSITORY_DIFF_MINIMUM_BODY_HEIGHT,
	REPOSITORY_DIFF_RENDER_OPTIONS,
} from "@/fixture/workspace-content/constants/repository-diff.js";
import type { RepositoryDiffFileEntry } from "@/fixture/workspace-content/lib/repository-diff-files.js";

interface DiffFileAccordionProps {
	readonly entry: RepositoryDiffFileEntry;
	readonly isBodyMounted: boolean;
	readonly onElementChange: (key: string, element: HTMLElement | null) => void;
	readonly onRequestExpandableFile: (
		entry: RepositoryDiffFileEntry
	) => Promise<unknown>;
	readonly showTarget: boolean;
}

const isElement = (value: EventTarget | undefined): value is Element =>
	value instanceof Element;

const visibleUnmodifiedLineLabels = (
	host: HTMLElement
): readonly HTMLElement[] => {
	const labels = host.shadowRoot?.querySelectorAll<HTMLElement>(
		'[data-separator="line-info"] [data-unmodified-lines]'
	);
	if (!labels) {
		return [];
	}
	return Array.from(labels).filter(
		(label) => label.getClientRects().length > 0
	);
};

const unmodifiedLineInteraction = (event: MouseEvent): number | null => {
	const path = event.composedPath();
	const label = path.find(
		(target) =>
			isElement(target) && target.hasAttribute("data-unmodified-lines")
	);
	const host = path.find(
		(target) =>
			target instanceof HTMLElement &&
			target.tagName.toLowerCase() === REPOSITORY_DIFF_ELEMENT_NAME
	);
	if (!(label instanceof HTMLElement && host instanceof HTMLElement)) {
		return null;
	}
	const labels = visibleUnmodifiedLineLabels(host);
	const index = labels.indexOf(label);
	return index >= 0 ? index : null;
};

const DiffFileAccordionComponent = ({
	entry,
	isBodyMounted,
	onElementChange,
	onRequestExpandableFile,
	showTarget,
}: DiffFileAccordionProps): ReactElement => {
	const [isOpen, setIsOpen] = useState(true);
	const [isPreparingContext, setIsPreparingContext] = useState(false);
	const articleElementRef = useRef<HTMLElement | null>(null);
	const pendingExpansionIndexRef = useRef<number | null>(null);
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
	const handleClickCapture = useCallback(
		(event: MouseEvent): void => {
			if (!entry.file?.isPartial || isPreparingContext) {
				return;
			}
			const interactionIndex = unmodifiedLineInteraction(event);
			if (interactionIndex === null) {
				return;
			}
			pendingExpansionIndexRef.current = interactionIndex;
			setIsPreparingContext(true);
			void onRequestExpandableFile(entry)
				.then((file) => {
					if (!file) {
						pendingExpansionIndexRef.current = null;
					}
				})
				.catch(() => {
					pendingExpansionIndexRef.current = null;
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
		const pendingIndex = pendingExpansionIndexRef.current;
		if (entry.file?.isPartial !== false || pendingIndex === null) {
			return;
		}
		const animationFrameId = requestAnimationFrame(() => {
			const host = articleElementRef.current?.querySelector<HTMLElement>(
				REPOSITORY_DIFF_ELEMENT_NAME
			);
			const label = host
				? visibleUnmodifiedLineLabels(host)[pendingIndex]
				: undefined;
			pendingExpansionIndexRef.current = null;
			label?.click();
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
		bodyContent = (
			<PierreFileDiff
				className="block"
				fileDiff={entry.file}
				options={REPOSITORY_DIFF_RENDER_OPTIONS}
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
				className="sticky top-0 z-10 flex h-8 w-full items-center gap-2 bg-editor-surface px-3 text-left outline-none transition-colors hover:bg-editor-sunken focus-visible:bg-editor-sunken focus-visible:ring-2 focus-visible:ring-editor-muted/20 focus-visible:ring-inset"
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
				<h2 className="min-w-0 flex-1 truncate font-medium text-editor-muted text-xss">
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
			</button>
			<div hidden={!isOpen} id={bodyId}>
				{bodyContent}
			</div>
		</article>
	);
};

export const DiffFileAccordion = memo(DiffFileAccordionComponent);
