import type { BranchCollection, RepositorySnapshot } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { RobotIcon } from "@phosphor-icons/react/dist/csr/Robot";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
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
import { formatRelativeTime } from "./workspace-model.js";
import { WorkspaceTab } from "./workspace-tab.js";

export interface DesktopToolbarProps {
	readonly activeSessionId: RepositorySessionId | null;
	readonly branches: BranchCollection | null;
	readonly lastFetchedAt: string | null;
	readonly onActivateWorkspace: (
		sessionId: RepositorySessionId
	) => Promise<void>;
	readonly onCloseWorkspace: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onOpenRecent: (path: string) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly onSwitchBranch: (name: string) => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
	readonly snapshot: RepositorySnapshot | null;
	readonly workspaces: readonly WorkspaceTabState[];
}

const WORKSPACE_MENU_WIDTH = 310;
const WINDOW_EDGE_GAP = 12;

export const DesktopToolbar = ({
	activeSessionId,
	branches,
	lastFetchedAt,
	onActivateWorkspace,
	onCloseWorkspace,
	onCreateBranch,
	onFetch,
	onOpenRecent,
	onPickRepository,
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
	const hasActiveSession = activeSessionId !== null;
	const currentBranch = snapshot?.head.branch ?? "";
	const upstreamRemote = snapshot?.head.upstream?.split("/")[0] ?? "origin";
	let fetchDescription = `Fetch ${upstreamRemote}`;
	if (snapshot?.head.upstream) {
		fetchDescription = `${snapshot.head.behind} behind · ${snapshot.head.ahead} ahead`;
	}
	if (lastFetchedAt) {
		fetchDescription = `Fetched ${formatRelativeTime(lastFetchedAt)}`;
	}

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
	const openRepositoryMenu = (): void => {
		setWorkspaceMenuLeft(null);
		setIsRepositoryMenuOpen(true);
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
	const fetchRepository = async (): Promise<void> => {
		await onFetch();
	};

	return (
		<header
			className="relative z-40 h-[76px] shrink-0 border-editor-hairline border-b bg-studio-glass backdrop-blur-2xl"
			data-name="DesktopToolbar"
		>
			<div
				aria-hidden
				className="absolute inset-x-0 top-0 h-10"
				data-desktop-drag
			/>

			<div
				aria-label="Open repository workspaces"
				className="relative flex h-10 min-w-0 items-center gap-1 overflow-x-auto pr-2 pl-(--desktop-titlebar-controls-width)"
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
					<span className="px-2 text-editor-faint text-xss">
						Open a repository to begin
					</span>
				) : null}
			</div>

			<div
				className="relative flex h-9 items-stretch border-editor-hairline border-t"
				data-name="WorkspaceCommandBar"
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
				<div aria-hidden className="h-full min-w-8 flex-1" data-desktop-drag />
				<div
					className="flex shrink-0 items-center gap-1 border-editor-hairline border-l px-2"
					data-name="WorkspaceToolbarActions"
				>
					<Button
						aria-label="Find a repository or worktree"
						className="h-8 gap-2 px-2.5 text-xss"
						data-name="WorkspaceSearchButton"
						onClick={openRepositoryMenu}
						size="sm"
						title="Find a repository or worktree (Command K)"
						variant="ghost"
					>
						<MagnifyingGlassIcon
							aria-hidden
							className="size-3.5"
							weight="regular"
						/>
						<kbd className="text-[10px] text-editor-faint">⌘K</kbd>
					</Button>
					<Button
						aria-label={fetchDescription}
						className="relative"
						data-name="SyncButton"
						disabled={!hasActiveSession || pendingAction !== null}
						onClick={fetchRepository}
						size="icon-sm"
						title={fetchDescription}
						variant="ghost"
					>
						{pendingAction === "fetch" ? (
							<SpinnerGapIcon
								aria-hidden
								className="size-4 animate-spin"
								weight="bold"
							/>
						) : (
							<ArrowsClockwiseIcon
								aria-hidden
								className="size-4"
								weight="regular"
							/>
						)}
						{snapshot?.head.behind ? (
							<span className="absolute top-1 right-1 size-1.5 rounded-full bg-brand" />
						) : null}
					</Button>
					<Button
						className="h-8 px-2.5 text-xss"
						data-name="AgentButton"
						disabled
						size="sm"
						title="Agent workspace is coming next"
						variant="ghost"
					>
						<RobotIcon aria-hidden className="size-3.5" weight="regular" />
						Agent
					</Button>
				</div>
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
