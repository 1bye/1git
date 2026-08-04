import type {
	BranchCollection,
	FileChange,
	RepositorySnapshot,
} from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { GitCommitIcon } from "@phosphor-icons/react/dist/csr/GitCommit";
import type { ReactElement } from "react";
import { useCallback, useEffect } from "react";
import type {
	PendingWorkspaceAction,
	RepositoryTab,
} from "@/feature/workspace/hooks/use-git-workspace.js";
import { areAllFilesStaged } from "@/feature/workspace/lib/workspace-model.js";
import { RepositoryFileNavigator } from "@/fixture/repository-workspace/components/repository-file-navigator.js";
import { RepositoryQuickActions } from "@/fixture/repository-workspace/components/repository-quick-actions.js";
import type { RepositoryFileNavigation } from "@/fixture/repository-workspace/hooks/use-repository-file-navigation.js";

interface RepositoryWorkspaceToolbarProps {
	readonly branches: BranchCollection | null;
	readonly commitCount: number;
	readonly navigation: RepositoryFileNavigation;
	readonly onFetch: () => Promise<void>;
	readonly onMergeBranch: (name: string) => Promise<boolean>;
	readonly onSetFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly onSetTab: (tab: RepositoryTab) => Promise<void>;
	readonly onStashChanges: () => Promise<boolean>;
	readonly onToggleAllFiles: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly selectedFilePath: string | null;
	readonly snapshot: RepositorySnapshot;
	readonly tab: RepositoryTab;
}

const tabForShortcut = (key: string): RepositoryTab | null => {
	if (key === "1") {
		return "changes";
	}
	if (key === "2") {
		return "history";
	}
	return null;
};

export function RepositoryWorkspaceToolbar({
	branches,
	commitCount,
	navigation,
	onFetch,
	onMergeBranch,
	onSetFileStaged,
	onSetTab,
	onStashChanges,
	onToggleAllFiles,
	pendingAction,
	selectedFilePath,
	snapshot,
	tab,
}: RepositoryWorkspaceToolbarProps): ReactElement {
	const { files } = snapshot;
	const changeTab = useCallback(
		async (nextTab: RepositoryTab): Promise<void> => {
			navigation.acceptPreview();
			await onSetTab(nextTab);
		},
		[navigation.acceptPreview, onSetTab]
	);

	useEffect(() => {
		const switchView = (event: KeyboardEvent): void => {
			if (!(event.metaKey || event.ctrlKey) || event.altKey) {
				return;
			}
			const nextTab = tabForShortcut(event.key);
			if (!nextTab) {
				return;
			}
			event.preventDefault();
			changeTab(nextTab).catch(() => {
				// The workspace hook exposes the operation error in the app notice.
			});
		};
		window.addEventListener("keydown", switchView);
		return () => window.removeEventListener("keydown", switchView);
	}, [changeTab]);

	return (
		<header
			className="relative z-30 flex h-11 shrink-0 items-center gap-2 border-editor-hairline border-b bg-editor-surface/92 px-2.5 backdrop-blur-xl"
			data-name="RepositoryWorkspaceToolbar"
		>
			<div
				aria-label="Repository view"
				className="flex rounded-lg bg-editor-sunken p-0.5"
				role="tablist"
			>
				<button
					aria-keyshortcuts="Meta+1 Control+1"
					aria-selected={tab === "changes"}
					className={cn(
						"h-7 rounded-md px-2.5 font-medium text-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-editor-muted/20",
						tab === "changes"
							? "bg-white text-editor-ink shadow-surface-1"
							: "text-editor-faint hover:text-editor-ink"
					)}
					onClick={() => changeTab("changes")}
					role="tab"
					type="button"
				>
					Changes
				</button>
				<button
					aria-keyshortcuts="Meta+2 Control+2"
					aria-selected={tab === "history"}
					className={cn(
						"h-7 rounded-md px-2.5 font-medium text-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-editor-muted/20",
						tab === "history"
							? "bg-white text-editor-ink shadow-surface-1"
							: "text-editor-faint hover:text-editor-ink"
					)}
					onClick={() => changeTab("history")}
					role="tab"
					type="button"
				>
					History
				</button>
			</div>

			{tab === "changes" ? (
				<RepositoryFileNavigator
					navigation={navigation}
					onSetFileStaged={onSetFileStaged}
					pendingAction={pendingAction}
					selectedFilePath={selectedFilePath}
				/>
			) : (
				<div className="flex h-8 items-center gap-2 rounded-lg bg-editor-sunken px-2.5 text-editor-muted text-xss">
					<GitCommitIcon aria-hidden className="size-3.5" weight="duotone" />
					<span className="text-editor-ink">{commitCount} commits</span>
				</div>
			)}

			<div className="ml-auto flex min-w-0 items-center gap-2">
				<div className="hidden min-w-0 items-center gap-1.5 text-[10px] text-editor-faint md:flex">
					<GitBranchIcon
						aria-hidden
						className="size-3.5 shrink-0"
						weight="duotone"
					/>
					<span className="max-w-40 truncate">
						{snapshot.head.branch ?? "Detached HEAD"}
					</span>
					{snapshot.head.ahead > 0 ? (
						<span className="tabular-nums">↑{snapshot.head.ahead}</span>
					) : null}
					{snapshot.head.behind > 0 ? (
						<span className="tabular-nums">↓{snapshot.head.behind}</span>
					) : null}
				</div>
				<RepositoryQuickActions
					allFilesStaged={areAllFilesStaged(files)}
					branches={branches}
					changedFileCount={files.length}
					onFetch={onFetch}
					onMergeBranch={onMergeBranch}
					onSetTab={onSetTab}
					onStashChanges={onStashChanges}
					onToggleAllFiles={onToggleAllFiles}
					pendingAction={pendingAction}
				/>
			</div>
		</header>
	);
}
