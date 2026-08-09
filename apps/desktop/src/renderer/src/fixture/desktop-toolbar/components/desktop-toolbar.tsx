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
	ComponentProps,
	CSSProperties,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { getCommandLensNumberKey } from "@/feature/command-lens/lib/command-lens-shortcut.js";
import type {
	OpenRepositoryOptions,
	PendingWorkspaceAction,
	WorkspaceTabState,
} from "@/feature/workspace/types/git-workspace.js";
import { RepositoryMenu } from "@/fixture/desktop-toolbar/components/repository-menu.js";
import { WorkspaceActionsMenu } from "@/fixture/desktop-toolbar/components/workspace-actions-menu.js";
import { WorkspaceLiquidSurface } from "@/fixture/desktop-toolbar/components/workspace-liquid-surface.js";
import {
	WorkspaceTab,
	WorkspaceTabOverlay,
} from "@/fixture/desktop-toolbar/components/workspace-tab.js";
import {
	WORKSPACE_TAB_POINTER_DRAG_HANDLE_SELECTOR,
	WORKSPACE_TAB_REORDER_MOTION,
	WORKSPACE_TAB_SURFACE_GEOMETRY,
} from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import { updateWorkspaceMenuSurfaceSession } from "@/fixture/desktop-toolbar/lib/workspace-menu-presence.js";
import { LiquidMenuRoot } from "@/fixture/liquid-menu/components/liquid-menu.js";
import type {
	RecentRepositoryRecord,
	RepositorySessionId,
} from "../../../../../shared/repository-session.js";

interface DesktopToolbarProps {
	readonly activeSessionId: RepositorySessionId | null;
	readonly branches: BranchCollection | null;
	readonly onActivateWorkspace: (
		sessionId: RepositorySessionId
	) => Promise<void>;
	readonly onCloseWorkspace: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onForgetRecent: (path: string) => Promise<void>;
	readonly onOpenRecent: (
		path: string,
		options?: OpenRepositoryOptions
	) => Promise<void>;
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
	ComponentProps<typeof LiquidMenuRoot>["onOpenChange"]
>;

const TAB_POINTER_ACTIVATION_DISTANCE = 5;
const TAB_DRAG_SENSORS = [
	PointerSensor.configure({
		activationConstraints: [
			new PointerActivationConstraints.Distance({
				value: TAB_POINTER_ACTIVATION_DISTANCE,
			}),
		],
		// The active label swaps to a menu trigger, so bind once to the stable tab.
		activatorElements: (source) => [source.element],
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
	paddingLeft: WORKSPACE_TAB_SURFACE_GEOMETRY.tabListInset,
	paddingRight: WORKSPACE_TAB_SURFACE_GEOMETRY.tabListInset,
	paddingTop:
		WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight -
		WORKSPACE_TAB_SURFACE_GEOMETRY.tabHeight -
		WORKSPACE_TAB_SURFACE_GEOMETRY.tabLift,
};
const WORKSPACE_ACTIONS_ANCHOR_GEOMETRY = {
	insetBlock: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetBlock,
	insetInline: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetInline,
	radius: WORKSPACE_TAB_SURFACE_GEOMETRY.tabRadius,
} as const;
const getActiveWorkspaceTab = (): Element | null =>
	document.querySelector(
		'[data-name="WorkspaceTab"][data-active="true"]:not([data-overlay="true"])'
	);

export function DesktopToolbar({
	activeSessionId,
	branches,
	onActivateWorkspace,
	onCloseWorkspace,
	onCreateBranch,
	onFetch,
	onForgetRecent,
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
	const [workspaceMenuSurfaceSessionId, setWorkspaceMenuSurfaceSessionId] =
		useState<RepositorySessionId | null>(null);
	const [draggingSessionId, setDraggingSessionId] =
		useState<RepositorySessionId | null>(null);
	const [droppingSessionId, setDroppingSessionId] =
		useState<RepositorySessionId | null>(null);
	const tabListRef = useRef<HTMLDivElement>(null);
	const currentBranch = snapshot?.head.branch ?? "";
	const workspaceIds = workspaces.map((workspace) => workspace.session.id);
	const activeTabIndex =
		activeSessionId === null ? -1 : workspaceIds.indexOf(activeSessionId);
	const isActiveTabDragging =
		activeSessionId !== null && draggingSessionId === activeSessionId;
	const isWorkspaceTabPositionTracking =
		draggingSessionId !== null || droppingSessionId !== null;
	const isWorkspaceMenuSurfacePresent =
		activeSessionId !== null &&
		workspaceMenuSurfaceSessionId === activeSessionId;
	const isWorkspaceMenuVisualOpen =
		isWorkspaceMenuOpen || isWorkspaceMenuSurfacePresent;
	const hasOpenWorkspaces = workspaces.length > 0;
	const getWorkspaceTabList = useCallback(
		(): Element | null => tabListRef.current,
		[]
	);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				if (!hasOpenWorkspaces) {
					return;
				}
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
	}, [hasOpenWorkspaces]);

	useEffect(() => {
		if (!hasOpenWorkspaces) {
			setIsRepositoryMenuOpen(false);
		}
	}, [hasOpenWorkspaces]);

	useLayoutEffect(() => {
		const tabList = tabListRef.current;
		if (!tabList) {
			return;
		}
		const updateEdgeMasks = (): void => {
			const maxScrollLeft = tabList.scrollWidth - tabList.clientWidth;
			tabList.dataset.overflowLeading =
				tabList.scrollLeft > 1 ? "true" : "false";
			tabList.dataset.overflowTrailing =
				tabList.scrollLeft < maxScrollLeft - 1 ? "true" : "false";
		};
		const mutationObserver = new MutationObserver(updateEdgeMasks);
		const resizeObserver = new ResizeObserver(updateEdgeMasks);
		mutationObserver.observe(tabList, { childList: true });
		resizeObserver.observe(tabList);
		tabList.addEventListener("scroll", updateEdgeMasks, { passive: true });
		updateEdgeMasks();
		return () => {
			mutationObserver.disconnect();
			resizeObserver.disconnect();
			tabList.removeEventListener("scroll", updateEdgeMasks);
		};
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
	const changeWorkspaceDropState = useCallback(
		(sessionId: RepositorySessionId, isDropping: boolean): void => {
			setDroppingSessionId((currentSessionId) => {
				if (isDropping) {
					return sessionId;
				}
				return currentSessionId === sessionId ? null : currentSessionId;
			});
		},
		[]
	);
	const changeWorkspaceMenuSurfacePresence = useCallback(
		(sessionId: RepositorySessionId, isPresent: boolean): void => {
			setWorkspaceMenuSurfaceSessionId((currentSessionId) =>
				updateWorkspaceMenuSurfaceSession(
					currentSessionId,
					sessionId,
					isPresent
				)
			);
		},
		[]
	);
	const startWorkspaceDrag = ({ operation }: DragStartEvent): void => {
		setIsRepositoryMenuOpen(false);
		setIsWorkspaceMenuOpen(false);
		setDroppingSessionId(null);
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
	const activateRelativeWorkspace = async (offset: -1 | 1): Promise<void> => {
		if (activeTabIndex < 0 || workspaces.length === 0) {
			return;
		}
		const nextIndex =
			(activeTabIndex + offset + workspaces.length) % workspaces.length;
		const nextWorkspace = workspaces[nextIndex];
		if (nextWorkspace) {
			await onActivateWorkspace(nextWorkspace.session.id);
		}
	};
	const activatePreviousWorkspace = (): Promise<void> =>
		activateRelativeWorkspace(-1);
	const activateNextWorkspace = (): Promise<void> =>
		activateRelativeWorkspace(1);

	return (
		<header
			className="relative z-40 shrink-0 border-editor-hairline border-b bg-transparent"
			data-name="DesktopToolbar"
			style={DESKTOP_TOOLBAR_STYLE}
		>
			<div
				className="flex h-full min-w-0"
				data-desktop-drag
				data-name="DesktopTitlebarLayout"
			>
				<div
					className="relative flex h-full min-w-0 flex-1 items-stretch pl-(--desktop-titlebar-controls-width)"
					data-active-tab-dragging={isActiveTabDragging ? "true" : undefined}
					data-name="WorkspaceTitlebar"
				>
					<WorkspaceLiquidSurface
						activeSessionId={activeSessionId}
						activeTabIndex={activeTabIndex}
						isPositionTracking={isWorkspaceTabPositionTracking}
					/>
					<RepositoryMenu
						isOpen={isRepositoryMenuOpen}
						isVisible={hasOpenWorkspaces}
						onForgetRecent={onForgetRecent}
						onOpenChange={setRepositoryMenuOpen}
						onOpenRecent={onOpenRecent}
						onPickRepository={onPickRepository}
						pendingAction={pendingAction}
						recentRepositories={recentRepositories}
						workspaces={workspaces}
					/>
					<div className="relative z-[2] min-w-0 flex-1">
						<DragDropProvider
							onDragEnd={finishWorkspaceDrag}
							onDragStart={startWorkspaceDrag}
							sensors={TAB_DRAG_SENSORS}
						>
							<div
								aria-label="Open repository workspaces"
								aria-orientation="horizontal"
								className="workspace-tab-edge-mask flex min-w-0 flex-1 items-start overflow-x-auto overflow-y-hidden"
								data-dragging={draggingSessionId ? "true" : undefined}
								data-name="WorkspaceTabList"
								onKeyDown={navigateWorkspaceTabs}
								ref={tabListRef}
								role="tablist"
								style={WORKSPACE_TAB_LIST_STYLE}
							>
								{workspaces.map((workspace, index) => {
									const isActive = workspace.session.id === activeSessionId;
									const changeSurfacePresence = (isPresent: boolean): void => {
										changeWorkspaceMenuSurfacePresence(
											workspace.session.id,
											isPresent
										);
									};
									return (
										<LiquidMenuRoot
											anchor={getActiveWorkspaceTab}
											anchorClip={getWorkspaceTabList}
											anchorGeometry={WORKSPACE_ACTIONS_ANCHOR_GEOMETRY}
											disabled={!isActive}
											key={workspace.session.id}
											modal
											onOpenChange={changeWorkspaceMenu}
											onPresenceChange={changeSurfacePresence}
											open={isActive && isWorkspaceMenuOpen}
											outlineWidth={WORKSPACE_TAB_SURFACE_GEOMETRY.outlineWidth}
										>
											<WorkspaceTab
												index={index}
												isActionsMenuOpen={
													isActive && isWorkspaceMenuVisualOpen
												}
												isActive={isActive}
												isBusy={pendingAction === "workspace"}
												onActivate={onActivateWorkspace}
												onActivateNext={activateNextWorkspace}
												onActivatePrevious={activatePreviousWorkspace}
												onClose={onCloseWorkspace}
												onDropStateChange={changeWorkspaceDropState}
												onOpenActions={toggleWorkspaceMenu}
												shortcutKey={getCommandLensNumberKey(
													index,
													workspaces.length
												)}
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
										</LiquidMenuRoot>
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
											onActivateNext={activateNextWorkspace}
											onActivatePrevious={activatePreviousWorkspace}
											onClose={onCloseWorkspace}
											onOpenActions={toggleWorkspaceMenu}
											shortcutKey={null}
											workspace={workspace}
										/>
									) : null;
								}}
							</DragOverlay>
						</DragDropProvider>
					</div>
				</div>
			</div>
		</header>
	);
}
