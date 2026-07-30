import type { BranchCollection, RepositorySnapshot } from "@1git/git";
import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
	horizontalListSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import type {
	RecentRepositoryRecord,
	RepositorySessionId,
} from "../../shared/repository-session.js";
import { RepositoryMenu } from "./repository-menu.js";
import type {
	PendingWorkspaceAction,
	WorkspaceTabState,
} from "./use-git-workspace.js";
import { WorkspaceActionsMenu } from "./workspace-actions-menu.js";
import { WorkspaceTab } from "./workspace-tab.js";

export interface DesktopToolbarProps {
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
const TAB_DRAG_MODIFIERS = [restrictToHorizontalAxis];

export const DesktopToolbar = ({
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
}: DesktopToolbarProps): ReactElement => {
	const [isRepositoryMenuOpen, setIsRepositoryMenuOpen] = useState(false);
	const [workspaceMenuLeft, setWorkspaceMenuLeft] = useState<number | null>(
		null
	);
	const [draggingSessionId, setDraggingSessionId] =
		useState<RepositorySessionId | null>(null);
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: TAB_POINTER_ACTIVATION_DISTANCE },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		})
	);
	const currentBranch = snapshot?.head.branch ?? "";
	const workspaceIds = workspaces.map((workspace) => workspace.session.id);

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
				setWorkspaceMenuLeft(null);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const setRepositoryMenuOpen = (isOpen: boolean): void => {
		setWorkspaceMenuLeft(null);
		setIsRepositoryMenuOpen(isOpen);
	};
	const openWorkspaceMenu = (left: number): void => {
		setIsRepositoryMenuOpen(false);
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
	const closeWorkspaceMenu = (): void => setWorkspaceMenuLeft(null);
	const startWorkspaceDrag = (event: DragStartEvent): void => {
		setIsRepositoryMenuOpen(false);
		setWorkspaceMenuLeft(null);
		setDraggingSessionId(String(event.active.id));
	};
	const finishWorkspaceDrag = ({ active, over }: DragEndEvent): void => {
		setDraggingSessionId(null);
		if (!over || active.id === over.id) {
			return;
		}
		onReorderWorkspace(String(active.id), String(over.id));
	};
	const cancelWorkspaceDrag = (): void => setDraggingSessionId(null);

	return (
		<header
			className="relative z-40 h-11.5 shrink-0 border-editor-hairline border-b bg-transparent"
			data-name="DesktopToolbar"
		>
			<div
				className="relative flex h-full min-w-0 items-stretch pl-(--desktop-titlebar-controls-width)"
				data-desktop-drag
				data-name="WorkspaceTitlebar"
			>
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
				<DndContext
					collisionDetection={closestCenter}
					modifiers={TAB_DRAG_MODIFIERS}
					onDragCancel={cancelWorkspaceDrag}
					onDragEnd={finishWorkspaceDrag}
					onDragStart={startWorkspaceDrag}
					sensors={sensors}
				>
					<SortableContext
						items={workspaceIds}
						strategy={horizontalListSortingStrategy}
					>
						<div
							aria-label="Open repository workspaces"
							className="flex h-[calc(100%+var(--workspace-tab-bridge-height))] min-w-0 flex-1 items-start gap-1 overflow-x-auto overflow-y-hidden pt-1.5"
							data-dragging={draggingSessionId ? "true" : undefined}
							data-name="WorkspaceTabList"
							role="tablist"
						>
							{workspaces.map((workspace) => (
								<WorkspaceTab
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
								<span className="px-2 pt-2 text-editor-faint text-xss">
									Open a repository to begin
								</span>
							) : null}
						</div>
					</SortableContext>
				</DndContext>
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
};
