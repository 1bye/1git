import type { RepositorySnapshot } from "@1git/git";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { GitPullRequestIcon } from "@phosphor-icons/react/dist/csr/GitPullRequest";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type { ReactElement } from "react";
import type { RepositoryCleanAction } from "@/feature/workspace/lib/repository-clean-state.js";
import {
	isRepositorySyncActionKind,
	repositorySyncProgressLabel,
} from "@/feature/workspace/lib/repository-sync.js";
import type { PendingWorkspaceAction } from "@/feature/workspace/types/git-workspace.js";

interface RepositoryCleanStateProps {
	readonly cleanAction: RepositoryCleanAction;
	readonly onCancelSync: () => Promise<void>;
	readonly onPreviewComparison: () => Promise<void>;
	readonly onSync: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly snapshot: RepositorySnapshot;
}

export function CleanState({
	onCancelSync,
	onPreviewComparison,
	onSync,
	pendingAction,
	snapshot,
	cleanAction,
}: RepositoryCleanStateProps): ReactElement {
	const isSyncPending = isRepositorySyncActionKind(pendingAction);
	const performPrimaryAction = async (): Promise<void> => {
		if (isSyncPending) {
			await onCancelSync();
			return;
		}
		if (cleanAction.kind === "sync") {
			await onSync();
		} else if (cleanAction.kind === "preview-comparison") {
			await onPreviewComparison();
		}
	};
	const isComparisonAction = cleanAction.kind !== "sync";
	const isActionPending = pendingAction === "refresh";
	let actionIcon = (
		<ArrowsClockwiseIcon
			aria-hidden
			className="size-4 text-editor-faint"
			weight="regular"
		/>
	);
	if (isComparisonAction) {
		actionIcon = (
			<GitPullRequestIcon
				aria-hidden
				className="size-4 text-editor-faint"
				weight="regular"
			/>
		);
	}
	if (isSyncPending || isActionPending) {
		actionIcon = (
			<SpinnerGapIcon
				aria-hidden
				className="size-4 animate-spin text-editor-faint"
				weight="bold"
			/>
		);
	}
	let actionLabel = cleanAction.label;
	if (isActionPending) {
		actionLabel = "Preparing preview";
	}
	if (isSyncPending) {
		actionLabel = `Cancel ${repositorySyncProgressLabel(pendingAction).toLowerCase()}`;
	}

	return (
		<section
			className="flex min-h-full items-center justify-center px-10 py-16"
			data-name="CleanState"
		>
			<div className="w-full max-w-[560px] text-center">
				<div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-700/10">
					<CheckCircleIcon aria-hidden className="size-6" weight="fill" />
				</div>
				<h1 className="mt-5 font-semibold text-editor-ink text-xl tracking-[-0.03em]">
					Working tree is clean
				</h1>
				<p className="mx-auto mt-2 max-w-[430px] text-editor-muted text-xs leading-5">
					There are no local changes on{" "}
					<span className="font-medium text-editor-ink">
						{snapshot.head.branch ?? "the current branch"}
					</span>
					. You’re ready for the next change.
				</p>
				<div className="mt-7 grid grid-cols-2 overflow-hidden rounded-2xl border border-editor-hairline bg-editor-sunken/55 text-left">
					<div className="border-editor-hairline border-r p-4">
						<GitBranchIcon
							aria-hidden
							className="size-4 text-editor-faint"
							weight="regular"
						/>
						<p className="mt-3 font-medium text-editor-ink text-xs">
							{snapshot.head.branch ?? "Detached HEAD"}
						</p>
						<p className="mt-1 text-[10px] text-editor-faint">
							{snapshot.head.upstream ?? "No upstream configured"}
						</p>
					</div>
					<button
						aria-busy={isSyncPending || isActionPending}
						className="p-4 text-left outline-none hover:bg-editor-surface focus-visible:bg-editor-surface focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50"
						disabled={
							(pendingAction !== null && !isSyncPending) ||
							(!isSyncPending && cleanAction.disabledReason !== null)
						}
						onClick={performPrimaryAction}
						title={cleanAction.disabledReason ?? cleanAction.description}
						type="button"
					>
						{actionIcon}
						<span className="mt-3 block font-medium text-editor-ink text-xs">
							{actionLabel}
						</span>
						<span className="mt-1 block text-[10px] text-editor-faint">
							{isSyncPending
								? "Stop this operation"
								: (cleanAction.disabledReason ?? cleanAction.description)}
						</span>
					</button>
				</div>
			</div>
		</section>
	);
}
