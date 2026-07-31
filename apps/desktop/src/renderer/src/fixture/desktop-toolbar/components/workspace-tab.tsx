import { cn } from "@1git/ui/lib/utils";
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers";
import { useSortable } from "@dnd-kit/react/sortable";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type {
  CSSProperties,
  MouseEvent,
  ReactElement,
  RefCallback,
} from "react";
import { useState } from "react";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";
import type { WorkspaceTabState } from "../../../feature/workspace/hooks/use-git-workspace.js";
import type { RepositoryOwner } from "../../../feature/workspace/lib/repository-owner.js";
import {
  getRepositoryName,
  getWorkspaceLabel,
} from "../../../feature/workspace/lib/workspace-model.js";
import {
  WORKSPACE_ACTIONS_MENU_ID,
  WORKSPACE_TAB_SURFACE_GEOMETRY,
} from "../constants/workspace-tab.js";
import { useRepositoryOwnerAvatar } from "../hooks/use-repository-owner-avatar.js";

interface WorkspaceTabProps {
  readonly index: number;
  readonly isActionsMenuOpen: boolean;
  readonly isActive: boolean;
  readonly isBusy: boolean;
  readonly onActivate: (sessionId: RepositorySessionId) => Promise<void>;
  readonly onClose: (sessionId: RepositorySessionId) => Promise<void>;
  readonly onOpenActions: (trigger: HTMLButtonElement) => void;
  readonly workspace: WorkspaceTabState;
}

interface WorkspaceTabAppearanceProps extends Omit<WorkspaceTabProps, "index"> {
  readonly handleRef?: RefCallback<Element>;
  readonly isDragging: boolean;
  readonly isOverlay?: boolean;
  readonly rootRef?: RefCallback<Element>;
}

interface WorkspaceOwnerThumbnailProps {
  readonly label: string;
  readonly owner: RepositoryOwner | null;
  readonly title: string;
}

interface WorkspaceTabNameButtonProps {
  readonly branch: string | null;
  readonly isActionsMenuOpen: boolean;
  readonly isActive: boolean;
  readonly isDisabled: boolean;
  readonly label: string;
  readonly onActivate: (sessionId: RepositorySessionId) => Promise<void>;
  readonly onOpenActions: (trigger: HTMLButtonElement) => void;
  readonly repositoryName: string;
  readonly sessionId: RepositorySessionId;
}

interface WorkspaceChangedFilesProps {
  readonly count: number;
}

const OWNER_THUMBNAIL_TONES = [
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-700",
] as const;

const WORKSPACE_OWNER_THUMBNAIL_CLASS_NAME =
  "shrink-0 rounded-full ring-1 ring-black/5";

const WORKSPACE_TAB_STYLE: CSSProperties = {
  height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabHeight,
  width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabWidth,
};

const WORKSPACE_TAB_VISUAL_STYLE: CSSProperties = {
  borderRadius: WORKSPACE_TAB_SURFACE_GEOMETRY.tabRadius,
  insetBlock: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetBlock,
  insetInline: WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetInline,
};

const WORKSPACE_TAB_ACTIVATOR_STYLE: CSSProperties = {
  paddingBlock: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentInsetBlock,
  paddingInlineEnd: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentGap,
  paddingInlineStart: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentInsetInlineStart,
};

const WORKSPACE_OWNER_THUMBNAIL_STYLE: CSSProperties = {
  height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabAvatarSize,
  width: WORKSPACE_TAB_SURFACE_GEOMETRY.tabAvatarSize,
};

const WORKSPACE_TAB_CHANGE_BADGE_STYLE: CSSProperties = {
  height: WORKSPACE_TAB_SURFACE_GEOMETRY.tabChangeBadgeHeight,
  marginInlineEnd: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentGap / 4,
  marginInlineStart: WORKSPACE_TAB_SURFACE_GEOMETRY.tabContentGap,
  minWidth: WORKSPACE_TAB_SURFACE_GEOMETRY.tabChangeBadgeMinWidth,
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

const getThumbnailTone = (label: string): string => {
  let toneIndex = 0;
  for (const character of label) {
    toneIndex =
      (toneIndex + (character.codePointAt(0) ?? 0)) %
      OWNER_THUMBNAIL_TONES.length;
  }
  return OWNER_THUMBNAIL_TONES[toneIndex] ?? OWNER_THUMBNAIL_TONES[0];
};

const getOwnerTitle = (workspace: WorkspaceTabState): string =>
  workspace.owner
    ? `${workspace.owner.namespace} on ${workspace.owner.host}`
    : "Local repository";

const getAccessibleTabLabel = (
  label: string,
  workspace: WorkspaceTabState
): string =>
  workspace.owner ? `${label}, owned by ${workspace.owner.namespace}` : label;

function WorkspaceOwnerThumbnail({
  label,
  owner,
  title,
}: WorkspaceOwnerThumbnailProps): ReactElement {
  const avatarDataUrl = useRepositoryOwnerAvatar(owner);
  const [failedDataUrl, setFailedDataUrl] = useState<string | null>(null);
  const initial = label.trim().charAt(0).toLocaleUpperCase() || "•";
  const showAvatar = avatarDataUrl !== null && avatarDataUrl !== failedDataUrl;
  const hideInvalidAvatar = (): void => {
    setFailedDataUrl(avatarDataUrl);
  };

  if (showAvatar) {
    return (
      <img
        alt=""
        aria-hidden
        className={cn(WORKSPACE_OWNER_THUMBNAIL_CLASS_NAME, "object-cover")}
        data-name="RepositoryOwnerThumbnail"
        decoding="async"
        draggable={false}
        height={WORKSPACE_TAB_SURFACE_GEOMETRY.tabAvatarSize}
        onError={hideInvalidAvatar}
        src={avatarDataUrl}
        style={WORKSPACE_OWNER_THUMBNAIL_STYLE}
        title={title}
        width={WORKSPACE_TAB_SURFACE_GEOMETRY.tabAvatarSize}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        WORKSPACE_OWNER_THUMBNAIL_CLASS_NAME,
        "flex items-center justify-center font-semibold text-[9px]",
        getThumbnailTone(label)
      )}
      data-name="RepositoryOwnerThumbnail"
      style={WORKSPACE_OWNER_THUMBNAIL_STYLE}
      title={title}
    >
      {initial}
    </span>
  );
}

function WorkspaceTabNameButton({
  branch,
  isActionsMenuOpen,
  isActive,
  isDisabled,
  label,
  onActivate,
  onOpenActions,
  repositoryName,
  sessionId,
}: WorkspaceTabNameButtonProps): ReactElement {
  const selectWorkspaceOrOpenActions = async (
    event: MouseEvent<HTMLButtonElement>
  ): Promise<void> => {
    if (!isActive) {
      await onActivate(sessionId);
      return;
    }
    onOpenActions(event.currentTarget);
  };

  return (
    <button
      aria-controls={isActive ? WORKSPACE_ACTIONS_MENU_ID : undefined}
      aria-expanded={isActive ? isActionsMenuOpen : undefined}
      aria-haspopup={isActive ? "dialog" : undefined}
      aria-label={isActive ? `Open actions for ${label}` : `Activate ${label}`}
      className="relative z-10 flex h-full min-w-0 flex-1 items-center rounded-md text-left outline-none hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-brand/20"
      data-desktop-interactive
      disabled={isDisabled}
      onClick={selectWorkspaceOrOpenActions}
      tabIndex={isActive ? 0 : -1}
      title={label}
      type="button"
    >
      <span className="min-w-0 truncate text-xss">
        <span className={cn(isActive ? "font-semibold" : "font-medium")}>
          {repositoryName}
        </span>
        {branch ? <span className="text-editor-faint"> / {branch}</span> : null}
      </span>
    </button>
  );
}

function WorkspaceChangedFiles({
  count,
}: WorkspaceChangedFilesProps): ReactElement | null {
  if (count <= 0) {
    return null;
  }

  const label = `${count} changed ${count === 1 ? "file" : "files"}`;

  return (
    <span
      className="relative z-10 flex shrink-0 items-center justify-center rounded-full bg-amber-100 px-1 font-semibold text-[9px] text-amber-800 tabular-nums ring-1 ring-amber-700/10"
      data-name="WorkspaceChangedFiles"
      style={WORKSPACE_TAB_CHANGE_BADGE_STYLE}
      title={label}
    >
      <span aria-hidden>{count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function WorkspaceTabAppearance({
  handleRef,
  isActionsMenuOpen,
  isActive,
  isBusy,
  isDragging,
  isOverlay = false,
  onActivate,
  onClose,
  onOpenActions,
  rootRef,
  workspace,
}: WorkspaceTabAppearanceProps): ReactElement {
  const repositoryName = getRepositoryName(workspace.session.repository.root);
  const label = getWorkspaceLabel(
    workspace.session.repository.root,
    workspace.branch
  );
  const ownerLabel = workspace.owner?.name ?? repositoryName;
  const changedFileCount = workspace.changedFiles ?? 0;
  const activateWorkspace = async (): Promise<void> => {
    await onActivate(workspace.session.id);
  };
  const closeWorkspace = async (): Promise<void> => {
    await onClose(workspace.session.id);
  };

  return (
    <div
      aria-hidden={isOverlay || undefined}
      className={cn(
        "group relative z-[2] flex shrink-0 items-center px-1 transition-colors",
        isActive ? "text-editor-ink" : "text-editor-muted hover:text-editor-ink"
      )}
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
        aria-label={getAccessibleTabLabel(label, workspace)}
        aria-selected={isActive}
        className="relative z-10 flex h-full shrink-0 cursor-default touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-brand/20 active:cursor-grabbing"
        data-desktop-interactive
        disabled={isBusy || isOverlay}
        onClick={activateWorkspace}
        ref={handleRef}
        role="tab"
        style={WORKSPACE_TAB_ACTIVATOR_STYLE}
        tabIndex={isActive ? 0 : -1}
        title={label}
        type="button"
      >
        <WorkspaceOwnerThumbnail
          label={ownerLabel}
          owner={workspace.owner}
          title={getOwnerTitle(workspace)}
        />
      </button>
      <WorkspaceTabNameButton
        branch={workspace.branch}
        isActionsMenuOpen={isActionsMenuOpen}
        isActive={isActive}
        isDisabled={isBusy || isOverlay}
        label={label}
        onActivate={onActivate}
        onOpenActions={onOpenActions}
        repositoryName={repositoryName}
        sessionId={workspace.session.id}
      />
      <WorkspaceChangedFiles count={changedFileCount} />
      <button
        aria-label={`Close ${label}`}
        className={cn(
          "relative z-10 flex shrink-0 items-center justify-center rounded-lg text-editor-faint outline-none hover:bg-active hover:text-editor-ink focus-visible:bg-active focus-visible:ring-2 focus-visible:ring-brand/20",
          !isActive &&
          "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        )}
        disabled={isBusy || isOverlay}
        onClick={closeWorkspace}
        style={WORKSPACE_TAB_CLOSE_STYLE}
        tabIndex={isActive ? 0 : -1}
        type="button"
      >
        <XIcon aria-hidden className="size-3" weight="bold" />
      </button>
    </div>
  );
}

export function WorkspaceTab({
  index,
  ...appearanceProps
}: WorkspaceTabProps): ReactElement {
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
}

export function WorkspaceTabOverlay(
  props: Omit<WorkspaceTabProps, "index">
): ReactElement {
  return <WorkspaceTabAppearance {...props} isDragging isOverlay />;
}
