import type { FileChange, RepositorySnapshot } from "@1git/git";
import { Input } from "@1git/ui/components/input";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import type { ChangeEvent, ReactElement } from "react";
import { useState } from "react";
import { CommitForm } from "./commit-form.js";
import type { PendingWorkspaceAction } from "./use-git-workspace.js";
import {
	areAllFilesStaged,
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
						: "size-4 rounded-[5px] border border-editor-hairline-strong bg-studio-glass-strong shadow-xs"
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
					? "group flex items-center bg-studio-glass-strong shadow-[inset_2px_0_0_var(--brand)]"
					: "group flex items-center hover:bg-hover"
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
				<span className="min-w-0 flex-1 truncate text-xss">
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

interface RepositoryChangesProps {
	readonly onCommit: (summary: string, description: string) => Promise<boolean>;
	readonly onSelectFile: (file: FileChange) => Promise<void>;
	readonly onSetFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly onToggleAllFiles: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly selectedFilePath: string | null;
	readonly snapshot: RepositorySnapshot | null;
}

export const RepositoryChanges = ({
	onCommit,
	onSelectFile,
	onSetFileStaged,
	onToggleAllFiles,
	pendingAction,
	selectedFilePath,
	snapshot,
}: RepositoryChangesProps): ReactElement => {
	const [filter, setFilter] = useState("");
	const files = snapshot?.files ?? [];
	const visibleFiles = files.filter((file) => matchesFileFilter(file, filter));
	const allStaged = areAllFilesStaged(files);
	const stagedCount = files.filter(isFileStaged).length;
	const handleFilterChange = (event: ChangeEvent<HTMLInputElement>): void => {
		setFilter(event.target.value);
	};
	const toggleAll = async (): Promise<void> => {
		await onToggleAllFiles();
	};

	return (
		<div className="contents" data-name="RepositoryChanges">
			<div className="shrink-0 p-2.5">
				<div className="relative">
					<FunnelSimpleIcon
						aria-hidden
						className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-editor-faint"
						weight="regular"
					/>
					<Input
						aria-label="Filter changed files"
						className="h-8 bg-studio-glass pl-8 text-xss"
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
				<span className="font-medium text-editor-muted text-xss">
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
					<li className="px-4 py-8 text-center text-editor-faint text-xss">
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
		</div>
	);
};
