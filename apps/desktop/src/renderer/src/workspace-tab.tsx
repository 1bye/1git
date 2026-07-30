import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { MouseEvent, ReactElement } from "react";
import type { RepositorySessionId } from "../../shared/repository-session.js";
import type { WorkspaceTabState } from "./use-git-workspace.js";
import { getRepositoryName, getWorkspaceLabel } from "./workspace-model.js";

interface WorkspaceTabProps {
  readonly isActive: boolean;
  readonly isBusy: boolean;
  readonly onActivate: (sessionId: RepositorySessionId) => Promise<void>;
  readonly onClose: (sessionId: RepositorySessionId) => Promise<void>;
  readonly onOpenActions: (left: number) => void;
  readonly workspace: WorkspaceTabState;
}

export const WorkspaceTab = ({
  isActive,
  isBusy,
  onActivate,
  onClose,
  onOpenActions,
  workspace,
}: WorkspaceTabProps): ReactElement => {
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
      className={`group relative flex h-full min-w-0 max-w-[250px] items-center transition-colors ${isActive
        ? "bg-studio-glass-strong text-editor-ink"
        : "text-editor-muted hover:bg-hover hover:text-editor-ink"
        }`}
      data-name="WorkspaceTab"
    >
      <button
        aria-controls="repository-workspace"
        aria-selected={isActive}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/20"
        disabled={isBusy}
        onClick={activateWorkspace}
        role="tab"
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
      {isActive ? (
        <button
          aria-haspopup="menu"
          aria-label={`Open actions for ${label}`}
          className="flex h-full w-7 items-center justify-center text-editor-faint outline-none hover:text-editor-ink focus-visible:text-editor-ink"
          disabled={isBusy}
          onClick={openActions}
          type="button"
        >
          <CaretDownIcon aria-hidden className="size-3" weight="bold" />
        </button>
      ) : null}
      <button
        aria-label={`Close ${label}`}
        className={`mr-1 flex size-6 shrink-0 items-center justify-center rounded-lg text-editor-faint outline-none hover:bg-active hover:text-editor-ink focus-visible:bg-active ${isActive
          ? ""
          : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          }`}
        disabled={isBusy}
        onClick={closeWorkspace}
        type="button"
      >
        <XIcon aria-hidden className="size-3" weight="bold" />
      </button>
      {/*{isActive ? (
        <span className="absolute inset-x-3 bottom-0.5 h-0.5 rounded-full bg-brand" />
      ) : null}*/}
    </div>
  );
};
