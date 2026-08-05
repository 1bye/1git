import type { CommitInfo, FileChange, FileDiff } from "@1git/git";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import type { ReactElement } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { RepositoryTab } from "@/feature/workspace/hooks/use-git-workspace.js";
import { useRepositoryDiffScrollSync } from "@/fixture/repository-workspace/hooks/use-repository-diff-scroll-sync.js";
import { DiffFileAccordion } from "@/fixture/workspace-content/components/diff-file-accordion.js";
import {
	REPOSITORY_DIFF_BODY_OBSERVER_MARGIN,
	REPOSITORY_DIFF_INITIAL_MOUNTED_COUNT,
	REPOSITORY_DIFF_SELECTED_NEIGHBOR_COUNT,
} from "@/fixture/workspace-content/constants/repository-diff.js";
import { useExpandableRepositoryDiffFiles } from "@/fixture/workspace-content/hooks/use-expandable-repository-diff-files.js";
import { useRepositoryDiffHighlighter } from "@/fixture/workspace-content/hooks/use-repository-diff-highlighter.js";
import { createRepositoryDiffFileEntries } from "@/fixture/workspace-content/lib/repository-diff-files.js";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

interface DiffViewProps {
	readonly commit: CommitInfo | null;
	readonly diffs: readonly FileDiff[];
	readonly files?: readonly FileChange[];
	readonly onActiveFileChange?: (path: string) => void;
	readonly selectedFilePath: string | null;
	readonly sessionId: RepositorySessionId;
	readonly tab: RepositoryTab;
}

const ignoreActiveFileChange = (): void => undefined;

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
	commit,
	diffs,
	files = [],
	onActiveFileChange = ignoreActiveFileChange,
	selectedFilePath,
	sessionId,
	tab,
}: DiffViewProps): ReactElement {
	const scrollRef = useRef<HTMLElement>(null);
	const bodyObserverRef = useRef<IntersectionObserver | null>(null);
	const articleElementsRef = useRef(new Map<string, HTMLElement>());
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
	const entries = useMemo(
		() => createRepositoryDiffFileEntries(diffs, files, commit?.oid, tab),
		[commit?.oid, diffs, files, tab]
	);
	const contentKey = useMemo(
		() => entries.map((entry) => entry.key).join("\n"),
		[entries]
	);
	const isHighlighterReady = useRepositoryDiffHighlighter(entries);
	const prioritizedEntryKeys = useMemo(() => {
		const keys = new Set<string>();
		if (!selectedFilePath) {
			return keys;
		}
		for (const [index, entry] of entries.entries()) {
			if (entry.path !== selectedFilePath) {
				continue;
			}
			const firstNeighborIndex = Math.max(
				0,
				index - REPOSITORY_DIFF_SELECTED_NEIGHBOR_COUNT
			);
			const lastNeighborIndex = Math.min(
				entries.length - 1,
				index + REPOSITORY_DIFF_SELECTED_NEIGHBOR_COUNT
			);
			for (
				let neighborIndex = firstNeighborIndex;
				neighborIndex <= lastNeighborIndex;
				neighborIndex += 1
			) {
				const neighbor = entries[neighborIndex];
				if (neighbor) {
					keys.add(neighbor.key);
				}
			}
		}
		return keys;
	}, [entries, selectedFilePath]);
	const { files: expandableFiles, requestFile: requestExpandableFile } =
		useExpandableRepositoryDiffFiles(sessionId, contentKey);
	useRepositoryDiffScrollSync({
		activePath: selectedFilePath,
		containerRef: scrollRef,
		contentKey,
		onActivePathChange: onActiveFileChange,
	});

	return (
		<section
			className="h-full min-h-0 overflow-y-auto overscroll-contain"
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
								entry={entry}
								isBodyMounted={
									isHighlighterReady &&
									(index < REPOSITORY_DIFF_INITIAL_MOUNTED_COUNT ||
										prioritizedEntryKeys.has(entry.key) ||
										visibleEntryKeys.has(entry.key))
								}
								key={entry.key}
								onElementChange={registerArticleElement}
								onRequestExpandableFile={requestExpandableFile}
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
							No text diff available
						</h2>
						<p className="mt-1 text-editor-faint text-xss">
							The changed files may be binary or have no patch content.
						</p>
					</div>
				</div>
			)}
		</section>
	);
}
