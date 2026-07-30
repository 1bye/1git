import type { BranchCollection, RepositorySnapshot } from "@1git/git";
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
  const currentBranch = snapshot?.head.branch ?? "";

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
        <div
          aria-label="Open repository workspaces"
          className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto"
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
