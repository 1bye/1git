import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@1git/ui/components/dropdown-menu";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/csr/GithubLogo";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/csr/TerminalWindow";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import type {
  OpenRepositoryOptions,
  WorkspaceTabState,
} from "@/feature/workspace/hooks/use-git-workspace.js";
import { recentRepositoryName } from "@/feature/workspace/lib/workspace-model.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";
import {
  RepositoryWorktreeCreate,
  RepositoryWorktreeList,
} from "@/fixture/repository-item/components/repository-context-worktrees.js";
import { useRepositoryWorktrees } from "@/fixture/repository-item/hooks/use-repository-worktrees.js";
import {
  getGithubRepositoryUrl,
  getPreferredRepositoryRemoteUrl,
} from "@/fixture/repository-item/lib/repository-remote.js";
import type {
  RecentRepositoryPreview,
  RecentRepositoryRecord,
} from "../../../../../shared/repository-session.js";

interface RepositoryContextActionsProps {
  readonly onDismiss: () => void;
  readonly onForgetRecent: (path: string) => Promise<void>;
  readonly onOpen: (
    path: string,
    options?: OpenRepositoryOptions
  ) => Promise<void>;
  readonly onOpenForeground?: () => void;
  readonly preview: RecentRepositoryPreview | null;
  readonly repository: RecentRepositoryRecord;
  readonly workspace: WorkspaceTabState | null;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "The repository action failed.";

export function RepositoryContextActions({
  onDismiss,
  onForgetRecent,
  onOpen,
  onOpenForeground,
  preview,
  repository,
  workspace,
}: RepositoryContextActionsProps): ReactElement {
  const [actionError, setActionError] = useState<string | null>(null);
  const worktreeState = useRepositoryWorktrees(workspace?.session.id ?? null);
  const repositoryName = recentRepositoryName(repository);
  const remoteUrl = getPreferredRepositoryRemoteUrl(
    preview?.remotes ?? [],
    preview?.head.upstream ?? null
  );
  const githubUrl = getGithubRepositoryUrl(remoteUrl);
  const supportsMacosApplications = window.desktop.platform === "darwin";
  const perform = async (action: () => Promise<void>): Promise<void> => {
    setActionError(null);
    try {
      await action();
      onDismiss();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };
  const openRepository = async (): Promise<void> => {
    await perform(async () => {
      onOpenForeground?.();
      await onOpen(repository.path, { activate: true });
    });
  };
  const openRepositoryInBackground = async (): Promise<void> => {
    await perform(async () => {
      await onOpen(repository.path, { activate: false });
    });
  };
  const copyText = async (text: string): Promise<void> => {
    await perform(async () => {
      await window.desktop.integrations.copyText(text);
    });
  };
  const openExternal = async (url: string): Promise<void> => {
    await perform(async () => {
      await window.desktop.integrations.openExternal(url);
    });
  };
  const revealRepository = async (): Promise<void> => {
    await perform(async () => {
      await window.desktop.integrations.revealPath(repository.path);
    });
  };
  const openInApplication = async (
    application: "ghostty" | "zed"
  ): Promise<void> => {
    await perform(async () => {
      await window.desktop.integrations.openInApplication(
        application,
        repository.path
      );
    });
  };
  const forgetRepository = async (): Promise<void> => {
    await perform(async () => {
      await onForgetRecent(repository.path);
    });
  };
  const actionItem = (
    label: string,
    icon: ReactNode,
    action: () => Promise<void> | void
  ): ReactElement => (
    <DropdownMenuItem
      className="gap-2.5 py-2"
      closeOnClick={false}
      onClick={action}
    >
      {icon}
      {label}
    </DropdownMenuItem>
  );

  if (worktreeState.view === "list") {
    return (
      <LiquidMenuAutoSize viewKey="worktree-list">
        <RepositoryWorktreeList
          error={worktreeState.error}
          isLoading={worktreeState.isLoading}
          onBack={worktreeState.showActions}
          onCreate={worktreeState.showCreate}
          worktrees={worktreeState.worktrees}
        />
      </LiquidMenuAutoSize>
    );
  }

  if (worktreeState.view === "create") {
    return (
      <LiquidMenuAutoSize viewKey="worktree-create">
        <RepositoryWorktreeCreate
          error={worktreeState.error}
          isLoading={worktreeState.isLoading}
          onBack={worktreeState.showActions}
          onCreate={worktreeState.create}
        />
      </LiquidMenuAutoSize>
    );
  }

  return (
    <LiquidMenuAutoSize viewKey="actions">
      <DropdownMenuItem
        className="gap-2.5 py-2"
        closeOnClick={false}
        onClick={openRepository}
      >
        <ArrowSquareOutIcon aria-hidden weight="regular" />
        Open repository
      </DropdownMenuItem>
      <DropdownMenuItem
        className="gap-2.5 py-2"
        closeOnClick={false}
        onClick={openRepositoryInBackground}
      >
        <SidebarSimpleIcon aria-hidden weight="duotone" />
        Open in background
        <DropdownMenuShortcut>⌘↵</DropdownMenuShortcut>
      </DropdownMenuItem>
      {workspace ? (
        <>
          <DropdownMenuSeparator />
          {actionItem(
            "Show worktrees",
            <GitBranchIcon aria-hidden weight="duotone" />,
            worktreeState.showList
          )}
          {actionItem(
            "New worktree…",
            <PlusIcon aria-hidden weight="regular" />,
            worktreeState.showCreate
          )}
        </>
      ) : null}
      <DropdownMenuSeparator />
      {actionItem(
        "Copy repository name",
        <CopyIcon aria-hidden weight="duotone" />,
        async () => await copyText(repositoryName)
      )}
      {actionItem(
        "Copy repository path",
        <CopyIcon aria-hidden weight="duotone" />,
        async () => await copyText(repository.path)
      )}
      {remoteUrl
        ? actionItem(
          "Copy remote URL",
          <CopyIcon aria-hidden weight="duotone" />,
          async () => await copyText(remoteUrl)
        )
        : null}
      <DropdownMenuSeparator />
      {githubUrl
        ? actionItem(
          "View on GitHub",
          <GithubLogoIcon aria-hidden weight="regular" />,
          async () => await openExternal(githubUrl)
        )
        : null}
      {actionItem(
        "Reveal in Finder",
        <FolderOpenIcon aria-hidden weight="duotone" />,
        revealRepository
      )}
      {supportsMacosApplications
        ? actionItem(
          "Open in Ghostty",
          <TerminalWindowIcon aria-hidden weight="regular" />,
          async () => await openInApplication("ghostty")
        )
        : null}
      {supportsMacosApplications
        ? actionItem(
          "Open in Zed",
          <CodeIcon aria-hidden weight="regular" />,
          async () => await openInApplication("zed")
        )
        : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="gap-2.5 py-2"
        closeOnClick={false}
        onClick={forgetRepository}
        variant="destructive"
      >
        <TrashIcon aria-hidden weight="duotone" />
        Remove from recents
      </DropdownMenuItem>
      {actionError ? (
        <p
          aria-live="polite"
          className="px-2 py-1.5 text-[10px] text-destructive leading-4"
          role="status"
        >
          {actionError}
        </p>
      ) : null}
    </LiquidMenuAutoSize>
  );
}
