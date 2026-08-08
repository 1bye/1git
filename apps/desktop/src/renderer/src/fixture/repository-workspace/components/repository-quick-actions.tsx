import type { BranchCollection, HeadState } from "@1git/git";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
} from "@1git/ui/components/dropdown-menu";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { GitCommitIcon } from "@phosphor-icons/react/dist/csr/GitCommit";
import type { ReactElement } from "react";
import { useCallback, useRef } from "react";
import type {
	PendingWorkspaceAction,
	RepositoryTab,
} from "@/feature/workspace/types/git-workspace.js";
import {
	LiquidMenuContent,
	LiquidMenuRoot,
	LiquidMenuSub,
	LiquidMenuSubContent,
	LiquidMenuSubTrigger,
	LiquidMenuTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";

const REPOSITORY_QUICK_ACTIONS_ANCHOR_GEOMETRY = {
	insetBlock: 0,
	insetInline: 0,
	radius: 9,
} as const;

interface RepositoryQuickActionsProps {
	readonly allFilesStaged: boolean;
	readonly branches: BranchCollection | null;
	readonly changedFileCount: number;
	readonly head: HeadState;
	readonly onFetch: () => Promise<void>;
	readonly onMergeBranch: (name: string) => Promise<boolean>;
	readonly onSetTab: (tab: RepositoryTab) => Promise<void>;
	readonly onStashChanges: () => Promise<boolean>;
	readonly onToggleAllFiles: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
}

export function RepositoryQuickActions({
	allFilesStaged,
	branches,
	changedFileCount,
	head,
	onFetch,
	onMergeBranch,
	onSetTab,
	onStashChanges,
	onToggleAllFiles,
	pendingAction,
}: RepositoryQuickActionsProps): ReactElement {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const isPending = pendingAction !== null;
	const isFetching = pendingAction === "fetch";
	const mergeCandidates =
		branches?.branches.filter(
			(branch) => branch.type === "local" && !branch.checkedOut
		) ?? [];
	const getAnchor = useCallback((): Element | null => triggerRef.current, []);
	const fetchRepository = async (): Promise<void> => {
		await onFetch();
	};
	const toggleAllFiles = async (): Promise<void> => {
		await onToggleAllFiles();
	};
	const stashChanges = async (): Promise<void> => {
		await onStashChanges();
	};
	const showHistory = async (): Promise<void> => {
		await onSetTab("history");
	};
	const branchLabel = head.branch ?? "Detached";
	let trackingLabel = "No upstream configured";
	if (head.upstream) {
		trackingLabel =
			head.ahead === 0 && head.behind === 0
				? `Up to date with ${head.upstream}`
				: `${head.ahead} ahead and ${head.behind} behind ${head.upstream}`;
	}

	return (
		<LiquidMenuRoot
			anchor={getAnchor}
			anchorGeometry={REPOSITORY_QUICK_ACTIONS_ANCHOR_GEOMETRY}
			disabled={isPending}
			modal
		>
			<LiquidMenuTrigger
				aria-label={`Repository actions. ${branchLabel}. ${trackingLabel}`}
				className="flex h-7 min-w-0 max-w-36 items-center gap-1 overflow-hidden px-1 text-[9px] text-editor-muted outline-none transition-colors hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-brand/20"
				ref={triggerRef}
				title={`${branchLabel} · ${trackingLabel}`}
			>
				<GitBranchIcon
					aria-hidden
					className="size-3 shrink-0"
					weight="duotone"
				/>
				<span className="max-w-24 truncate">{branchLabel}</span>
				{isFetching ? (
					<ArrowsClockwiseIcon
						aria-hidden
						className="size-3 shrink-0 animate-spin"
						weight="duotone"
					/>
				) : null}
				<CaretDownIcon aria-hidden className="size-3 shrink-0" weight="bold" />
			</LiquidMenuTrigger>
			<LiquidMenuContent
				align="end"
				aria-label="Repository quick actions"
				className="w-64 min-w-64 p-1.5"
				sideOffset={8}
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel>Repository</DropdownMenuLabel>
					<DropdownMenuItem
						closeOnClick
						disabled={isPending}
						onClick={fetchRepository}
					>
						<ArrowsClockwiseIcon
							aria-hidden
							className="text-editor-faint"
							weight="duotone"
						/>
						Fetch remote
					</DropdownMenuItem>
					<DropdownMenuItem
						closeOnClick
						disabled={isPending || changedFileCount === 0}
						onClick={stashChanges}
					>
						<FileCodeIcon
							aria-hidden
							className="text-editor-faint"
							weight="duotone"
						/>
						Stash changes
					</DropdownMenuItem>
					{mergeCandidates.length > 0 ? (
						<LiquidMenuSub>
							<LiquidMenuSubTrigger disabled={isPending}>
								<GitBranchIcon
									aria-hidden
									className="text-editor-faint"
									weight="duotone"
								/>
								Merge into current branch
							</LiquidMenuSubTrigger>
							<LiquidMenuSubContent
								className="max-h-72 w-64 min-w-64 overflow-y-auto p-1.5"
								side="right"
								sideOffset={4}
							>
								<DropdownMenuLabel>Choose a branch</DropdownMenuLabel>
								{mergeCandidates.map((branch) => (
									<DropdownMenuItem
										closeOnClick
										key={branch.fullName}
										onClick={async () => {
											await onMergeBranch(branch.name);
										}}
									>
										<GitBranchIcon
											aria-hidden
											className="text-editor-faint"
											weight="regular"
										/>
										<span className="min-w-0 flex-1 truncate">
											{branch.name}
										</span>
									</DropdownMenuItem>
								))}
							</LiquidMenuSubContent>
						</LiquidMenuSub>
					) : null}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						closeOnClick
						disabled={isPending || changedFileCount === 0}
						onClick={toggleAllFiles}
					>
						<CheckIcon
							aria-hidden
							className="text-editor-faint"
							weight="bold"
						/>
						{allFilesStaged ? "Unstage all files" : "Stage all files"}
					</DropdownMenuItem>
					<DropdownMenuItem closeOnClick onClick={showHistory}>
						<GitCommitIcon
							aria-hidden
							className="text-editor-faint"
							weight="duotone"
						/>
						Show history
						<DropdownMenuShortcut>⌘2</DropdownMenuShortcut>
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</LiquidMenuContent>
		</LiquidMenuRoot>
	);
}
