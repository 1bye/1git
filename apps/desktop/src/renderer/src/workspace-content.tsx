import type { CommitInfo, FileDiff, RepositorySnapshot } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { GitCommitIcon } from "@phosphor-icons/react/dist/csr/GitCommit";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type { ReactElement } from "react";
import { useMemo } from "react";
import type {
	RecentRepositoryRecord,
	RepositorySessionRecord,
} from "../../shared/repository-session.js";
import type { RepositoryTab } from "./use-git-workspace.js";
import { recentRepositoryName } from "./use-git-workspace.js";
import {
	formatCommitDate,
	formatRelativeTime,
	getRepositoryName,
} from "./workspace-model.js";

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

interface RepositoryWelcomeProps {
	readonly isLoading: boolean;
	readonly onOpenRecent: (path: string) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
}

const RepositoryWelcome = ({
	isLoading,
	onOpenRecent,
	onPickRepository,
	recentRepositories,
}: RepositoryWelcomeProps): ReactElement => {
	const pickRepository = async (): Promise<void> => {
		await onPickRepository();
	};

	return (
		<main
			className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-editor-surface px-8 py-12"
			data-name="RepositoryWelcome"
		>
			<div className="w-full max-w-[620px]">
				<div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-editor-ink text-white shadow-surface-3">
					{isLoading ? (
						<SpinnerGapIcon
							aria-hidden
							className="size-5 animate-spin"
							weight="bold"
						/>
					) : (
						<GitBranchIcon aria-hidden className="size-5" weight="bold" />
					)}
				</div>
				<h1 className="mt-5 text-center font-semibold text-[24px] text-editor-ink tracking-[-0.03em]">
					Open a repository
				</h1>
				<p className="mx-auto mt-2 max-w-[420px] text-center text-[13px] text-editor-muted leading-5">
					Review changes, shape commits, and move through history without
					leaving your local workspace.
				</p>
				<div className="mt-6 flex justify-center">
					<Button disabled={isLoading} onClick={pickRepository} variant="brand">
						<FolderOpenIcon aria-hidden className="size-4" weight="bold" />
						Open local repository
					</Button>
				</div>

				{recentRepositories.length > 0 ? (
					<section
						aria-labelledby="welcome-recent-heading"
						className="mt-10"
						data-name="RecentRepositories"
					>
						<h2
							className="mb-2 px-1 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]"
							id="welcome-recent-heading"
						>
							Recent repositories
						</h2>
						<div className="overflow-hidden rounded-2xl border border-editor-hairline bg-editor-sunken/60">
							{recentRepositories.slice(0, 5).map((repository) => {
								const openRecent = async (): Promise<void> => {
									await onOpenRecent(repository.path);
								};
								return (
									<button
										className="group flex w-full items-center gap-3 border-editor-hairline border-b px-3.5 py-3 text-left outline-none last:border-b-0 hover:bg-white/80 focus-visible:bg-white"
										key={repository.path}
										onClick={openRecent}
										type="button"
									>
										<span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-editor-muted shadow-surface-1">
											<FolderOpenIcon
												aria-hidden
												className="size-4"
												weight="regular"
											/>
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium text-[12px] text-editor-ink">
												{recentRepositoryName(repository)}
											</span>
											<span className="block truncate text-[10px] text-editor-faint">
												{repository.path}
											</span>
										</span>
										<span className="shrink-0 text-[10px] text-editor-faint">
											{formatRelativeTime(repository.lastOpenedAt)}
										</span>
									</button>
								);
							})}
						</div>
					</section>
				) : null}
			</div>
		</main>
	);
};

interface CleanStateProps {
	readonly onFetch: () => Promise<void>;
	readonly snapshot: RepositorySnapshot;
}

const CleanState = ({ onFetch, snapshot }: CleanStateProps): ReactElement => {
	const fetchRepository = async (): Promise<void> => {
		await onFetch();
	};

	return (
		<section
			className="flex min-h-full items-center justify-center px-10 py-16"
			data-name="CleanState"
		>
			<div className="w-full max-w-[560px] text-center">
				<div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-700/10">
					<CheckCircleIcon aria-hidden className="size-6" weight="fill" />
				</div>
				<h1 className="mt-5 font-semibold text-[24px] text-editor-ink tracking-[-0.03em]">
					Working tree is clean
				</h1>
				<p className="mx-auto mt-2 max-w-[430px] text-[13px] text-editor-muted leading-5">
					There are no local changes on{" "}
					<span className="font-medium text-editor-ink">
						{snapshot.head.branch ?? "the current branch"}
					</span>
					. You’re ready for the next change.
				</p>
				<div className="mt-7 grid grid-cols-2 overflow-hidden rounded-2xl border border-editor-hairline bg-editor-sunken/55 text-left">
					<div className="border-editor-hairline border-r p-4">
						<GitBranchIcon
							aria-hidden
							className="size-4 text-editor-faint"
							weight="regular"
						/>
						<p className="mt-3 font-medium text-[12px] text-editor-ink">
							{snapshot.head.branch ?? "Detached HEAD"}
						</p>
						<p className="mt-1 text-[10px] text-editor-faint">
							{snapshot.head.upstream ?? "No upstream configured"}
						</p>
					</div>
					<button
						className="p-4 text-left outline-none hover:bg-white/70 focus-visible:bg-white"
						onClick={fetchRepository}
						type="button"
					>
						<ArrowsClockwiseIcon
							aria-hidden
							className="size-4 text-editor-faint"
							weight="regular"
						/>
						<p className="mt-3 font-medium text-[12px] text-editor-ink">
							Fetch remote
						</p>
						<p className="mt-1 text-[10px] text-editor-faint">
							Check for new commits
						</p>
					</button>
				</div>
			</div>
		</section>
	);
};

interface DiffViewProps {
	readonly commit: CommitInfo | null;
	readonly diff: FileDiff;
	readonly selectedFilePath: string | null;
	readonly tab: RepositoryTab;
}

const DiffView = ({
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

interface WorkspaceContentProps {
	readonly activeSession: RepositorySessionRecord | null;
	readonly diff: FileDiff | null;
	readonly historyCommit: CommitInfo | null;
	readonly isInitialLoading: boolean;
	readonly onFetch: () => Promise<void>;
	readonly onOpenRecent: (path: string) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
	readonly selectedFilePath: string | null;
	readonly snapshot: RepositorySnapshot | null;
	readonly tab: RepositoryTab;
}

export const WorkspaceContent = ({
	activeSession,
	diff,
	historyCommit,
	isInitialLoading,
	onFetch,
	onOpenRecent,
	onPickRepository,
	recentRepositories,
	selectedFilePath,
	snapshot,
	tab,
}: WorkspaceContentProps): ReactElement => {
	if (!activeSession) {
		return (
			<RepositoryWelcome
				isLoading={isInitialLoading}
				onOpenRecent={onOpenRecent}
				onPickRepository={onPickRepository}
				recentRepositories={recentRepositories}
			/>
		);
	}

	if (!snapshot) {
		return (
			<main
				className="flex min-h-0 flex-1 items-center justify-center bg-editor-surface"
				data-name="WorkspaceLoading"
			>
				<SpinnerGapIcon
					aria-label={`Loading ${getRepositoryName(
						activeSession.repository.root
					)}`}
					className="size-5 animate-spin text-editor-faint"
					weight="bold"
				/>
			</main>
		);
	}

	if (tab === "changes" && snapshot.files.length === 0) {
		return (
			<main
				className="min-h-0 flex-1 overflow-y-auto bg-editor-surface"
				data-name="WorkspaceContent"
			>
				<CleanState onFetch={onFetch} snapshot={snapshot} />
			</main>
		);
	}

	return (
		<main
			className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-editor-surface"
			data-name="WorkspaceContent"
		>
			{diff ? (
				<DiffView
					commit={historyCommit}
					diff={diff}
					selectedFilePath={selectedFilePath}
					tab={tab}
				/>
			) : (
				<section
					className="flex min-h-full items-center justify-center px-8 py-16 text-center"
					data-name="DiffEmptyState"
				>
					<div>
						<GitDiffIcon
							aria-hidden
							className="mx-auto size-6 text-editor-faint"
							weight="regular"
						/>
						<p className="mt-3 font-medium text-[13px] text-editor-ink">
							Select an item to inspect
						</p>
						<p className="mt-1 text-[11px] text-editor-faint">
							Choose a changed file or commit from the sidebar.
						</p>
					</div>
				</section>
			)}
		</main>
	);
};
