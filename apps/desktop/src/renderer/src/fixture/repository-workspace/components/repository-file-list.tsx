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
import { RepositoryFileStatus } from "@/fixture/repository-workspace/components/repository-file-status.js";
import {
	doesRepositoryFileContextMenuUseSelection,
	getRepositoryFileRowId,
	getRepositoryFileSelectionRunPaths,
	orderRepositoryFilesByPath,
	shouldElevateRepositoryFileSelection,
	splitRepositoryFilePath,
} from "@/fixture/repository-workspace/lib/repository-navigation.js";

const REPOSITORY_FILE_SELECTION_MENU_ANCHOR_SELECTOR =
	"[data-repository-file-selection-menu-anchor]";
const SELECTION_MENU_ANCHOR_INLINE_INSET = 12;
const REPOSITORY_FILE_CONTEXT_MENU_ANCHOR_GEOMETRY = {
	insetBlock: 0,
	insetInline: 0,
	radius: 6,
} as const;
const REPOSITORY_FILE_SELECTION_CONTEXT_MENU_ANCHOR_GEOMETRY = {
	insetBlock: 0,
	insetInline: 0,
	radius: 1,
} as const;
const REPOSITORY_FILE_CONTEXT_MENU_WIDTH = 260;
const REPOSITORY_FILE_CONTEXT_MENU_WIDTH_CLASS_NAME = "w-[260px] min-w-[260px]";

const ELEVATED_SELECTION_STYLE = {
	zIndex: getLiquidMenuLayerZIndices(0).selection,
} satisfies CSSProperties;

const getVisibleSelectionEdgeRow = (
	anchorElement: HTMLElement,
	selectionRunPaths: readonly string[]
): HTMLElement => {
	const viewport = anchorElement.closest("[data-repository-file-viewport]");
	const viewportBounds = viewport?.getBoundingClientRect();
	let edgeRow = anchorElement;
	for (const path of selectionRunPaths) {
		const row = document.getElementById(getRepositoryFileRowId(path));
		if (!row) {
			continue;
		}
		const rowBounds = row.getBoundingClientRect();
		const isVisible =
			!viewportBounds ||
			(rowBounds.bottom > viewportBounds.top &&
				rowBounds.top < viewportBounds.bottom);
		if (isVisible) {
			edgeRow = row;
		}
	}
	return edgeRow;
};

const positionSelectionMenuAnchor = (
	row: HTMLElement,
	pointerClientX: number
): HTMLElement | null => {
	const anchor = row.querySelector<HTMLElement>(
		REPOSITORY_FILE_SELECTION_MENU_ANCHOR_SELECTOR
	);
	if (!anchor) {
		return null;
	}
	const rowBounds = row.getBoundingClientRect();
	const maximumOffset = Math.max(
		SELECTION_MENU_ANCHOR_INLINE_INSET,
		rowBounds.width - SELECTION_MENU_ANCHOR_INLINE_INSET
	);
	const offset = Math.min(
		Math.max(
			pointerClientX - rowBounds.left,
			SELECTION_MENU_ANCHOR_INLINE_INSET
		),
		maximumOffset
	);
	anchor.style.left = `${offset}px`;
	return anchor;
};

interface RepositoryFileContextMenuAnchors {
	readonly position: HTMLElement | null;
	readonly surface: HTMLElement | null;
}

interface GetRepositoryFileContextMenuAnchorsOptions {
	readonly anchorElement: HTMLElement | null;
	readonly orderedFilePaths: readonly string[];
	readonly pointerClientX: number;
	readonly selectedFilePaths: ReadonlySet<string>;
	readonly targetPath: string;
	readonly usesSelection: boolean;
}

const getRepositoryFileContextMenuAnchors = ({
	anchorElement,
	orderedFilePaths,
	pointerClientX,
	selectedFilePaths,
	targetPath,
	usesSelection,
}: GetRepositoryFileContextMenuAnchorsOptions): RepositoryFileContextMenuAnchors => {
	if (!(usesSelection && anchorElement)) {
		return { position: anchorElement, surface: anchorElement };
	}
	const selectionRunPaths = getRepositoryFileSelectionRunPaths(
		orderedFilePaths,
		selectedFilePaths,
		targetPath
	);
	const edgeRow = getVisibleSelectionEdgeRow(anchorElement, selectionRunPaths);
	return {
		position: edgeRow,
		surface: positionSelectionMenuAnchor(edgeRow, pointerClientX) ?? edgeRow,
	};
};

const getRepositoryFileSelectionMode = (
	event: ReactMouseEvent<HTMLElement>
): "range" | "replace" | "toggle" => {
	if (event.shiftKey) {
		return "range";
	}
	if (event.metaKey || event.ctrlKey) {
		return "toggle";
	}
	return "replace";
};

const getRepositoryFileContextMenuAnchorGeometry = (
	usesSelection: boolean
):
	| typeof REPOSITORY_FILE_CONTEXT_MENU_ANCHOR_GEOMETRY
	| typeof REPOSITORY_FILE_SELECTION_CONTEXT_MENU_ANCHOR_GEOMETRY =>
	usesSelection
		? REPOSITORY_FILE_SELECTION_CONTEXT_MENU_ANCHOR_GEOMETRY
		: REPOSITORY_FILE_CONTEXT_MENU_ANCHOR_GEOMETRY;

interface SelectRepositoryFileForContextMenuOptions {
	readonly file: FileChange;
	readonly isSelected: boolean;
	readonly onSelect: (file: FileChange) => void;
	readonly selectedFileCount: number;
	readonly usesSelection: boolean;
}

const selectRepositoryFileForContextMenu = ({
	file,
	isSelected,
	onSelect,
	selectedFileCount,
	usesSelection,
}: SelectRepositoryFileForContextMenuOptions): void => {
	if (!usesSelection && (!isSelected || selectedFileCount > 0)) {
		onSelect(file);
	}
};

const getRepositoryFileSelectionClassName = (
	isBulkSelected: boolean,
	isSelected: boolean
): string => {
	if (isBulkSelected) {
		return "bg-black/[0.045]";
	}
	return isSelected ? "bg-brand-softer" : "hover:bg-hover";
};

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
		<label className="group/checkbox relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none focus-within:ring-2 focus-within:ring-editor-muted/20">
			<input
				aria-label={label}
				checked={checked}
				className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
				disabled={disabled}
				onChange={changeChecked}
				ref={setIndeterminate}
				type="checkbox"
			/>
			<span
				aria-hidden
				className={cn(
					"pointer-events-none flex size-3.5 items-center justify-center rounded-[4px] transition-colors",
					checked || mixed
						? "bg-brand text-white"
						: "bg-white/45 group-hover/checkbox:bg-white/70"
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
	readonly orderedFilePaths: readonly string[];
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
	orderedFilePaths,
	repositoryRoot,
	selectedFiles,
	selectedFilePaths,
	selectedRowAriaKeyShortcuts,
	selectedRowRef,
}: RepositoryFileRowProps): ReactElement {
	const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
	const [positionAnchorElement, setPositionAnchorElement] =
		useState<HTMLElement | null>(null);
	const [surfaceAnchorElement, setSurfaceAnchorElement] =
		useState<HTMLElement | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [isPresent, setIsPresent] = useState(false);
	const contextMenuPosition = useLiquidContextMenuPosition({
		anchorElement: positionAnchorElement ?? anchorElement,
		menuWidth: REPOSITORY_FILE_CONTEXT_MENU_WIDTH,
	});
	const contextUsesSelection = doesRepositoryFileContextMenuUseSelection(
		file.path,
		selectedFilePaths
	);
	const getAnchor = useCallback(
		(): Element | null => surfaceAnchorElement ?? anchorElement,
		[anchorElement, surfaceAnchorElement]
	);
	const getPositionAnchor = useCallback(
		(): Element | null => positionAnchorElement ?? anchorElement,
		[anchorElement, positionAnchorElement]
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
		onSelect(file, getRepositoryFileSelectionMode(event));
	};
	const setStaged = async (shouldStage: boolean): Promise<void> => {
		await onSetStaged(file, shouldStage);
	};
	const openContextMenu = (event: ReactMouseEvent<HTMLElement>): void => {
		const anchors = getRepositoryFileContextMenuAnchors({
			anchorElement,
			orderedFilePaths,
			pointerClientX: event.clientX,
			selectedFilePaths,
			targetPath: file.path,
			usesSelection: contextUsesSelection,
		});
		setPositionAnchorElement(anchors.position);
		setSurfaceAnchorElement(anchors.surface);
		selectRepositoryFileForContextMenu({
			file,
			isSelected,
			onSelect,
			selectedFileCount: selectedFilePaths.size,
			usesSelection: contextUsesSelection,
		});
	};
	const isSingleContextMenuActive =
		(isOpen || isPresent) && !contextUsesSelection;
	const selectionClassName = getRepositoryFileSelectionClassName(
		isBulkSelected,
		isSelected
	);

	const row = (
		<li
			aria-keyshortcuts={isSelected ? selectedRowAriaKeyShortcuts : undefined}
			className={cn(
				"group relative flex min-h-7 items-center rounded-md transition-colors",
				selectionClassName,
				isBulkSelectionStart && "rounded-t-md",
				isBulkSelectionEnd && "rounded-b-md",
				isSingleContextMenuActive && "rounded-md",
				isSingleContextMenuActive && !shouldElevateSelection && "z-20"
			)}
			data-bulk-selected={isBulkSelected ? "true" : undefined}
			data-name="RepositoryFileRow"
			data-overflowing-label-trigger
			id={getRepositoryFileRowId(file.path)}
			ref={setRowElement}
			style={shouldElevateSelection ? ELEVATED_SELECTION_STYLE : undefined}
		>
			<span
				aria-hidden
				className="pointer-events-none absolute bottom-0 left-1/2 size-px"
				data-repository-file-selection-menu-anchor
			/>
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
				className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset"
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
						<span className="text-editor-muted/75">{path.directory}</span>
					) : null}
					<span className="font-medium text-editor-ink">{path.name}</span>
				</OverflowingLabel>
				<RepositoryFileStatus file={file} />
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
			anchorGeometry={getRepositoryFileContextMenuAnchorGeometry(
				contextUsesSelection
			)}
			onOpenChange={changeOpen}
			onPresenceChange={changePresence}
			open={isOpen}
		>
			<LiquidContextMenuTrigger
				data-liquid-connected-fill={contextUsesSelection ? "none" : undefined}
				onContextMenu={(event) => {
					contextMenuPosition.onContextMenu(event);
					openContextMenu(event);
				}}
				render={row}
			/>
			{isOpen ? (
				<LiquidMenuContent
					align="start"
					alignOffset={contextMenuPosition.alignOffset + 20}
					anchor={getPositionAnchor}
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
	const orderedFiles = orderRepositoryFilesByPath(files);
	const orderedFilePaths = orderedFiles.map((file) => file.path);
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
			className="px-1 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset"
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
						orderedFilePaths={orderedFilePaths}
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
