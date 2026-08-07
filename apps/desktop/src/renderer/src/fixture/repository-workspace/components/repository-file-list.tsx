import type { FileChange } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import { cn } from "@1git/ui/lib/utils";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { ChangeEvent, ReactElement, RefCallback } from "react";
import { useCallback, useState } from "react";
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
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";
import { useLiquidContextMenuPosition } from "@/fixture/liquid-menu/hooks/use-liquid-context-menu-position.js";
import { OverflowingLabel } from "@/fixture/overflowing-label/components/overflowing-label.js";
import {
	REPOSITORY_FILE_CONTEXT_MENU_ANCHOR_GEOMETRY,
	REPOSITORY_FILE_CONTEXT_MENU_WIDTH,
	REPOSITORY_FILE_CONTEXT_MENU_WIDTH_CLASS_NAME,
} from "@/fixture/repository-workspace/constants/repository-workspace.js";
import {
	getRepositoryFileRowId,
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
	readonly isDiscardDisabled: boolean;
	readonly isSelected: boolean;
	readonly isStagingDisabled: boolean;
	readonly onDiscard: (file: FileChange) => Promise<boolean>;
	readonly onSelect: (file: FileChange) => void;
	readonly onSetStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly selectedRowAriaKeyShortcuts?: string;
	readonly selectedRowRef?: RefCallback<HTMLElement>;
}

interface RepositoryFileContextActionsProps {
	readonly file: FileChange;
	readonly isDisabled: boolean;
	readonly onDiscard: (file: FileChange) => Promise<boolean>;
	readonly onDismiss: () => void;
}

function RepositoryFileContextActions({
	file,
	isDisabled,
	onDiscard,
	onDismiss,
}: RepositoryFileContextActionsProps): ReactElement {
	const [actionError, setActionError] = useState<string | null>(null);
	const [isDiscarding, setIsDiscarding] = useState(false);
	const [view, setView] = useState<"actions" | "confirm-discard">("actions");
	const path = splitRepositoryFilePath(file.path);
	const discardFile = async (): Promise<void> => {
		setActionError(null);
		setIsDiscarding(true);
		try {
			if (await onDiscard(file)) {
				onDismiss();
				return;
			}
			setActionError("The changes could not be discarded.");
		} finally {
			setIsDiscarding(false);
		}
	};

	return (
		<LiquidMenuAutoSize viewKey={view}>
			{view === "actions" ? (
				<DropdownMenuItem
					className="gap-2.5 py-2"
					closeOnClick={false}
					disabled={isDisabled || file.recordType === "unmerged"}
					onClick={() => setView("confirm-discard")}
					title={
						file.recordType === "unmerged"
							? "Resolve conflicts before discarding changes."
							: undefined
					}
					variant="destructive"
				>
					<TrashIcon aria-hidden weight="duotone" />
					Discard changes…
				</DropdownMenuItem>
			) : (
				<>
					<DropdownMenuItem
						className="gap-2.5 py-2"
						closeOnClick={false}
						disabled={isDiscarding}
						onClick={() => setView("actions")}
					>
						<ArrowLeftIcon aria-hidden weight="bold" />
						Discard changes
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<div className="space-y-3 p-2">
						<p className="text-[10px] text-editor-muted leading-4">
							Discard every staged and unstaged change in{" "}
							<span className="font-medium text-editor-ink">{path.name}</span>?
							You can undo for 10 seconds.
						</p>
						{actionError ? (
							<p
								aria-live="polite"
								className="text-[10px] text-destructive leading-4"
								role="status"
							>
								{actionError}
							</p>
						) : null}
						<div className="flex justify-end gap-1.5">
							<Button
								disabled={isDiscarding}
								onClick={onDismiss}
								size="sm"
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>
							<Button
								disabled={isDiscarding}
								onClick={discardFile}
								size="sm"
								type="button"
								variant="destructive"
							>
								{isDiscarding ? (
									<SpinnerGapIcon
										aria-hidden
										className="animate-spin"
										weight="bold"
									/>
								) : null}
								Discard
							</Button>
						</div>
					</div>
				</>
			)}
		</LiquidMenuAutoSize>
	);
}

function RepositoryFileRow({
	file,
	isDiscardDisabled,
	isSelected,
	isStagingDisabled,
	onDiscard,
	onSelect,
	onSetStaged,
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
			if (!nextIsOpen) {
				contextMenuPosition.resetPointer();
			}
		},
		[contextMenuPosition.resetPointer]
	);
	const staged = isFileStaged(file);
	const path = splitRepositoryFilePath(file.path);
	const selectFile = (): void => onSelect(file);
	const setStaged = async (shouldStage: boolean): Promise<void> => {
		await onSetStaged(file, shouldStage);
	};
	const openContextMenu = (): void => {
		if (!isSelected) {
			onSelect(file);
		}
	};

	const row = (
		<li
			aria-keyshortcuts={isSelected ? selectedRowAriaKeyShortcuts : undefined}
			className={cn(
				"group relative flex min-h-7 items-center rounded-md transition-colors",
				isSelected ? "bg-editor-sunken-2" : "hover:bg-editor-sunken",
				(isOpen || isPresent) && "z-20 bg-white hover:bg-white"
			)}
			data-name="RepositoryFileRow"
			data-overflowing-label-trigger
			id={getRepositoryFileRowId(file.path)}
			ref={setRowElement}
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
					title={file.path}
				>
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
			onPresenceChange={setIsPresent}
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
						file={file}
						isDisabled={isDiscardDisabled}
						onDiscard={onDiscard}
						onDismiss={() => changeOpen(false)}
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
	readonly onDiscard: (file: FileChange) => Promise<boolean>;
	readonly onSelect: (file: FileChange) => void;
	readonly onSetStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly query: string;
	readonly selectedFilePath: string | null;
	readonly selectedRowAriaKeyShortcuts?: string;
	readonly selectedRowRef?: RefCallback<HTMLElement>;
}

export function RepositoryFileList({
	files,
	isDiscardDisabled,
	isStagingDisabled,
	onDiscard,
	onSelect,
	onSetStaged,
	query,
	selectedFilePath,
	selectedRowAriaKeyShortcuts,
	selectedRowRef,
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
					isDiscardDisabled={isDiscardDisabled}
					isSelected={selectedFilePath === file.path}
					isStagingDisabled={isStagingDisabled}
					key={file.path}
					onDiscard={onDiscard}
					onSelect={onSelect}
					onSetStaged={onSetStaged}
					selectedRowAriaKeyShortcuts={selectedRowAriaKeyShortcuts}
					selectedRowRef={selectedRowRef}
				/>
			))}
		</ul>
	);
}
