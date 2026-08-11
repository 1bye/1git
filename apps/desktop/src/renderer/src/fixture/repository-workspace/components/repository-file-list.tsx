import type { FileChange } from "@1git/git";
import { DropdownMenuItem } from "@1git/ui/components/dropdown-menu";
import { cn } from "@1git/ui/lib/utils";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import {
	DragDropProvider,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	useDraggable,
	useDroppable,
} from "@dnd-kit/react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import type {
	CSSProperties,
	ReactElement,
	MouseEvent as ReactMouseEvent,
	ReactNode,
	RefCallback,
} from "react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
	isFileConflicted,
	isFileStaged,
} from "@/feature/workspace/lib/workspace-model.js";
import {
	LiquidContextMenuRoot,
	LiquidContextMenuTrigger,
	LiquidMenuContent,
	LiquidMenuRoot,
	LiquidMenuTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY } from "@/fixture/liquid-menu/constants/liquid-menu.js";
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
	hasRepositoryFileStageProjectionSettled,
	type RepositoryFileStageProjection,
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
const REPOSITORY_FILE_DRAG_OVERLAY_STYLE = {
	pointerEvents: "none",
} satisfies CSSProperties;
const REPOSITORY_FILE_DRAG_SENSORS = [
	PointerSensor.configure({
		activationConstraints: [
			new PointerActivationConstraints.Distance({
				value: REPOSITORY_FILE_DRAG_ACTIVATION_DISTANCE,
			}),
		],
	}),
];

type RepositoryFileStageGroup = "conflicted" | "staged" | "unstaged";

const repositoryFileStageGroupLabel = (
	group: RepositoryFileStageGroup
): string => {
	if (group === "conflicted") {
		return "Conflicted";
	}
	return group === "staged" ? "Staged" : "Unstaged";
};

const repositoryFileStageGroup = (
	file: FileChange
): RepositoryFileStageGroup => {
	if (isFileConflicted(file)) {
		return "conflicted";
	}
	return isFileStaged(file) ? "staged" : "unstaged";
};

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

const isRepositoryFileDragFeedbackActive = (
	isDragging: boolean,
	isDropping: boolean,
	isLanding: boolean
): boolean => (isDragging || isDropping) && !isLanding;

const getBooleanDataAttribute = (value: boolean): "true" | undefined =>
	value ? "true" : undefined;

interface RepositoryFileDragOverlayProps {
	readonly file: FileChange;
}

function RepositoryFileDragOverlay({
	file,
}: RepositoryFileDragOverlayProps): ReactElement {
	const path = splitRepositoryFilePath(file.path);
	return (
		<div
			aria-hidden
			className="flex h-full w-full items-center rounded-md bg-editor-surface pr-0.5 shadow-surface-3 ring-1 ring-black/5"
			data-name="RepositoryFileDragOverlay"
		>
			<span className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap px-1.5 py-0.5 text-[11px]">
				{path.directory ? (
					<span className="text-editor-muted/75">{path.directory}</span>
				) : null}
				<span className="font-medium text-editor-ink">{path.name}</span>
			</span>
			<span className="ml-0.5 flex size-5 shrink-0 items-center justify-center">
				<RepositoryFileStatus file={file} />
			</span>
		</div>
	);
}

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
	readonly disabled: boolean;
	readonly dragSourceGroup: RepositoryFileStageGroup | null;
	readonly files: readonly FileChange[];
	readonly group: RepositoryFileStageGroup;
	readonly isSticky: boolean;
	readonly onSetFilesStaged: (
		files: readonly FileChange[],
		shouldStage: boolean
	) => Promise<boolean>;
	readonly stickyLayer: HTMLElement | null;
}

interface RepositoryFileStageHeaderProps {
	readonly disabled: boolean;
	readonly dragSourceGroup: RepositoryFileStageGroup | null;
	readonly files: readonly FileChange[];
	readonly group: RepositoryFileStageGroup;
	readonly isOverlay?: boolean;
	readonly onSetFilesStaged: (
		files: readonly FileChange[],
		shouldStage: boolean
	) => Promise<boolean>;
	readonly showDropWell: boolean;
}

function RepositoryFileStageHeader({
	disabled,
	dragSourceGroup,
	files,
	group,
	isOverlay = false,
	onSetFilesStaged,
	showDropWell,
}: RepositoryFileStageHeaderProps): ReactElement {
	const label =
		group === "conflicted" ? "Conflicts" : repositoryFileStageGroupLabel(group);
	const shouldStage = group !== "staged";
	const actionLabel = shouldStage ? "Stage all" : "Unstage all";
	const dropLabel = group === "staged" ? "Drop to stage" : "Drop to unstage";
	const setGroupStaged = async (): Promise<void> => {
		await onSetFilesStaged(files, shouldStage);
	};

	return (
		<header
			className={cn(
				"flex h-7 items-center px-1.5 font-medium text-[10px] text-editor-muted transition-colors",
				isOverlay && "pointer-events-auto mx-1",
				showDropWell && "text-brand"
			)}
			data-repository-file-sticky-header={isOverlay ? "true" : undefined}
		>
			<span>{showDropWell ? dropLabel : label}</span>
			<span className="ml-1 tabular-nums">{files.length}</span>
			<LiquidMenuRoot
				anchorGeometry={LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY}
				disabled={disabled || dragSourceGroup !== null || files.length === 0}
				modal
			>
				<LiquidMenuTrigger
					aria-label={`Actions for ${label.toLowerCase()} files`}
					className="ml-auto flex size-6 items-center justify-center rounded-lg text-editor-muted outline-none transition-colors hover:bg-hover hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-brand/20 data-disabled:pointer-events-none data-disabled:text-editor-faint"
				>
					<DotsThreeIcon aria-hidden className="size-3.5" weight="bold" />
				</LiquidMenuTrigger>
				<LiquidMenuContent
					align="end"
					aria-label={`${label} file actions`}
					className="min-w-36 p-1"
					sideOffset={4}
				>
					<DropdownMenuItem closeOnClick onClick={setGroupStaged}>
						{shouldStage ? (
							<CheckIcon aria-hidden weight="bold" />
						) : (
							<MinusIcon aria-hidden weight="bold" />
						)}
						{actionLabel}
					</DropdownMenuItem>
				</LiquidMenuContent>
			</LiquidMenuRoot>
		</header>
	);
}

function RepositoryFileStageGroup({
	children,
	disabled,
	dragSourceGroup,
	files,
	group,
	isSticky,
	onSetFilesStaged,
	stickyLayer,
}: RepositoryFileStageGroupProps): ReactElement {
	const { isDropTarget, ref } = useDroppable({
		accept: REPOSITORY_FILE_DRAG_TYPE,
		disabled: disabled || group === "conflicted",
		id: repositoryFileStageGroupId(group),
		type: "repository-file-stage-group",
	});
	const isDropDestination =
		dragSourceGroup !== null && dragSourceGroup !== group;
	const showDropWell = isDropDestination && isDropTarget;
	const releaseLabel =
		group === "staged" ? "Release to stage" : "Release to unstage";
	const stickyHeader =
		isSticky && stickyLayer
			? createPortal(
					<RepositoryFileStageHeader
						disabled={disabled}
						dragSourceGroup={dragSourceGroup}
						files={files}
						group={group}
						isOverlay
						onSetFilesStaged={onSetFilesStaged}
						showDropWell={showDropWell}
					/>,
					stickyLayer
				)
			: null;

	return (
		<section
			aria-label={`${repositoryFileStageGroupLabel(group)} files`}
			className={cn(
				"min-h-10 rounded-lg px-1 pb-1 transition-[opacity] duration-150 motion-reduce:transition-none",
				dragSourceGroup !== null && !isDropDestination && "opacity-55"
			)}
			data-file-stage-group={group}
			data-file-stage-group-count={files.length}
			data-name="RepositoryFileStageGroup"
			data-repository-file-drop-target={showDropWell ? "true" : undefined}
			ref={ref}
		>
			{stickyHeader}
			{isSticky && stickyLayer ? (
				<div aria-hidden className="h-7" data-repository-file-sticky-spacer />
			) : (
				<RepositoryFileStageHeader
					disabled={disabled}
					dragSourceGroup={dragSourceGroup}
					files={files}
					group={group}
					onSetFilesStaged={onSetFilesStaged}
					showDropWell={showDropWell}
				/>
			)}
			<div
				aria-hidden
				className={cn(
					"grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none",
					showDropWell
						? "grid-rows-[1fr] opacity-100"
						: "grid-rows-[0fr] opacity-0"
				)}
			>
				<div className="overflow-hidden">
					<div className="mx-1 mb-1 flex h-8 items-center justify-center gap-1.5 rounded-lg bg-brand-softer font-medium text-[10px] text-brand shadow-inner">
						{group === "staged" ? (
							<CheckIcon aria-hidden className="size-3" weight="bold" />
						) : (
							<MinusIcon aria-hidden className="size-3" weight="bold" />
						)}
						{releaseLabel}
					</div>
				</div>
			</div>
			<ul
				aria-label={`${repositoryFileStageGroupLabel(group)} changed files`}
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
	) => Promise<boolean>;
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
	readonly isDragLanding: boolean;
	readonly isDragSettling: boolean;
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
	) => Promise<boolean>;
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
	isDragLanding,
	isDragSettling,
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
		isDropping,
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
	const isDragFeedbackActive = isRepositoryFileDragFeedbackActive(
		isDragging,
		isDropping,
		isDragLanding
	);
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
				"group relative flex min-h-6.5 items-center rounded-md pr-0.5 transition-[background-color,opacity]",
				selectionClassName,
				isBulkSelectionStart && "rounded-t-md",
				isBulkSelectionEnd && "rounded-b-md",
				isSingleContextMenuActive && "rounded-md",
				isSingleContextMenuActive && !shouldElevateSelection && "z-20"
			)}
			data-active={getBooleanDataAttribute(isSelected)}
			data-bulk-selected={getBooleanDataAttribute(isBulkSelected)}
			data-drag-landing={getBooleanDataAttribute(isDragLanding)}
			data-drag-settling={getBooleanDataAttribute(isDragSettling)}
			data-dragging={getBooleanDataAttribute(isDragFeedbackActive)}
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

			<button
				aria-current={isSelected ? "true" : undefined}
				className={cn(
					"flex min-w-0 flex-1 cursor-grab items-center gap-1.5 px-1.5 py-0.5 text-left outline-none active:cursor-grabbing",
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

			<RepositoryFileStageButton
				disabled={isStagingDisabled}
				file={file}
				onSetStaged={onSetStaged}
			/>
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
	readonly allFiles?: readonly FileChange[];
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
	) => Promise<boolean>;
	readonly query: string;
	readonly repositoryRoot: string;
	readonly selectedFilePath: string | null;
	readonly selectedFilePaths: ReadonlySet<string>;
	readonly selectedFiles: readonly FileChange[];
	readonly selectedRowAriaKeyShortcuts?: string;
	readonly selectedRowRef?: RefCallback<HTMLElement>;
}

export function RepositoryFileList({
	allFiles,
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
	const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
	const [stickyGroup, setStickyGroup] =
		useState<RepositoryFileStageGroup | null>(null);
	const [stickyLayer, setStickyLayer] = useState<HTMLElement | null>(null);
	const [isSelectionContextMenuPresent, setSelectionContextMenuPresent] =
		useState(false);
	const [dragSourceGroup, setDragSourceGroup] =
		useState<RepositoryFileStageGroup | null>(null);
	const [settlingFilePath, setSettlingFilePath] = useState<string | null>(null);
	const [landingFilePath, setLandingFilePath] = useState<string | null>(null);
	const [stageProjection, setStageProjection] =
		useState<RepositoryFileStageProjection | null>(null);
	const sourceFiles = allFiles ?? files;
	const groups = groupRepositoryFilesByStaging(files, stageProjection);
	const totalGroups = groupRepositoryFilesByStaging(
		sourceFiles,
		stageProjection
	);
	const orderedFiles = [
		...groups.conflicted,
		...groups.staged,
		...groups.unstaged,
	];
	const orderedFilePaths = orderedFiles.map((file) => file.path);
	const conflictedFileCount = groups.conflicted.length;
	const stagedFileCount = groups.staged.length;
	const unstagedFileCount = groups.unstaged.length;
	useLayoutEffect(() => {
		if (!listElement) {
			return;
		}
		const scrollArea = listElement.closest<HTMLElement>(
			'[data-name="RepositoryFileScrollArea"]'
		);
		const viewport = scrollArea?.querySelector<HTMLElement>(
			"[data-repository-file-viewport]"
		);
		const nextStickyLayer = scrollArea?.querySelector<HTMLElement>(
			"[data-repository-file-sticky-layer]"
		);
		const groupElements = [
			...listElement.querySelectorAll<HTMLElement>("[data-file-stage-group]"),
		];
		const groupCounts: Readonly<Record<RepositoryFileStageGroup, number>> = {
			conflicted: conflictedFileCount,
			staged: stagedFileCount,
			unstaged: unstagedFileCount,
		};
		const hasCurrentGroupLayout = groupElements.every((groupElement) => {
			const group = groupElement.dataset
				.fileStageGroup as RepositoryFileStageGroup;
			return (
				groupElement.dataset.fileStageGroupCount === String(groupCounts[group])
			);
		});
		if (!(viewport && nextStickyLayer && hasCurrentGroupLayout)) {
			return;
		}
		setStickyLayer(nextStickyLayer);
		const updateStickyGroup = (): void => {
			const viewportTop = viewport.getBoundingClientRect().top;
			let nextGroup: RepositoryFileStageGroup | null = null;
			for (const groupElement of groupElements) {
				if (groupElement.getBoundingClientRect().top <= viewportTop + 1) {
					nextGroup = groupElement.dataset
						.fileStageGroup as RepositoryFileStageGroup;
				}
			}
			nextGroup ??=
				(groupElements[0]?.dataset.fileStageGroup as
					| RepositoryFileStageGroup
					| undefined) ?? null;
			setStickyGroup((currentGroup) =>
				currentGroup === nextGroup ? currentGroup : nextGroup
			);
		};
		updateStickyGroup();
		viewport.addEventListener("scroll", updateStickyGroup, { passive: true });
		return () => {
			viewport.removeEventListener("scroll", updateStickyGroup);
		};
	}, [conflictedFileCount, listElement, stagedFileCount, unstagedFileCount]);
	useEffect(() => {
		if (selectedFiles.length < 2) {
			setSelectionContextMenuPresent(false);
		}
	}, [selectedFiles.length]);
	useEffect(() => {
		if (!stageProjection) {
			return;
		}
		if (hasRepositoryFileStageProjectionSettled(sourceFiles, stageProjection)) {
			setStageProjection(null);
		}
	}, [sourceFiles, stageProjection]);
	if (files.length === 0) {
		return (
			<p className="px-4 py-8 text-center text-editor-faint text-xss">
				{query ? `No changed files match “${query}”.` : "No changed files."}
			</p>
		);
	}

	const startFileDrag = (event: DragStartEvent): void => {
		const sourceFile = orderedFiles.find(
			(file) => file.path === String(event.operation.source?.id)
		);
		if (!sourceFile) {
			setDragSourceGroup(null);
			return;
		}
		setDragSourceGroup(repositoryFileStageGroup(sourceFile));
	};
	const finishFileDrag = async (event: DragEndEvent): Promise<void> => {
		setDragSourceGroup(null);
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
		setStageProjection({ path: file.path, staged: shouldStage });
		setLandingFilePath(file.path);
		setSettlingFilePath(file.path);
		let didStage = false;
		try {
			didStage = await onSetStaged(file, shouldStage);
		} finally {
			if (!didStage) {
				setStageProjection((currentProjection) =>
					currentProjection?.path === file.path ? null : currentProjection
				);
			}
			setSettlingFilePath((currentPath) =>
				currentPath === file.path ? null : currentPath
			);
			setLandingFilePath((currentPath) =>
				currentPath === file.path ? null : currentPath
			);
		}
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
				isDragLanding={landingFilePath === file.path}
				isDragSettling={settlingFilePath === file.path}
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
	const conflictedRows = rows.slice(0, groups.conflicted.length);
	const stagedStart = groups.conflicted.length;
	const unstagedStart = stagedStart + groups.staged.length;
	const stagedRows = rows.slice(stagedStart, unstagedStart);
	const unstagedRows = rows.slice(unstagedStart);

	return (
		<DragDropProvider
			onDragEnd={finishFileDrag}
			onDragStart={startFileDrag}
			sensors={REPOSITORY_FILE_DRAG_SENSORS}
		>
			<div
				data-name="RepositoryFileListGroups"
				data-repository-file-list
				ref={setListElement}
			>
				{groups.conflicted.length > 0 ? (
					<RepositoryFileStageGroup
						disabled={isStagingDisabled}
						dragSourceGroup={dragSourceGroup}
						files={totalGroups.conflicted}
						group="conflicted"
						isSticky={stickyGroup === "conflicted"}
						onSetFilesStaged={onSetFilesStaged}
						stickyLayer={stickyLayer}
					>
						{conflictedRows}
					</RepositoryFileStageGroup>
				) : null}
				<RepositoryFileStageGroup
					disabled={isStagingDisabled}
					dragSourceGroup={dragSourceGroup}
					files={totalGroups.staged}
					group="staged"
					isSticky={stickyGroup === "staged"}
					onSetFilesStaged={onSetFilesStaged}
					stickyLayer={stickyLayer}
				>
					{stagedRows}
				</RepositoryFileStageGroup>
				<RepositoryFileStageGroup
					disabled={isStagingDisabled}
					dragSourceGroup={dragSourceGroup}
					files={totalGroups.unstaged}
					group="unstaged"
					isSticky={stickyGroup === "unstaged"}
					onSetFilesStaged={onSetFilesStaged}
					stickyLayer={stickyLayer}
				>
					{unstagedRows}
				</RepositoryFileStageGroup>
			</div>
			<DragOverlay
				dropAnimation={null}
				style={REPOSITORY_FILE_DRAG_OVERLAY_STYLE}
			>
				{(source) => {
					const file = sourceFiles.find(
						(candidate) => candidate.path === String(source.id)
					);
					return file ? <RepositoryFileDragOverlay file={file} /> : null;
				}}
			</DragOverlay>
		</DragDropProvider>
	);
}
