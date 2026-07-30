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
import type { RepositorySessionId } from "../../shared/repository-session.js";
import type { WorkspaceTabState } from "./use-git-workspace.js";
import { getRepositoryName, getWorkspaceLabel } from "./workspace-model.js";

interface WorkspaceTabProps {
	readonly index: number;
	readonly isActive: boolean;
	readonly isBusy: boolean;
	readonly onActivate: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onClose: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onOpenActions: (left: number) => void;
	readonly workspace: WorkspaceTabState;
}

interface WorkspaceTabAppearanceProps extends Omit<WorkspaceTabProps, "index"> {
	readonly handleRef?: RefCallback<Element>;
	readonly isDragging: boolean;
	readonly isOverlay?: boolean;
	readonly rootRef?: RefCallback<Element>;
}

/** Adjust the active tab and SVG shoulder geometry from this single object. */
export const WORKSPACE_TAB_SURFACE_GEOMETRY = {
	containerOverlap: 1,
	outlineWidth: 1,
	shoulderHeight: 16,
	shoulderRoundness: 1,
	shoulderWidth: 16,
	tabHeight: 40,
	tabWidth: 210,
	toolbarHeight: 46,
	topCornerRadius: 12,
} as const;

const createWorkspaceTabSurface = () => {
	const {
		containerOverlap,
		shoulderHeight,
		shoulderRoundness,
		shoulderWidth,
		tabHeight,
		tabWidth,
		topCornerRadius,
	} = WORKSPACE_TAB_SURFACE_GEOMETRY;
	const leftTabEdge = shoulderWidth;
	const rightTabEdge = tabWidth - shoulderWidth;
	const shoulderTop = tabHeight - shoulderHeight;
	const shoulderBottom = tabHeight;
	const surfaceWidth = tabWidth;
	const surfaceHeight = tabHeight + containerOverlap;
	const shoulderControlX = shoulderWidth * shoulderRoundness;
	const shoulderControlY = shoulderHeight * shoulderRoundness;
	const leftTopCornerEnd = leftTabEdge + topCornerRadius;
	const rightTopCornerStart = rightTabEdge - topCornerRadius;
	const outlinePath = [
		`M 0 ${shoulderBottom}`,
		`C ${shoulderControlX} ${shoulderBottom} ${leftTabEdge} ${shoulderTop + shoulderControlY} ${leftTabEdge} ${shoulderTop}`,
		`V ${topCornerRadius}`,
		`Q ${leftTabEdge} 0 ${leftTopCornerEnd} 0`,
		`H ${rightTopCornerStart}`,
		`Q ${rightTabEdge} 0 ${rightTabEdge} ${topCornerRadius}`,
		`V ${shoulderTop}`,
		`C ${rightTabEdge} ${shoulderTop + shoulderControlY} ${surfaceWidth - shoulderControlX} ${shoulderBottom} ${surfaceWidth} ${shoulderBottom}`,
	].join(" ");

	return {
		fillPath: `${outlinePath} V ${surfaceHeight} H 0 Z`,
		outlinePath,
		surfaceHeight,
		surfaceWidth,
		viewBox: `0 0 ${surfaceWidth} ${surfaceHeight}`,
	};
};

const WORKSPACE_TAB_SURFACE = createWorkspaceTabSurface();
const WORKSPACE_TAB_SURFACE_STYLE: CSSProperties = {
	height: WORKSPACE_TAB_SURFACE.surfaceHeight,
	left: 0,
	width: WORKSPACE_TAB_SURFACE.surfaceWidth,
};

const WORKSPACE_TAB_SORT_TRANSITION = {
	duration: 180,
	easing: "cubic-bezier(0.22, 1, 0.36, 1)",
	idle: true,
} as const;

const WorkspaceTabAppearance = ({
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
}: WorkspaceTabAppearanceProps): ReactElement => {
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
		onOpenActions(event.currentTarget.getBoundingClientRect().left);
	};
	const tabStyle: CSSProperties = {
		height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabHeight,
		paddingInline: WORKSPACE_TAB_SURFACE_GEOMETRY.shoulderWidth,
		width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabWidth,
	};

	return (
		<div
			aria-hidden={isOverlay || undefined}
			className={`group relative flex shrink-0 items-center transition-[background-color,color] ${isActive ? "text-editor-ink" : "rounded-xl text-editor-muted hover:bg-hover hover:text-editor-ink"}`}
			data-active={isActive ? "true" : undefined}
			data-desktop-interactive
			data-dragging={isDragging ? "true" : undefined}
			data-name="WorkspaceTab"
			data-overlay={isOverlay ? "true" : undefined}
			data-workspace-session-id={workspace.session.id}
			ref={rootRef}
			style={tabStyle}
		>
			<button
				aria-controls="repository-workspace"
				aria-selected={isActive}
				className="relative z-10 flex h-full min-w-0 flex-1 cursor-default touch-none items-center gap-2 py-2 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/20 active:cursor-grabbing"
				data-desktop-interactive
				disabled={isBusy || isOverlay}
				onClick={activateWorkspace}
				ref={handleRef}
				role="tab"
				title={label}
				type="button"
			>
				{workspace.changedFiles ? (
					<>
						<span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
						<span className="sr-only">
							{workspace.changedFiles} changed files
						</span>
					</>
				) : (
					<span className="size-1.5 shrink-0 rounded-full bg-editor-hairline-strong" />
				)}
				<span className="min-w-0 truncate text-xss">
					<span className={isActive ? "font-semibold" : "font-medium"}>
						{getRepositoryName(workspace.session.repository.root)}
					</span>
					{workspace.branch ? (
						<span className="text-editor-faint"> / {workspace.branch}</span>
					) : null}
				</span>
			</button>
			{isActive ? (
				<button
					aria-haspopup="menu"
					aria-label={`Open actions for ${label}`}
					className="relative z-10 flex h-full w-7 items-center justify-center text-editor-faint outline-none hover:text-editor-ink focus-visible:text-editor-ink"
					disabled={isBusy || isOverlay}
					onClick={openActions}
					type="button"
				>
					<CaretDownIcon aria-hidden className="size-3" weight="bold" />
				</button>
			) : null}
			<button
				aria-label={`Close ${label}`}
				className={`relative z-10 mr-1 flex size-6 shrink-0 items-center justify-center rounded-lg text-editor-faint outline-none hover:bg-active hover:text-editor-ink focus-visible:bg-active ${isActive ? "" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"}`}
				disabled={isBusy || isOverlay}
				onClick={closeWorkspace}
				type="button"
			>
				<XIcon aria-hidden className="size-3" weight="bold" />
			</button>
			{isActive ? (
				<svg
					aria-hidden
					data-name="WorkspaceTabSurface"
					preserveAspectRatio="none"
					style={WORKSPACE_TAB_SURFACE_STYLE}
					viewBox={WORKSPACE_TAB_SURFACE.viewBox}
				>
					<title>Active workspace surface</title>
					<path
						d={WORKSPACE_TAB_SURFACE.fillPath}
						data-name="WorkspaceTabSurfaceFill"
					/>
					<path
						d={WORKSPACE_TAB_SURFACE.outlinePath}
						data-name="WorkspaceTabSurfaceOutline"
						fill="none"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={WORKSPACE_TAB_SURFACE_GEOMETRY.outlineWidth}
						vectorEffect="non-scaling-stroke"
					/>
				</svg>
			) : null}
		</div>
	);
};

export const WorkspaceTab = ({
	index,
	...appearanceProps
}: WorkspaceTabProps): ReactElement => {
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
};

export const WorkspaceTabOverlay = (
	props: Omit<WorkspaceTabProps, "index">
): ReactElement => <WorkspaceTabAppearance {...props} isDragging isOverlay />;
