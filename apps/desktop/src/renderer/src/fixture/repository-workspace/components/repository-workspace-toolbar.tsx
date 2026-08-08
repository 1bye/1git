import type {
	BranchCollection,
	FileChange,
	RepositorySnapshot,
} from "@1git/git";
import { cn } from "@1git/ui/lib/utils";
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
	readonly navigation: RepositoryFileNavigation;
	readonly onDiscardFiles: (files: readonly FileChange[]) => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onMergeBranch: (name: string) => Promise<boolean>;
	readonly onSetFileStaged: (
		file: FileChange,
		shouldStage: boolean
	) => Promise<void>;
	readonly onSetFilesStaged: (
		files: readonly FileChange[],
		shouldStage: boolean
	) => Promise<boolean>;
	readonly onSetTab: (tab: RepositoryTab) => Promise<void>;
	readonly onStashChanges: () => Promise<boolean>;
	readonly onToggleAllFiles: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly repositoryRoot: string;
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
	navigation,
	onDiscardFiles,
	onFetch,
	onMergeBranch,
	onSetFileStaged,
	onSetFilesStaged,
	onSetTab,
	onStashChanges,
	onToggleAllFiles,
	pendingAction,
	repositoryRoot,
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
			className="relative z-30 flex h-11 shrink-0 items-center gap-2 bg-transparent px-2.5"
			data-name="RepositoryWorkspaceToolbar"
		>
			<div
				aria-label="Repository view"
				className="flex self-stretch"
				role="tablist"
			>
				<button
					aria-keyshortcuts="Meta+1 Control+1"
					aria-selected={tab === "changes"}
					className={cn(
						"relative px-2.5 font-medium text-[10px] outline-none transition-colors after:absolute after:right-2.5 after:bottom-0 after:left-2.5 after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-brand after:transition-transform focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset",
						tab === "changes"
							? "text-brand after:scale-x-100"
							: "text-editor-muted hover:text-editor-ink"
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
						"relative px-2.5 font-medium text-[10px] outline-none transition-colors after:absolute after:right-2.5 after:bottom-0 after:left-2.5 after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-brand after:transition-transform focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset",
						tab === "history"
							? "text-brand after:scale-x-100"
							: "text-editor-muted hover:text-editor-ink"
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
					onDiscardFiles={onDiscardFiles}
					onSetFileStaged={onSetFileStaged}
					onSetFilesStaged={onSetFilesStaged}
					pendingAction={pendingAction}
					repositoryRoot={repositoryRoot}
					selectedFilePath={selectedFilePath}
				/>
			) : null}

			<div className="ml-auto flex min-w-0 items-center">
				<RepositoryQuickActions
					allFilesStaged={areAllFilesStaged(files)}
					branches={branches}
					changedFileCount={files.length}
					head={snapshot.head}
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
