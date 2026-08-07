import type { FileChange } from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import type {
	ChangeEvent,
	CSSProperties,
	ReactElement,
	MouseEvent as ReactMouseEvent,
	RefCallback,
} from "react";
import { useCallback, useEffect, useState } from "react";
import {
	getFileChangeLabel,
	isFilePartiallyStaged,
	isFileStaged,
} from "@/feature/workspace/lib/workspace-model.js";
import {
	LiquidContextMenuRoot,
	LiquidContextMenuTrigger,
	LiquidMenuContent,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { useLiquidContextMenuPosition } from "@/fixture/liquid-menu/hooks/use-liquid-context-menu-position.js";
import { getLiquidMenuLayerZIndices } from "@/fixture/liquid-menu/lib/liquid-menu-stack.js";
import { OverflowingLabel } from "@/fixture/overflowing-label/components/overflowing-label.js";
import { RepositoryFileContextActions } from "@/fixture/repository-workspace/components/repository-file-context-actions.js";
import {
	REPOSITORY_FILE_CONTEXT_MENU_ANCHOR_GEOMETRY,
	REPOSITORY_FILE_CONTEXT_MENU_WIDTH,
	REPOSITORY_FILE_CONTEXT_MENU_WIDTH_CLASS_NAME,
} from "@/fixture/repository-workspace/constants/repository-workspace.js";
import {
	doesRepositoryFileContextMenuUseSelection,
	getRepositoryFileRowId,
	groupRepositoryFiles,
	shouldElevateRepositoryFileSelection,
	splitRepositoryFilePath,
} from "@/fixture/repository-workspace/lib/repository-navigation.js";

const ELEVATED_SELECTION_STYLE = {
	zIndex: getLiquidMenuLayerZIndices(0).selection,
} satisfies CSSProperties;

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
	readonly isBulkSelected: boolean;
	readonly isBulkSelectionEnd: boolean;
	readonly isBulkSelectionStart: boolean;
	readonly isDiscardDisabled: boolean;
	readonly isSelected: boolean;
	readonly isSelectionContextMenuPresent: boolean;
	readonly isStagingDisabled: boolean;
	readonly onClearSelection: () => void;
	readonly onDiscard: (files: readonly FileChange[]) => Promise<boolean>;
	readonly onSelect: (
		file: FileChange,
		mode?: "range" | "replace" | "toggle"
	) => void;
	readonly onSelectionContextMenuPresenceChange: (isPresent: boolean) => void;
	readonly onSetFilesStaged: (
		files: readonly FileChange[],
		shouldStage: boolean
	) => Promise<boolean>;
	readonly onSetStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly repositoryRoot: string;
	readonly selectedFilePaths: ReadonlySet<string>;
	readonly selectedFiles: readonly FileChange[];
	readonly selectedRowAriaKeyShortcuts?: string;
	readonly selectedRowRef?: RefCallback<HTMLElement>;
}

function RepositoryFileRow({
	file,
	isBulkSelectionEnd,
	isBulkSelectionStart,
	isBulkSelected,
	isDiscardDisabled,
	isSelectionContextMenuPresent,
	isSelected,
	isStagingDisabled,
	onClearSelection,
	onDiscard,
	onSelect,
	onSelectionContextMenuPresenceChange,
	onSetStaged,
	onSetFilesStaged,
	repositoryRoot,
	selectedFiles,
	selectedFilePaths,
	selectedRowAriaKeyShortcuts,
	selectedRowRef,
}: RepositoryFileRowProps): ReactElement {
	const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [isPresent, setIsPresent] = useState(false);
	const contextMenuPosition = useLiquidContextMenuPosition({
		anchorElement,
		menuWidth: REPOSITORY_FILE_CONTEXT_MENU_WIDTH,
	});
	const contextUsesSelection = doesRepositoryFileContextMenuUseSelection(
		file.path,
		selectedFilePaths
	);
	const getAnchor = useCallback(
		(): Element | null => anchorElement,
		[anchorElement]
	);
	const setRowElement = useCallback(
		(element: HTMLElement | null): void => {
			setAnchorElement(element);
			if (isSelected) {
				selectedRowRef?.(element);
			}
		},
		[isSelected, selectedRowRef]
	);
	const changeOpen = useCallback(
		(nextIsOpen: boolean): void => {
			setIsOpen(nextIsOpen);
			if (nextIsOpen && contextUsesSelection) {
				onSelectionContextMenuPresenceChange(true);
			}
			if (!nextIsOpen) {
				contextMenuPosition.resetPointer();
			}
		},
		[
			contextMenuPosition.resetPointer,
			contextUsesSelection,
			onSelectionContextMenuPresenceChange,
		]
	);
	const changePresence = useCallback(
		(nextIsPresent: boolean): void => {
			setIsPresent(nextIsPresent);
			if (!nextIsPresent && contextUsesSelection) {
				onSelectionContextMenuPresenceChange(false);
			}
		},
		[contextUsesSelection, onSelectionContextMenuPresenceChange]
	);
	const staged = isFileStaged(file);
	const path = splitRepositoryFilePath(file.path);
	const contextFiles = contextUsesSelection ? selectedFiles : [file];
	const shouldElevateSelection = shouldElevateRepositoryFileSelection(
		isSelectionContextMenuPresent,
		isBulkSelected
	);
	const selectFile = (event: ReactMouseEvent<HTMLButtonElement>): void => {
		let mode: "range" | "replace" | "toggle" = "replace";
		if (event.shiftKey) {
			mode = "range";
		} else if (event.metaKey || event.ctrlKey) {
			mode = "toggle";
		}
		onSelect(file, mode);
	};
	const setStaged = async (shouldStage: boolean): Promise<void> => {
		await onSetStaged(file, shouldStage);
	};
	const openContextMenu = (): void => {
		if (!contextUsesSelection && (!isSelected || selectedFilePaths.size > 0)) {
			onSelect(file);
		}
	};
	let selectionClassName = "hover:bg-editor-sunken";
	if (isBulkSelected) {
		selectionClassName = isSelected ? "bg-editor-sunken-2" : "bg-editor-sunken";
	} else if (isSelected) {
		selectionClassName = "bg-editor-sunken-2";
	}

	const row = (
		<li
			aria-keyshortcuts={isSelected ? selectedRowAriaKeyShortcuts : undefined}
			className={cn(
				"group relative flex min-h-7 items-center transition-colors",
				selectionClassName,
				!isBulkSelected && "rounded-md",
				isBulkSelectionStart && "rounded-t-md",
				isBulkSelectionEnd && "rounded-b-md",
				(isOpen || isPresent) && "rounded-md bg-white hover:bg-white",
				(isOpen || isPresent) && !shouldElevateSelection && "z-20"
			)}
			data-bulk-selected={isBulkSelected ? "true" : undefined}
			data-name="RepositoryFileRow"
			data-overflowing-label-trigger
			id={getRepositoryFileRowId(file.path)}
			ref={setRowElement}
			style={shouldElevateSelection ? ELEVATED_SELECTION_STYLE : undefined}
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
				<OverflowingLabel
					className="flex-1 text-[11px]"
					deferUntilVisible
					direction="end-to-start"
					title={file.path}
				>
					{path.directory ? (
						<span className="text-editor-faint">{path.directory}</span>
					) : null}
					<span className="font-medium text-editor-ink">{path.name}</span>
				</OverflowingLabel>
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

	return (
		<LiquidContextMenuRoot
			anchor={getAnchor}
			anchorGeometry={REPOSITORY_FILE_CONTEXT_MENU_ANCHOR_GEOMETRY}
			onOpenChange={changeOpen}
			onPresenceChange={changePresence}
			open={isOpen}
		>
			<LiquidContextMenuTrigger
				onContextMenu={(event) => {
					contextMenuPosition.onContextMenu(event);
					openContextMenu();
				}}
				render={row}
			/>
			{isOpen ? (
				<LiquidMenuContent
					align="start"
					alignOffset={contextMenuPosition.alignOffset + 20}
					aria-label={`Actions for ${file.path}`}
					className={`${REPOSITORY_FILE_CONTEXT_MENU_WIDTH_CLASS_NAME} p-1.5`}
					side="bottom"
					sideOffset={0}
				>
					<RepositoryFileContextActions
						files={contextFiles}
						isPending={isDiscardDisabled || isStagingDisabled}
						onClearSelection={onClearSelection}
						onDiscard={onDiscard}
						onDismiss={() => changeOpen(false)}
						onSetStaged={onSetFilesStaged}
						repositoryRoot={repositoryRoot}
					/>
				</LiquidMenuContent>
			) : null}
		</LiquidContextMenuRoot>
	);
}

interface RepositoryFileListProps {
	readonly files: readonly FileChange[];
	readonly isDiscardDisabled: boolean;
	readonly isStagingDisabled: boolean;
	readonly onClearSelection: () => void;
	readonly onDiscard: (files: readonly FileChange[]) => Promise<boolean>;
	readonly onSelect: (
		file: FileChange,
		mode?: "range" | "replace" | "toggle"
	) => void;
	readonly onSetFilesStaged: (
		files: readonly FileChange[],
		shouldStage: boolean
	) => Promise<boolean>;
	readonly onSetStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly query: string;
	readonly repositoryRoot: string;
	readonly selectedFilePath: string | null;
	readonly selectedFilePaths: ReadonlySet<string>;
	readonly selectedFiles: readonly FileChange[];
	readonly selectedRowAriaKeyShortcuts?: string;
	readonly selectedRowRef?: RefCallback<HTMLElement>;
}

export function RepositoryFileList({
	files,
	isDiscardDisabled,
	isStagingDisabled,
	onClearSelection,
	onDiscard,
	onSelect,
	onSetStaged,
	onSetFilesStaged,
	query,
	repositoryRoot,
	selectedFilePath,
	selectedFilePaths,
	selectedFiles,
	selectedRowAriaKeyShortcuts,
	selectedRowRef,
}: RepositoryFileListProps): ReactElement {
	const [isSelectionContextMenuPresent, setSelectionContextMenuPresent] =
		useState(false);
	const groups = groupRepositoryFiles(files);
	const orderedFiles = [...groups.staged, ...groups.unstaged];
	useEffect(() => {
		if (selectedFiles.length < 2) {
			setSelectionContextMenuPresent(false);
		}
	}, [selectedFiles.length]);
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
			className="px-1 pb-1 outline-none"
			data-name="RepositoryFileList"
			tabIndex={-1}
		>
			{orderedFiles.map((file, index) => {
				const isBulkSelected = selectedFilePaths.has(file.path);
				const previousFile = orderedFiles[index - 1];
				const nextFile = orderedFiles[index + 1];
				return (
					<RepositoryFileRow
						file={file}
						isBulkSelected={isBulkSelected}
						isBulkSelectionEnd={
							isBulkSelected &&
							!(nextFile && selectedFilePaths.has(nextFile.path))
						}
						isBulkSelectionStart={
							isBulkSelected &&
							!(previousFile && selectedFilePaths.has(previousFile.path))
						}
						isDiscardDisabled={isDiscardDisabled}
						isSelected={selectedFilePath === file.path}
						isSelectionContextMenuPresent={isSelectionContextMenuPresent}
						isStagingDisabled={isStagingDisabled}
						key={file.path}
						onClearSelection={onClearSelection}
						onDiscard={onDiscard}
						onSelect={onSelect}
						onSelectionContextMenuPresenceChange={
							setSelectionContextMenuPresent
						}
						onSetFilesStaged={onSetFilesStaged}
						onSetStaged={onSetStaged}
						repositoryRoot={repositoryRoot}
						selectedFilePaths={selectedFilePaths}
						selectedFiles={selectedFiles}
						selectedRowAriaKeyShortcuts={selectedRowAriaKeyShortcuts}
						selectedRowRef={selectedRowRef}
					/>
				);
			})}
		</ul>
	);
}
