import type { CommitInfo, DiffFileStat, FileChange, FileDiff } from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type { ReactElement } from "react";
import { useMemo, useRef, useState } from "react";
import type { RepositoryTab } from "@/feature/workspace/hooks/use-git-workspace.js";
import { useRepositoryDiffScrollSync } from "@/fixture/repository-workspace/hooks/use-repository-diff-scroll-sync.js";
import { getRepositoryDiffElementId } from "@/fixture/repository-workspace/lib/repository-navigation.js";

const DIFF_RENDER_OPTIONS = {
	diffIndicators: "bars",
	diffStyle: "unified",
	disableFileHeader: true,
	disableVirtualizationBuffers: true,
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
	showTarget,
}: DiffFileAccordionProps): ReactElement {
	const [isOpen, setIsOpen] = useState(true);
	const bodyId = `repository-diff-body:${encodeURIComponent(entry.key)}`;
	const addedLines = entry.stat?.addedLines;
	const deletedLines = entry.stat?.deletedLines;

	return (
		<article
			className="overflow-clip border-editor-hairline border-b bg-editor-surface"
			data-name="DiffFile"
			data-repository-diff-path={entry.path}
			id={entry.id}
		>
			<button
				aria-controls={bodyId}
				aria-expanded={isOpen}
				className="sticky top-0 z-10 flex h-9 w-full items-center gap-2 border-editor-hairline border-b bg-editor-sunken/92 px-3 text-left outline-none backdrop-blur-xl transition-colors hover:bg-editor-sunken-2 focus-visible:ring-2 focus-visible:ring-editor-muted/20 focus-visible:ring-inset"
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
				<FileCodeIcon
					aria-hidden
					className="size-3.5 shrink-0 text-editor-faint"
					weight="duotone"
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
				{entry.file ? (
					<PierreFileDiff
						className="block"
						disableWorkerPool
						fileDiff={entry.file}
						options={DIFF_RENDER_OPTIONS}
					/>
				) : (
					<p className="px-4 py-8 text-center text-editor-faint text-xss">
						No text diff available for this file.
					</p>
				)}
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
	useRepositoryDiffScrollSync({
		activePath: selectedFilePath,
		containerRef: scrollRef,
		onActivePathChange: onActiveFileChange,
	});

	return (
		<section
			className="h-full min-h-0 overflow-y-auto overscroll-contain"
			data-name="DiffView"
			ref={scrollRef}
		>
			{entries.length > 0 ? (
				<div>
					{entries.map((entry) => (
						<DiffFileAccordion
							entry={entry}
							key={entry.key}
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
	);
}
