import type { ChangeHunkInput, FileDiff } from "@1git/git";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import type { ReactElement } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { DiffFileAccordion } from "@/fixture/repository-workspace/components/diff-file-accordion.js";
import {
	REPOSITORY_DIFF_BODY_OBSERVER_MARGIN,
	REPOSITORY_DIFF_INITIAL_MOUNTED_COUNT,
} from "@/fixture/repository-workspace/constants/repository-diff.js";
import { useExpandableRepositoryDiffFiles } from "@/fixture/repository-workspace/hooks/use-expandable-repository-diff-files.js";
import { useRepositoryDiffHighlighter } from "@/fixture/repository-workspace/hooks/use-repository-diff-highlighter.js";
import { useRepositoryDiffScrollSync } from "@/fixture/repository-workspace/hooks/use-repository-diff-scroll-sync.js";
import {
	getSelectedRepositoryDiffEntryKey,
	type RepositoryDiffFileEntry,
} from "@/fixture/repository-workspace/lib/repository-diff-files.js";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

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

const updateVisibleEntryKeys = (
	currentKeys: ReadonlySet<string>,
	observerEntries: readonly IntersectionObserverEntry[]
): ReadonlySet<string> => {
	const nextKeys = new Set(currentKeys);

	for (const observerEntry of observerEntries) {
		if (!(observerEntry.target instanceof HTMLElement)) {
			continue;
		}
		const key = observerEntry.target.dataset.repositoryDiffKey;
		if (!key) {
			continue;
		}
		if (observerEntry.isIntersecting) {
			nextKeys.add(key);
		} else {
			nextKeys.delete(key);
		}
	}

	if (
		nextKeys.size === currentKeys.size &&
		[...nextKeys].every((key) => currentKeys.has(key))
	) {
		return currentKeys;
	}
	return nextKeys;
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
	const scrollRef = useRef<HTMLElement>(null);
	const bodyObserverRef = useRef<IntersectionObserver | null>(null);
	const articleElementsRef = useRef(new Map<string, HTMLElement>());
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
	const [visibleEntryKeys, setVisibleEntryKeys] = useState<ReadonlySet<string>>(
		() => new Set()
	);
	const registerArticleElement = useCallback(
		(key: string, element: HTMLElement | null): void => {
			const previousElement = articleElementsRef.current.get(key);
			if (previousElement) {
				bodyObserverRef.current?.unobserve(previousElement);
			}
			if (element) {
				articleElementsRef.current.set(key, element);
				bodyObserverRef.current?.observe(element);
			} else {
				articleElementsRef.current.delete(key);
			}
		},
		[]
	);
	const setScrollContainer = useCallback(
		(element: HTMLElement | null): void => {
			bodyObserverRef.current?.disconnect();
			bodyObserverRef.current = null;
			scrollRef.current = element;
			if (element) {
				bodyObserverRef.current = new IntersectionObserver(
					(observerEntries) => {
						setVisibleEntryKeys((currentKeys) =>
							updateVisibleEntryKeys(currentKeys, observerEntries)
						);
					},
					{
						root: element,
						rootMargin: `${REPOSITORY_DIFF_BODY_OBSERVER_MARGIN}px 0px`,
					}
				);
				for (const articleElement of articleElementsRef.current.values()) {
					bodyObserverRef.current.observe(articleElement);
				}
			}
		},
		[]
	);
	const contentKey = useMemo(
		() => entries.map((entry) => entry.key).join("\n"),
		[entries]
	);
	useRepositoryDiffHighlighter(entries);
	const selectedEntryKey = useMemo(
		() => getSelectedRepositoryDiffEntryKey(entries, selectedFilePath),
		[entries, selectedFilePath]
	);
	const { files: expandableFiles, requestFile: requestExpandableFile } =
		useExpandableRepositoryDiffFiles(sessionId, contentKey, ignoreWhitespace);
	useRepositoryDiffScrollSync({
		activePath: selectedFilePath,
		containerRef: scrollRef,
		contentKey,
		onActivePathChange: onActiveFileChange,
	});

	return (
		<section
			className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
			data-name="DiffView"
			data-repository-diff-viewport
			ref={setScrollContainer}
		>
			{entries.length > 0 ? (
				<div>
					{entries.map((baseEntry, index) => {
						const expandedFile = expandableFiles.get(baseEntry.key);
						const entry = expandedFile
							? { ...baseEntry, file: expandedFile }
							: baseEntry;
						return (
							<DiffFileAccordion
								areHunkActionsEnabled={onChangeHunk !== undefined}
								entry={entry}
								ignoreWhitespace={ignoreWhitespace}
								isBodyMounted={
									index < REPOSITORY_DIFF_INITIAL_MOUNTED_COUNT ||
									selectedEntryKey === entry.key ||
									visibleEntryKeys.has(entry.key)
								}
								isHunkActionPending={isHunkActionPending}
								key={entry.key}
								onChangeHunk={changeHunk}
								onElementChange={registerArticleElement}
								onOpenFile={openFile}
								onRequestExpandableFile={requestExpandableFile}
								sessionId={sessionId}
								showTarget={diffs.length > 1}
							/>
						);
					})}
				</div>
			) : (
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
						<p className="mt-1 text-editor-faint text-xss">
							{emptyDescription}
						</p>
					</div>
				</div>
			)}
		</section>
	);
}
