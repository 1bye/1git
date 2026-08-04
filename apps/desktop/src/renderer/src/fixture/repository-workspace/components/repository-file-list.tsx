import type { FileChange } from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
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
				"flex size-4 shrink-0 items-center justify-center rounded-md outline-none focus-within:ring-2 focus-within:ring-editor-muted/20",
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
					"flex size-3 items-center justify-center rounded-[4px] transition-colors",
					checked || mixed ? "bg-editor-ink text-white" : "bg-editor-sunken-2"
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
				"group flex min-h-7 items-center rounded-md transition-colors",
				isSelected ? "bg-editor-sunken-2" : "hover:bg-editor-sunken"
			)}
			data-name="RepositoryFileRow"
		>
			<div className="pl-1.5">
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
				className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-editor-muted/20 focus-visible:ring-inset"
				onClick={selectFile}
				type="button"
			>
				<span className="min-w-0 flex-1 truncate text-[11px]">
					<span className="font-medium text-editor-ink">{path.name}</span>
					{path.directory ? (
						<span
							className={cn(
								"ml-1 text-editor-faint transition-opacity",
								isSelected
									? "opacity-100"
									: "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
							)}
						>
							{path.directory}
						</span>
					) : null}
				</span>
				<span
					aria-hidden
					className="w-3.5 shrink-0 text-center font-mono font-semibold text-[9px] text-editor-muted"
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
	const orderedFiles = [...groups.staged, ...groups.unstaged];
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
			className="px-1 pb-1"
			data-name="RepositoryFileList"
		>
			{orderedFiles.map((file) => (
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
	);
}
