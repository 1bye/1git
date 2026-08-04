import { cn } from "@1git/ui/lib/utils";
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers";
import { useSortable } from "@dnd-kit/react/sortable";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { CSSProperties, ReactElement, RefCallback } from "react";
import { useCallback } from "react";
import type { WorkspaceTabState } from "@/feature/workspace/hooks/use-git-workspace.js";
import {
	getRepositoryName,
	getWorkspaceLabel,
} from "@/feature/workspace/lib/workspace-model.js";
import { useCommandLensTarget } from "@/fixture/command-lens/hooks/use-command-lens-target.js";
import type { CommandLensCommand } from "@/fixture/command-lens/lib/command-lens-shortcut.js";
import {
	WORKSPACE_COMMAND_LENS_GROUP,
	WORKSPACE_TAB_REORDER_MOTION,
	WORKSPACE_TAB_SURFACE_GEOMETRY,
} from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import { useWorkspaceTabClose } from "@/fixture/desktop-toolbar/hooks/use-workspace-tab-close.js";
import { LiquidMenuTrigger } from "@/fixture/liquid-menu/components/liquid-menu.js";
import { OverflowingLabel } from "@/fixture/overflowing-label/components/overflowing-label.js";
import { RepositoryOwnerThumbnail } from "@/fixture/repository-item/components/repository-owner-thumbnail.js";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

interface WorkspaceTabProps {
	readonly index: number;
	readonly isActionsMenuOpen: boolean;
	readonly isActive: boolean;
	readonly isBusy: boolean;
	readonly onActivate: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onActivateNext: () => Promise<void>;
	readonly onActivatePrevious: () => Promise<void>;
	readonly onClose: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onOpenActions: () => void;
	readonly shortcutKey: string | null;
	readonly workspace: WorkspaceTabState;
}

interface WorkspaceTabAppearanceProps extends Omit<WorkspaceTabProps, "index"> {
	readonly handleRef?: RefCallback<Element>;
	readonly isDragging: boolean;
	readonly isOverlay?: boolean;
	readonly navigationOrder?: number;
	readonly rootRef?: RefCallback<Element>;
}

interface WorkspaceTabNameButtonProps {
	readonly branch: string | null;
	readonly isActive: boolean;
	readonly isDisabled: boolean;
	readonly isDragging: boolean;
	readonly isMenuTrigger: boolean;
	readonly label: string;
	readonly onActivate: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onOpenActions: () => void;
	readonly repositoryName: string;
	readonly sessionId: RepositorySessionId;
}

interface WorkspaceTabNameProps {
	readonly branch: string | null;
	readonly isActive: boolean;
	readonly repositoryName: string;
}

interface WorkspaceChangedFilesProps {
	readonly count: number;
	readonly isActive: boolean;
}

interface WorkspaceTabCommandOptions {
	readonly activate: () => Promise<void>;
	readonly activateNext: () => Promise<void>;
	readonly activatePrevious: () => Promise<void>;
	readonly close: () => void;
	readonly isActive: boolean;
	readonly label: string;
	readonly shortcutKey: string | null;
}

const WORKSPACE_TAB_NAME_BUTTON_CLASS_NAME =
	"relative z-10 flex h-full min-w-0 flex-1 touch-none items-center overflow-hidden rounded-md text-left outline-none hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-brand/20";

const WORKSPACE_TAB_STYLE: CSSProperties = {
	height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabHeight,
	width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabWidth,
};

const WORKSPACE_TAB_MENU_OPEN_STYLE: CSSProperties = {
	...WORKSPACE_TAB_STYLE,
	zIndex: 4,
};

const WORKSPACE_TAB_VISUAL_STYLE: CSSProperties = {
	borderRadius: WORKSPACE_TAB_SURFACE_GEOMETRY.tabRadius,
	insetBlock: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetBlock,
	insetInline: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetInline,
};

const WORKSPACE_TAB_ACTIVATOR_STYLE: CSSProperties = {
	paddingBlock: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentInsetBlock,
	paddingInlineEnd: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentGap,
	paddingInlineStart: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentInsetInlineStart,
};

const WORKSPACE_TAB_CHANGE_BADGE_STYLE: CSSProperties = {
	height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabChangeBadgeHeight,
	minWidth: WORKSPACE_TAB_SURFACE_GEOMETRY.tabChangeBadgeMinWidth,
};

const WORKSPACE_TAB_TRAILING_STYLE: CSSProperties = {
	height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabCloseSize,
	marginInlineEnd: WORKSPACE_TAB_SURFACE_GEOMETRY.tabTrailingInset,
	marginInlineStart: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentGap,
	width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabCloseSize,
};

const MAX_VISIBLE_CHANGED_FILE_COUNT = 99;

const WORKSPACE_TAB_SORT_TRANSITION = {
	...WORKSPACE_TAB_REORDER_MOTION,
	idle: true,
} as const;

const getWorkspaceTabStyle = (
	isActionsMenuOpen: boolean,
	isOverlay: boolean
): CSSProperties =>
	isActionsMenuOpen && !isOverlay
		? WORKSPACE_TAB_MENU_OPEN_STYLE
		: WORKSPACE_TAB_STYLE;

const getOwnerTitle = (workspace: WorkspaceTabState): string =>
	workspace.owner
		? `${workspace.owner.namespace} on ${workspace.owner.host}`
		: "Local repository";

const getAccessibleTabLabel = (
	label: string,
	workspace: WorkspaceTabState
): string =>
	workspace.owner ? `${label}, owned by ${workspace.owner.namespace}` : label;

const getWorkspaceTabCommands = ({
	activate,
	activateNext,
	activatePrevious,
	close,
	isActive,
	label,
	shortcutKey,
}: WorkspaceTabCommandOptions): readonly CommandLensCommand[] => {
	const commands: CommandLensCommand[] = shortcutKey
		? [
				{
					allowInEditable: true,
					key: shortcutKey,
					label: `Open ${label}`,
					onInvoke: activate,
					showInLens: false,
				},
			]
		: [];
	if (!isActive) {
		return commands;
	}
	commands.push(
		{
			key: "ArrowLeft",
			label: "Previous workspace",
			onInvoke: activatePrevious,
		},
		{
			key: "ArrowRight",
			label: "Next workspace",
			onInvoke: activateNext,
		},
		{
			key: "Backspace",
			label: `Close ${label}`,
			onInvoke: close,
		}
	);
	return commands;
};

function WorkspaceTabName({
	branch,
	isActive,
	repositoryName,
}: WorkspaceTabNameProps): ReactElement {
	return (
		<OverflowingLabel className="flex-1 text-xss">
			<span className={cn(isActive ? "font-bold" : "font-semibold")}>
				{repositoryName}
			</span>
			{branch ? (
				<span className="font-medium text-editor-faint"> / {branch}</span>
			) : null}
		</OverflowingLabel>
	);
}

function WorkspaceTabNameButton({
	branch,
	isActive,
	isDisabled,
	isDragging,
	isMenuTrigger,
	label,
	onActivate,
	onOpenActions,
	repositoryName,
	sessionId,
}: WorkspaceTabNameButtonProps): ReactElement {
	const selectWorkspace = async (): Promise<void> => {
		if (isDragging) {
			return;
		}
		await onActivate(sessionId);
	};
	const openActions = (): void => {
		if (!isDragging) {
			onOpenActions();
		}
	};
	const name = (
		<WorkspaceTabName
			branch={branch}
			isActive={isActive}
			repositoryName={repositoryName}
		/>
	);

	if (isMenuTrigger) {
		return (
			<LiquidMenuTrigger
				aria-label={`Open actions for ${label}`}
				className={WORKSPACE_TAB_NAME_BUTTON_CLASS_NAME}
				data-desktop-interactive
				data-workspace-tab-pointer-drag-handle
				disabled={isDisabled}
				onClick={openActions}
				tabIndex={0}
				title={label}
			>
				{name}
			</LiquidMenuTrigger>
		);
	}

	return (
		<button
			aria-label={`Activate ${label}`}
			className={WORKSPACE_TAB_NAME_BUTTON_CLASS_NAME}
			data-desktop-interactive
			data-workspace-tab-pointer-drag-handle
			disabled={isDisabled}
			onClick={selectWorkspace}
			tabIndex={isActive ? 0 : -1}
			title={label}
			type="button"
		>
			{name}
		</button>
	);
}

function WorkspaceChangedFiles({
	count,
	isActive,
}: WorkspaceChangedFilesProps): ReactElement | null {
	if (count <= 0) {
		return null;
	}

	const label = `${count} changed ${count === 1 ? "file" : "files"}`;
	const visibleCount =
		count > MAX_VISIBLE_CHANGED_FILE_COUNT
			? `${MAX_VISIBLE_CHANGED_FILE_COUNT}+`
			: count;

	return (
		<span
			className={cn(
				"pointer-events-none flex shrink-0 items-center justify-center rounded-[0.3rem] bg-amber-100 px-1 font-semibold text-[9px] text-amber-800 tabular-nums opacity-100 transition-opacity duration-150 ease-out group-focus-within/trailing:opacity-0 group-hover:opacity-0",
				!isActive && "bg-amber-100/35 text-amber-800/65"
			)}
			data-name="WorkspaceChangedFiles"
			style={WORKSPACE_TAB_CHANGE_BADGE_STYLE}
			title={label}
		>
			<span aria-hidden>{visibleCount}</span>
			<span className="sr-only">{label}</span>
		</span>
	);
}

function WorkspaceTabAppearance({
	handleRef,
	isActionsMenuOpen,
	isActive,
	isBusy,
	isDragging,
	isOverlay = false,
	navigationOrder = 0,
	onActivate,
	onActivateNext,
	onActivatePrevious,
	onClose,
	onOpenActions,
	rootRef,
	shortcutKey,
	workspace,
}: WorkspaceTabAppearanceProps): ReactElement {
	const repositoryName = getRepositoryName(workspace.session.repository.root);
	const label = getWorkspaceLabel(
		workspace.session.repository.root,
		workspace.branch
	);
	const ownerLabel = workspace.owner?.name ?? repositoryName;
	const changedFileCount = workspace.changedFiles ?? 0;
	const activateWorkspace = async (): Promise<void> => {
		await onActivate(workspace.session.id);
	};
	const {
		finishClosing: finishClosingWorkspace,
		isClosing,
		startClosing: startClosingWorkspace,
	} = useWorkspaceTabClose({
		isOverlay,
		onClose,
		sessionId: workspace.session.id,
	});
	const commandLensTarget = useCommandLensTarget({
		commands: getWorkspaceTabCommands({
			activate: activateWorkspace,
			activateNext: onActivateNext,
			activatePrevious: onActivatePrevious,
			close: startClosingWorkspace,
			isActive,
			label,
			shortcutKey,
		}),
		disabled: isBusy || isClosing || isOverlay,
		highlightInsetBlock: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetBlock,
		highlightInsetInline: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetInline,
		highlightOutset: 0,
		hintLayout: "floating",
		id: `workspace-tab:${workspace.session.id}`,
		navigationDefault: isActive,
		navigationGroup: WORKSPACE_COMMAND_LENS_GROUP,
		navigationOrder,
		navigationOrientation: "horizontal",
		placement: "bottom",
		radius: WORKSPACE_TAB_SURFACE_GEOMETRY.tabRadius,
	});
	const setRootElement = useCallback(
		(element: HTMLElement | null): void => {
			rootRef?.(element);
			commandLensTarget.ref(element);
		},
		[commandLensTarget.ref, rootRef]
	);

	return (
		<div
			aria-hidden={isOverlay || undefined}
			aria-keyshortcuts={commandLensTarget.ariaKeyShortcuts}
			className={cn(
				"group relative z-[2] flex shrink-0 items-center px-1 transition-colors",
				isActive ? "text-editor-ink" : "text-editor-muted hover:text-editor-ink"
			)}
			data-active={isActive ? "true" : undefined}
			data-closing={isClosing ? "true" : undefined}
			data-desktop-interactive
			data-dragging={isDragging ? "true" : undefined}
			data-name="WorkspaceTab"
			data-overflowing-label-suppressed={isDragging ? "true" : undefined}
			data-overflowing-label-trigger
			data-overlay={isOverlay ? "true" : undefined}
			data-workspace-session-id={workspace.session.id}
			ref={setRootElement}
			style={getWorkspaceTabStyle(isActionsMenuOpen, isOverlay)}
		>
			<div
				className="relative z-[1] flex h-full min-w-0 flex-1 items-center"
				data-name="WorkspaceTabContent"
				onAnimationEnd={finishClosingWorkspace}
			>
				<button
					aria-controls="repository-workspace"
					aria-label={getAccessibleTabLabel(label, workspace)}
					aria-selected={isActive}
					className="relative z-10 flex h-full shrink-0 cursor-default touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-brand/20 active:cursor-grabbing"
					data-desktop-interactive
					data-workspace-tab-pointer-drag-handle
					disabled={isBusy || isClosing || isOverlay}
					onClick={activateWorkspace}
					ref={handleRef}
					role="tab"
					style={WORKSPACE_TAB_ACTIVATOR_STYLE}
					tabIndex={isActive ? 0 : -1}
					title={label}
					type="button"
				>
					<RepositoryOwnerThumbnail
						label={ownerLabel}
						owner={workspace.owner}
						size="sm"
						title={getOwnerTitle(workspace)}
					/>
				</button>
				<WorkspaceTabNameButton
					branch={workspace.branch}
					isActive={isActive}
					isDisabled={isBusy || isClosing || isOverlay}
					isDragging={isDragging}
					isMenuTrigger={isActive && !isOverlay}
					label={label}
					onActivate={onActivate}
					onOpenActions={onOpenActions}
					repositoryName={repositoryName}
					sessionId={workspace.session.id}
				/>
				<div
					className="group/trailing relative z-10 flex shrink-0 items-center justify-center"
					data-name="WorkspaceTabTrailingAction"
					style={WORKSPACE_TAB_TRAILING_STYLE}
				>
					<WorkspaceChangedFiles count={changedFileCount} isActive={isActive} />
					<button
						aria-label={`Close ${label}`}
						className="absolute inset-0 flex items-center justify-center rounded-lg text-editor-faint opacity-0 outline-none transition-opacity duration-150 ease-out hover:bg-active hover:text-editor-ink focus-visible:bg-active focus-visible:ring-2 focus-visible:ring-brand/20 group-focus-within/trailing:opacity-100 group-hover:opacity-100"
						data-name="WorkspaceTabClose"
						disabled={isBusy || isClosing || isOverlay}
						onClick={startClosingWorkspace}
						tabIndex={isActive ? 0 : -1}
						type="button"
					>
						<XIcon aria-hidden className="size-3" weight="bold" />
					</button>
				</div>
			</div>
			{isActionsMenuOpen && !isOverlay ? (
				<span
					aria-hidden
					className="pointer-events-none absolute z-0 bg-white"
					data-name="WorkspaceTabMenuPill"
					style={WORKSPACE_TAB_VISUAL_STYLE}
				/>
			) : null}
			{isActive || isOverlay ? null : (
				<span
					aria-hidden
					className="pointer-events-none absolute z-0 bg-transparent transition-colors group-hover:bg-hover"
					data-name="WorkspaceTabHoverPill"
					style={WORKSPACE_TAB_VISUAL_STYLE}
				/>
			)}
		</div>
	);
}

export function WorkspaceTab({
	index,
	...appearanceProps
}: WorkspaceTabProps): ReactElement {
	const { handleRef, isDragging, isDropping, ref } = useSortable({
		disabled: appearanceProps.isBusy,
		id: appearanceProps.workspace.session.id,
		index,
		modifiers: [RestrictToHorizontalAxis],
		transition: WORKSPACE_TAB_SORT_TRANSITION,
	});

	return (
		<WorkspaceTabAppearance
			{...appearanceProps}
			handleRef={handleRef}
			isDragging={isDragging || isDropping}
			navigationOrder={index + 1}
			rootRef={ref}
		/>
	);
}

export function WorkspaceTabOverlay(
	props: Omit<WorkspaceTabProps, "index">
): ReactElement {
	return <WorkspaceTabAppearance {...props} isDragging isOverlay />;
}
