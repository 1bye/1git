import type { FileChange } from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import type { ChangeEvent, ReactElement } from "react";
import {
	getFileChangeLabel,
	isFilePartiallyStaged,
	isFileStaged,
} from "@/feature/workspace/lib/workspace-model.js";
import {
	groupRepositoryFiles,
	splitRepositoryFilePath,
} from "@/fixture/repository-workspace/lib/repository-navigation.js";

interface RepositoryStageCheckboxProps {
	readonly checked: boolean;
	readonly disabled: boolean;
	readonly label: string;
	readonly mixed?: boolean;
	readonly onChange: (checked: boolean) => Promise<void>;
}

function RepositoryStageCheckbox({
	checked,
	disabled,
	label,
	mixed = false,
	onChange,
}: RepositoryStageCheckboxProps): ReactElement {
	const changeChecked = async (
		event: ChangeEvent<HTMLInputElement>
	): Promise<void> => {
		await onChange(event.target.checked);
	};
	const setIndeterminate = (input: HTMLInputElement | null): void => {
		if (input) {
			input.indeterminate = mixed;
		}
	};
	let checkboxIcon: ReactElement | null = null;
	if (mixed) {
		checkboxIcon = <MinusIcon className="size-2.5" weight="bold" />;
	} else if (checked) {
		checkboxIcon = <CheckIcon className="size-2.5" weight="bold" />;
	}

	return (
		<label
			className={cn(
				"flex size-5 shrink-0 items-center justify-center rounded-md outline-none focus-within:ring-2 focus-within:ring-editor-muted/20",
				disabled && "opacity-45"
			)}
		>
			<input
				aria-label={label}
				checked={checked}
				className="sr-only"
				disabled={disabled}
				onChange={changeChecked}
				ref={setIndeterminate}
				type="checkbox"
			/>
			<span
				aria-hidden
				className={cn(
					"flex size-3.5 items-center justify-center rounded-[5px] transition-colors",
					checked || mixed
						? "bg-editor-ink text-white"
						: "bg-editor-sunken-2 shadow-[inset_0_0_0_1px_var(--editor-hairline-strong)]"
				)}
			>
				{checkboxIcon}
			</span>
		</label>
	);
}

interface RepositoryFileRowProps {
	readonly file: FileChange;
	readonly isSelected: boolean;
	readonly isStagingDisabled: boolean;
	readonly onSelect: (file: FileChange) => void;
	readonly onSetStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
}

function RepositoryFileRow({
	file,
	isSelected,
	isStagingDisabled,
	onSelect,
	onSetStaged,
}: RepositoryFileRowProps): ReactElement {
	const staged = isFileStaged(file);
	const path = splitRepositoryFilePath(file.path);
	const selectFile = (): void => onSelect(file);
	const setStaged = async (shouldStage: boolean): Promise<void> => {
		await onSetStaged(file, shouldStage);
	};

	return (
		<li
			className={cn(
				"group flex min-h-9 items-center rounded-lg transition-colors",
				isSelected ? "bg-editor-sunken-2" : "hover:bg-editor-sunken"
			)}
			data-name="RepositoryFileRow"
		>
			<div className="pl-2">
				<RepositoryStageCheckbox
					checked={staged}
					disabled={isStagingDisabled}
					label={staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
					mixed={isFilePartiallyStaged(file)}
					onChange={setStaged}
				/>
			</div>
			<button
				aria-current={isSelected ? "true" : undefined}
				className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-editor-muted/20 focus-visible:ring-inset"
				onClick={selectFile}
				type="button"
			>
				<FileIcon
					aria-hidden
					className="size-3.5 shrink-0 text-editor-faint"
					weight="duotone"
				/>
				<span className="min-w-0 flex-1 truncate text-xss">
					<span className="font-medium text-editor-ink">{path.name}</span>
					{path.directory ? (
						<span className="ml-1 text-editor-faint">{path.directory}</span>
					) : null}
				</span>
				<span
					aria-hidden
					className="w-4 shrink-0 text-center font-mono font-semibold text-[10px] text-editor-muted"
				>
					{getFileChangeLabel(file)}
				</span>
				<span className="sr-only">
					Index status {file.indexStatus}; working tree status{" "}
					{file.worktreeStatus}
				</span>
			</button>
		</li>
	);
}

interface RepositoryFileGroupProps
	extends Omit<RepositoryFileRowProps, "file" | "isSelected"> {
	readonly files: readonly FileChange[];
	readonly label: string;
	readonly selectedFilePath: string | null;
}

function RepositoryFileGroup({
	files,
	isStagingDisabled,
	label,
	onSelect,
	onSetStaged,
	selectedFilePath,
}: RepositoryFileGroupProps): ReactElement | null {
	if (files.length === 0) {
		return null;
	}

	return (
		<li>
			<div className="flex h-7 items-center px-2 font-medium text-[9px] text-editor-faint uppercase tracking-[0.08em]">
				<span>{label}</span>
				<span className="ml-auto tabular-nums">{files.length}</span>
			</div>
			<ul aria-label={`${label} files`} className="space-y-0.5">
				{files.map((file) => (
					<RepositoryFileRow
						file={file}
						isSelected={selectedFilePath === file.path}
						isStagingDisabled={isStagingDisabled}
						key={file.path}
						onSelect={onSelect}
						onSetStaged={onSetStaged}
					/>
				))}
			</ul>
		</li>
	);
}

interface RepositoryFileListProps {
	readonly files: readonly FileChange[];
	readonly isStagingDisabled: boolean;
	readonly onSelect: (file: FileChange) => void;
	readonly onSetStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly query: string;
	readonly selectedFilePath: string | null;
}

export function RepositoryFileList({
	files,
	isStagingDisabled,
	onSelect,
	onSetStaged,
	query,
	selectedFilePath,
}: RepositoryFileListProps): ReactElement {
	const groups = groupRepositoryFiles(files);
	if (files.length === 0) {
		return (
			<p className="px-4 py-8 text-center text-editor-faint text-xss">
				{query ? `No changed files match “${query}”.` : "No changed files."}
			</p>
		);
	}

	return (
		<ul
			aria-label="Changed files"
			className="space-y-1 px-1 pb-1"
			data-name="RepositoryFileList"
		>
			<RepositoryFileGroup
				files={groups.staged}
				isStagingDisabled={isStagingDisabled}
				label="Staged"
				onSelect={onSelect}
				onSetStaged={onSetStaged}
				selectedFilePath={selectedFilePath}
			/>
			<RepositoryFileGroup
				files={groups.unstaged}
				isStagingDisabled={isStagingDisabled}
				label="Changes"
				onSelect={onSelect}
				onSetStaged={onSetStaged}
				selectedFilePath={selectedFilePath}
			/>
		</ul>
	);
}
