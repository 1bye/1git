import type { BranchCollection } from "@1git/git";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
} from "@1git/ui/components/dropdown-menu";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { GitCommitIcon } from "@phosphor-icons/react/dist/csr/GitCommit";
import type { ReactElement } from "react";
import { useCallback, useRef } from "react";
import type {
	PendingWorkspaceAction,
	RepositoryTab,
} from "@/feature/workspace/hooks/use-git-workspace.js";
import {
	LiquidMenuContent,
	LiquidMenuRoot,
	LiquidMenuSub,
	LiquidMenuSubContent,
	LiquidMenuSubTrigger,
	LiquidMenuTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { REPOSITORY_QUICK_ACTIONS_ANCHOR_GEOMETRY } from "@/fixture/repository-workspace/constants/repository-workspace.js";

interface RepositoryQuickActionsProps {
	readonly allFilesStaged: boolean;
	readonly branches: BranchCollection | null;
	readonly changedFileCount: number;
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
	onFetch,
	onMergeBranch,
	onSetTab,
	onStashChanges,
	onToggleAllFiles,
	pendingAction,
}: RepositoryQuickActionsProps): ReactElement {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const isPending = pendingAction !== null;
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

	return (
		<LiquidMenuRoot
			anchor={getAnchor}
			anchorGeometry={REPOSITORY_QUICK_ACTIONS_ANCHOR_GEOMETRY}
			disabled={isPending}
			modal
		>
			<LiquidMenuTrigger
				className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-medium text-editor-muted text-xss outline-none transition-colors hover:bg-editor-sunken hover:text-editor-ink focus-visible:ring-2 focus-visible:ring-editor-muted/20"
				ref={triggerRef}
			>
				Quick actions
				<CaretRightIcon
					aria-hidden
					className="size-3 rotate-90"
					weight="bold"
				/>
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
