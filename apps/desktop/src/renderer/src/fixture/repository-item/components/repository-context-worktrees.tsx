import type { WorktreeInfo } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import { Input } from "@1git/ui/components/input";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type {
	ChangeEvent,
	FormEvent,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useId, useState } from "react";

const BRANCH_REFERENCE_PREFIX = "refs/heads/";
const ABSOLUTE_PATH_PATTERN = /^(?:\/|[A-Za-z]:[\\/])/;

interface RepositoryWorktreeListProps {
	readonly error: string | null;
	readonly isLoading: boolean;
	readonly onBack: () => void;
	readonly onCreate: () => void;
	readonly worktrees: readonly WorktreeInfo[];
}

interface RepositoryWorktreeCreateProps {
	readonly error: string | null;
	readonly isLoading: boolean;
	readonly onBack: () => void;
	readonly onCreate: (input: {
		readonly newBranch?: string;
		readonly path: string;
	}) => Promise<boolean>;
}

const branchLabel = (worktree: WorktreeInfo): string => {
	if (worktree.branch) {
		return worktree.branch.replace(BRANCH_REFERENCE_PREFIX, "");
	}

	return worktree.detached ? "Detached HEAD" : "No branch";
};

const stopMenuNavigation = (
	event: ReactKeyboardEvent<HTMLInputElement>
): void => {
	if (event.key !== "Escape") {
		event.stopPropagation();
	}
};

function RepositoryWorktreeHeader({
	onBack,
	title,
}: {
	readonly onBack: () => void;
	readonly title: string;
}): ReactElement {
	return (
		<DropdownMenuItem
			className="gap-2.5 py-2"
			closeOnClick={false}
			onClick={onBack}
		>
			<ArrowLeftIcon aria-hidden weight="bold" />
			{title}
		</DropdownMenuItem>
	);
}

function RepositoryWorktreeStatus({
	children,
}: {
	readonly children: string;
}): ReactElement {
	return (
		<p
			aria-live="polite"
			className="px-2 py-2 text-[10px] text-editor-faint leading-4"
			role="status"
		>
			{children}
		</p>
	);
}

export function RepositoryWorktreeList({
	error,
	isLoading,
	onBack,
	onCreate,
	worktrees,
}: RepositoryWorktreeListProps): ReactElement {
	return (
		<>
			<RepositoryWorktreeHeader onBack={onBack} title="Worktrees" />
			<DropdownMenuSeparator />
			{isLoading ? (
				<p
					className="flex items-center gap-2 px-2 py-3 text-editor-faint text-xs"
					role="status"
				>
					<SpinnerGapIcon
						aria-hidden
						className="animate-spin"
						weight="duotone"
					/>
					Loading worktrees…
				</p>
			) : null}
			{isLoading || error ? null : (
				<ul className="max-h-52 space-y-0.5 overflow-y-auto py-1">
					{worktrees.map((worktree) => (
						<li
							className="flex items-start gap-2.5 rounded-lg px-2 py-1.5"
							key={worktree.path}
						>
							<GitBranchIcon
								aria-hidden
								className="mt-0.5 size-3.5 shrink-0 text-editor-faint"
								weight="duotone"
							/>
							<span className="min-w-0">
								<span className="block truncate font-medium text-editor-ink text-xs">
									{branchLabel(worktree)}
								</span>
								<span
									className="mt-0.5 block truncate text-[10px] text-editor-faint"
									title={worktree.path}
								>
									{worktree.path}
								</span>
							</span>
						</li>
					))}
				</ul>
			)}
			{error ? (
				<RepositoryWorktreeStatus>{error}</RepositoryWorktreeStatus>
			) : null}
			<DropdownMenuSeparator />
			<DropdownMenuItem
				className="gap-2.5 py-2"
				closeOnClick={false}
				onClick={onCreate}
			>
				<PlusIcon aria-hidden weight="regular" />
				New worktree…
			</DropdownMenuItem>
		</>
	);
}

export function RepositoryWorktreeCreate({
	error,
	isLoading,
	onBack,
	onCreate,
}: RepositoryWorktreeCreateProps): ReactElement {
	const pathInputId = useId();
	const branchInputId = useId();
	const [path, setPath] = useState("");
	const [newBranch, setNewBranch] = useState("");
	const trimmedPath = path.trim();
	const isAbsolutePath = ABSOLUTE_PATH_PATTERN.test(trimmedPath);
	const canCreate = Boolean(trimmedPath && isAbsolutePath && !isLoading);

	const updatePath = (event: ChangeEvent<HTMLInputElement>): void => {
		setPath(event.target.value);
	};

	const updateNewBranch = (event: ChangeEvent<HTMLInputElement>): void => {
		setNewBranch(event.target.value);
	};

	const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();

		if (!canCreate) {
			return;
		}

		await onCreate({
			newBranch: newBranch.trim() || undefined,
			path: trimmedPath,
		});
	};

	return (
		<>
			<RepositoryWorktreeHeader onBack={onBack} title="New worktree" />
			<DropdownMenuSeparator />
			<form className="space-y-3 p-2" onSubmit={submit}>
				<label className="block" htmlFor={pathInputId}>
					<span className="mb-1 block text-[10px] text-editor-faint">
						Worktree path
					</span>
					<Input
						aria-invalid={trimmedPath ? !isAbsolutePath : undefined}
						autoFocus
						className="h-8 bg-editor-sunken text-xs shadow-none"
						id={pathInputId}
						onChange={updatePath}
						onKeyDown={stopMenuNavigation}
						placeholder="/Users/name/Projects/repo-feature"
						value={path}
					/>
				</label>
				<label className="block" htmlFor={branchInputId}>
					<span className="mb-1 block text-[10px] text-editor-faint">
						New branch (optional)
					</span>
					<Input
						className="h-8 bg-editor-sunken text-xs shadow-none"
						id={branchInputId}
						onChange={updateNewBranch}
						onKeyDown={stopMenuNavigation}
						placeholder="feature/my-change"
						value={newBranch}
					/>
				</label>
				{trimmedPath && !isAbsolutePath ? (
					<RepositoryWorktreeStatus>
						Enter an absolute filesystem path.
					</RepositoryWorktreeStatus>
				) : null}
				{error ? (
					<RepositoryWorktreeStatus>{error}</RepositoryWorktreeStatus>
				) : null}
				<div className="flex justify-end gap-2">
					<Button onClick={onBack} size="sm" type="button" variant="ghost">
						Cancel
					</Button>
					<Button disabled={!canCreate} size="sm" type="submit">
						{isLoading ? (
							<SpinnerGapIcon
								aria-hidden
								className="animate-spin"
								weight="duotone"
							/>
						) : null}
						Create
					</Button>
				</div>
			</form>
		</>
	);
}
