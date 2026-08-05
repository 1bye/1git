import type { BranchCollection, CommitInfo, ResetMode } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import { Input } from "@1git/ui/components/input";
import { Textarea } from "@1git/ui/components/textarea";
import { cn } from "@1git/ui/lib/utils";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type {
  FormEvent,
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useCallback, useState } from "react";
import { formatRelativeTime } from "@/feature/workspace/lib/workspace-model.js";
import {
  LiquidContextMenuRoot,
  LiquidContextMenuTrigger,
  LiquidMenuContent,
  LiquidMenuSub,
  LiquidMenuSubContent,
  LiquidMenuSubTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";
import { useLiquidContextMenuPosition } from "@/fixture/liquid-menu/hooks/use-liquid-context-menu-position.js";
import {
  REPOSITORY_HISTORY_CONTEXT_MENU_ANCHOR_GEOMETRY,
  REPOSITORY_HISTORY_CONTEXT_MENU_WIDTH,
  REPOSITORY_HISTORY_CONTEXT_MENU_WIDTH_CLASS_NAME,
} from "@/fixture/repository-workspace/constants/repository-workspace.js";
import {
  canAmendHistoryCommit,
  canRevertHistoryCommit,
  getCherryPickTargetBranches,
} from "@/fixture/repository-workspace/lib/repository-history-actions.js";

type HistoryMenuView = "actions" | "amend" | "reset";

interface RepositoryHistoryContextMenuProps {
  readonly branches: BranchCollection | null;
  readonly commit: CommitInfo;
  readonly currentBranch: string | null;
  readonly headOid: string | null;
  readonly isPending: boolean;
  readonly isSelected: boolean;
  readonly onAmend: (
    commit: CommitInfo,
    summary: string,
    description: string
  ) => Promise<boolean>;
  readonly onCherryPick: (
    commit: CommitInfo,
    branchName: string
  ) => Promise<boolean>;
  readonly onReset: (commit: CommitInfo, mode: ResetMode) => Promise<boolean>;
  readonly onRevert: (commit: CommitInfo) => Promise<boolean>;
  readonly onSelect: (commit: CommitInfo) => Promise<void>;
}

interface RepositoryHistoryContextActionsProps
  extends Omit<RepositoryHistoryContextMenuProps, "isSelected" | "onSelect"> {
  readonly onDismiss: () => void;
}

const RESET_MODE_DETAILS: Readonly<
  Record<ResetMode, { readonly description: string; readonly label: string }>
> = {
  hard: {
    description: "Discard later commits and every uncommitted change.",
    label: "Hard",
  },
  mixed: {
    description: "Keep later changes in the working tree, unstaged.",
    label: "Mixed",
  },
  soft: {
    description: "Keep later changes staged and ready to commit.",
    label: "Soft",
  },
};

const stopMenuNavigation = (
  event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
): void => {
  if (event.key !== "Escape") {
    event.stopPropagation();
  }
};

function HistoryMenuBack({
  label,
  onBack,
}: {
  readonly label: string;
  readonly onBack: () => void;
}): ReactElement {
  return (
    <>
      <DropdownMenuItem
        className="gap-2.5 py-2"
        closeOnClick={false}
        onClick={onBack}
      >
        <ArrowLeftIcon aria-hidden weight="bold" />
        {label}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

function HistoryActionStatus({
  children,
}: {
  readonly children: string;
}): ReactElement {
  return (
    <p
      aria-live="polite"
      className="px-2 py-1.5 text-[10px] text-destructive leading-4"
      role="status"
    >
      {children}
    </p>
  );
}

function AmendCommitForm({
  commit,
  isPending,
  onAmend,
  onBack,
}: {
  readonly commit: CommitInfo;
  readonly isPending: boolean;
  readonly onAmend: (summary: string, description: string) => Promise<boolean>;
  readonly onBack: () => void;
}): ReactElement {
  const [summary, setSummary] = useState(commit.summary);
  const [description, setDescription] = useState(commit.body);
  const [actionError, setActionError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setActionError(null);
    if (!(await onAmend(summary, description))) {
      setActionError("The commit could not be amended.");
    }
  };

  return (
    <>
      <HistoryMenuBack label="Amend commit" onBack={onBack} />
      <form className="space-y-2 p-1" onSubmit={submit}>
        <Input
          aria-label="Commit summary"
          autoFocus
          className="h-8 bg-editor-sunken text-xs shadow-none"
          disabled={isPending}
          maxLength={120}
          onChange={(event) => setSummary(event.target.value)}
          onKeyDown={stopMenuNavigation}
          placeholder="Summary"
          value={summary}
        />
        <Textarea
          aria-label="Commit description"
          className="min-h-20 border-0 bg-editor-sunken text-xs shadow-none focus-visible:ring-editor-muted/15"
          disabled={isPending}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={stopMenuNavigation}
          placeholder="Description"
          value={description}
        />
        <div className="flex justify-end gap-1.5 pt-1">
          <Button
            disabled={isPending}
            onClick={onBack}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={isPending || !summary.trim()}
            size="sm"
            type="submit"
          >
            {isPending ? (
              <SpinnerGapIcon aria-hidden className="animate-spin" />
            ) : null}
            Amend
          </Button>
        </div>
      </form>
      {actionError ? (
        <HistoryActionStatus>{actionError}</HistoryActionStatus>
      ) : null}
    </>
  );
}

function ResetCommitForm({
  branch,
  commit,
  isPending,
  onBack,
  onReset,
}: {
  readonly branch: string | null;
  readonly commit: CommitInfo;
  readonly isPending: boolean;
  readonly onBack: () => void;
  readonly onReset: (mode: ResetMode) => Promise<boolean>;
}): ReactElement {
  const [mode, setMode] = useState<ResetMode>("mixed");
  const [actionError, setActionError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setActionError(null);
    if (!(await onReset(mode))) {
      setActionError("The branch could not be reset.");
    }
  };
  const selectedMode = RESET_MODE_DETAILS[mode];

  return (
    <>
      <HistoryMenuBack label="Reset branch" onBack={onBack} />
      <form className="space-y-2 p-1" onSubmit={submit}>
        <p className="px-1 text-[10px] text-editor-faint leading-4">
          Move {branch ?? "the current branch"} to {commit.oid.slice(0, 7)}.
        </p>
        <fieldset className="grid grid-cols-3 gap-1 rounded-lg border-0 bg-editor-sunken p-1">
          <legend className="sr-only">Reset mode</legend>
          {(["soft", "mixed", "hard"] as const).map((candidate) => (
            <button
              aria-pressed={mode === candidate}
              className={cn(
                "rounded-md px-2 py-1.5 font-medium text-[10px] text-editor-muted outline-none transition-colors hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-editor-muted/20",
                mode === candidate && "bg-editor-surface text-editor-ink"
              )}
              disabled={isPending}
              key={candidate}
              onClick={() => setMode(candidate)}
              type="button"
            >
              {RESET_MODE_DETAILS[candidate].label}
            </button>
          ))}
        </fieldset>
        <p className="min-h-8 px-1 text-[10px] text-editor-faint leading-4">
          {selectedMode.description}
        </p>
        <div className="flex justify-end gap-1.5">
          <Button
            disabled={isPending}
            onClick={onBack}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={isPending}
            size="sm"
            type="submit"
            variant={mode === "hard" ? "destructive" : "default"}
          >
            {isPending ? (
              <SpinnerGapIcon aria-hidden className="animate-spin" />
            ) : null}
            Reset
          </Button>
        </div>
      </form>
      {actionError ? (
        <HistoryActionStatus>{actionError}</HistoryActionStatus>
      ) : null}
    </>
  );
}

function RepositoryHistoryContextActions({
  branches,
  commit,
  currentBranch,
  headOid,
  isPending,
  onAmend,
  onCherryPick,
  onDismiss,
  onReset,
  onRevert,
}: RepositoryHistoryContextActionsProps): ReactElement {
  const [view, setView] = useState<HistoryMenuView>("actions");
  const [actionError, setActionError] = useState<string | null>(null);
  const cherryPickTargets = getCherryPickTargetBranches(branches);
  const perform = async (
    action: () => Promise<boolean>,
    error: string
  ): Promise<void> => {
    setActionError(null);
    if (await action()) {
      onDismiss();
      return;
    }
    setActionError(error);
  };

  if (view === "amend") {
    return (
      <LiquidMenuAutoSize viewKey="amend">
        <AmendCommitForm
          commit={commit}
          isPending={isPending}
          onAmend={async (summary, description) => {
            const succeeded = await onAmend(commit, summary, description);
            if (succeeded) {
              onDismiss();
            }
            return succeeded;
          }}
          onBack={() => setView("actions")}
        />
      </LiquidMenuAutoSize>
    );
  }

  if (view === "reset") {
    return (
      <LiquidMenuAutoSize viewKey="reset">
        <ResetCommitForm
          branch={currentBranch}
          commit={commit}
          isPending={isPending}
          onBack={() => setView("actions")}
          onReset={async (mode) => {
            const succeeded = await onReset(commit, mode);
            if (succeeded) {
              onDismiss();
            }
            return succeeded;
          }}
        />
      </LiquidMenuAutoSize>
    );
  }

  return (
    <LiquidMenuAutoSize viewKey="actions">
      <DropdownMenuItem
        className="gap-2.5 py-2"
        closeOnClick={false}
        disabled={!canAmendHistoryCommit(commit, headOid) || isPending}
        onClick={() => setView("amend")}
      >
        <PencilSimpleIcon aria-hidden weight="duotone" />
        Amend last commit…
      </DropdownMenuItem>
      <LiquidMenuSub>
        <LiquidMenuSubTrigger
          className="gap-2.5 py-2"
          disabled={cherryPickTargets.length === 0 || isPending}
        >
          <GitBranchIcon aria-hidden weight="duotone" />
          Cherry-pick onto
        </LiquidMenuSubTrigger>
        <LiquidMenuSubContent
          className="max-h-64 w-56 min-w-56 overflow-y-auto p-1.5"
          side="right"
          sideOffset={4}
        >
          {cherryPickTargets.map((branch) => (
            <DropdownMenuItem
              closeOnClick={false}
              key={branch.fullName}
              onClick={async () =>
                await perform(
                  async () => await onCherryPick(commit, branch.name),
                  `Could not cherry-pick onto ${branch.name}.`
                )
              }
            >
              <GitBranchIcon aria-hidden weight="regular" />
              <span className="min-w-0 flex-1 truncate">{branch.name}</span>
            </DropdownMenuItem>
          ))}
        </LiquidMenuSubContent>
      </LiquidMenuSub>
      <DropdownMenuItem
        className="gap-2.5 py-2"
        closeOnClick={false}
        disabled={!canRevertHistoryCommit(commit) || isPending}
        onClick={async () =>
          await perform(
            async () => await onRevert(commit),
            "The commit could not be reverted."
          )
        }
        title={
          canRevertHistoryCommit(commit)
            ? undefined
            : "Merge commits cannot be reverted here."
        }
      >
        <ArrowCounterClockwiseIcon aria-hidden weight="duotone" />
        Revert commit
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="gap-2.5 py-2"
        closeOnClick={false}
        disabled={commit.oid === headOid || isPending}
        onClick={() => setView("reset")}
        variant="destructive"
      >
        <ClockCounterClockwiseIcon aria-hidden weight="duotone" />
        Reset branch to commit…
      </DropdownMenuItem>
      {actionError ? (
        <HistoryActionStatus>{actionError}</HistoryActionStatus>
      ) : null}
    </LiquidMenuAutoSize>
  );
}

export function RepositoryHistoryContextMenu({
  branches,
  commit,
  currentBranch,
  headOid,
  isPending,
  isSelected,
  onAmend,
  onCherryPick,
  onReset,
  onRevert,
  onSelect,
}: RepositoryHistoryContextMenuProps): ReactElement {
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPresent, setIsPresent] = useState(false);
  const contextMenuPosition = useLiquidContextMenuPosition({
    anchorElement,
    menuWidth: REPOSITORY_HISTORY_CONTEXT_MENU_WIDTH,
  });
  const getAnchor = useCallback(
    (): Element | null => anchorElement,
    [anchorElement]
  );
  const changeOpen = useCallback(
    (nextIsOpen: boolean): void => {
      setIsOpen(nextIsOpen);
      if (!nextIsOpen) {
        contextMenuPosition.resetPointer();
      }
    },
    [contextMenuPosition.resetPointer]
  );
  const selectCommit = async (): Promise<void> => {
    await onSelect(commit);
  };
  const openContextMenu = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    contextMenuPosition.onContextMenu(event);
    if (!isSelected) {
      onSelect(commit).catch(() => {
        // The workspace hook reports selection errors in the app notice.
      });
    }
  };
  const row = (
    <button
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "relative w-full rounded-lg px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-editor-muted/20 focus-visible:ring-inset",
        isSelected ? "bg-editor-sunken-2" : "hover:bg-editor-sunken",
        (isOpen || isPresent) &&
        "z-20 bg-white hover:bg-white focus-visible:bg-white"
      )}
      onClick={selectCommit}
      onContextMenu={openContextMenu}
      ref={setAnchorElement}
      type="button"
    >
      <span className="block min-w-0">
        <span className="block truncate font-medium text-editor-ink text-xss">
          {commit.summary}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[9px] text-editor-faint">
          <span className="min-w-0 flex-1 truncate">{commit.author.name}</span>
          <span className="shrink-0 tabular-nums">
            {formatRelativeTime(commit.committedAt)}
          </span>
        </span>
      </span>
    </button>
  );

  return (
    <LiquidContextMenuRoot
      anchor={getAnchor}
      anchorGeometry={REPOSITORY_HISTORY_CONTEXT_MENU_ANCHOR_GEOMETRY}
      onOpenChange={changeOpen}
      onPresenceChange={setIsPresent}
      open={isOpen}
    >
      <LiquidContextMenuTrigger render={row} />
      {isOpen ? (
        <LiquidMenuContent
          align="start"
          alignOffset={contextMenuPosition.alignOffset + 24}
          aria-label={`Actions for ${commit.summary}`}
          className={`${REPOSITORY_HISTORY_CONTEXT_MENU_WIDTH_CLASS_NAME} p-1.5`}
          side="bottom"
          sideOffset={0}
        >
          <RepositoryHistoryContextActions
            branches={branches}
            commit={commit}
            currentBranch={currentBranch}
            headOid={headOid}
            isPending={isPending}
            onAmend={onAmend}
            onCherryPick={onCherryPick}
            onDismiss={() => changeOpen(false)}
            onReset={onReset}
            onRevert={onRevert}
          />
        </LiquidMenuContent>
      ) : null}
    </LiquidContextMenuRoot>
  );
}
