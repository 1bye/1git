import type {
	CommitInfo,
	CommitPage,
	FileChange,
	RepositorySnapshot,
} from "@1git/git";
import { Button } from "@1git/ui/components/button";
import { Input } from "@1git/ui/components/input";
import { Textarea } from "@1git/ui/components/textarea";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import { GitCommitIcon } from "@phosphor-icons/react/dist/csr/GitCommit";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { useState } from "react";
import type {
	PendingWorkspaceAction,
	RepositoryTab,
} from "./use-git-workspace.js";
import {
	areAllFilesStaged,
	formatRelativeTime,
	getFileChangeLabel,
	isFilePartiallyStaged,
	isFileStaged,
	matchesFileFilter,
} from "./workspace-model.js";

interface StageCheckboxProps {
	readonly checked: boolean;
	readonly disabled?: boolean;
	readonly label: string;
	readonly mixed?: boolean;
	readonly onChange: (checked: boolean) => Promise<void>;
}

const StageCheckbox = ({
	checked,
	disabled = false,
	label,
	mixed = false,
	onChange,
}: StageCheckboxProps): ReactElement => {
	const toggle = async (
		event: ChangeEvent<HTMLInputElement>
	): Promise<void> => {
		await onChange(event.target.checked);
	};
	let checkboxIcon: ReactElement | null = null;
	if (mixed) {
		checkboxIcon = <MinusIcon aria-hidden className="size-2.5" weight="bold" />;
	} else if (checked) {
		checkboxIcon = <CheckIcon aria-hidden className="size-2.5" weight="bold" />;
	}

	return (
		<label
			className="flex size-5 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50"
			data-name="StageCheckbox"
		>
			<input
				aria-checked={mixed ? "mixed" : checked}
				aria-label={label}
				checked={checked}
				className="sr-only"
				disabled={disabled}
				onChange={toggle}
				type="checkbox"
			/>
			<span
				className={
					checked || mixed
						? "flex size-4 items-center justify-center rounded-[5px] bg-editor-ink text-white shadow-sm"
						: "size-4 rounded-[5px] border border-editor-hairline-strong bg-white/65 shadow-xs"
				}
			>
				{checkboxIcon}
			</span>
		</label>
	);
};

interface FileChangeRowProps {
	readonly file: FileChange;
	readonly isPending: boolean;
	readonly isSelected: boolean;
	readonly onSelect: (file: FileChange) => Promise<void>;
	readonly onSetStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
}

const FileChangeRow = ({
	file,
	isPending,
	isSelected,
	onSelect,
	onSetStaged,
}: FileChangeRowProps): ReactElement => {
	const staged = isFileStaged(file);
	const partiallyStaged = isFilePartiallyStaged(file);
	const selectFile = async (): Promise<void> => {
		await onSelect(file);
	};
	const setStaged = async (shouldStage: boolean): Promise<void> => {
		await onSetStaged(file, shouldStage);
	};
	const pathSeparator = file.path.lastIndexOf("/");
	const directory =
		pathSeparator > -1 ? file.path.slice(0, pathSeparator + 1) : "";
	const name =
		pathSeparator > -1 ? file.path.slice(pathSeparator + 1) : file.path;

	return (
		<li
			className={
				isSelected
					? "group flex items-center bg-white/78 shadow-[inset_2px_0_0_var(--brand)]"
					: "group flex items-center hover:bg-white/45"
			}
			data-name="FileChangeRow"
		>
			<div className="pl-2.5">
				<StageCheckbox
					checked={staged}
					disabled={isPending}
					label={staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
					mixed={partiallyStaged}
					onChange={setStaged}
				/>
			</div>
			<button
				aria-current={isSelected ? "true" : undefined}
				className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset"
				onClick={selectFile}
				type="button"
			>
				<FileIcon
					aria-hidden
					className="size-3.5 shrink-0 text-editor-faint"
					weight="regular"
				/>
				<span className="min-w-0 flex-1 truncate text-[12px]">
					<span className="text-editor-faint">{directory}</span>
					<span className="font-medium text-editor-ink">{name}</span>
				</span>
				<span
					className="w-4 shrink-0 text-center font-mono font-semibold text-[10px] text-editor-muted"
					title={`${file.indexStatus} / ${file.worktreeStatus}`}
				>
					{getFileChangeLabel(file)}
				</span>
			</button>
		</li>
	);
};

interface CommitRowProps {
	readonly commit: CommitInfo;
	readonly isSelected: boolean;
	readonly onSelect: (commit: CommitInfo) => Promise<void>;
}

const CommitRow = ({
	commit,
	isSelected,
	onSelect,
}: CommitRowProps): ReactElement => {
	const selectCommit = async (): Promise<void> => {
		await onSelect(commit);
	};

	return (
		<li data-name="CommitRow">
			<button
				aria-current={isSelected ? "true" : undefined}
				className={
					isSelected
						? "flex w-full gap-3 bg-white/78 px-3 py-3 text-left shadow-[inset_2px_0_0_var(--brand)] outline-none"
						: "flex w-full gap-3 px-3 py-3 text-left outline-none hover:bg-white/45 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset"
				}
				onClick={selectCommit}
				type="button"
			>
				<span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-white/70 text-editor-muted shadow-surface-1">
					<GitCommitIcon aria-hidden className="size-3.5" weight="regular" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-[12px] text-editor-ink">
						{commit.summary}
					</span>
					<span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-editor-faint">
						<span className="truncate">{commit.author.name}</span>
						<span className="shrink-0">
							{formatRelativeTime(commit.committedAt)}
						</span>
					</span>
				</span>
			</button>
		</li>
	);
};

interface CommitFormProps {
	readonly branch: string | null;
	readonly canCommit: boolean;
	readonly isPending: boolean;
	readonly onCommit: (summary: string, description: string) => Promise<boolean>;
}

const CommitForm = ({
	branch,
	canCommit,
	isPending,
	onCommit,
}: CommitFormProps): ReactElement => {
	const [summary, setSummary] = useState("");
	const [description, setDescription] = useState("");
	const handleSummaryChange = (event: ChangeEvent<HTMLInputElement>): void => {
		setSummary(event.target.value);
	};
	const handleDescriptionChange = (
		event: ChangeEvent<HTMLTextAreaElement>
	): void => {
		setDescription(event.target.value);
	};
	const submitCommit = async (
		event: FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();
		const didCommit = await onCommit(summary, description);
		if (didCommit) {
			setSummary("");
			setDescription("");
		}
	};

	return (
		<form
			className="shrink-0 border-editor-hairline border-t bg-white/36 p-3 backdrop-blur-xl"
			data-name="CommitForm"
			onSubmit={submitCommit}
		>
			<div className="flex items-center gap-2">
				<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-editor-ink text-white">
					<GitCommitIcon aria-hidden className="size-3.5" weight="bold" />
				</span>
				<label className="sr-only" htmlFor="commit-summary">
					Commit summary
				</label>
				<Input
					className="h-8 bg-white/70 text-[12px]"
					disabled={isPending}
					id="commit-summary"
					maxLength={120}
					onChange={handleSummaryChange}
					placeholder="Summary (required)"
					value={summary}
				/>
			</div>
			<label className="sr-only" htmlFor="commit-description">
				Commit description
			</label>
			<Textarea
				className="mt-2 min-h-[72px] bg-white/70 text-[12px]"
				disabled={isPending}
				id="commit-description"
				onChange={handleDescriptionChange}
				placeholder="Description"
				value={description}
			/>
			<Button
				className="mt-2 w-full"
				disabled={!(canCommit && summary.trim()) || isPending}
				size="sm"
				type="submit"
				variant="brand"
			>
				{isPending ? (
					<SpinnerGapIcon
						aria-hidden
						className="size-3.5 animate-spin"
						weight="bold"
					/>
				) : (
					<GitCommitIcon aria-hidden className="size-3.5" weight="bold" />
				)}
				Commit to {branch ?? "current branch"}
			</Button>
		</form>
	);
};

interface RepositorySidebarProps {
	readonly history: CommitPage | null;
	readonly onCommit: (summary: string, description: string) => Promise<boolean>;
	readonly onSelectCommit: (commit: CommitInfo) => Promise<void>;
	readonly onSelectFile: (file: FileChange) => Promise<void>;
	readonly onSetFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly onSetTab: (tab: RepositoryTab) => Promise<void>;
	readonly onToggleAllFiles: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly selectedCommitOid: string | null;
	readonly selectedFilePath: string | null;
	readonly snapshot: RepositorySnapshot | null;
	readonly tab: RepositoryTab;
}

export const RepositorySidebar = ({
	history,
	onCommit,
	onSelectCommit,
	onSelectFile,
	onSetFileStaged,
	onSetTab,
	onToggleAllFiles,
	pendingAction,
	selectedCommitOid,
	selectedFilePath,
	snapshot,
	tab,
}: RepositorySidebarProps): ReactElement => {
	const [filter, setFilter] = useState("");
	const files = snapshot?.files ?? [];
	const visibleFiles = files.filter((file) => matchesFileFilter(file, filter));
	const allStaged = areAllFilesStaged(files);
	const stagedCount = files.filter(isFileStaged).length;
	const setChangesTab = async (): Promise<void> => {
		await onSetTab("changes");
	};
	const setHistoryTab = async (): Promise<void> => {
		await onSetTab("history");
	};
	const handleFilterChange = (event: ChangeEvent<HTMLInputElement>): void => {
		setFilter(event.target.value);
	};
	const toggleAll = async (): Promise<void> => {
		await onToggleAllFiles();
	};

	return (
		<aside
			aria-label="Repository activity"
			className="flex h-full w-[346px] shrink-0 flex-col border-editor-hairline border-r bg-studio-glass-subtle backdrop-blur-2xl"
			data-name="RepositorySidebar"
		>
			<div
				className="grid h-11 shrink-0 grid-cols-2 border-editor-hairline border-b"
				data-name="RepositoryTabs"
				role="tablist"
			>
				<button
					aria-selected={tab === "changes"}
					className={
						tab === "changes"
							? "relative font-semibold text-[12px] text-editor-ink after:absolute after:inset-x-5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-editor-ink"
							: "text-[12px] text-editor-faint outline-none hover:text-editor-ink focus-visible:bg-white/45"
					}
					onClick={setChangesTab}
					role="tab"
					type="button"
				>
					Changes
					{files.length > 0 ? (
						<span className="ml-1.5 rounded-full bg-editor-sunken px-1.5 py-0.5 font-semibold text-[9px] text-editor-muted">
							{files.length}
						</span>
					) : null}
				</button>
				<button
					aria-selected={tab === "history"}
					className={
						tab === "history"
							? "relative font-semibold text-[12px] text-editor-ink after:absolute after:inset-x-5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-editor-ink"
							: "text-[12px] text-editor-faint outline-none hover:text-editor-ink focus-visible:bg-white/45"
					}
					onClick={setHistoryTab}
					role="tab"
					type="button"
				>
					History
				</button>
			</div>

			{tab === "changes" ? (
				<>
					<div className="shrink-0 p-2.5">
						<div className="relative">
							<FunnelSimpleIcon
								aria-hidden
								className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-editor-faint"
								weight="regular"
							/>
							<Input
								aria-label="Filter changed files"
								className="h-8 bg-white/55 pl-8 text-[11px]"
								onChange={handleFilterChange}
								placeholder="Filter changed files"
								value={filter}
							/>
						</div>
					</div>
					<div className="flex h-8 shrink-0 items-center gap-2 border-editor-hairline border-y px-2.5">
						<StageCheckbox
							checked={allStaged}
							disabled={pendingAction !== null || files.length === 0}
							label={allStaged ? "Unstage all files" : "Stage all files"}
							mixed={stagedCount > 0 && !allStaged}
							onChange={toggleAll}
						/>
						<span className="font-medium text-[11px] text-editor-muted">
							{files.length} changed {files.length === 1 ? "file" : "files"}
						</span>
						{stagedCount > 0 ? (
							<span className="ml-auto text-[10px] text-editor-faint">
								{stagedCount} staged
							</span>
						) : null}
					</div>
					<ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
						{visibleFiles.map((file) => (
							<FileChangeRow
								file={file}
								isPending={pendingAction === "stage"}
								isSelected={selectedFilePath === file.path}
								key={file.path}
								onSelect={onSelectFile}
								onSetStaged={onSetFileStaged}
							/>
						))}
						{files.length > 0 && visibleFiles.length === 0 ? (
							<li className="px-4 py-8 text-center text-[11px] text-editor-faint">
								No changed files match “{filter}”.
							</li>
						) : null}
					</ul>
					<CommitForm
						branch={snapshot?.head.branch ?? null}
						canCommit={stagedCount > 0}
						isPending={pendingAction === "commit"}
						onCommit={onCommit}
					/>
				</>
			) : (
				<ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
					{history?.commits.map((commit) => (
						<CommitRow
							commit={commit}
							isSelected={selectedCommitOid === commit.oid}
							key={commit.oid}
							onSelect={onSelectCommit}
						/>
					))}
					{history?.commits.length === 0 ? (
						<li className="px-4 py-10 text-center text-[11px] text-editor-faint">
							This repository has no commits yet.
						</li>
					) : null}
				</ul>
			)}
		</aside>
	);
};
