import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@1git/ui/components/dropdown-menu";
import { Input } from "@1git/ui/components/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@1git/ui/components/tooltip";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type {
  ChangeEvent,
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  RecentRepositoryPreview,
  RecentRepositoryRecord,
  RepositorySessionId,
} from "../../../../../shared/repository-session.js";
import type {
  PendingWorkspaceAction,
  WorkspaceTabState,
} from "../../../feature/workspace/hooks/use-git-workspace.js";
import { getRepositoryOwner } from "../../../feature/workspace/lib/repository-owner.js";
import {
  formatCommitDate,
  formatRelativeTime,
  getRepositoryName,
  recentRepositoryName,
} from "../../../feature/workspace/lib/workspace-model.js";
import { useKeyboardModifiers } from "../../../hooks/use-keyboard-modifiers.js";
import { AnimatedFolderOpenIcon } from "../../icons/components/animated-folder-open-icon.js";
import {
  LiquidMenuContent,
  LiquidMenuRoot,
} from "../../liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "../../liquid-menu/components/liquid-menu-auto-size.js";
import {
  REPOSITORY_MENU_ALIGN_OFFSET,
  REPOSITORY_MENU_ANCHOR_GEOMETRY,
  REPOSITORY_MENU_TOOLTIP_DELAY_MS,
} from "../constants/repository-menu.js";
import { useRecentRepositoryPreview } from "../hooks/use-recent-repository-preview.js";
import { RepositoryOwnerThumbnail } from "./repository-owner-thumbnail.js";

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

interface RecentRepositoryMenuItemProps {
  readonly metaKey: boolean;
  readonly onClose: () => void;
  readonly onOpen: (path: string) => Promise<void>;
  readonly repository: RecentRepositoryRecord;
}

function RecentRepositoryTooltipDetails({
  preview,
}: {
  readonly preview: RecentRepositoryPreview | null;
}): ReactElement {
  if (!preview) {
    return (
      <span className="mt-1.5 block text-[10px] opacity-65">
        Loading repository details…
      </span>
    );
  }

  if (!preview.latestCommit) {
    return (
      <>
        {preview.head.branch ? (
          <span className="mt-1 block opacity-80">
            Branch {preview.head.branch}
          </span>
        ) : null}
        <span className="mt-1.5 block text-[10px] opacity-65">
          No commits yet
        </span>
      </>
    );
  }

  return (
    <>
      {/*{preview.head.branch ? (
        <span className="mt-1 block opacity-80">
          Branch {preview.head.branch}
        </span>
      ) : null}*/}
      <span className="mt-1.5 line-clamp-2 block font-medium">
        {preview.latestCommit.summary}
      </span>
      <span className="mt-1 block text-[10px] opacity-65">
        Latest commit {formatCommitDate(preview.latestCommit.committedAt)} by{" "}
        {preview.latestCommit.author.name}
      </span>
    </>
  );
}

function RecentRepositoryMenuItem({
  metaKey,
  onClose,
  onOpen,
  repository,
}: RecentRepositoryMenuItemProps): ReactElement {
  const tooltipId = useId();
  const preview = useRecentRepositoryPreview(repository.path);
  const owner = preview
    ? getRepositoryOwner(preview.remotes, preview.head.upstream)
    : null;
  const repositoryName = recentRepositoryName(repository);
  const lastUsed = formatRelativeTime(repository.lastOpenedAt);
  const ownerTitle = owner
    ? `${owner.namespace} on ${owner.host}`
    : "Local repository";
  const thumbnailLabel = owner ? owner.namespace : repositoryName;
  const openRecent = async (
    event: ReactMouseEvent<HTMLElement>
  ): Promise<void> => {
    if (!(event.metaKey || metaKey)) {
      onClose();
    }
    await onOpen(repository.path);
  };

  const menuItem = (
    <DropdownMenuItem
      aria-describedby={tooltipId}
      aria-label={`${repositoryName}, last used ${lastUsed}`}
      className="gap-2"
      closeOnClick={false}
      onClick={openRecent}
    >
      <RepositoryOwnerThumbnail
        label={thumbnailLabel}
        owner={owner}
        size="sm"
        title={ownerTitle}
      />
      <span className="min-w-0 flex-1 truncate">{repositoryName}</span>
      <time
        className="shrink-0 font-normal text-[10px] text-editor-faint tabular-nums"
        dateTime={repository.lastOpenedAt}
        title={formatCommitDate(repository.lastOpenedAt)}
      >
        {lastUsed}
      </time>
    </DropdownMenuItem>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={menuItem} />
      <TooltipContent
        align="center"
        className="max-w-80 items-start"
        id={tooltipId}
        side="right"
        sideOffset={8}
      >
        <span className="min-w-0 py-1">
          <span className="block truncate font-semibold">{repositoryName}</span>
          <span className="mt-0.5 block break-all opacity-70">
            {repository.path}
          </span>
          <RecentRepositoryTooltipDetails preview={preview} />
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

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
  const { metaKey } = useKeyboardModifiers();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
    if (!isOpen) {
      return;
    }
    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    });
    return () => window.clearTimeout(focusTimer);
  }, [isOpen]);

  const closeMenu = (): void => {
    onOpenChange(false);
    setQuery("");
  };
  const changeMenuOpen = (nextIsOpen: boolean): void => {
    onOpenChange(nextIsOpen);
    if (!nextIsOpen) {
      setQuery("");
    }
  };
  const updateQuery = (event: ChangeEvent<HTMLInputElement>): void => {
    setQuery(event.target.value);
  };
  const stopMenuNavigation = (
    event: ReactKeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.key !== "Escape") {
      event.stopPropagation();
    }
  };
  const pickRepository = async (): Promise<void> => {
    closeMenu();
    await onPickRepository();
  };
  const getMenuAnchor = useCallback(
    (): Element | null => triggerRef.current,
    []
  );

  return (
    <TooltipProvider delay={REPOSITORY_MENU_TOOLTIP_DELAY_MS}>
      <div
        className="relative flex h-full shrink-0 items-center border-editor-hairline pl-2"
        data-name="RepositoryMenu"
      >
        <LiquidMenuRoot
          anchor={getMenuAnchor}
          anchorGeometry={REPOSITORY_MENU_ANCHOR_GEOMETRY}
          disabled={pendingAction === "open"}
          modal
          onOpenChange={changeMenuOpen}
          open={isOpen}
        >
          <DropdownMenuTrigger
            aria-keyshortcuts="Meta+K Control+K"
            aria-label="Open repositories"
            className="relative z-10 flex h-8 items-center gap-2 rounded-lg px-2.5 font-semibold text-editor-ink text-xss outline-none transition-colors hover:bg-white focus-visible:bg-studio-glass-strong"
            ref={triggerRef}
          >
            {pendingAction === "open" ? (
              <SpinnerGapIcon
                aria-hidden
                className="size-4 animate-spin text-editor-muted"
                weight="bold"
              />
            ) : (
              <AnimatedFolderOpenIcon
                aria-hidden
                className="size-4 text-editor-muted"
                triggerRef={triggerRef}
              />
            )}
            Repos
          </DropdownMenuTrigger>

          {isOpen ? (
            <LiquidMenuContent
              align="start"
              alignOffset={REPOSITORY_MENU_ALIGN_OFFSET}
              aria-busy={pendingAction === "open"}
              aria-label="Repositories"
              className="max-h-[min(70vh,32rem)] w-[370px] min-w-[370px] p-1.5"
              sideOffset={8}
            >
              <LiquidMenuAutoSize>
                <div className="p-1">
                  <div className="relative">
                    <MagnifyingGlassIcon
                      aria-hidden
                      className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-editor-faint"
                      weight="regular"
                    />
                    <Input
                      aria-label="Find a repository or worktree"
                      autoFocus
                      className="h-8 border-editor-hairline bg-editor-sunken pl-8 text-xs shadow-none"
                      onChange={updateQuery}
                      onKeyDown={stopMenuNavigation}
                      placeholder="Find a repository or worktree"
                      ref={searchInputRef}
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
                  <DropdownMenuGroup data-name="OpenWorkspaceList">
                    <DropdownMenuLabel>Open workspaces</DropdownMenuLabel>
                    {matchingWorkspaces.map((workspace) => {
                      const activateWorkspace = async (): Promise<void> => {
                        closeMenu();
                        await onActivateWorkspace(workspace.session.id);
                      };
                      const isActive = workspace.session.id === activeSessionId;
                      return (
                        <DropdownMenuItem
                          aria-current={isActive ? "page" : undefined}
                          className="gap-2.5 py-2"
                          closeOnClick
                          key={workspace.session.id}
                          onClick={activateWorkspace}
                        >
                          <GitBranchIcon
                            aria-hidden
                            className="text-editor-faint"
                            weight="regular"
                          />
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
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                ) : null}

                {matchingRecentRepositories.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup data-name="RecentRepositoryList">
                      {/*<DropdownMenuLabel>Recent</DropdownMenuLabel>*/}
                      {matchingRecentRepositories.map((repository) => (
                        <RecentRepositoryMenuItem
                          key={repository.path}
                          metaKey={metaKey}
                          onClose={closeMenu}
                          onOpen={onOpenRecent}
                          repository={repository}
                        />
                      ))}
                    </DropdownMenuGroup>
                  </>
                ) : null}

                {matchingWorkspaces.length === 0 &&
                  matchingRecentRepositories.length === 0 &&
                  normalizedQuery ? (
                  <p
                    aria-live="polite"
                    className="px-3 py-5 text-center text-editor-faint text-xs"
                  >
                    No repositories match “{query.trim()}”.
                  </p>
                ) : null}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2.5 py-2"
                  closeOnClick
                  onClick={pickRepository}
                >
                  <PlusIcon
                    aria-hidden
                    className="text-editor-faint"
                    weight="bold"
                  />
                  Open local repository…
                </DropdownMenuItem>
              </LiquidMenuAutoSize>
            </LiquidMenuContent>
          ) : null}
        </LiquidMenuRoot>
      </div>
    </TooltipProvider>
  );
}
