import {
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  type ComboboxRootProps,
  ComboboxSeparator,
} from "@1git/ui/components/combobox";
import { Kbd } from "@1git/ui/components/kbd";
import { TooltipProvider } from "@1git/ui/components/tooltip";
import { cn } from "@1git/ui/lib/utils";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type { ReactElement, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCommandLensTarget } from "@/feature/command-lens/hooks/use-command-lens-target.js";
import type { CommandLensCommand } from "@/feature/command-lens/lib/command-lens-shortcut.js";
import { recentRepositoryName } from "@/feature/workspace/lib/workspace-model.js";
import type {
  OpenRepositoryOptions,
  PendingWorkspaceAction,
  WorkspaceTabState,
} from "@/feature/workspace/types/git-workspace.js";
import { WORKSPACE_COMMAND_LENS_GROUP } from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import { useKeyboardModifiers } from "@/fixture/desktop-toolbar/hooks/use-keyboard-modifiers.js";
import {
  getNextRepositoryPickerId,
  reconcileRepositoryPickerId,
} from "@/fixture/desktop-toolbar/lib/repository-picker-navigation.js";
import {
  LiquidPickerContent,
  LiquidPickerRoot,
  LiquidPickerTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";
import { LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY } from "@/fixture/liquid-menu/constants/liquid-menu.js";
import { RepositoryContextMenu } from "@/fixture/repository-item/components/repository-context-menu.js";
import { REPOSITORY_ITEM_TOOLTIP_DELAY_MS } from "@/fixture/repository-item/constants/repository-context-menu.js";
import { useRecentRepositoryPreviews } from "@/fixture/repository-item/hooks/use-recent-repository-previews.js";
import {
  type RepositoryContextLayer,
  updateRepositoryContextLayerOpen,
  updateRepositoryContextLayerPresence,
} from "@/fixture/repository-item/lib/repository-context-layer.js";
import type { RecentRepositoryRecord } from "../../../../../shared/repository-session.js";

interface RepositoryMenuProps {
  readonly isOpen: boolean;
  readonly isVisible: boolean;
  readonly navigationOrder: number;
  readonly onForgetRecent: (path: string) => Promise<void>;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onOpenRecent: (
    path: string,
    options?: OpenRepositoryOptions
  ) => Promise<void>;
  readonly onPickRepository: () => Promise<void>;
  readonly pendingAction: PendingWorkspaceAction;
  readonly recentRepositories: readonly RecentRepositoryRecord[];
  readonly workspaces: readonly WorkspaceTabState[];
}

interface RepositoryEntry {
  readonly id: string;
  readonly kind: "repository";
  readonly repository: RecentRepositoryRecord;
}

interface OpenLocalEntry {
  readonly id: "open-local";
  readonly kind: "open-local";
}

type RepositoryPickerEntry = OpenLocalEntry | RepositoryEntry;

type RepositoryPickerHighlightDetails = Parameters<
  NonNullable<ComboboxRootProps<RepositoryPickerEntry>["onItemHighlighted"]>
>[1];

const REPOSITORY_MENU_SIDE_OFFSET = -1;

const OPEN_LOCAL_ENTRY: OpenLocalEntry = {
  id: "open-local",
  kind: "open-local",
};

const REPOSITORY_MENU_COMMANDS: readonly CommandLensCommand[] = [
  {
    allowInEditable: true,
    key: "k",
    label: "Open repository",
  },
];

const repositoryEntryId = (repositoryPath: string): string =>
  `repository:${repositoryPath}`;

const repositoryPickerEntryLabel = (entry: RepositoryPickerEntry): string =>
  entry.kind === "repository"
    ? recentRepositoryName(entry.repository)
    : "Open local repository";

const isSameRepositoryPickerEntry = (
  first: RepositoryPickerEntry,
  second: RepositoryPickerEntry
): boolean => first.id === second.id;

const preventBaseUiHandler = (
  event: ReactKeyboardEvent<HTMLInputElement>
): void => {
  (
    event as ReactKeyboardEvent<HTMLInputElement> & {
      preventBaseUIHandler?: () => void;
    }
  ).preventBaseUIHandler?.();
};

const consumePickerKey = (
  event: ReactKeyboardEvent<HTMLInputElement>
): void => {
  event.preventDefault();
  event.stopPropagation();
  preventBaseUiHandler(event);
};

const isUnmodifiedPickerKey = (
  event: ReactKeyboardEvent<HTMLInputElement>
): boolean =>
  !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);

export function RepositoryMenu({
  isOpen,
  isVisible,
  navigationOrder,
  onForgetRecent,
  onOpenChange,
  onOpenRecent,
  onPickRepository,
  pendingAction,
  recentRepositories,
  workspaces,
}: RepositoryMenuProps): ReactElement {
  const [query, setQuery] = useState("");
  const [contextLayer, setContextLayer] =
    useState<RepositoryContextLayer | null>(null);
  const { metaKey } = useKeyboardModifiers();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerItemElementsRef = useRef(new Map<string, HTMLElement>());
  const highlightedEntryIdRef = useRef<string | null>(null);
  const preferredEntryIdRef = useRef<string | null>(null);
  const previousVisibleEntryIdsRef = useRef<readonly string[]>([]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const previews = useRecentRepositoryPreviews(recentRepositories, isOpen);
  const workspacesByPath = useMemo(
    () =>
      new Map(
        workspaces.map((workspace) => [
          workspace.session.repository.root,
          workspace,
        ])
      ),
    [workspaces]
  );
  const repositoryEntries = useMemo<readonly RepositoryEntry[]>(
    () =>
      recentRepositories.map((repository) => ({
        id: repositoryEntryId(repository.path),
        kind: "repository",
        repository,
      })),
    [recentRepositories]
  );
  const allEntries = useMemo<readonly RepositoryPickerEntry[]>(
    () => [...repositoryEntries, OPEN_LOCAL_ENTRY],
    [repositoryEntries]
  );
  const matchingRepositoryEntries = useMemo(
    () =>
      repositoryEntries.filter(({ repository }) => {
        const workspace = workspacesByPath.get(repository.path);
        return (
          !normalizedQuery ||
          recentRepositoryName(repository)
            .toLocaleLowerCase()
            .includes(normalizedQuery) ||
          repository.path.toLocaleLowerCase().includes(normalizedQuery) ||
          workspace?.branch?.toLocaleLowerCase().includes(normalizedQuery)
        );
      }),
    [normalizedQuery, repositoryEntries, workspacesByPath]
  );
  const isOpenLocalVisible =
    !normalizedQuery ||
    "open local repository".includes(normalizedQuery) ||
    "open from disk".includes(normalizedQuery);
  const visibleEntries = useMemo<readonly RepositoryPickerEntry[]>(
    () =>
      isOpenLocalVisible
        ? [...matchingRepositoryEntries, OPEN_LOCAL_ENTRY]
        : matchingRepositoryEntries,
    [isOpenLocalVisible, matchingRepositoryEntries]
  );
  const visibleEntryIds = useMemo(
    () => visibleEntries.map((entry) => entry.id),
    [visibleEntries]
  );
  const visibleRepositoryEntryIds = useMemo(
    () => matchingRepositoryEntries.map((entry) => entry.id),
    [matchingRepositoryEntries]
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

  const closeMenu = useCallback((): void => {
    onOpenChange(false);
    setQuery("");
    setContextLayer(null);
  }, [onOpenChange]);
  const changeMenuOpen = useCallback(
    (nextIsOpen: boolean): void => {
      onOpenChange(nextIsOpen);
      if (!nextIsOpen) {
        setQuery("");
        setContextLayer(null);
        highlightedEntryIdRef.current = null;
        preferredEntryIdRef.current = null;
        previousVisibleEntryIdsRef.current = [];
      }
    },
    [onOpenChange]
  );
  const pickRepository = useCallback(async (): Promise<void> => {
    closeMenu();
    await onPickRepository();
  }, [closeMenu, onPickRepository]);
  const setPickerItemElement = useCallback(
    (entryId: string, element: HTMLElement | null): void => {
      if (element) {
        pickerItemElementsRef.current.set(entryId, element);
        return;
      }
      pickerItemElementsRef.current.delete(entryId);
    },
    []
  );
  const highlightPickerEntry = useCallback((entryId: string): void => {
    const element = pickerItemElementsRef.current.get(entryId);
    if (!element) {
      return;
    }
    element.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "mouse",
      })
    );
    element.scrollIntoView({ block: "nearest" });
  }, []);
  const changeHighlightedEntry = useCallback(
    (
      entry: RepositoryPickerEntry | undefined,
      eventDetails: RepositoryPickerHighlightDetails
    ): void => {
      const entryId = entry ? entry.id : null;
      highlightedEntryIdRef.current = entryId;
      if (entryId && eventDetails.reason !== "none") {
        preferredEntryIdRef.current = entryId;
      }
    },
    []
  );
  const changeRepositoryContextOpen = useCallback(
    (repositoryPath: string, nextIsOpen: boolean): void => {
      setContextLayer((currentLayer) =>
        updateRepositoryContextLayerOpen(
          currentLayer,
          repositoryPath,
          nextIsOpen
        )
      );
      if (nextIsOpen) {
        const entryId = repositoryEntryId(repositoryPath);
        preferredEntryIdRef.current = entryId;
        return;
      }
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    },
    []
  );
  const changeRepositoryContextPresence = useCallback(
    (repositoryPath: string, isPresent: boolean): void => {
      setContextLayer((currentLayer) =>
        updateRepositoryContextLayerPresence(
          currentLayer,
          repositoryPath,
          isPresent
        )
      );
    },
    []
  );
  const openHighlightedRepositoryInBackground = useCallback(
    async (entry: RepositoryEntry): Promise<void> => {
      const nextEntryId = getNextRepositoryPickerId(
        visibleRepositoryEntryIds,
        entry.id
      );
      if (nextEntryId) {
        preferredEntryIdRef.current = nextEntryId;
        window.requestAnimationFrame(() => highlightPickerEntry(nextEntryId));
      }
      await onOpenRecent(entry.repository.path, { activate: false });
    },
    [highlightPickerEntry, onOpenRecent, visibleRepositoryEntryIds]
  );
  const navigatePickerBoundary = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>): boolean => {
      if (
        !isUnmodifiedPickerKey(event) ||
        (event.key !== "Home" && event.key !== "End")
      ) {
        return false;
      }
      const entry =
        event.key === "Home" ? visibleEntries[0] : visibleEntries.at(-1);
      if (!entry) {
        return false;
      }
      consumePickerKey(event);
      preferredEntryIdRef.current = entry.id;
      highlightPickerEntry(entry.id);
      return true;
    },
    [highlightPickerEntry, visibleEntries]
  );
  const openHighlightedRepositoryContext = useCallback(
    (
      event: ReactKeyboardEvent<HTMLInputElement>,
      entry: RepositoryPickerEntry | undefined
    ): boolean => {
      if (
        event.key !== "F10" ||
        !event.shiftKey ||
        entry?.kind !== "repository"
      ) {
        return false;
      }
      consumePickerKey(event);
      changeRepositoryContextOpen(entry.repository.path, true);
      return true;
    },
    [changeRepositoryContextOpen]
  );
  const handlePickerKeyDown = useCallback(
    async (event: ReactKeyboardEvent<HTMLInputElement>): Promise<void> => {
      if (navigatePickerBoundary(event)) {
        return;
      }
      const highlightedEntry = visibleEntries.find(
        (entry) => entry.id === highlightedEntryIdRef.current
      );
      if (openHighlightedRepositoryContext(event, highlightedEntry)) {
        return;
      }
      if (event.key !== "Enter" || !event.metaKey) {
        return;
      }
      consumePickerKey(event);
      if (highlightedEntry?.kind === "repository") {
        await openHighlightedRepositoryInBackground(highlightedEntry);
        return;
      }
      if (highlightedEntry?.kind === "open-local") {
        await pickRepository();
      }
    },
    [
      navigatePickerBoundary,
      openHighlightedRepositoryContext,
      openHighlightedRepositoryInBackground,
      pickRepository,
      visibleEntries,
    ]
  );

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    const nextEntryId = reconcileRepositoryPickerId(
      previousVisibleEntryIdsRef.current,
      visibleEntryIds,
      preferredEntryIdRef.current
    );
    previousVisibleEntryIdsRef.current = visibleEntryIds;
    preferredEntryIdRef.current = nextEntryId;
    if (nextEntryId && nextEntryId !== highlightedEntryIdRef.current) {
      const frame = window.requestAnimationFrame(() =>
        highlightPickerEntry(nextEntryId)
      );
      return () => window.cancelAnimationFrame(frame);
    }
  }, [highlightPickerEntry, isOpen, visibleEntryIds]);

  const getMenuAnchor = useCallback(
    (): Element | null => triggerRef.current,
    []
  );
  const commandLensTarget = useCommandLensTarget({
    commands: REPOSITORY_MENU_COMMANDS,
    disabled: !isVisible || pendingAction === "open",
    hintLayout: "floating",
    id: "repository-menu",
    navigationGroup: WORKSPACE_COMMAND_LENS_GROUP,
    navigationOrder,
    navigationOrientation: "horizontal",
    placement: "bottom",
    radius: 10,
  });
  const setTriggerElement = useCallback(
    (element: HTMLButtonElement | null): void => {
      triggerRef.current = element;
      commandLensTarget.ref(element);
    },
    [commandLensTarget.ref]
  );

  return (
    <TooltipProvider delay={REPOSITORY_ITEM_TOOLTIP_DELAY_MS}>
      <div
        aria-hidden={isVisible ? undefined : true}
        className={cn(
          "relative flex h-full shrink-0 items-center justify-center border-editor-hairline opacity-100 transition-[width,opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
          isVisible
            ? "w-8 overflow-visible"
            : "pointer-events-none w-0 translate-x-1 overflow-hidden opacity-0"
        )}
        data-name="RepositoryMenu"
        data-visible={isVisible ? "true" : "false"}
        inert={isVisible ? undefined : true}
      >
        <LiquidPickerRoot<RepositoryPickerEntry>
          anchor={getMenuAnchor}
          anchorGeometry={LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY}
          autoHighlight
          disabled={!isVisible || pendingAction === "open"}
          filter={null}
          filteredItems={visibleEntries}
          inputValue={query}
          isItemEqualToValue={isSameRepositoryPickerEntry}
          items={allEntries}
          itemToStringLabel={repositoryPickerEntryLabel}
          modal
          onInputValueChange={setQuery}
          onItemHighlighted={changeHighlightedEntry}
          onOpenChange={changeMenuOpen}
          onValueChange={() => undefined}
          open={isOpen}
          value={null}
        >
          <LiquidPickerTrigger
            aria-keyshortcuts="Meta+K Control+K"
            aria-label="Open repository"
            className="relative flex size-8 items-center justify-center rounded-lg text-editor-ink outline-none transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20 data-disabled:pointer-events-none data-disabled:opacity-50"
            data-name="RepositoryMenuTrigger"
            ref={setTriggerElement}
            title="Open repository"
          >
            {pendingAction === "open" ? (
              <SpinnerGapIcon
                aria-hidden
                className="size-4 animate-spin text-editor-muted"
                weight="bold"
              />
            ) : (
              <PlusIcon
                aria-hidden
                className="size-4 text-editor-muted"
                weight="regular"
              />
            )}
          </LiquidPickerTrigger>

          {isOpen ? (
            <LiquidPickerContent
              align="start"
              aria-busy={pendingAction === "open"}
              aria-label="Repositories"
              className="max-h-[min(70vh,32rem)] w-[370px] min-w-[370px] p-1.5"
              data-name="RepositoryMenuContent"
              initialFocus={searchInputRef}
              sideOffset={REPOSITORY_MENU_SIDE_OFFSET}
            >
              <LiquidMenuAutoSize>
                <div className="p-1">
                  <div className="relative">
                    <MagnifyingGlassIcon
                      aria-hidden
                      className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-editor-faint"
                      weight="regular"
                    />
                    <ComboboxInput
                      aria-label="Find a repository or worktree"
                      autoFocus
                      className="h-8 bg-editor-sunken pl-8 text-xs shadow-none"
                      onKeyDown={handlePickerKeyDown}
                      placeholder="Find a repository or worktree"
                      ref={searchInputRef}
                      type="search"
                    />
                    <Kbd
                      aria-hidden
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 gap-0.5 text-[10px] text-editor-faint"
                    >
                      <span>⌘</span>
                      <span>K</span>
                    </Kbd>
                  </div>
                </div>

                {visibleEntries.length > 0 ? <ComboboxSeparator /> : null}
                <ComboboxEmpty>
                  No repositories match “{query.trim()}”.
                </ComboboxEmpty>
                <ComboboxList data-name="RecentRepositoryList">
                  {matchingRepositoryEntries.map((entry) => {
                    const { repository } = entry;
                    return (
                      <RepositoryContextMenu
                        disabled={pendingAction === "open"}
                        key={entry.id}
                        metaKey={metaKey}
                        onContextOpenChange={(nextIsOpen) =>
                          changeRepositoryContextOpen(
                            repository.path,
                            nextIsOpen
                          )
                        }
                        onContextPresenceChange={(isPresent) =>
                          changeRepositoryContextPresence(
                            repository.path,
                            isPresent
                          )
                        }
                        onForgetRecent={onForgetRecent}
                        onItemElementChange={(element) =>
                          setPickerItemElement(entry.id, element)
                        }
                        onOpen={onOpenRecent}
                        onOpenForeground={closeMenu}
                        open={
                          contextLayer?.repositoryPath === repository.path &&
                          contextLayer.isOpen
                        }
                        pickerValue={entry}
                        preview={previews.get(repository.path) ?? null}
                        repository={repository}
                        variant="menu"
                        workspace={
                          workspacesByPath.get(repository.path) ?? null
                        }
                      />
                    );
                  })}
                  {isOpenLocalVisible ? (
                    <>
                      <ComboboxSeparator />
                      <ComboboxItem
                        className="gap-2.5 py-2"
                        onClick={pickRepository}
                        ref={(element) =>
                          setPickerItemElement(OPEN_LOCAL_ENTRY.id, element)
                        }
                        value={OPEN_LOCAL_ENTRY}
                      >
                        <PlusIcon
                          aria-hidden
                          className="text-editor-faint"
                          weight="bold"
                        />
                        Open local repository…
                      </ComboboxItem>
                    </>
                  ) : null}
                </ComboboxList>
              </LiquidMenuAutoSize>
            </LiquidPickerContent>
          ) : null}
        </LiquidPickerRoot>
      </div>
    </TooltipProvider>
  );
}
