import { cn } from "@1git/ui/lib/utils";
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers";
import { useSortable } from "@dnd-kit/react/sortable";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type {
	CSSProperties,
	MouseEvent,
	ReactElement,
	RefCallback,
} from "react";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";
import type { WorkspaceTabState } from "../../../feature/workspace/hooks/use-git-workspace.js";
import {
	getRepositoryName,
	getWorkspaceLabel,
} from "../../../feature/workspace/lib/workspace-model.js";
import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "../constants/workspace-tab.js";

interface WorkspaceTabProps {
	readonly index: number;
	readonly isActive: boolean;
	readonly isBusy: boolean;
	readonly onActivate: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onClose: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onOpenActions: (trigger: HTMLButtonElement) => void;
	readonly workspace: WorkspaceTabState;
}

interface WorkspaceTabAppearanceProps extends Omit<WorkspaceTabProps, "index"> {
	readonly handleRef?: RefCallback<Element>;
	readonly isDragging: boolean;
	readonly isOverlay?: boolean;
	readonly rootRef?: RefCallback<Element>;
}

const WORKSPACE_TAB_STYLE: CSSProperties = {
	height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabHeight,
	width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabWidth,
};

const WORKSPACE_TAB_VISUAL_STYLE: CSSProperties = {
	borderRadius: WORKSPACE_TAB_SURFACE_GEOMETRY.tabRadius,
	insetBlock: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetBlock,
	insetInline: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetInline,
};

const WORKSPACE_TAB_CONTENT_STYLE: CSSProperties = {
	columnGap: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentGap,
	paddingBlock: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentInsetBlock,
	paddingInlineStart: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentInsetInlineStart,
};

const WORKSPACE_TAB_ACTION_STYLE: CSSProperties = {
	width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabActionWidth,
};

const WORKSPACE_TAB_CLOSE_STYLE: CSSProperties = {
	height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabCloseSize,
	marginInlineEnd: WORKSPACE_TAB_SURFACE_GEOMETRY.tabTrailingInset,
	width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabCloseSize,
};

const WORKSPACE_TAB_SORT_TRANSITION = {
	duration: 180,
	easing: "cubic-bezier(0.22, 1, 0.36, 1)",
	idle: true,
} as const;

function WorkspaceTabAppearance({
	handleRef,
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
	const label = getWorkspaceLabel(
		workspace.session.repository.root,
		workspace.branch
	);
	const activateWorkspace = async (): Promise<void> => {
		await onActivate(workspace.session.id);
	};
	const closeWorkspace = async (): Promise<void> => {
		await onClose(workspace.session.id);
	};
	const openActions = (event: MouseEvent<HTMLButtonElement>): void => {
		onOpenActions(event.currentTarget);
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
			style={WORKSPACE_TAB_STYLE}
		>
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
				aria-selected={isActive}
				className="relative z-10 flex h-full min-w-0 flex-1 cursor-default touch-none items-center text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/20 active:cursor-grabbing"
				data-desktop-interactive
				disabled={isBusy || isOverlay}
				onClick={activateWorkspace}
				ref={handleRef}
				role="tab"
				style={WORKSPACE_TAB_CONTENT_STYLE}
				tabIndex={isActive ? 0 : -1}
				title={label}
				type="button"
			>
				{workspace.changedFiles ? (
					<>
						<span
							aria-hidden
							className="size-1.5 shrink-0 rounded-full bg-amber-500"
						/>
						<span className="sr-only">
							{workspace.changedFiles} changed files
						</span>
					</>
				) : (
					<span
						aria-hidden
						className="size-1.5 shrink-0 rounded-full bg-editor-hairline-strong"
					/>
				)}
				<span className="min-w-0 truncate text-xss">
					<span className={cn(isActive ? "font-semibold" : "font-medium")}>
						{getRepositoryName(workspace.session.repository.root)}
					</span>
					{workspace.branch ? (
						<span className="text-editor-faint"> / {workspace.branch}</span>
					) : null}
				</span>
			</button>
			<button
				aria-haspopup="dialog"
				aria-hidden={isActive ? undefined : true}
				aria-label={`Open actions for ${label}`}
				className={cn(
					"relative z-10 flex h-full shrink-0 items-center justify-center text-editor-faint outline-none transition-opacity hover:text-editor-ink focus-visible:text-editor-ink focus-visible:ring-2 focus-visible:ring-brand/20",
					!isActive && "pointer-events-none opacity-0"
				)}
				disabled={isBusy || isOverlay || !isActive}
				onClick={openActions}
				style={WORKSPACE_TAB_ACTION_STYLE}
				tabIndex={isActive ? undefined : -1}
				type="button"
			>
				<CaretDownIcon aria-hidden className="size-3" weight="bold" />
			</button>
			<button
				aria-label={`Close ${label}`}
				className={cn(
					"relative z-10 flex shrink-0 items-center justify-center rounded-lg text-editor-faint outline-none hover:bg-active hover:text-editor-ink focus-visible:bg-active focus-visible:ring-2 focus-visible:ring-brand/20",
					!isActive &&
						"opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
				)}
				disabled={isBusy || isOverlay}
				onClick={closeWorkspace}
				style={WORKSPACE_TAB_CLOSE_STYLE}
				tabIndex={isActive ? 0 : -1}
				type="button"
			>
				<XIcon aria-hidden className="size-3" weight="bold" />
			</button>
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
