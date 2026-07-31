import type { BranchCollection, RepositorySnapshot } from "@1git/git";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { move } from "@dnd-kit/helpers";
import {
	DragDropProvider,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
} from "@dnd-kit/react";
import type {
	CSSProperties,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useEffect, useRef, useState } from "react";
import type {
	RecentRepositoryRecord,
	RepositorySessionId,
} from "../../../../../shared/repository-session.js";
import type {
	PendingWorkspaceAction,
	WorkspaceTabState,
} from "../../../feature/workspace/hooks/use-git-workspace.js";
import {
	WORKSPACE_TAB_POINTER_DRAG_HANDLE_SELECTOR,
	WORKSPACE_TAB_SURFACE_GEOMETRY,
} from "../constants/workspace-tab.js";
import { RepositoryMenu } from "./repository-menu.js";
import { WorkspaceActionsMenu } from "./workspace-actions-menu.js";
import { WorkspaceLiquidSurface } from "./workspace-liquid-surface.js";
import { WorkspaceTab, WorkspaceTabOverlay } from "./workspace-tab.js";

interface DesktopToolbarProps {
	readonly activeSessionId: RepositorySessionId | null;
	readonly branches: BranchCollection | null;
	readonly onActivateWorkspace: (
		sessionId: RepositorySessionId
	) => Promise<void>;
	readonly onCloseWorkspace: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onOpenRecent: (path: string) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly onReorderWorkspace: (
		activeSessionId: RepositorySessionId,
		overSessionId: RepositorySessionId
	) => void;
	readonly onSwitchBranch: (name: string) => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
	readonly snapshot: RepositorySnapshot | null;
	readonly workspaces: readonly WorkspaceTabState[];
}

const WORKSPACE_MENU_WIDTH = 310;
const WINDOW_EDGE_GAP = 12;
const TAB_POINTER_ACTIVATION_DISTANCE = 5;
const TAB_DRAG_SENSORS = [
	PointerSensor.configure({
		activationConstraints: [
			new PointerActivationConstraints.Distance({
				value: TAB_POINTER_ACTIVATION_DISTANCE,
			}),
		],
		activatorElements: (source) =>
			source.element
				? Array.from(
						source.element.querySelectorAll(
							WORKSPACE_TAB_POINTER_DRAG_HANDLE_SELECTOR
						)
					)
				: [],
		preventActivation: (event, source) => {
			if (!(event.target instanceof Element)) {
				return true;
			}
			const pointerDragHandle = event.target.closest(
				WORKSPACE_TAB_POINTER_DRAG_HANDLE_SELECTOR
			);
			return !(
				pointerDragHandle && source.element?.contains(pointerDragHandle)
			);
		},
	}),
	KeyboardSensor,
];
const TAB_DROP_ANIMATION = {
	duration: 240,
	easing: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const;
const TAB_OVERLAY_STYLE: CSSProperties = {
	pointerEvents: "none",
};
const DESKTOP_TOOLBAR_STYLE: CSSProperties = {
	height: WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight,
};
const WORKSPACE_TAB_LIST_STYLE: CSSProperties = {
	columnGap: WORKSPACE_TAB_SURFACE_GEOMETRY.tabGap,
	height:
		WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight +
		WORKSPACE_TAB_SURFACE_GEOMETRY.containerOverlap,
	paddingInline: WORKSPACE_TAB_SURFACE_GEOMETRY.tabListInset,
	paddingTop:
		WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight -
		WORKSPACE_TAB_SURFACE_GEOMETRY.tabHeight -
		WORKSPACE_TAB_SURFACE_GEOMETRY.tabLift,
};

export function DesktopToolbar({
	activeSessionId,
	branches,
	onActivateWorkspace,
	onCloseWorkspace,
	onCreateBranch,
	onFetch,
	onOpenRecent,
	onPickRepository,
	onReorderWorkspace,
	onSwitchBranch,
	pendingAction,
	recentRepositories,
	snapshot,
	workspaces,
}: DesktopToolbarProps): ReactElement {
	const [isRepositoryMenuOpen, setIsRepositoryMenuOpen] = useState(false);
	const [workspaceMenuLeft, setWorkspaceMenuLeft] = useState<number | null>(
		null
	);
	const [draggingSessionId, setDraggingSessionId] =
		useState<RepositorySessionId | null>(null);
	const workspaceMenuTriggerRef = useRef<HTMLButtonElement>(null);
	const currentBranch = snapshot?.head.branch ?? "";
	const workspaceIds = workspaces.map((workspace) => workspace.session.id);
	const isActiveTabDragging =
		activeSessionId !== null && draggingSessionId === activeSessionId;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setWorkspaceMenuLeft(null);
				setIsRepositoryMenuOpen(true);
				return;
			}
			if (event.key === "Escape") {
				setIsRepositoryMenuOpen(false);
				if (workspaceMenuLeft !== null) {
					workspaceMenuTriggerRef.current?.focus();
				}
				setWorkspaceMenuLeft(null);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [workspaceMenuLeft]);

	const setRepositoryMenuOpen = (isOpen: boolean): void => {
		setWorkspaceMenuLeft(null);
		setIsRepositoryMenuOpen(isOpen);
	};
	const openWorkspaceMenu = (trigger: HTMLButtonElement): void => {
		setIsRepositoryMenuOpen(false);
		workspaceMenuTriggerRef.current = trigger;
		const { left } = trigger.getBoundingClientRect();
		setWorkspaceMenuLeft(
			Math.max(
				WINDOW_EDGE_GAP,
				Math.min(
					left,
					window.innerWidth - WORKSPACE_MENU_WIDTH - WINDOW_EDGE_GAP
				)
			)
		);
	};
	const closeWorkspaceMenu = (): void => {
		setWorkspaceMenuLeft(null);
		workspaceMenuTriggerRef.current?.focus();
	};
	const startWorkspaceDrag = ({ operation }: DragStartEvent): void => {
		setIsRepositoryMenuOpen(false);
		setWorkspaceMenuLeft(null);
		setDraggingSessionId(operation.source ? String(operation.source.id) : null);
	};
	const finishWorkspaceDrag = (event: DragEndEvent): void => {
		setDraggingSessionId(null);
		const { source } = event.operation;
		if (event.canceled || !source) {
			return;
		}
		const sourceSessionId = String(source.id);
		const initialIndex = workspaceIds.indexOf(sourceSessionId);
		const reorderedWorkspaceIds = move([...workspaceIds], event);
		const nextIndex = reorderedWorkspaceIds.indexOf(sourceSessionId);
		const overSessionId = workspaceIds[nextIndex];
		if (
			initialIndex === nextIndex ||
			initialIndex < 0 ||
			nextIndex < 0 ||
			!overSessionId
		) {
			return;
		}
		onReorderWorkspace(sourceSessionId, overSessionId);
	};
	const navigateWorkspaceTabs = (
		event: ReactKeyboardEvent<HTMLDivElement>
	): void => {
		if (draggingSessionId) {
			return;
		}
		const focusedTab = document.activeElement;
		if (
			!(focusedTab instanceof HTMLButtonElement) ||
			focusedTab.getAttribute("role") !== "tab"
		) {
			return;
		}
		const tabs = Array.from(
			event.currentTarget.querySelectorAll<HTMLButtonElement>(
				'button[role="tab"]:not(:disabled)'
			)
		);
		const focusedIndex = tabs.indexOf(focusedTab);
		if (focusedIndex < 0 || tabs.length === 0) {
			return;
		}

		let nextIndex: number | null = null;
		if (event.key === "Home") {
			nextIndex = 0;
		} else if (event.key === "End") {
			nextIndex = tabs.length - 1;
		} else if (event.key === "ArrowLeft") {
			nextIndex = (focusedIndex - 1 + tabs.length) % tabs.length;
		} else if (event.key === "ArrowRight") {
			nextIndex = (focusedIndex + 1) % tabs.length;
		}
		if (nextIndex === null) {
			return;
		}

		event.preventDefault();
		const nextTab = tabs[nextIndex];
		nextTab?.focus();
		nextTab?.click();
	};

	return (
		<header
			className="relative z-40 shrink-0 border-editor-hairline border-b bg-transparent"
			data-name="DesktopToolbar"
			style={DESKTOP_TOOLBAR_STYLE}
		>
			<div
				className="relative flex h-full min-w-0 items-stretch pl-(--desktop-titlebar-controls-width)"
				data-active-tab-dragging={isActiveTabDragging ? "true" : undefined}
				data-desktop-drag
				data-name="WorkspaceTitlebar"
			>
				<WorkspaceLiquidSurface
					activeSessionId={activeSessionId}
					isDragging={Boolean(draggingSessionId)}
				/>
				<RepositoryMenu
					activeSessionId={activeSessionId}
					isOpen={isRepositoryMenuOpen}
					onActivateWorkspace={onActivateWorkspace}
					onOpenChange={setRepositoryMenuOpen}
					onOpenRecent={onOpenRecent}
					onPickRepository={onPickRepository}
					pendingAction={pendingAction}
					recentRepositories={recentRepositories}
					workspaces={workspaces}
				/>
				<DragDropProvider
					onDragEnd={finishWorkspaceDrag}
					onDragStart={startWorkspaceDrag}
					sensors={TAB_DRAG_SENSORS}
				>
					<div
						aria-label="Open repository workspaces"
						aria-orientation="horizontal"
						className="flex min-w-0 flex-1 items-start overflow-x-auto overflow-y-hidden"
						data-dragging={draggingSessionId ? "true" : undefined}
						data-name="WorkspaceTabList"
						onKeyDown={navigateWorkspaceTabs}
						role="tablist"
						style={WORKSPACE_TAB_LIST_STYLE}
					>
						{workspaces.map((workspace, index) => (
							<WorkspaceTab
								index={index}
								isActionsMenuOpen={
									workspace.session.id === activeSessionId &&
									workspaceMenuLeft !== null
								}
								isActive={workspace.session.id === activeSessionId}
								isBusy={pendingAction === "workspace"}
								key={workspace.session.id}
								onActivate={onActivateWorkspace}
								onClose={onCloseWorkspace}
								onOpenActions={openWorkspaceMenu}
								workspace={workspace}
							/>
						))}
						{workspaces.length === 0 ? (
							<span
								className="px-2 pt-2 text-editor-faint text-xss"
								role="status"
							>
								Open a repository to begin
							</span>
						) : null}
					</div>
					<DragOverlay
						dropAnimation={TAB_DROP_ANIMATION}
						style={TAB_OVERLAY_STYLE}
					>
						{(source) => {
							const workspace = workspaces.find(
								(candidate) => candidate.session.id === String(source.id)
							);
							return workspace ? (
								<WorkspaceTabOverlay
									isActionsMenuOpen={false}
									isActive={workspace.session.id === activeSessionId}
									isBusy={pendingAction === "workspace"}
									onActivate={onActivateWorkspace}
									onClose={onCloseWorkspace}
									onOpenActions={openWorkspaceMenu}
									workspace={workspace}
								/>
							) : null;
						}}
					</DragOverlay>
				</DragDropProvider>
			</div>

			{workspaceMenuLeft === null ? null : (
				<WorkspaceActionsMenu
					branches={branches}
					currentBranch={currentBranch}
					left={workspaceMenuLeft}
					onClose={closeWorkspaceMenu}
					onCreateBranch={onCreateBranch}
					onFetch={onFetch}
					onSwitchBranch={onSwitchBranch}
					pendingAction={pendingAction}
				/>
			)}
		</header>
	);
}
