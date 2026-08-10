import type { BranchCollection, RepositorySnapshot } from "@1git/git";
import {
  DropdownMenuItem,
  DropdownMenuShortcut,
} from "@1git/ui/components/dropdown-menu";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef } from "react";
import { areAllFilesStaged } from "@/feature/workspace/lib/workspace-model.js";
import type {
  PendingWorkspaceAction,
  RepositoryTab,
} from "@/feature/workspace/types/git-workspace.js";
import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import {
  LiquidMenuContent,
  LiquidMenuRoot,
  LiquidMenuTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY } from "@/fixture/liquid-menu/constants/liquid-menu.js";
import { RepositoryQuickActions } from "@/fixture/repository-workspace/components/repository-quick-actions.js";

interface RepositoryWorkspaceToolbarProps {
  readonly branches: BranchCollection | null;
  readonly onFetch: () => Promise<void>;
  readonly onMergeBranch: (name: string) => Promise<boolean>;
  readonly onSetTab: (tab: RepositoryTab) => Promise<void>;
  readonly onStashChanges: () => Promise<boolean>;
  readonly onToggleAllFiles: () => Promise<void>;
  readonly pendingAction: PendingWorkspaceAction;
  readonly snapshot: RepositorySnapshot;
  readonly tab: RepositoryTab;
}

const tabForShortcut = (key: string): RepositoryTab | null => {
  if (key === "1") {
    return "changes";
  }
  if (key === "2") {
    return "history";
  }
  return null;
};

export function RepositoryWorkspaceToolbar({
  branches,
  onFetch,
  onMergeBranch,
  onSetTab,
  onStashChanges,
  onToggleAllFiles,
  pendingAction,
  snapshot,
  tab,
}: RepositoryWorkspaceToolbarProps): ReactElement {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const getAnchor = useCallback((): Element | null => triggerRef.current, []);
  const changeTab = useCallback(
    async (nextTab: RepositoryTab): Promise<void> => {
      await onSetTab(nextTab);
    },
    [onSetTab]
  );

  useEffect(() => {
    const switchView = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }
      const nextTab = tabForShortcut(event.key);
      if (!nextTab) {
        return;
      }
      event.preventDefault();
      changeTab(nextTab).catch(() => {
        // The workspace hook exposes the operation error in the app notice.
      });
    };
    window.addEventListener("keydown", switchView);
    return () => window.removeEventListener("keydown", switchView);
  }, [changeTab]);

  const selectTab = (nextTab: RepositoryTab): void => {
    changeTab(nextTab).catch(() => {
      // The workspace hook exposes the operation error in the app notice.
    });
  };
  const viewLabel = tab === "changes" ? "Changes" : "History";

  return (
    <div
      className="relative z-10 flex w-full shrink-0 items-center justify-between gap-2 px-2"
      data-name="RepositoryTitlebarControls"
      style={{ height: WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight }}
    >
      <LiquidMenuRoot
        anchor={getAnchor}
        anchorGeometry={LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY}
        modal
      >
        <LiquidMenuTrigger
          aria-label={`Repository view: ${viewLabel}`}
          className="flex h-7 min-w-20 items-center justify-between gap-2 rounded-lg px-2 font-medium text-[10px] text-editor-ink outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20"
          ref={triggerRef}
        >
          {viewLabel}
          <CaretDownIcon
            aria-hidden
            className="size-3 text-editor-faint"
            weight="bold"
          />
        </LiquidMenuTrigger>
        <LiquidMenuContent
          align="start"
          aria-label="Repository view"
          className="max-w-36 min-w-36 p-1"
          sideOffset={4}
          alignOffset={16}
        >
          <DropdownMenuItem closeOnClick onClick={() => selectTab("changes")}>
            <CheckIcon
              aria-hidden
              className={tab === "changes" ? "opacity-100" : "opacity-0"}
              weight="bold"
            />
            Changes
            <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem closeOnClick onClick={() => selectTab("history")}>
            <CheckIcon
              aria-hidden
              className={tab === "history" ? "opacity-100" : "opacity-0"}
              weight="bold"
            />
            History
            <DropdownMenuShortcut>⌘2</DropdownMenuShortcut>
          </DropdownMenuItem>
        </LiquidMenuContent>
      </LiquidMenuRoot>

      <RepositoryQuickActions
        allFilesStaged={areAllFilesStaged(snapshot.files)}
        branches={branches}
        changedFileCount={snapshot.files.length}
        head={snapshot.head}
        onFetch={onFetch}
        onMergeBranch={onMergeBranch}
        onSetTab={onSetTab}
        onStashChanges={onStashChanges}
        onToggleAllFiles={onToggleAllFiles}
        pendingAction={pendingAction}
      />
    </div>
  );
}
