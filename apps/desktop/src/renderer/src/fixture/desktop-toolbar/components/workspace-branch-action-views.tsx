import type { BranchInfo } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import { Input } from "@1git/ui/components/input";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type {
	FormEvent,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useState } from "react";

import type { PendingWorkspaceAction } from "@/feature/workspace/types/git-workspace.js";

const stopMenuNavigation = (
	event: ReactKeyboardEvent<HTMLInputElement>
): void => {
	if (event.key !== "Escape") {
		event.stopPropagation();
	}
};

function WorkspaceMenuBack({
	label,
	onBack,
}: {
	readonly label: string;
	readonly onBack: () => void;
}): ReactElement {
	return (
		<>
			<DropdownMenuItem closeOnClick={false} onClick={onBack}>
				<ArrowLeftIcon aria-hidden weight="bold" />
				{label}
			</DropdownMenuItem>
			<DropdownMenuSeparator />
		</>
	);
}

interface CreateBranchFormProps {
	readonly isPending: boolean;
	readonly onCancel: () => void;
	readonly onClose: () => void;
	readonly onCreateBranch: (
		name: string,
		startPoint?: string
	) => Promise<boolean>;
	readonly pendingAction: PendingWorkspaceAction;
}

export function CreateBranchForm({
	isPending,
	onCancel,
	onClose,
	onCreateBranch,
	pendingAction,
}: CreateBranchFormProps): ReactElement {
	const [branchName, setBranchName] = useState("");

	const createBranch = async (
		event: FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();

		if (await onCreateBranch(branchName)) {
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
				onChange={(event) => setBranchName(event.target.value)}
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

interface RenameBranchFormProps {
	readonly currentBranch: string;
	readonly isPending: boolean;
	readonly onBack: () => void;
	readonly onClose: () => void;
	readonly onRenameBranch: (newName: string) => Promise<boolean>;
}

export function RenameBranchForm({
	currentBranch,
	isPending,
	onBack,
	onClose,
	onRenameBranch,
}: RenameBranchFormProps): ReactElement {
	const [branchName, setBranchName] = useState(currentBranch);

	const renameBranch = async (
		event: FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();

		if (await onRenameBranch(branchName)) {
			onClose();
		}
	};

	return (
		<>
			<WorkspaceMenuBack label="Rename branch" onBack={onBack} />
			<form className="p-1" onSubmit={renameBranch}>
				<label
					className="px-1 font-medium text-[10px] text-editor-faint"
					htmlFor="renamed-workspace-branch-name"
				>
					New name for {currentBranch}
				</label>
				<Input
					autoComplete="off"
					autoFocus
					className="mt-1.5 h-8 text-xs"
					disabled={isPending}
					id="renamed-workspace-branch-name"
					onChange={(event) => setBranchName(event.target.value)}
					onKeyDown={stopMenuNavigation}
					required
					value={branchName}
				/>
				<div className="mt-2 flex justify-end gap-1">
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
						disabled={
							isPending ||
							!branchName.trim() ||
							branchName.trim() === currentBranch
						}
						size="sm"
						type="submit"
						variant="brand"
					>
						Rename
					</Button>
				</div>
			</form>
		</>
	);
}

interface SetBranchUpstreamViewProps {
	readonly currentUpstream: string | null;
	readonly isPending: boolean;
	readonly onBack: () => void;
	readonly onClose: () => void;
	readonly onSetBranchUpstream: (upstream: string) => Promise<boolean>;
	readonly remoteBranches: readonly BranchInfo[];
}

export function SetBranchUpstreamView({
	currentUpstream,
	isPending,
	onBack,
	onClose,
	onSetBranchUpstream,
	remoteBranches,
}: SetBranchUpstreamViewProps): ReactElement {
	const chooseUpstream = async (upstream: string): Promise<void> => {
		if (await onSetBranchUpstream(upstream)) {
			onClose();
		}
	};

	return (
		<>
			<WorkspaceMenuBack label="Set upstream" onBack={onBack} />
			<DropdownMenuGroup>
				<DropdownMenuLabel>Remote branch</DropdownMenuLabel>
				<div className="max-h-64 overflow-y-auto overscroll-contain">
					{remoteBranches.map((branch) => (
						<DropdownMenuItem
							closeOnClick={false}
							disabled={isPending || branch.name === currentUpstream}
							key={branch.fullName}
							onClick={async () => await chooseUpstream(branch.name)}
						>
							{branch.name === currentUpstream ? (
								<CheckIcon aria-hidden className="text-brand" weight="bold" />
							) : (
								<LinkSimpleIcon
									aria-hidden
									className="text-editor-faint"
									weight="regular"
								/>
							)}
							<span className="min-w-0 flex-1 truncate">{branch.name}</span>
						</DropdownMenuItem>
					))}
				</div>
			</DropdownMenuGroup>
		</>
	);
}

interface DeleteBranchViewProps {
	readonly branches: readonly BranchInfo[];
	readonly isPending: boolean;
	readonly onBack: () => void;
	readonly onClose: () => void;
	readonly onDeleteBranch: (name: string) => Promise<boolean>;
}

export function DeleteBranchView({
	branches,
	isPending,
	onBack,
	onClose,
	onDeleteBranch,
}: DeleteBranchViewProps): ReactElement {
	const [targetBranch, setTargetBranch] = useState<BranchInfo | null>(null);

	const deleteBranch = async (): Promise<void> => {
		if (targetBranch && (await onDeleteBranch(targetBranch.name))) {
			onClose();
		}
	};

	if (!targetBranch) {
		return (
			<>
				<WorkspaceMenuBack label="Delete branch" onBack={onBack} />
				<DropdownMenuGroup>
					<DropdownMenuLabel>Choose a local branch</DropdownMenuLabel>
					<div className="max-h-64 overflow-y-auto overscroll-contain">
						{branches.map((branch) => (
							<DropdownMenuItem
								closeOnClick={false}
								disabled={isPending}
								key={branch.fullName}
								onClick={() => setTargetBranch(branch)}
							>
								<GitBranchIcon
									aria-hidden
									className="text-editor-faint"
									weight="regular"
								/>
								<span className="min-w-0 flex-1 truncate">{branch.name}</span>
							</DropdownMenuItem>
						))}
					</div>
				</DropdownMenuGroup>
			</>
		);
	}

	return (
		<>
			<WorkspaceMenuBack
				label="Choose another branch"
				onBack={() => setTargetBranch(null)}
			/>
			<div className="p-1">
				<p className="px-1 font-medium text-xs">Delete {targetBranch.name}?</p>
				<p className="mt-1 px-1 text-editor-muted text-xss leading-4">
					Git will keep the branch if it contains commits that have not been
					merged.
				</p>
				<div className="mt-2 flex justify-end gap-1">
					<Button
						disabled={isPending}
						onClick={() => setTargetBranch(null)}
						size="sm"
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						aria-label={`Delete branch ${targetBranch.name}`}
						disabled={isPending}
						onClick={deleteBranch}
						size="sm"
						type="button"
						variant="destructive"
					>
						<TrashIcon aria-hidden weight="duotone" />
						Delete branch
					</Button>
				</div>
			</div>
		</>
	);
}
