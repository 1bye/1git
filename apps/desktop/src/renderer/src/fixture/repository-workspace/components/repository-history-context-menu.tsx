import type { BranchCollection, CommitInfo, ResetMode } from "@1git/git";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import { cn } from "@1git/ui/lib/utils";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import type {
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
} from "react";
import { useCallback, useState } from "react";
import {
	canAmendRepositoryCommit,
	canRevertRepositoryCommit,
	getRepositoryCherryPickTargets,
} from "@/feature/workspace/lib/repository-history-actions.js";
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
	AmendCommitForm,
	CreateBranchAtCommitForm,
	ResetCommitForm,
} from "@/fixture/repository-workspace/components/repository-history-context-forms.js";

type HistoryMenuView = "actions" | "amend" | "branch" | "reset";

const REPOSITORY_HISTORY_CONTEXT_MENU_ANCHOR_GEOMETRY = {
	insetBlock: 0,
	insetInline: 0,
	radius: 8,
} as const;
const REPOSITORY_HISTORY_CONTEXT_MENU_WIDTH = 280;
const REPOSITORY_HISTORY_CONTEXT_MENU_WIDTH_CLASS_NAME =
	"w-[280px] min-w-[280px]";

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
	readonly onCreateBranch: (
		name: string,
		startPoint?: string
	) => Promise<boolean>;
	readonly onNavigate: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
	readonly onReset: (commit: CommitInfo, mode: ResetMode) => Promise<boolean>;
	readonly onRevert: (commit: CommitInfo) => Promise<boolean>;
	readonly onSelect: (commit: CommitInfo) => Promise<void>;
}

interface RepositoryHistoryContextActionsProps
	extends Omit<
		RepositoryHistoryContextMenuProps,
		"isSelected" | "onNavigate" | "onSelect"
	> {
	readonly onDismiss: () => void;
}

function RepositoryHistoryContextActions({
	branches,
	commit,
	currentBranch,
	headOid,
	isPending,
	onAmend,
	onCherryPick,
	onCreateBranch,
	onDismiss,
	onReset,
	onRevert,
}: RepositoryHistoryContextActionsProps): ReactElement {
	const [view, setView] = useState<HistoryMenuView>("actions");
	const [actionError, setActionError] = useState<string | null>(null);
	const cherryPickTargets = getRepositoryCherryPickTargets(branches);
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

	if (view === "branch") {
		return (
			<LiquidMenuAutoSize viewKey="branch">
				<CreateBranchAtCommitForm
					commit={commit}
					isPending={isPending}
					onBack={() => setView("actions")}
					onCreate={async (name) => {
						const succeeded = await onCreateBranch(name, commit.oid);
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
				disabled={!canAmendRepositoryCommit(commit, headOid) || isPending}
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
				disabled={isPending}
				onClick={() => setView("branch")}
			>
				<GitBranchIcon aria-hidden weight="duotone" />
				Create branch here…
			</DropdownMenuItem>
			<DropdownMenuItem
				className="gap-2.5 py-2"
				closeOnClick={false}
				disabled={!canRevertRepositoryCommit(commit) || isPending}
				onClick={async () =>
					await perform(
						async () => await onRevert(commit),
						"The commit could not be reverted."
					)
				}
				title={
					canRevertRepositoryCommit(commit)
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

export function RepositoryHistoryContextMenu({
	branches,
	commit,
	currentBranch,
	headOid,
	isPending,
	isSelected,
	onAmend,
	onCherryPick,
	onCreateBranch,
	onNavigate,
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
				!isSelected && "hover:bg-hover",
				(isSelected || isOpen || isPresent) && "z-20"
			)}
			data-repository-revision-liquid-active={isSelected ? "true" : undefined}
			data-repository-revision-navigation-item={commit.oid}
			onClick={selectCommit}
			onContextMenu={openContextMenu}
			onKeyDown={onNavigate}
			ref={setAnchorElement}
			tabIndex={isSelected ? 0 : -1}
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
						onCreateBranch={onCreateBranch}
						onDismiss={() => changeOpen(false)}
						onReset={onReset}
						onRevert={onRevert}
					/>
				</LiquidMenuContent>
			) : null}
		</LiquidContextMenuRoot>
	);
}
