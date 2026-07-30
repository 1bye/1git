import type { CommitInfo, FileDiff } from "@1git/git";
import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import { GitCommitIcon } from "@phosphor-icons/react/dist/csr/GitCommit";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type { ReactElement } from "react";
import { useMemo } from "react";
import type { RepositoryTab } from "./use-git-workspace.js";
import { formatCommitDate } from "./workspace-model.js";

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

interface DiffViewProps {
	readonly commit: CommitInfo | null;
	readonly diff: FileDiff;
	readonly selectedFilePath: string | null;
	readonly tab: RepositoryTab;
}

export const DiffView = ({
	commit,
	diff,
	selectedFilePath,
	tab,
}: DiffViewProps): ReactElement => {
	const parsedFiles = useMemo(
		() =>
			parsePatchFiles(
				diff.patch,
				tab === "history" ? commit?.oid : (selectedFilePath ?? undefined),
				true
			).flatMap((patch) => patch.files),
		[commit?.oid, diff.patch, selectedFilePath, tab]
	);
	const addedLines = diff.stats.reduce(
		(total, stat) => total + (stat.addedLines ?? 0),
		0
	);
	const deletedLines = diff.stats.reduce(
		(total, stat) => total + (stat.deletedLines ?? 0),
		0
	);
	const title =
		tab === "history"
			? (commit?.summary ?? "Commit")
			: (selectedFilePath ?? "Changes");

	return (
		<section className="flex min-h-full flex-col" data-name="DiffView">
			<header className="sticky top-0 z-20 flex min-h-14 shrink-0 items-center gap-3 border-editor-hairline border-b bg-white/88 px-5 backdrop-blur-xl">
				<span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-editor-sunken text-editor-muted">
					{tab === "history" ? (
						<GitCommitIcon aria-hidden className="size-3.5" weight="regular" />
					) : (
						<FileCodeIcon aria-hidden className="size-3.5" weight="regular" />
					)}
				</span>
				<div className="min-w-0 flex-1">
					<h1 className="truncate font-semibold text-[13px] text-editor-ink">
						{title}
					</h1>
					{commit ? (
						<p className="mt-0.5 truncate text-[10px] text-editor-faint">
							{commit.author.name} · {formatCommitDate(commit.committedAt)} ·{" "}
							{commit.oid.slice(0, 7)}
						</p>
					) : (
						<p className="mt-0.5 text-[10px] text-editor-faint">
							{diff.target.kind === "staged"
								? "Staged changes"
								: "Working tree changes"}
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-3 font-medium font-mono text-[10px]">
					<span className="text-emerald-700">+{addedLines}</span>
					<span className="text-rose-600">−{deletedLines}</span>
					<span className="text-editor-faint">
						{diff.stats.length} {diff.stats.length === 1 ? "file" : "files"}
					</span>
				</div>
			</header>

			{parsedFiles.length > 0 ? (
				<div className="space-y-3 p-3">
					{parsedFiles.map((file, index) => (
						<div
							className="overflow-hidden rounded-xl border border-editor-hairline bg-white shadow-surface-1"
							data-name="DiffFile"
							key={file.cacheKey ?? `${file.name}-${index}`}
						>
							<div className="flex h-9 items-center gap-2 border-editor-hairline border-b bg-editor-sunken/65 px-3">
								<GitDiffIcon
									aria-hidden
									className="size-3.5 text-editor-faint"
									weight="regular"
								/>
								<span className="truncate font-medium font-mono text-[11px] text-editor-muted">
									{file.name}
								</span>
							</div>
							<PierreFileDiff
								className="block"
								disableWorkerPool
								fileDiff={file}
								options={DIFF_RENDER_OPTIONS}
							/>
						</div>
					))}
				</div>
			) : (
				<div className="flex flex-1 items-center justify-center px-8 py-16 text-center">
					<div>
						<GitDiffIcon
							aria-hidden
							className="mx-auto size-6 text-editor-faint"
							weight="regular"
						/>
						<p className="mt-3 font-medium text-[13px] text-editor-ink">
							No text diff available
						</p>
						<p className="mt-1 text-[11px] text-editor-faint">
							The file may be binary or have no patch content.
						</p>
					</div>
				</div>
			)}
		</section>
	);
};
