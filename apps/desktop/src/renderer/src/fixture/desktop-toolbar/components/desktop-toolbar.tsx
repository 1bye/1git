import type { BranchCollection, RepositorySnapshot } from "@1git/git";
import { DropdownMenu } from "@1git/ui/components/dropdown-menu";
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
	ComponentProps,
	CSSProperties,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useEffect, useState } from "react";
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
	WORKSPACE_TAB_REORDER_MOTION,
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

type WorkspaceMenuOpenChange = NonNullable<
	ComponentProps<typeof DropdownMenu>["onOpenChange"]
>;

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
const TAB_DROP_ANIMATION = WORKSPACE_TAB_REORDER_MOTION;
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
	const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
	const [draggingSessionId, setDraggingSessionId] =
		useState<RepositorySessionId | null>(null);
	const currentBranch = snapshot?.head.branch ?? "";
	const workspaceIds = workspaces.map((workspace) => workspace.session.id);
	const activeTabIndex =
		activeSessionId === null ? -1 : workspaceIds.indexOf(activeSessionId);
	const isActiveTabDragging =
		activeSessionId !== null && draggingSessionId === activeSessionId;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setIsWorkspaceMenuOpen(false);
				setIsRepositoryMenuOpen(true);
				return;
			}
			if (event.key === "Escape") {
				setIsRepositoryMenuOpen(false);
				setIsWorkspaceMenuOpen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const setRepositoryMenuOpen = (isOpen: boolean): void => {
		if (isOpen) {
			setIsWorkspaceMenuOpen(false);
		}
		setIsRepositoryMenuOpen(isOpen);
	};
	const changeWorkspaceMenu: WorkspaceMenuOpenChange = (
		isOpen,
		eventDetails
	): void => {
		const isMouseDownTrigger =
			eventDetails.reason === "trigger-press" &&
			eventDetails.event.type === "mousedown";
		if (isMouseDownTrigger) {
			eventDetails.cancel();
			return;
		}
		if (isOpen) {
			setIsRepositoryMenuOpen(false);
		}
		setIsWorkspaceMenuOpen(isOpen);
	};
	const toggleWorkspaceMenu = (): void => {
		const nextIsOpen = !isWorkspaceMenuOpen;
		if (nextIsOpen) {
			setIsRepositoryMenuOpen(false);
		}
		setIsWorkspaceMenuOpen(nextIsOpen);
	};
	const closeWorkspaceMenu = (): void => {
		setIsWorkspaceMenuOpen(false);
	};
	const startWorkspaceDrag = ({ operation }: DragStartEvent): void => {
		setIsRepositoryMenuOpen(false);
		setIsWorkspaceMenuOpen(false);
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
					activeTabIndex={activeTabIndex}
					isDragging={Boolean(draggingSessionId)}
				/>
				{isWorkspaceMenuOpen && activeTabIndex >= 0 ? (
					<div
						aria-hidden
						className="pointer-events-none fixed inset-0 z-[3] bg-black/20"
						data-name="WorkspaceActionsBackdrop"
					/>
				) : null}
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
						{workspaces.map((workspace, index) => {
							const isActive = workspace.session.id === activeSessionId;
							return (
								<DropdownMenu
									disabled={!isActive}
									key={workspace.session.id}
									modal
									onOpenChange={changeWorkspaceMenu}
									open={isActive && isWorkspaceMenuOpen}
								>
									<WorkspaceTab
										index={index}
										isActionsMenuOpen={isActive && isWorkspaceMenuOpen}
										isActive={isActive}
										isBusy={pendingAction === "workspace"}
										onActivate={onActivateWorkspace}
										onClose={onCloseWorkspace}
										onOpenActions={toggleWorkspaceMenu}
										workspace={workspace}
									/>
									{isActive && isWorkspaceMenuOpen ? (
										<WorkspaceActionsMenu
											branches={branches}
											currentBranch={currentBranch}
											onClose={closeWorkspaceMenu}
											onCreateBranch={onCreateBranch}
											onFetch={onFetch}
											onSwitchBranch={onSwitchBranch}
											pendingAction={pendingAction}
										/>
									) : null}
								</DropdownMenu>
							);
						})}
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
									onOpenActions={toggleWorkspaceMenu}
									workspace={workspace}
								/>
							) : null;
						}}
					</DragOverlay>
				</DragDropProvider>
			</div>
		</header>
	);
}
