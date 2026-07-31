import { DropdownMenuTrigger } from "@1git/ui/components/dropdown-menu";
import { cn } from "@1git/ui/lib/utils";
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers";
import { useSortable } from "@dnd-kit/react/sortable";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { CSSProperties, ReactElement, RefCallback } from "react";
import { useState } from "react";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";
import type { WorkspaceTabState } from "../../../feature/workspace/hooks/use-git-workspace.js";
import type { RepositoryOwner } from "../../../feature/workspace/lib/repository-owner.js";
import {
	getRepositoryName,
	getWorkspaceLabel,
} from "../../../feature/workspace/lib/workspace-model.js";
import {
	WORKSPACE_TAB_REORDER_MOTION,
	WORKSPACE_TAB_SURFACE_GEOMETRY,
} from "../constants/workspace-tab.js";
import { useOverflowingTabLabel } from "../hooks/use-overflowing-tab-label.js";
import { useRepositoryOwnerAvatar } from "../hooks/use-repository-owner-avatar.js";

interface WorkspaceTabProps {
	readonly index: number;
	readonly isActionsMenuOpen: boolean;
	readonly isActive: boolean;
	readonly isBusy: boolean;
	readonly onActivate: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onClose: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onOpenActions: () => void;
	readonly workspace: WorkspaceTabState;
}

interface WorkspaceTabAppearanceProps extends Omit<WorkspaceTabProps, "index"> {
	readonly handleRef?: RefCallback<Element>;
	readonly isDragging: boolean;
	readonly isOverlay?: boolean;
	readonly rootRef?: RefCallback<Element>;
}

interface WorkspaceOwnerThumbnailProps {
	readonly label: string;
	readonly owner: RepositoryOwner | null;
	readonly title: string;
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

const OWNER_THUMBNAIL_TONES = [
	"bg-sky-100 text-sky-700",
	"bg-violet-100 text-violet-700",
	"bg-emerald-100 text-emerald-700",
	"bg-amber-100 text-amber-800",
	"bg-rose-100 text-rose-700",
] as const;

const WORKSPACE_OWNER_THUMBNAIL_CLASS_NAME = "shrink-0 rounded-full";
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

const WORKSPACE_OWNER_THUMBNAIL_STYLE: CSSProperties = {
	height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabAvatarSize,
	width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabAvatarSize,
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

const getThumbnailTone = (label: string): string => {
	let toneIndex = 0;
	for (const character of label) {
		toneIndex =
			(toneIndex + (character.codePointAt(0) ?? 0)) %
			OWNER_THUMBNAIL_TONES.length;
	}
	return OWNER_THUMBNAIL_TONES[toneIndex] ?? OWNER_THUMBNAIL_TONES[0];
};

const getOwnerTitle = (workspace: WorkspaceTabState): string =>
	workspace.owner
		? `${workspace.owner.namespace} on ${workspace.owner.host}`
		: "Local repository";

const getAccessibleTabLabel = (
	label: string,
	workspace: WorkspaceTabState
): string =>
	workspace.owner ? `${label}, owned by ${workspace.owner.namespace}` : label;

function WorkspaceOwnerThumbnail({
	label,
	owner,
	title,
}: WorkspaceOwnerThumbnailProps): ReactElement {
	const avatarDataUrl = useRepositoryOwnerAvatar(owner);
	const [failedDataUrl, setFailedDataUrl] = useState<string | null>(null);
	const initial = label.trim().charAt(0).toLocaleUpperCase() || "•";
	const showAvatar = avatarDataUrl !== null && avatarDataUrl !== failedDataUrl;
	const hideInvalidAvatar = (): void => {
		setFailedDataUrl(avatarDataUrl);
	};

	if (showAvatar) {
		return (
			<img
				alt=""
				aria-hidden
				className={cn(WORKSPACE_OWNER_THUMBNAIL_CLASS_NAME, "object-cover")}
				data-name="RepositoryOwnerThumbnail"
				decoding="async"
				draggable={false}
				height={WORKSPACE_TAB_SURFACE_GEOMETRY.tabAvatarSize}
				onError={hideInvalidAvatar}
				src={avatarDataUrl}
				style={WORKSPACE_OWNER_THUMBNAIL_STYLE}
				title={title}
				width={WORKSPACE_TAB_SURFACE_GEOMETRY.tabAvatarSize}
			/>
		);
	}

	return (
		<span
			aria-hidden
			className={cn(
				WORKSPACE_OWNER_THUMBNAIL_CLASS_NAME,
				"flex items-center justify-center font-semibold text-[9px]",
				getThumbnailTone(label)
			)}
			data-name="RepositoryOwnerThumbnail"
			style={WORKSPACE_OWNER_THUMBNAIL_STYLE}
			title={title}
		>
			{initial}
		</span>
	);
}

function WorkspaceTabName({
	branch,
	isActive,
	repositoryName,
}: WorkspaceTabNameProps): ReactElement {
	const { isOverflowing, style, trackRef, viewportRef } =
		useOverflowingTabLabel();

	return (
		<span
			className="pointer-events-none block min-w-0 flex-1 overflow-hidden text-xss"
			data-name="WorkspaceTabLabelViewport"
			data-overflowing={isOverflowing ? "true" : undefined}
			ref={viewportRef}
			style={style}
		>
			<span
				className="inline-block min-w-max whitespace-nowrap"
				data-name="WorkspaceTabLabelTrack"
				ref={trackRef}
			>
				<span className={cn(isActive ? "font-bold" : "font-semibold")}>
					{repositoryName}
				</span>
				{branch ? (
					<span className="font-medium text-editor-faint"> / {branch}</span>
				) : null}
			</span>
		</span>
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
			<DropdownMenuTrigger
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
			</DropdownMenuTrigger>
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
	onActivate,
	onClose,
	onOpenActions,
	rootRef,
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
	const closeWorkspace = async (): Promise<void> => {
		await onClose(workspace.session.id);
	};

	return (
		<div
			aria-hidden={isOverlay || undefined}
			className={cn(
				"group relative z-[2] flex shrink-0 items-center px-1 transition-colors",
				isActive ? "text-editor-ink" : "text-editor-muted hover:text-editor-ink"
			)}
			data-active={isActive ? "true" : undefined}
			data-desktop-interactive
			data-dragging={isDragging ? "true" : undefined}
			data-name="WorkspaceTab"
			data-overlay={isOverlay ? "true" : undefined}
			data-workspace-session-id={workspace.session.id}
			ref={rootRef}
			style={
				isActionsMenuOpen && !isOverlay
					? WORKSPACE_TAB_MENU_OPEN_STYLE
					: WORKSPACE_TAB_STYLE
			}
		>
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
			<button
				aria-controls="repository-workspace"
				aria-label={getAccessibleTabLabel(label, workspace)}
				aria-selected={isActive}
				className="relative z-10 flex h-full shrink-0 cursor-default touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-brand/20 active:cursor-grabbing"
				data-desktop-interactive
				data-workspace-tab-pointer-drag-handle
				disabled={isBusy || isOverlay}
				onClick={activateWorkspace}
				ref={handleRef}
				role="tab"
				style={WORKSPACE_TAB_ACTIVATOR_STYLE}
				tabIndex={isActive ? 0 : -1}
				title={label}
				type="button"
			>
				<WorkspaceOwnerThumbnail
					label={ownerLabel}
					owner={workspace.owner}
					title={getOwnerTitle(workspace)}
				/>
			</button>
			<WorkspaceTabNameButton
				branch={workspace.branch}
				isActive={isActive}
				isDisabled={isBusy || isOverlay}
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
					disabled={isBusy || isOverlay}
					onClick={closeWorkspace}
					tabIndex={isActive ? 0 : -1}
					type="button"
				>
					<XIcon aria-hidden className="size-3" weight="bold" />
				</button>
			</div>
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
			rootRef={ref}
		/>
	);
}

export function WorkspaceTabOverlay(
	props: Omit<WorkspaceTabProps, "index">
): ReactElement {
	return <WorkspaceTabAppearance {...props} isDragging isOverlay />;
}
