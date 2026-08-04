import type { CommitInfo, DiffFileStat, FileChange, FileDiff } from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import {
	Virtualizer as PierreDiffVirtualizer,
	parsePatchFiles,
} from "@pierre/diffs";
import {
	FileDiff as PierreFileDiff,
	VirtualizerContext,
} from "@pierre/diffs/react";
import type { ReactElement } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { RepositoryTab } from "@/feature/workspace/hooks/use-git-workspace.js";
import { useRepositoryDiffScrollSync } from "@/fixture/repository-workspace/hooks/use-repository-diff-scroll-sync.js";
import { getRepositoryDiffElementId } from "@/fixture/repository-workspace/lib/repository-navigation.js";

const DIFF_RENDER_OPTIONS = {
	diffIndicators: "bars",
	diffStyle: "unified",
	disableFileHeader: true,
	hunkSeparators: "metadata",
	lineDiffType: "word-alt",
	overflow: "scroll",
	theme: "pierre-light",
	themeType: "light",
	unsafeCSS: `
		:host {
			display: block;
			--diffs-font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
		}
		pre {
			font-family: var(--diffs-font-family) !important;
			font-size: 12px !important;
			line-height: 1.65 !important;
		}
	`,
} as const;

const DIFF_VIRTUALIZER_CONFIG = {
	intersectionObserverMargin: 1600,
	overscrollSize: 800,
} as const;

const DIFF_ESTIMATED_LINE_HEIGHT = 20;
const DIFF_ESTIMATED_SEPARATOR_HEIGHT = 24;
const DIFF_MINIMUM_BODY_HEIGHT = 64;
const DIFF_BODY_OBSERVER_MARGIN = 1600;
const INITIAL_MOUNTED_DIFF_COUNT = 2;

type ParsedDiffFile = ReturnType<
	typeof parsePatchFiles
>[number]["files"][number];

interface DiffFileEntry {
	readonly file: ParsedDiffFile | null;
	readonly id: string | undefined;
	readonly key: string;
	readonly path: string;
	readonly stat: DiffFileStat | null;
	readonly targetLabel: string;
}

type DiffFileEntryWithoutId = Omit<DiffFileEntry, "id">;

interface DiffFileAccordionProps {
	readonly entry: DiffFileEntry;
	readonly isBodyMounted: boolean;
	readonly onElementChange: (key: string, element: HTMLElement | null) => void;
	readonly showTarget: boolean;
}

const diffTargetLabel = (diff: FileDiff): string => {
	if (diff.target.kind === "staged") {
		return "Staged";
	}
	if (diff.target.kind === "working") {
		return "Working tree";
	}
	if (diff.target.kind === "commit") {
		return "Commit";
	}
	return "Comparison";
};

const statForFile = (
	stats: readonly DiffFileStat[],
	path: string
): DiffFileStat | null =>
	stats.find((stat) => stat.path === path || stat.originalPath === path) ??
	null;

const parseDiffFileEntries = (
	diffs: readonly FileDiff[],
	commitOid: string | undefined,
	tab: RepositoryTab
): readonly DiffFileEntryWithoutId[] => {
	const entries: DiffFileEntryWithoutId[] = [];
	for (const [diffIndex, diff] of diffs.entries()) {
		const parsedFiles = parsePatchFiles(
			diff.patch,
			tab === "history" ? commitOid : `${diff.target.kind}-${diffIndex}`,
			true
		).flatMap((patch) => patch.files);
		for (const file of parsedFiles) {
			entries.push({
				file,
				key: `${diff.target.kind}:${diffIndex}:${file.cacheKey ?? file.name}`,
				path: file.name,
				stat: statForFile(diff.stats, file.name),
				targetLabel: diffTargetLabel(diff),
			});
		}
	}
	return entries;
};

const addMissingFileEntries = (
	entries: readonly DiffFileEntryWithoutId[],
	files: readonly FileChange[],
	tab: RepositoryTab
): readonly DiffFileEntryWithoutId[] => {
	if (tab !== "changes") {
		return entries;
	}
	const knownPaths = new Set(entries.map((entry) => entry.path));
	const nextEntries = [...entries];
	for (const file of files) {
		if (knownPaths.has(file.path)) {
			continue;
		}
		nextEntries.push({
			file: null,
			key: `empty:${file.path}`,
			path: file.path,
			stat: null,
			targetLabel: "Working tree",
		});
	}
	return nextEntries;
};

const assignDiffElementIds = (
	entries: readonly DiffFileEntryWithoutId[]
): readonly DiffFileEntry[] => {
	const seenPaths = new Set<string>();
	return entries.map((entry) => {
		const isFirstOccurrence = !seenPaths.has(entry.path);
		seenPaths.add(entry.path);
		return {
			...entry,
			id: isFirstOccurrence
				? getRepositoryDiffElementId(entry.path)
				: undefined,
		};
	});
};

function DiffFileAccordion({
	entry,
	isBodyMounted,
	onElementChange,
	showTarget,
}: DiffFileAccordionProps): ReactElement {
	const [isOpen, setIsOpen] = useState(true);
	const bodyId = `repository-diff-body:${encodeURIComponent(entry.key)}`;
	const addedLines = entry.stat?.addedLines;
	const deletedLines = entry.stat?.deletedLines;
	const setArticleElement = useCallback(
		(element: HTMLElement | null): void => {
			onElementChange(entry.key, element);
		},
		[entry.key, onElementChange]
	);
	const estimatedBodyHeight = entry.file
		? Math.max(
				DIFF_MINIMUM_BODY_HEIGHT,
				entry.file.unifiedLineCount * DIFF_ESTIMATED_LINE_HEIGHT +
					entry.file.hunks.length * DIFF_ESTIMATED_SEPARATOR_HEIGHT
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
				options={DIFF_RENDER_OPTIONS}
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
				className="sticky top-0 z-10 flex h-9 w-full items-center gap-2 bg-editor-sunken/92 px-3 text-left outline-none backdrop-blur-xl transition-colors hover:bg-editor-sunken-2 focus-visible:ring-2 focus-visible:ring-editor-muted/20 focus-visible:ring-inset"
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
				<h2 className="min-w-0 flex-1 truncate font-medium font-mono text-editor-muted text-xss">
					{entry.path}
				</h2>
				{showTarget ? (
					<span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[9px] text-editor-faint">
						{entry.targetLabel}
					</span>
				) : null}
				<div className="flex shrink-0 items-center gap-2 font-medium font-mono text-[9px] tabular-nums">
					{addedLines === null || addedLines === undefined ? null : (
						<span className="text-emerald-700">+{addedLines}</span>
					)}
					{deletedLines === null || deletedLines === undefined ? null : (
						<span className="text-rose-600">−{deletedLines}</span>
					)}
				</div>
			</button>
			<div hidden={!isOpen} id={bodyId}>
				{bodyContent}
			</div>
		</article>
	);
}

interface DiffViewProps {
	readonly commit: CommitInfo | null;
	readonly diffs: readonly FileDiff[];
	readonly files?: readonly FileChange[];
	readonly onActiveFileChange?: (path: string) => void;
	readonly selectedFilePath: string | null;
	readonly tab: RepositoryTab;
}

const ignoreActiveFileChange = (): void => undefined;

export function DiffView({
	commit,
	diffs,
	files = [],
	onActiveFileChange = ignoreActiveFileChange,
	selectedFilePath,
	tab,
}: DiffViewProps): ReactElement {
	const scrollRef = useRef<HTMLElement>(null);
	const bodyObserverRef = useRef<IntersectionObserver | null>(null);
	const articleElementsRef = useRef(new Map<string, HTMLElement>());
	const [visibleEntryKeys, setVisibleEntryKeys] = useState<ReadonlySet<string>>(
		() => new Set()
	);
	const [virtualizer] = useState(
		() => new PierreDiffVirtualizer(DIFF_VIRTUALIZER_CONFIG)
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
				virtualizer.setup(element);
				bodyObserverRef.current = new IntersectionObserver(
					(observerEntries) => {
						setVisibleEntryKeys((currentKeys) => {
							let nextKeys: Set<string> | null = null;
							for (const observerEntry of observerEntries) {
								if (
									!(
										observerEntry.isIntersecting &&
										observerEntry.target instanceof HTMLElement
									)
								) {
									continue;
								}
								const key = observerEntry.target.dataset.repositoryDiffKey;
								if (key && !currentKeys.has(key)) {
									nextKeys ??= new Set(currentKeys);
									nextKeys.add(key);
								}
							}
							return nextKeys ?? currentKeys;
						});
					},
					{
						root: element,
						rootMargin: `${DIFF_BODY_OBSERVER_MARGIN}px 0px`,
					}
				);
				for (const articleElement of articleElementsRef.current.values()) {
					bodyObserverRef.current.observe(articleElement);
				}
			} else {
				virtualizer.cleanUp();
			}
		},
		[virtualizer]
	);
	const entries = useMemo(
		() =>
			assignDiffElementIds(
				addMissingFileEntries(
					parseDiffFileEntries(diffs, commit?.oid, tab),
					files,
					tab
				)
			),
		[commit?.oid, diffs, files, tab]
	);
	const contentKey = useMemo(
		() => entries.map((entry) => entry.key).join("\n"),
		[entries]
	);
	useRepositoryDiffScrollSync({
		activePath: selectedFilePath,
		containerRef: scrollRef,
		contentKey,
		onActivePathChange: onActiveFileChange,
	});

	return (
		<VirtualizerContext.Provider value={virtualizer}>
			<section
				className="h-full min-h-0 overflow-y-auto overscroll-contain"
				data-name="DiffView"
				ref={setScrollContainer}
			>
				{entries.length > 0 ? (
					<div>
						{entries.map((entry, index) => (
							<DiffFileAccordion
								entry={entry}
								isBodyMounted={
									index < INITIAL_MOUNTED_DIFF_COUNT ||
									entry.path === selectedFilePath ||
									visibleEntryKeys.has(entry.key)
								}
								key={entry.key}
								onElementChange={registerArticleElement}
								showTarget={diffs.length > 1}
							/>
						))}
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
		</VirtualizerContext.Provider>
	);
}
