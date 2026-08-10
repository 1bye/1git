import type { FileChange } from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import {
	DragDropProvider,
	type DragEndEvent,
	useDraggable,
	useDroppable,
} from "@dnd-kit/react";
import type {
	CSSProperties,
	ReactElement,
	MouseEvent as ReactMouseEvent,
	ReactNode,
	RefCallback,
} from "react";
import { useCallback, useEffect, useState } from "react";
import { isFileStaged } from "@/feature/workspace/lib/workspace-model.js";
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
	groupRepositoryFilesByStaging,
	shouldElevateRepositoryFileSelection,
	shouldStageRepositoryFileDrop,
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
const REPOSITORY_FILE_DRAG_TYPE = "repository-file";
const REPOSITORY_FILE_DRAG_ACTIVATION_DISTANCE = 5;
const REPOSITORY_FILE_DRAG_SENSORS = [
	PointerSensor.configure({
		activationConstraints: [
			new PointerActivationConstraints.Distance({
				value: REPOSITORY_FILE_DRAG_ACTIVATION_DISTANCE,
			}),
		],
	}),
];

type RepositoryFileStageGroup = "staged" | "unstaged";

const repositoryFileStageGroupId = (group: RepositoryFileStageGroup): string =>
	`repository-file-stage-group:${group}`;

const getRepositoryFileStageGroupFromId = (
	id: string
): RepositoryFileStageGroup | null => {
	if (id === repositoryFileStageGroupId("staged")) {
		return "staged";
	}
	if (id === repositoryFileStageGroupId("unstaged")) {
		return "unstaged";
	}
	return null;
};

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

interface RepositoryFileStageGroupProps {
	readonly children: ReactNode;
	readonly count: number;
	readonly disabled: boolean;
	readonly group: RepositoryFileStageGroup;
}

function RepositoryFileStageGroup({
	children,
	count,
	disabled,
	group,
}: RepositoryFileStageGroupProps): ReactElement {
	const { isDropTarget, ref } = useDroppable({
		accept: REPOSITORY_FILE_DRAG_TYPE,
		disabled,
		id: repositoryFileStageGroupId(group),
		type: "repository-file-stage-group",
	});
	const label = group === "staged" ? "Staged" : "Unstaged";

	return (
		<section
			aria-label={`${label} files`}
			className={cn(
				"min-h-10 rounded-lg px-1 pb-1 transition-colors",
				isDropTarget && "bg-brand-softer"
			)}
			data-file-stage-group={group}
			data-name="RepositoryFileStageGroup"
			ref={ref}
		>
			<header className="sticky top-0 z-10 flex h-6 items-center bg-editor-sunken/90 px-1.5 font-medium text-[10px] text-editor-muted backdrop-blur-md">
				<span>{label}</span>
				<span className="ml-auto tabular-nums">{count}</span>
			</header>
			<ul
				aria-label={`${label} changed files`}
				className="outline-none"
				data-name="RepositoryFileList"
				tabIndex={-1}
			>
				{children}
			</ul>
		</section>
	);
}

interface RepositoryFileStageButtonProps {
	readonly disabled: boolean;
	readonly file: FileChange;
	readonly onSetStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
}

function RepositoryFileStageButton({
	disabled,
	file,
	onSetStaged,
}: RepositoryFileStageButtonProps): ReactElement {
	const staged = isFileStaged(file);
	const toggleStaged = async (): Promise<void> => {
		await onSetStaged(file, !staged);
	};

	return (
		<button
			aria-label={staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
			className="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-md outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20 disabled:cursor-default disabled:opacity-50"
			disabled={disabled}
			onClick={toggleStaged}
			title={staged ? "Unstage file" : "Stage file"}
			type="button"
		>
			<RepositoryFileStatus file={file} />
		</button>
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
	onSetFilesStaged,
	onSetStaged,
	orderedFilePaths,
	repositoryRoot,
	selectedFiles,
	selectedFilePaths,
	selectedRowAriaKeyShortcuts,
	selectedRowRef,
}: RepositoryFileRowProps): ReactElement {
	const {
		handleRef,
		isDragging,
		ref: draggableRef,
	} = useDraggable({
		disabled: isStagingDisabled,
		id: file.path,
		type: REPOSITORY_FILE_DRAG_TYPE,
	});
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
			draggableRef(element);
			setAnchorElement(element);
			if (isSelected) {
				selectedRowRef?.(element);
			}
		},
		[draggableRef, isSelected, selectedRowRef]
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
	const path = splitRepositoryFilePath(file.path);
	const contextFiles = contextUsesSelection ? selectedFiles : [file];
	const shouldElevateSelection = shouldElevateRepositoryFileSelection(
		isSelectionContextMenuPresent,
		isBulkSelected
	);
	const selectFile = (event: ReactMouseEvent<HTMLButtonElement>): void => {
		onSelect(file, getRepositoryFileSelectionMode(event));
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
				"group relative flex min-h-7 items-center rounded-md transition-[background-color,opacity]",
				selectionClassName,
				isBulkSelectionStart && "rounded-t-md",
				isBulkSelectionEnd && "rounded-b-md",
				isSingleContextMenuActive && "rounded-md",
				isSingleContextMenuActive && !shouldElevateSelection && "z-20",
				isDragging && "opacity-45"
			)}
			data-active={isSelected ? "true" : undefined}
			data-bulk-selected={isBulkSelected ? "true" : undefined}
			data-dragging={isDragging ? "true" : undefined}
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
			<RepositoryFileStageButton
				disabled={isStagingDisabled}
				file={file}
				onSetStaged={onSetStaged}
			/>
			<button
				aria-current={isSelected ? "true" : undefined}
				className={cn(
					"flex min-w-0 flex-1 cursor-grab items-center gap-1.5 px-1.5 py-1 text-left outline-none active:cursor-grabbing",
					isStagingDisabled && "cursor-default active:cursor-default"
				)}
				onClick={selectFile}
				ref={handleRef}
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
	const groups = groupRepositoryFilesByStaging(files);
	const orderedFiles = [...groups.staged, ...groups.unstaged];
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

	const finishFileDrag = (event: DragEndEvent): void => {
		const {
			canceled,
			operation: { source, target },
		} = event;
		if (canceled || !(source && target)) {
			return;
		}
		const targetGroup = getRepositoryFileStageGroupFromId(String(target.id));
		const file = orderedFiles.find(
			(candidate) => candidate.path === String(source.id)
		);
		if (!(targetGroup && file)) {
			return;
		}
		const shouldStage = shouldStageRepositoryFileDrop(
			file,
			targetGroup === "staged"
		);
		if (shouldStage === null) {
			return;
		}
		onSetStaged(file, shouldStage).catch(() => {
			// The workspace displays the Git operation failure.
		});
	};
	const rows = orderedFiles.map((file, index) => {
		const isBulkSelected = selectedFilePaths.has(file.path);
		const previousFile = orderedFiles[index - 1];
		const nextFile = orderedFiles[index + 1];
		return (
			<RepositoryFileRow
				file={file}
				isBulkSelected={isBulkSelected}
				isBulkSelectionEnd={
					isBulkSelected && !(nextFile && selectedFilePaths.has(nextFile.path))
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
				onSelectionContextMenuPresenceChange={setSelectionContextMenuPresent}
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
	});
	const stagedRows = rows.slice(0, groups.staged.length);
	const unstagedRows = rows.slice(groups.staged.length);

	return (
		<DragDropProvider
			onDragEnd={finishFileDrag}
			sensors={REPOSITORY_FILE_DRAG_SENSORS}
		>
			<div data-name="RepositoryFileListGroups">
				<RepositoryFileStageGroup
					count={groups.staged.length}
					disabled={isStagingDisabled}
					group="staged"
				>
					{stagedRows}
				</RepositoryFileStageGroup>
				<RepositoryFileStageGroup
					count={groups.unstaged.length}
					disabled={isStagingDisabled}
					group="unstaged"
				>
					{unstagedRows}
				</RepositoryFileStageGroup>
			</div>
		</DragDropProvider>
	);
}
