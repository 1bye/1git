import type { BranchCollection, BranchInfo } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import { Input } from "@1git/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@1git/ui/components/tooltip";
import { cn } from "@1git/ui/lib/utils";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type {
	ChangeEvent,
	CSSProperties,
	FormEvent,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useId, useState } from "react";
import type { BranchSwitchResult } from "@/feature/workspace/lib/repository-stash.js";
import {
	isRepositorySyncActionKind,
	type RepositorySyncAction,
	repositorySyncProgressLabel,
} from "@/feature/workspace/lib/repository-sync.js";
import { formatCommitDate } from "@/feature/workspace/lib/workspace-model.js";
import type { PendingWorkspaceAction } from "@/feature/workspace/types/git-workspace.js";
import {
	WORKSPACE_BRANCH_EXPANDED_VISIBLE_LIMIT,
	WORKSPACE_BRANCH_MENU_ITEM_HEIGHT_PX,
	WORKSPACE_BRANCH_TOOLTIP_DELAY_MS,
} from "@/fixture/desktop-toolbar/constants/workspace-actions-menu.js";
import {
	formatBranchCommitAge,
	groupWorkspaceBranches,
} from "@/fixture/desktop-toolbar/lib/workspace-actions-menu.js";
import { LiquidMenuContent } from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";

interface WorkspaceActionsMenuProps {
	readonly branches: BranchCollection | null;
	readonly currentBranch: string;
	readonly onCancelSync: () => Promise<void>;
	readonly onClose: () => void;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly onStashAndSwitchBranch: (name: string) => Promise<boolean>;
	readonly onSwitchBranch: (name: string) => Promise<BranchSwitchResult>;
	readonly onSync: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly syncAction: RepositorySyncAction;
}

interface BranchMenuItemProps {
	readonly branch: BranchInfo;
	readonly isPending: boolean;
	readonly onClose: () => void;
	readonly onNeedsStash: (branch: BranchInfo) => void;
	readonly onSwitchBranch: (name: string) => Promise<BranchSwitchResult>;
}

interface CreateBranchFormProps {
	readonly isPending: boolean;
	readonly onCancel: () => void;
	readonly onClose: () => void;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly pendingAction: PendingWorkspaceAction;
}

interface RepositorySyncMenuItemProps {
	readonly onCancelSync: () => Promise<void>;
	readonly onClose: () => void;
	readonly onSync: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly syncAction: RepositorySyncAction;
}

interface StashAndSwitchConfirmationProps {
	readonly branch: BranchInfo;
	readonly isPending: boolean;
	readonly onCancel: () => void;
	readonly onClose: () => void;
	readonly onStashAndSwitchBranch: (name: string) => Promise<boolean>;
}

interface WorkspaceBranchActionsProps {
	readonly branchListId: string;
	readonly hasMoreBranches: boolean;
	readonly isBranchListExpanded: boolean;
	readonly isPending: boolean;
	readonly onBeginBranchCreation: () => void;
	readonly onCancelSync: () => Promise<void>;
	readonly onClose: () => void;
	readonly onNeedsStash: (branch: BranchInfo) => void;
	readonly onSwitchBranch: (name: string) => Promise<BranchSwitchResult>;
	readonly onSync: () => Promise<void>;
	readonly onToggleBranchList: () => void;
	readonly pendingAction: PendingWorkspaceAction;
	readonly syncAction: RepositorySyncAction;
	readonly visibleBranches: readonly BranchInfo[];
}

function BranchMenuItem({
	branch,
	isPending,
	onClose,
	onNeedsStash,
	onSwitchBranch,
}: BranchMenuItemProps): ReactElement {
	const commitAge = formatBranchCommitAge(branch.committedAt);
	const tooltipId = useId();
	const switchBranch = async (): Promise<void> => {
		if (branch.checkedOut) {
			onClose();
			return;
		}
		const result = await onSwitchBranch(branch.name);
		if (result === "needs-stash") {
			onNeedsStash(branch);
			return;
		}
		onClose();
	};
	const menuItemLabel = [
		branch.name,
		branch.checkedOut ? "current branch" : null,
		commitAge ? `last commit ${commitAge}` : null,
	]
		.filter(Boolean)
		.join(", ");
	const menuItem = (
		<DropdownMenuItem
			aria-current={branch.checkedOut ? "true" : undefined}
			aria-describedby={branch.committedAt && commitAge ? tooltipId : undefined}
			aria-label={menuItemLabel}
			closeOnClick={false}
			disabled={isPending}
			onClick={switchBranch}
		>
			{branch.checkedOut ? (
				<CheckIcon aria-hidden className="text-brand" weight="bold" />
			) : (
				<GitBranchIcon
					aria-hidden
					className="text-editor-faint"
					weight="regular"
				/>
			)}
			<span className="min-w-0 flex-1 truncate">{branch.name}</span>
			{commitAge ? (
				<span className="shrink-0 font-normal text-[10px] text-editor-faint tabular-nums">
					{commitAge}
				</span>
			) : null}
		</DropdownMenuItem>
	);

	if (!(branch.committedAt && commitAge)) {
		return menuItem;
	}

	return (
		<Tooltip>
			<TooltipTrigger render={menuItem} />
			<TooltipContent
				align="center"
				className="max-w-72 items-start"
				id={tooltipId}
				side="right"
				sideOffset={8}
			>
				<span className="min-w-0">
					<span className="block truncate font-semibold">{branch.name}</span>
					{branch.summary ? (
						<span className="mt-0.5 line-clamp-2 block opacity-80">
							{branch.summary}
						</span>
					) : null}
					<span className="mt-1 block text-[10px] opacity-65">
						Last commit {formatCommitDate(branch.committedAt)}
					</span>
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

function StashAndSwitchConfirmation({
	branch,
	isPending,
	onCancel,
	onClose,
	onStashAndSwitchBranch,
}: StashAndSwitchConfirmationProps): ReactElement {
	const stashAndSwitch = async (): Promise<void> => {
		if (await onStashAndSwitchBranch(branch.name)) {
			onClose();
		}
	};

	return (
		<div className="p-1">
			<p className="px-1 font-medium text-xs">Stash local changes?</p>
			<p className="mt-1 px-1 text-editor-muted text-xss leading-4">
				Your changes will be kept in the stash shelf before switching to{" "}
				<span className="font-medium text-editor-ink">{branch.name}</span>.
			</p>
			<div className="mt-2 flex justify-end gap-1">
				<Button
					disabled={isPending}
					onClick={onCancel}
					size="sm"
					type="button"
					variant="ghost"
				>
					Cancel
				</Button>
				<Button
					disabled={isPending}
					onClick={stashAndSwitch}
					size="sm"
					type="button"
					variant="brand"
				>
					<FileCodeIcon aria-hidden weight="duotone" />
					Stash and switch
				</Button>
			</div>
		</div>
	);
}

function CreateBranchForm({
	isPending,
	onCancel,
	onClose,
	onCreateBranch,
	pendingAction,
}: CreateBranchFormProps): ReactElement {
	const [branchName, setBranchName] = useState("");
	const updateBranchName = (event: ChangeEvent<HTMLInputElement>): void => {
		setBranchName(event.target.value);
	};
	const stopMenuNavigation = (
		event: ReactKeyboardEvent<HTMLInputElement>
	): void => {
		event.stopPropagation();
	};
	const createBranch = async (
		event: FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();
		const didCreate = await onCreateBranch(branchName);
		if (didCreate) {
			onClose();
		}
	};

	return (
		<form
			aria-busy={isPending}
			className="p-1"
			data-name="CreateBranchForm"
			onSubmit={createBranch}
		>
			<label
				className="px-1 font-medium text-[10px] text-editor-faint"
				htmlFor="new-workspace-branch-name"
			>
				New branch name
			</label>
			<Input
				autoComplete="off"
				autoFocus
				className="mt-1.5 h-8 text-xs"
				disabled={isPending}
				id="new-workspace-branch-name"
				onChange={updateBranchName}
				onKeyDown={stopMenuNavigation}
				placeholder="feature/my-change"
				required
				value={branchName}
			/>
			<div className="mt-2 flex justify-end gap-1">
				<Button
					disabled={isPending}
					onClick={onCancel}
					size="sm"
					type="button"
					variant="ghost"
				>
					Cancel
				</Button>
				<Button
					aria-busy={pendingAction === "branch"}
					disabled={!branchName.trim() || isPending}
					size="sm"
					type="submit"
					variant="brand"
				>
					Create
				</Button>
			</div>
		</form>
	);
}

const EXPANDED_BRANCH_LIST_STYLE: CSSProperties = {
	maxHeight:
		WORKSPACE_BRANCH_EXPANDED_VISIBLE_LIMIT *
		WORKSPACE_BRANCH_MENU_ITEM_HEIGHT_PX,
};

function RepositorySyncMenuItem({
	onCancelSync,
	onClose,
	onSync,
	pendingAction,
	syncAction,
}: RepositorySyncMenuItemProps): ReactElement {
	const isPending = pendingAction !== null;
	const isSyncPending = isRepositorySyncActionKind(pendingAction);
	const synchronizeRepository = async (): Promise<void> => {
		onClose();
		if (isSyncPending) {
			await onCancelSync();
		} else {
			await onSync();
		}
	};

	return (
		<DropdownMenuItem
			closeOnClick
			disabled={
				(isPending && !isSyncPending) ||
				(!isSyncPending && syncAction.disabledReason !== null)
			}
			onClick={synchronizeRepository}
			title={syncAction.disabledReason ?? syncAction.description}
		>
			{isSyncPending ? (
				<XIcon aria-hidden className="text-editor-faint" weight="bold" />
			) : (
				<ArrowsClockwiseIcon
					aria-hidden
					className="text-editor-faint"
					weight="regular"
				/>
			)}
			{isSyncPending
				? `Cancel ${repositorySyncProgressLabel(pendingAction).toLowerCase()}`
				: syncAction.label}
		</DropdownMenuItem>
	);
}

function WorkspaceBranchActions({
	branchListId,
	hasMoreBranches,
	isBranchListExpanded,
	isPending,
	onBeginBranchCreation,
	onCancelSync,
	onClose,
	onNeedsStash,
	onSwitchBranch,
	onSync,
	onToggleBranchList,
	pendingAction,
	syncAction,
	visibleBranches,
}: WorkspaceBranchActionsProps): ReactElement {
	return (
		<>
			<div
				className={
					isBranchListExpanded
						? "overflow-y-auto overscroll-contain"
						: undefined
				}
				id={branchListId}
				style={isBranchListExpanded ? EXPANDED_BRANCH_LIST_STYLE : undefined}
			>
				<DropdownMenuGroup>
					{visibleBranches.map((branch) => (
						<BranchMenuItem
							branch={branch}
							isPending={isPending}
							key={branch.fullName}
							onClose={onClose}
							onNeedsStash={onNeedsStash}
							onSwitchBranch={onSwitchBranch}
						/>
					))}
					{visibleBranches.length === 0 ? (
						<DropdownMenuLabel className="py-2 font-normal text-xss normal-case tracking-normal">
							No local branches available.
						</DropdownMenuLabel>
					) : null}
				</DropdownMenuGroup>
			</div>
			{hasMoreBranches ? (
				<DropdownMenuItem
					aria-controls={branchListId}
					aria-expanded={isBranchListExpanded}
					aria-label={
						isBranchListExpanded ? "Show fewer branches" : "Show all branches"
					}
					closeOnClick={false}
					disabled={isPending}
					onClick={onToggleBranchList}
				>
					More
					<CaretRightIcon
						aria-hidden
						className={cn(
							"ml-auto transition-transform duration-200 motion-reduce:transition-none",
							isBranchListExpanded && "rotate-90"
						)}
						weight="bold"
					/>
				</DropdownMenuItem>
			) : null}

			<DropdownMenuSeparator />

			<DropdownMenuGroup>
				<DropdownMenuItem
					closeOnClick={false}
					disabled={isPending}
					onClick={onBeginBranchCreation}
				>
					<PlusIcon aria-hidden className="text-editor-faint" weight="bold" />
					Create new branch…
				</DropdownMenuItem>
				<RepositorySyncMenuItem
					onCancelSync={onCancelSync}
					onClose={onClose}
					onSync={onSync}
					pendingAction={pendingAction}
					syncAction={syncAction}
				/>
			</DropdownMenuGroup>
		</>
	);
}

export function WorkspaceActionsMenu({
	branches,
	currentBranch,
	onCancelSync,
	onClose,
	onCreateBranch,
	onStashAndSwitchBranch,
	onSync,
	onSwitchBranch,
	pendingAction,
	syncAction,
}: WorkspaceActionsMenuProps): ReactElement {
	const [isCreating, setIsCreating] = useState(false);
	const [isBranchListExpanded, setIsBranchListExpanded] = useState(false);
	const [switchTarget, setSwitchTarget] = useState<BranchInfo | null>(null);
	const branchListId = useId();
	const { latestBranches, remainingBranches } =
		groupWorkspaceBranches(branches);
	const visibleBranches = isBranchListExpanded
		? [...latestBranches, ...remainingBranches]
		: latestBranches;
	const hasMoreBranches = remainingBranches.length > 0;
	const isPending = pendingAction !== null;
	const beginBranchCreation = (): void => setIsCreating(true);
	const cancelBranchCreation = (): void => setIsCreating(false);
	const cancelStashAndSwitch = (): void => setSwitchTarget(null);
	const toggleBranchList = (): void =>
		setIsBranchListExpanded((isExpanded) => !isExpanded);
	let menuViewKey = "actions";
	let content: ReactElement;
	if (isCreating) {
		menuViewKey = "create-branch";
		content = (
			<CreateBranchForm
				isPending={isPending}
				onCancel={cancelBranchCreation}
				onClose={onClose}
				onCreateBranch={onCreateBranch}
				pendingAction={pendingAction}
			/>
		);
	} else if (switchTarget) {
		menuViewKey = "stash-and-switch";
		content = (
			<StashAndSwitchConfirmation
				branch={switchTarget}
				isPending={isPending}
				onCancel={cancelStashAndSwitch}
				onClose={onClose}
				onStashAndSwitchBranch={onStashAndSwitchBranch}
			/>
		);
	} else {
		content = (
			<WorkspaceBranchActions
				branchListId={branchListId}
				hasMoreBranches={hasMoreBranches}
				isBranchListExpanded={isBranchListExpanded}
				isPending={isPending}
				onBeginBranchCreation={beginBranchCreation}
				onCancelSync={onCancelSync}
				onClose={onClose}
				onNeedsStash={setSwitchTarget}
				onSwitchBranch={onSwitchBranch}
				onSync={onSync}
				onToggleBranchList={toggleBranchList}
				pendingAction={pendingAction}
				syncAction={syncAction}
				visibleBranches={visibleBranches}
			/>
		);
	}

	return (
		<TooltipProvider delay={WORKSPACE_BRANCH_TOOLTIP_DELAY_MS}>
			<LiquidMenuContent
				align="center"
				aria-busy={isPending}
				aria-label={`Workspace actions for ${currentBranch || "detached HEAD"}`}
				className="w-72 min-w-72"
				sideOffset={2}
			>
				<LiquidMenuAutoSize viewKey={menuViewKey}>{content}</LiquidMenuAutoSize>
			</LiquidMenuContent>
		</TooltipProvider>
	);
}
