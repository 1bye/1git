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
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import type {
	ChangeEvent,
	FormEvent,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
} from "react";
import { useId, useState } from "react";
import type { PendingWorkspaceAction } from "../../../feature/workspace/hooks/use-git-workspace.js";
import { formatCommitDate } from "../../../feature/workspace/lib/workspace-model.js";
import {
	LiquidMenuContent,
	LiquidMenuSub,
	LiquidMenuSubContent,
	LiquidMenuSubTrigger,
} from "../../liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "../../liquid-menu/components/liquid-menu-auto-size.js";
import { WORKSPACE_BRANCH_TOOLTIP_DELAY_MS } from "../constants/workspace-actions-menu.js";
import {
	formatBranchCommitAge,
	groupWorkspaceBranches,
} from "../lib/workspace-actions-menu.js";

interface WorkspaceActionsMenuProps {
	readonly branches: BranchCollection | null;
	readonly currentBranch: string;
	readonly onClose: () => void;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onSwitchBranch: (name: string) => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
}

interface BranchMenuItemProps {
	readonly branch: BranchInfo;
	readonly isPending: boolean;
	readonly isSubmenuItem: boolean;
	readonly onClose: () => void;
	readonly onSwitchBranch: (name: string) => Promise<void>;
}

interface CreateBranchFormProps {
	readonly isPending: boolean;
	readonly onCancel: () => void;
	readonly onClose: () => void;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly pendingAction: PendingWorkspaceAction;
}

function BranchMenuItem({
	branch,
	isPending,
	isSubmenuItem,
	onClose,
	onSwitchBranch,
}: BranchMenuItemProps): ReactElement {
	const commitAge = formatBranchCommitAge(branch.committedAt);
	const tooltipId = useId();
	const [tooltipSide, setTooltipSide] = useState<"left" | "right">(
		isSubmenuItem ? "left" : "right"
	);
	const switchBranch = async (): Promise<void> => {
		onClose();
		if (!branch.checkedOut) {
			await onSwitchBranch(branch.name);
		}
	};
	const positionTooltipOutsideSubmenu = (
		event: ReactMouseEvent<HTMLElement>
	): void => {
		if (!isSubmenuItem) {
			return;
		}

		const submenu = event.currentTarget.closest<HTMLElement>(
			"[data-slot='dropdown-menu-sub-content']"
		);
		setTooltipSide(submenu?.dataset.side === "left" ? "left" : "right");
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
			closeOnClick
			disabled={isPending}
			onClick={switchBranch}
			onMouseEnter={positionTooltipOutsideSubmenu}
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
				side={tooltipSide}
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

export function WorkspaceActionsMenu({
	branches,
	currentBranch,
	onClose,
	onCreateBranch,
	onFetch,
	onSwitchBranch,
	pendingAction,
}: WorkspaceActionsMenuProps): ReactElement {
	const [isCreating, setIsCreating] = useState(false);
	const { latestBranches, remainingBranches } =
		groupWorkspaceBranches(branches);
	const isPending = pendingAction !== null;
	const beginBranchCreation = (): void => setIsCreating(true);
	const cancelBranchCreation = (): void => setIsCreating(false);
	const fetchRepository = async (): Promise<void> => {
		onClose();
		await onFetch();
	};

	return (
		<TooltipProvider delay={WORKSPACE_BRANCH_TOOLTIP_DELAY_MS}>
			<LiquidMenuContent
				align="center"
				aria-busy={isPending}
				aria-label="Workspace actions"
				className="w-72 min-w-72"
				sideOffset={2}
			>
				<LiquidMenuAutoSize viewKey={isCreating ? "create-branch" : "actions"}>
					<DropdownMenuGroup>
						<DropdownMenuLabel className="flex items-center gap-2 px-2 py-1.5 normal-case tracking-normal">
							<GitBranchIcon
								aria-hidden
								className="size-3.5 shrink-0 text-editor-faint"
								weight="regular"
							/>
							<span className="min-w-0">
								<span className="block font-normal text-[9px] text-editor-faint">
									Current branch
								</span>
								<span className="block truncate font-semibold text-editor-ink text-xs">
									{currentBranch || "Detached HEAD"}
								</span>
							</span>
						</DropdownMenuLabel>
					</DropdownMenuGroup>

					<DropdownMenuSeparator />

					{isCreating ? (
						<CreateBranchForm
							isPending={isPending}
							onCancel={cancelBranchCreation}
							onClose={onClose}
							onCreateBranch={onCreateBranch}
							pendingAction={pendingAction}
						/>
					) : (
						<>
							<DropdownMenuGroup>
								<DropdownMenuLabel>Switch branch</DropdownMenuLabel>
								{latestBranches.map((branch) => (
									<BranchMenuItem
										branch={branch}
										isPending={isPending}
										isSubmenuItem={false}
										key={branch.fullName}
										onClose={onClose}
										onSwitchBranch={onSwitchBranch}
									/>
								))}
								{latestBranches.length === 0 ? (
									<DropdownMenuLabel className="py-2 font-normal text-xss normal-case tracking-normal">
										No local branches available.
									</DropdownMenuLabel>
								) : null}
								{remainingBranches.length > 0 ? (
									<LiquidMenuSub>
										<LiquidMenuSubTrigger disabled={isPending}>
											More
										</LiquidMenuSubTrigger>
										<LiquidMenuSubContent
											align="start"
											className="w-48 min-w-48"
										>
											{remainingBranches.map((branch) => (
												<BranchMenuItem
													branch={branch}
													isPending={isPending}
													isSubmenuItem
													key={branch.fullName}
													onClose={onClose}
													onSwitchBranch={onSwitchBranch}
												/>
											))}
										</LiquidMenuSubContent>
									</LiquidMenuSub>
								) : null}
							</DropdownMenuGroup>

							<DropdownMenuSeparator />

							<DropdownMenuGroup>
								<DropdownMenuItem
									closeOnClick={false}
									disabled={isPending}
									onClick={beginBranchCreation}
								>
									<PlusIcon
										aria-hidden
										className="text-editor-faint"
										weight="bold"
									/>
									Create new branch…
								</DropdownMenuItem>
								<DropdownMenuItem
									closeOnClick
									disabled={isPending}
									onClick={fetchRepository}
								>
									<ArrowsClockwiseIcon
										aria-hidden
										className="text-editor-faint"
										weight="regular"
									/>
									Fetch remote
								</DropdownMenuItem>
							</DropdownMenuGroup>
						</>
					)}
				</LiquidMenuAutoSize>
			</LiquidMenuContent>
		</TooltipProvider>
	);
}
