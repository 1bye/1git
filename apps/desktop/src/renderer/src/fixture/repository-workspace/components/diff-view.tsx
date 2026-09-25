import type { ChangeHunkInput, FileDiff } from "@1git/git";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import type { CodeViewItem, CodeViewOptions } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import type { ReactElement } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import {
	REPOSITORY_DIFF_CODE_VIEW_LAYOUT,
	REPOSITORY_DIFF_RENDER_OPTIONS,
	REPOSITORY_DIFF_VIRTUAL_METRICS,
} from "@/fixture/repository-workspace/constants/repository-diff.js";
import { useExpandableRepositoryDiffFiles } from "@/fixture/repository-workspace/hooks/use-expandable-repository-diff-files.js";
import { useRepositoryDiffHighlighter } from "@/fixture/repository-workspace/hooks/use-repository-diff-highlighter.js";
import { useRepositoryDiffScrollSync } from "@/fixture/repository-workspace/hooks/use-repository-diff-scroll-sync.js";
import {
	createRepositoryCodeViewItems,
	getNextRepositoryCodeViewItemVersion,
	type RepositoryCodeViewAnnotation,
} from "@/fixture/repository-workspace/lib/repository-code-view.js";
import type { RepositoryDiffFileEntry } from "@/fixture/repository-workspace/lib/repository-diff-files.js";

import type { RepositorySessionId } from "../../../../../shared/repository-session.js";
import { useRepositoryCodeViewControls } from "./repository-code-view-controls.js";

interface DiffViewProps {
	readonly diffs: readonly FileDiff[];
	readonly emptyDescription?: string;
	readonly emptyTitle?: string;
	readonly entries: readonly RepositoryDiffFileEntry[];
	readonly ignoreWhitespace?: boolean;
	readonly isHunkActionPending?: boolean;
	readonly onActiveFileChange?: (path: string) => void;
	readonly onChangeHunk?: (input: ChangeHunkInput) => Promise<boolean>;
	readonly onOpenFile?: (path: string) => Promise<void>;
	readonly selectedFilePath: string | null;
	readonly sessionId: RepositorySessionId;
}

const ignoreActiveFileChange = (): void => undefined;
const ignoreHunkChange = async (): Promise<boolean> => false;
const ignoreOpenFile = async (): Promise<void> => undefined;

const isElement = (value: EventTarget | undefined): value is Element =>
	value instanceof Element;

const isUnmodifiedLineInteraction = (event: MouseEvent): boolean =>
	event
		.composedPath()
		.some(
			(target) =>
				isElement(target) &&
				(target.hasAttribute("data-expand-button") ||
					target.hasAttribute("data-separator-content") ||
					target.hasAttribute("data-unmodified-lines"))
		);

const isDiffHeaderInteraction = (event: MouseEvent): boolean =>
	event
		.composedPath()
		.some(
			(target) => isElement(target) && target.hasAttribute("data-diffs-header")
		);

const isButtonInteraction = (event: MouseEvent): boolean =>
	event.composedPath().some((target) => target instanceof HTMLButtonElement);

const getDiffHost = (event: MouseEvent): HTMLElement | null => {
	const host = event
		.composedPath()
		.find(
			(target) =>
				target instanceof HTMLElement && target.tagName === "DIFFS-CONTAINER"
		);

	return host instanceof HTMLElement ? host : null;
};

export function DiffView({
	diffs,
	entries,
	emptyDescription = "The changed files may be binary or have no patch content.",
	emptyTitle = "No text diff available",
	isHunkActionPending = false,
	ignoreWhitespace = false,
	onActiveFileChange = ignoreActiveFileChange,
	onChangeHunk,
	onOpenFile = ignoreOpenFile,
	selectedFilePath,
	sessionId,
}: DiffViewProps): ReactElement {
	const scrollRef = useRef<HTMLDivElement | null>(null);

	const viewerRef = useRef<CodeViewHandle<RepositoryCodeViewAnnotation> | null>(
		null
	);

	const preparingContextRef = useRef(new Set<string>());
	const onChangeHunkRef = useRef(onChangeHunk ?? ignoreHunkChange);
	const onOpenFileRef = useRef(onOpenFile);

	onChangeHunkRef.current = onChangeHunk ?? ignoreHunkChange;
	onOpenFileRef.current = onOpenFile;
	const changeHunk = useCallback(
		(input: ChangeHunkInput): Promise<boolean> =>
			onChangeHunkRef.current(input),
		[]
	);

	const openFile = useCallback(
		(path: string): Promise<void> => onOpenFileRef.current(path),
		[]
	);

	const contentKey = useMemo(
		() =>
			`${sessionId}:${ignoreWhitespace ? "ignore-whitespace" : "keep-whitespace"}\n${entries
				.map((entry) => entry.key)
				.join("\n")}`,
		[entries, ignoreWhitespace, sessionId]
	);

	useRepositoryDiffHighlighter(entries);
	const { files: expandableFiles, requestFile: requestExpandableFile } =
		useExpandableRepositoryDiffFiles(sessionId, contentKey, ignoreWhitespace);

	const renderedEntries = useMemo(
		() =>
			entries.map((entry) => {
				const expandedFile = expandableFiles.get(entry.key);

				return expandedFile ? { ...entry, file: expandedFile } : entry;
			}),
		[entries, expandableFiles]
	);

	const entriesByKey = useMemo(
		() => new Map(renderedEntries.map((entry) => [entry.key, entry])),
		[renderedEntries]
	);

	const entriesByKeyRef = useRef(entriesByKey);

	entriesByKeyRef.current = entriesByKey;
	const codeViewItems = useMemo(
		() => createRepositoryCodeViewItems(renderedEntries, ignoreWhitespace),
		[ignoreWhitespace, renderedEntries]
	);

	const {
		hunkActionPocket,
		renderAnnotation,
		renderGutterUtility,
		renderHeaderMetadata,
		renderHeaderPrefix,
		toggleItemCollapsed,
	} = useRepositoryCodeViewControls({
		areHunkActionsEnabled: onChangeHunk !== undefined,
		entriesByKey,
		isHunkActionPending,
		onChangeHunk: changeHunk,
		onOpenFile: openFile,
		sessionId,
		showTarget: diffs.length > 1,
		viewerRef,
	});

	const codeViewOptions = useMemo(
		() =>
			({
				...REPOSITORY_DIFF_RENDER_OPTIONS,
				enableGutterUtility: true,
				itemMetrics: REPOSITORY_DIFF_VIRTUAL_METRICS,
				layout: REPOSITORY_DIFF_CODE_VIEW_LAYOUT,
				onPostRender(node, _instance, phase, context) {
					if (phase === "unmount") {
						node.removeAttribute("aria-busy");
						node.removeAttribute("data-name");
						node.removeAttribute("data-repository-diff-key");
						node.removeAttribute("data-repository-diff-path");
						node.removeAttribute("id");

						return;
					}

					const entry = entriesByKeyRef.current.get(context.item.id);

					if (!entry) {
						return;
					}

					node.dataset.name = "DiffFile";
					node.dataset.repositoryDiffKey = entry.key;
					node.dataset.repositoryDiffPath = entry.path;

					if (entry.id) {
						node.id = entry.id;
					} else {
						node.removeAttribute("id");
					}
				},
				stickyHeaders: true,
			}) satisfies CodeViewOptions<RepositoryCodeViewAnnotation>,
		[]
	);

	const handleCodeViewScroll = useRepositoryDiffScrollSync({
		activePath: selectedFilePath,
		contentKey,
		entries: renderedEntries,
		onActivePathChange: onActiveFileChange,
		viewerRef,
	});

	useLayoutEffect(() => {
		const viewer = viewerRef.current;

		if (!viewer) {
			return;
		}

		for (const nextItem of codeViewItems) {
			const currentItem = viewer.getItem(nextItem.id);

			if (!(currentItem && currentItem.type === nextItem.type)) {
				continue;
			}

			let contentMatches = false;

			if (currentItem.type === "diff" && nextItem.type === "diff") {
				contentMatches = currentItem.fileDiff === nextItem.fileDiff;
			} else if (currentItem.type === "file" && nextItem.type === "file") {
				contentMatches = currentItem.file === nextItem.file;
			}

			if (contentMatches) {
				continue;
			}

			const updatedItem: CodeViewItem<RepositoryCodeViewAnnotation> = {
				...nextItem,
				collapsed: currentItem.collapsed,
				version: getNextRepositoryCodeViewItemVersion(currentItem),
			};

			viewer.updateItem(updatedItem);
		}
	}, [codeViewItems]);

	useLayoutEffect(() => {
		const container = scrollRef.current;

		if (!container) {
			return;
		}

		const handleClick = (event: MouseEvent): void => {
			const isHeaderInteraction = isDiffHeaderInteraction(event);

			if (!(isHeaderInteraction || isUnmodifiedLineInteraction(event))) {
				return;
			}

			const host = getDiffHost(event);
			const entryKey = host?.dataset.repositoryDiffKey;

			if (isHeaderInteraction) {
				if (entryKey && !isButtonInteraction(event)) {
					toggleItemCollapsed(entryKey);
				}

				return;
			}

			const entry = entryKey
				? entriesByKeyRef.current.get(entryKey)
				: undefined;

			if (
				!(host && entryKey && entry) ||
				entry.file?.isPartial === false ||
				preparingContextRef.current.has(entryKey)
			) {
				return;
			}

			preparingContextRef.current.add(entryKey);
			host.ariaBusy = "true";
			requestExpandableFile(entry)
				.catch(() => undefined)
				.finally(() => {
					preparingContextRef.current.delete(entryKey);

					if (host.dataset.repositoryDiffKey === entryKey) {
						host.removeAttribute("aria-busy");
					}
				});
		};

		container.addEventListener("click", handleClick, { capture: true });

		return () => {
			container.removeEventListener("click", handleClick, { capture: true });
		};
	}, [requestExpandableFile, toggleItemCollapsed]);

	if (entries.length === 0) {
		return (
			<div className="flex min-h-full items-center justify-center px-8 py-16 text-center">
				<div>
					<GitDiffIcon
						aria-hidden
						className="mx-auto size-6 text-editor-faint"
						weight="duotone"
					/>
					<h2 className="mt-3 font-medium text-[13px] text-editor-ink">
						{emptyTitle}
					</h2>
					<p className="mt-1 text-editor-faint text-xss">{emptyDescription}</p>
				</div>
			</div>
		);
	}

	return (
		<>
			<CodeView
				className="relative min-h-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain [contain:strict] [overflow-anchor:none] [will-change:scroll-position] [&_diffs-container]:overflow-clip [&_diffs-container]:[contain:layout_paint_style]"
				containerRef={(element) => {
					scrollRef.current = element;

					if (element) {
						element.dataset.name = "DiffView";
						element.toggleAttribute("data-repository-diff-viewport", true);
					}
				}}
				initialItems={codeViewItems}
				key={contentKey}
				onScroll={handleCodeViewScroll}
				options={codeViewOptions}
				ref={viewerRef}
				renderAnnotation={renderAnnotation}
				renderGutterUtility={renderGutterUtility}
				renderHeaderMetadata={renderHeaderMetadata}
				renderHeaderPrefix={renderHeaderPrefix}
			/>
			{hunkActionPocket}
		</>
	);
}
