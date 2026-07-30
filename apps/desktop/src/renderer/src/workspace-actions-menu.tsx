import type { BranchCollection } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import { Elevated } from "@1git/ui/components/elevated";
import { Input } from "@1git/ui/components/input";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { useState } from "react";
import type { PendingWorkspaceAction } from "./use-git-workspace.js";

interface WorkspaceActionsMenuProps {
	readonly branches: BranchCollection | null;
	readonly currentBranch: string;
	readonly left: number;
	readonly onClose: () => void;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onSwitchBranch: (name: string) => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
}

export const WorkspaceActionsMenu = ({
	branches,
	currentBranch,
	left,
	onClose,
	onCreateBranch,
	onFetch,
	onSwitchBranch,
	pendingAction,
}: WorkspaceActionsMenuProps): ReactElement => {
	const [isCreating, setIsCreating] = useState(false);
	const [branchName, setBranchName] = useState("");
	const localBranches =
		branches?.branches.filter((branch) => branch.type === "local") ?? [];
	const handleBranchNameChange = (
		event: ChangeEvent<HTMLInputElement>
	): void => {
		setBranchName(event.target.value);
	};
	const beginBranchCreation = (): void => setIsCreating(true);
	const cancelBranchCreation = (): void => {
		setIsCreating(false);
		setBranchName("");
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
	const fetchRepository = async (): Promise<void> => {
		onClose();
		await onFetch();
	};

	return (
		<div data-name="WorkspaceActionsMenu">
			<button
				aria-label="Close workspace actions"
				className="fixed inset-0 z-40 cursor-default"
				onClick={onClose}
				type="button"
			/>
			<Elevated
				aria-label="Workspace actions"
				className="fixed top-9 z-50 w-[310px] overflow-hidden rounded-2xl p-1.5"
				offset={2}
				role="dialog"
				shadowLevel={6}
				style={{ left }}
			>
				<div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2">
					<span className="flex size-7 items-center justify-center rounded-lg bg-editor-sunken text-editor-muted">
						<GitBranchIcon aria-hidden className="size-3.5" weight="regular" />
					</span>
					<span className="min-w-0">
						<span className="block text-[10px] text-editor-faint">
							Current branch
						</span>
						<span className="block truncate font-semibold text-editor-ink text-xs">
							{currentBranch || "Detached HEAD"}
						</span>
					</span>
				</div>

				{isCreating ? (
					<form
						className="border-editor-hairline border-t p-2"
						data-name="CreateBranchForm"
						onSubmit={createBranch}
					>
						<label
							className="font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]"
							htmlFor="new-workspace-branch-name"
						>
							New branch name
						</label>
						<Input
							autoFocus
							className="mt-2 h-8 text-xs"
							id="new-workspace-branch-name"
							onChange={handleBranchNameChange}
							placeholder="feature/my-change"
							value={branchName}
						/>
						<div className="mt-2 flex justify-end gap-1.5">
							<Button
								onClick={cancelBranchCreation}
								size="sm"
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>
							<Button
								disabled={!branchName.trim() || pendingAction !== null}
								size="sm"
								type="submit"
								variant="brand"
							>
								Create branch
							</Button>
						</div>
					</form>
				) : (
					<>
						<div className="max-h-52 overflow-y-auto border-editor-hairline border-t pt-1">
							<p className="px-2.5 pt-1.5 pb-1 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]">
								Switch branch
							</p>
							{localBranches.map((branch) => {
								const switchBranch = async (): Promise<void> => {
									if (!branch.checkedOut) {
										await onSwitchBranch(branch.name);
									}
									onClose();
								};
								return (
									<button
										className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none hover:bg-editor-sunken focus-visible:bg-editor-sunken"
										key={branch.fullName}
										onClick={switchBranch}
										type="button"
									>
										<GitBranchIcon
											aria-hidden
											className="size-3.5 shrink-0 text-editor-faint"
											weight="regular"
										/>
										<span className="min-w-0 flex-1 truncate font-medium text-editor-ink text-xs">
											{branch.name}
										</span>
										{branch.checkedOut ? (
											<CheckIcon
												aria-hidden
												className="size-3.5 text-brand"
												weight="bold"
											/>
										) : null}
									</button>
								);
							})}
						</div>
						<div className="mt-1 border-editor-hairline border-t pt-1">
							<button
								className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left font-medium text-editor-ink text-xs outline-none hover:bg-editor-sunken focus-visible:bg-editor-sunken"
								onClick={beginBranchCreation}
								type="button"
							>
								<PlusIcon
									aria-hidden
									className="size-3.5 text-editor-faint"
									weight="bold"
								/>
								Create new branch…
							</button>
							<button
								className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left font-medium text-editor-ink text-xs outline-none hover:bg-editor-sunken focus-visible:bg-editor-sunken"
								disabled={pendingAction !== null}
								onClick={fetchRepository}
								type="button"
							>
								<ArrowsClockwiseIcon
									aria-hidden
									className="size-3.5 text-editor-faint"
									weight="regular"
								/>
								Fetch remote
							</button>
						</div>
					</>
				)}
			</Elevated>
		</div>
	);
};
