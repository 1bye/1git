import { Elevated } from "@1git/ui/components/elevated";
import { Input } from "@1git/ui/components/input";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type { ChangeEvent, ReactElement } from "react";
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
  getRepositoryName,
  recentRepositoryName,
} from "../../../feature/workspace/lib/workspace-model.js";

interface RepositoryMenuProps {
  readonly activeSessionId: RepositorySessionId | null;
  readonly isOpen: boolean;
  readonly onActivateWorkspace: (
    sessionId: RepositorySessionId
  ) => Promise<void>;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onOpenRecent: (path: string) => Promise<void>;
  readonly onPickRepository: () => Promise<void>;
  readonly pendingAction: PendingWorkspaceAction;
  readonly recentRepositories: readonly RecentRepositoryRecord[];
  readonly workspaces: readonly WorkspaceTabState[];
}

const REPOSITORY_MENU_ID = "repository-menu-dialog";

export function RepositoryMenu({
  activeSessionId,
  isOpen,
  onActivateWorkspace,
  onOpenChange,
  onOpenRecent,
  onPickRepository,
  pendingAction,
  recentRepositories,
  workspaces,
}: RepositoryMenuProps): ReactElement {
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(isOpen);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const openPaths = new Set(
    workspaces.map((workspace) => workspace.session.repository.root)
  );
  const matchingWorkspaces = workspaces.filter((workspace) => {
    const repositoryName = getRepositoryName(workspace.session.repository.root);
    return (
      !normalizedQuery ||
      repositoryName.toLocaleLowerCase().includes(normalizedQuery) ||
      workspace.session.repository.root
        .toLocaleLowerCase()
        .includes(normalizedQuery) ||
      workspace.branch?.toLocaleLowerCase().includes(normalizedQuery)
    );
  });
  const matchingRecentRepositories = recentRepositories.filter(
    (repository) =>
      !openPaths.has(repository.path) &&
      (!normalizedQuery ||
        recentRepositoryName(repository)
          .toLocaleLowerCase()
          .includes(normalizedQuery) ||
        repository.path.toLocaleLowerCase().includes(normalizedQuery))
  );

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const closeMenu = (): void => {
    onOpenChange(false);
    setQuery("");
  };
  const toggleMenu = (): void => {
    if (isOpen) {
      closeMenu();
      return;
    }
    onOpenChange(true);
  };
  const updateQuery = (event: ChangeEvent<HTMLInputElement>): void => {
    setQuery(event.target.value);
  };
  const pickRepository = async (): Promise<void> => {
    closeMenu();
    await onPickRepository();
  };

  return (
    <div
      className="relative flex h-full shrink-0 items-center border-editor-hairline pl-2"
      data-name="RepositoryMenu"
    >
      <button
        aria-controls={REPOSITORY_MENU_ID}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-8 items-center gap-2 rounded-lg px-2.5 font-semibold text-editor-ink text-xss outline-none transition-colors hover:bg-hover focus-visible:bg-studio-glass-strong"
        disabled={pendingAction === "open"}
        onClick={toggleMenu}
        ref={triggerRef}
        type="button"
      >
        {pendingAction === "open" ? (
          <SpinnerGapIcon
            aria-hidden
            className="size-4 animate-spin text-editor-muted"
            weight="bold"
          />
        ) : (
          <FolderOpenIcon
            aria-hidden
            className="size-4 text-editor-muted"
            weight="regular"
          />
        )}
        Repos
      </button>

      {isOpen ? (
        <>
          <button
            aria-label="Close repositories"
            className="fixed inset-0 z-40 cursor-default"
            onClick={closeMenu}
            tabIndex={-1}
            type="button"
          />
          <Elevated
            aria-busy={pendingAction === "open"}
            aria-label="Repositories"
            className="absolute top-[calc(100%-3px)] left-2 z-50 w-[370px] overflow-hidden rounded-2xl p-1.5"
            data-name="RepositoryMenuPopover"
            id={REPOSITORY_MENU_ID}
            offset={2}
            role="dialog"
            shadowLevel={6}
          >
            <div className="p-1.5">
              <div className="relative">
                <MagnifyingGlassIcon
                  aria-hidden
                  className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-editor-faint"
                  weight="regular"
                />
                <Input
                  aria-label="Find a repository or worktree"
                  autoFocus
                  className="h-8 bg-editor-sunken pl-8 text-xs shadow-none"
                  onChange={updateQuery}
                  placeholder="Find a repository or worktree"
                  type="search"
                  value={query}
                />
                <kbd
                  aria-hidden
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[10px] text-editor-faint"
                >
                  ⌘K
                </kbd>
              </div>
            </div>

            {matchingWorkspaces.length > 0 ? (
              <section
                aria-labelledby="open-workspaces-heading"
                data-name="OpenWorkspaceList"
              >
                <h2
                  className="px-2.5 pt-2 pb-1 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]"
                  id="open-workspaces-heading"
                >
                  Open workspaces
                </h2>
                <ul>
                  {matchingWorkspaces.map((workspace) => {
                    const activateWorkspace = async (): Promise<void> => {
                      closeMenu();
                      await onActivateWorkspace(workspace.session.id);
                    };
                    const isActive = workspace.session.id === activeSessionId;
                    return (
                      <li key={workspace.session.id}>
                        <button
                          aria-current={isActive ? "page" : undefined}
                          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors hover:bg-editor-sunken focus-visible:bg-editor-sunken focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset"
                          onClick={activateWorkspace}
                          type="button"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-editor-sunken text-editor-muted group-hover:bg-surface-3">
                            <GitBranchIcon
                              aria-hidden
                              className="size-3.5"
                              weight="regular"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-editor-ink text-xs">
                              {getRepositoryName(
                                workspace.session.repository.root
                              )}
                            </span>
                            <span className="block truncate text-[10px] text-editor-faint">
                              {workspace.branch ?? "Loading branch…"}
                            </span>
                          </span>
                          {workspace.changedFiles ? (
                            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-[9px] text-amber-700">
                              {workspace.changedFiles}
                              <span className="sr-only"> changed files</span>
                            </span>
                          ) : null}
                          {isActive ? (
                            <>
                              <span
                                aria-hidden
                                className="size-1.5 rounded-full bg-brand"
                              />
                              <span className="sr-only">Current workspace</span>
                            </>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {matchingRecentRepositories.length > 0 ? (
              <section
                aria-labelledby="recent-repositories-heading"
                className="mt-1"
                data-name="RecentRepositoryList"
              >
                <h2
                  className="border-editor-hairline border-t px-2.5 pt-2.5 pb-1 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]"
                  id="recent-repositories-heading"
                >
                  Recent
                </h2>
                <ul>
                  {matchingRecentRepositories.map((repository) => {
                    const openRecent = async (): Promise<void> => {
                      closeMenu();
                      await onOpenRecent(repository.path);
                    };
                    return (
                      <li key={repository.path}>
                        <button
                          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors hover:bg-editor-sunken focus-visible:bg-editor-sunken focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset"
                          onClick={openRecent}
                          type="button"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-editor-sunken text-editor-muted group-hover:bg-surface-3">
                            <FolderOpenIcon
                              aria-hidden
                              className="size-3.5"
                              weight="regular"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-editor-ink text-xs">
                              {recentRepositoryName(repository)}
                            </span>
                            <span
                              className="block truncate text-[10px] text-editor-faint"
                              title={repository.path}
                            >
                              {repository.path}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {matchingWorkspaces.length === 0 &&
              matchingRecentRepositories.length === 0 &&
              normalizedQuery ? (
              <p className="px-3 py-5 text-center text-editor-faint text-xs">
                No repositories match “{query.trim()}”.
              </p>
            ) : null}

            <div className="mt-1 border-editor-hairline border-t pt-1">
              <button
                className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left font-medium text-editor-ink text-xs outline-none transition-colors hover:bg-editor-sunken focus-visible:bg-editor-sunken focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset"
                onClick={pickRepository}
                type="button"
              >
                <span className="flex size-7 items-center justify-center rounded-lg bg-editor-ink text-white">
                  <PlusIcon aria-hidden className="size-3.5" weight="bold" />
                </span>
                Open local repository…
              </button>
            </div>
          </Elevated>
        </>
      ) : null}
    </div>
  );
}
