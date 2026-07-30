import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers";
import { useSortable } from "@dnd-kit/react/sortable";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type {
  CSSProperties,
  MouseEvent,
  ReactElement,
  RefCallback,
} from "react";
import type { RepositorySessionId } from "../../shared/repository-session.js";
import type { WorkspaceTabState } from "./use-git-workspace.js";
import { getRepositoryName, getWorkspaceLabel } from "./workspace-model.js";

interface WorkspaceTabProps {
  readonly index: number;
  readonly isActive: boolean;
  readonly isBusy: boolean;
  readonly onActivate: (sessionId: RepositorySessionId) => Promise<void>;
  readonly onClose: (sessionId: RepositorySessionId) => Promise<void>;
  readonly onOpenActions: (left: number) => void;
  readonly workspace: WorkspaceTabState;
}

interface WorkspaceTabAppearanceProps extends Omit<WorkspaceTabProps, "index"> {
  readonly handleRef?: RefCallback<Element>;
  readonly isDragging: boolean;
  readonly isOverlay?: boolean;
  readonly rootRef?: RefCallback<Element>;
}

/** Adjust the active tab and SDF fusion geometry from this single object. */
export const WORKSPACE_TAB_SURFACE_GEOMETRY = {
  blendRadius: 12,
  containerDepth: 48,
  containerInset: 6,
  containerOverlap: 1,
  containerRadius: 14,
  outlineWidth: 1,
  sampleCellSize: 2,
  smoothingPasses: 1,
  tabActionWidth: 28,
  tabCloseSize: 24,
  tabContentGap: 8,
  tabContentInsetBlock: 8,
  tabContentInsetInlineStart: 12,
  tabGap: 2,
  tabHeight: 40,
  tabLift: 3,
  tabListInset: 16,
  tabRadius: 10,
  tabSdfExtensionBlockEnd: 16,
  tabTrailingInset: 4,
  tabVisualInsetBlock: 4,
  tabVisualInsetInline: 4,
  tabWidth: 196,
  toolbarHeight: 46,
} as const;

const WORKSPACE_TAB_STYLE: CSSProperties = {
  height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabHeight,
  width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabWidth,
};

const WORKSPACE_TAB_VISUAL_STYLE: CSSProperties = {
  borderRadius: WORKSPACE_TAB_SURFACE_GEOMETRY.tabRadius,
  insetBlock: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetBlock,
  insetInline: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetInline,
};

const WORKSPACE_TAB_CONTENT_STYLE: CSSProperties = {
  columnGap: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentGap,
  paddingBlock: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentInsetBlock,
  paddingInlineStart: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentInsetInlineStart,
};

const WORKSPACE_TAB_ACTION_STYLE: CSSProperties = {
  width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabActionWidth,
};

const WORKSPACE_TAB_CLOSE_STYLE: CSSProperties = {
  height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabCloseSize,
  marginInlineEnd: WORKSPACE_TAB_SURFACE_GEOMETRY.tabTrailingInset,
  width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabCloseSize,
};

const WORKSPACE_TAB_SORT_TRANSITION = {
  duration: 180,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  idle: true,
} as const;

const WorkspaceTabAppearance = ({
  handleRef,
  isActive,
  isBusy,
  isDragging,
  isOverlay = false,
  onActivate,
  onClose,
  onOpenActions,
  rootRef,
  workspace,
}: WorkspaceTabAppearanceProps): ReactElement => {
  const label = getWorkspaceLabel(
    workspace.session.repository.root,
    workspace.branch
  );
  const activateWorkspace = async (): Promise<void> => {
    await onActivate(workspace.session.id);
  };
  const closeWorkspace = async (): Promise<void> => {
    await onClose(workspace.session.id);
  };
  const openActions = (event: MouseEvent<HTMLButtonElement>): void => {
    onOpenActions(event.currentTarget.getBoundingClientRect().left);
  };
  return (
    <div
      aria-hidden={isOverlay || undefined}
      className={`group relative z-[2] flex shrink-0 items-center transition-colors ${isActive ? "text-editor-ink" : "text-editor-muted hover:text-editor-ink"}`}
      data-active={isActive ? "true" : undefined}
      data-desktop-interactive
      data-dragging={isDragging ? "true" : undefined}
      data-name="WorkspaceTab"
      data-overlay={isOverlay ? "true" : undefined}
      data-workspace-session-id={workspace.session.id}
      ref={rootRef}
      style={WORKSPACE_TAB_STYLE}
    >
      {isActive || isOverlay ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute z-0 bg-transparent transition-colors group-hover:bg-hover"
          data-name="WorkspaceTabHoverPill"
          style={WORKSPACE_TAB_VISUAL_STYLE}
        />
      )}
      <button
        aria-controls="repository-workspace"
        aria-selected={isActive}
        className="relative z-10 flex h-full min-w-0 flex-1 cursor-default touch-none items-center text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/20 active:cursor-grabbing"
        data-desktop-interactive
        disabled={isBusy || isOverlay}
        onClick={activateWorkspace}
        ref={handleRef}
        role="tab"
        style={WORKSPACE_TAB_CONTENT_STYLE}
        title={label}
        type="button"
      >
        {workspace.changedFiles ? (
          <>
            <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
            <span className="sr-only">
              {workspace.changedFiles} changed files
            </span>
          </>
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-editor-hairline-strong" />
        )}
        <span className="min-w-0 truncate text-xss">
          <span className={isActive ? "font-semibold" : "font-medium"}>
            {getRepositoryName(workspace.session.repository.root)}
          </span>
          {workspace.branch ? (
            <span className="text-editor-faint"> / {workspace.branch}</span>
          ) : null}
        </span>
      </button>
      <button
        aria-haspopup="menu"
        aria-hidden={isActive ? undefined : true}
        aria-label={`Open actions for ${label}`}
        className={`relative z-10 flex h-full shrink-0 items-center justify-center text-editor-faint outline-none transition-opacity hover:text-editor-ink focus-visible:text-editor-ink ${isActive ? "" : "pointer-events-none opacity-0"}`}
        disabled={isBusy || isOverlay || !isActive}
        onClick={openActions}
        style={WORKSPACE_TAB_ACTION_STYLE}
        tabIndex={isActive ? undefined : -1}
        type="button"
      >
        <CaretDownIcon aria-hidden className="size-3" weight="bold" />
      </button>
      <button
        aria-label={`Close ${label}`}
        className={`relative z-10 flex shrink-0 items-center justify-center rounded-lg text-editor-faint outline-none hover:bg-active hover:text-editor-ink focus-visible:bg-active ${isActive ? "" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"}`}
        disabled={isBusy || isOverlay}
        onClick={closeWorkspace}
        style={WORKSPACE_TAB_CLOSE_STYLE}
        type="button"
      >
        <XIcon aria-hidden className="size-3" weight="bold" />
      </button>
    </div>
  );
};

export const WorkspaceTab = ({
  index,
  ...appearanceProps
}: WorkspaceTabProps): ReactElement => {
  const { handleRef, isDragging, isDropping, ref } = useSortable({
    disabled: appearanceProps.isBusy,
    id: appearanceProps.workspace.session.id,
    index,
    modifiers: [RestrictToHorizontalAxis],
    transition: WORKSPACE_TAB_SORT_TRANSITION,
  });

  return (
    <WorkspaceTabAppearance
      {...appearanceProps}
      handleRef={handleRef}
      isDragging={isDragging || isDropping}
      rootRef={ref}
    />
  );
};

export const WorkspaceTabOverlay = (
  props: Omit<WorkspaceTabProps, "index">
): ReactElement => <WorkspaceTabAppearance {...props} isDragging isOverlay />;
