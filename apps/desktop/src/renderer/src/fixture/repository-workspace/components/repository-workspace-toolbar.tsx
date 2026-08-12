import type {
	BranchCollection,
	RepositorySnapshot,
	StashInfo,
} from "@1git/git";
import {
	DropdownMenuCheckboxItem,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
} from "@1git/ui/components/dropdown-menu";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { RepositoryRecoveryAction } from "@/feature/workspace/lib/repository-recovery.js";
import type { RepositorySyncAction } from "@/feature/workspace/lib/repository-sync.js";
import { areAllFilesStaged } from "@/feature/workspace/lib/workspace-model.js";
import type {
	PendingWorkspaceAction,
	RepositoryTab,
} from "@/feature/workspace/types/git-workspace.js";
import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import {
	LiquidMenuContent,
	LiquidMenuRoot,
	LiquidMenuTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY } from "@/fixture/liquid-menu/constants/liquid-menu.js";
import { RepositoryQuickActions } from "@/fixture/repository-workspace/components/repository-quick-actions.js";

interface RepositoryWorkspaceToolbarProps {
	readonly branches: BranchCollection | null;
	readonly ignoreWhitespace: boolean;
	readonly onApplyStash: (stash: StashInfo) => Promise<boolean>;
	readonly onCancelSync: () => Promise<void>;
	readonly onDropStash: (stash: StashInfo) => Promise<boolean>;
	readonly onMergeBranch: (name: string) => Promise<boolean>;
	readonly onOpenInEditor: () => Promise<void>;
	readonly onPopStash: (stash: StashInfo) => Promise<boolean>;
	readonly onRecover: (action: RepositoryRecoveryAction) => Promise<boolean>;
	readonly onSetIgnoreWhitespace: (ignoreWhitespace: boolean) => void;
	readonly onSetTab: (tab: RepositoryTab) => Promise<void>;
	readonly onStashChanges: () => Promise<boolean>;
	readonly onSync: () => Promise<void>;
	readonly onToggleAllFiles: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly snapshot: RepositorySnapshot;
	readonly stashes: readonly StashInfo[];
	readonly syncAction: RepositorySyncAction;
	readonly tab: RepositoryTab;
}

const tabForShortcut = (key: string): RepositoryTab | null => {
	if (key === "1") {
		return "changes";
	}
	if (key === "2") {
		return "history";
	}
	if (key === "3") {
		return "stashes";
	}
	return null;
};

const REPOSITORY_TAB_LABELS: Readonly<Record<RepositoryTab, string>> = {
	changes: "Changes",
	history: "History",
	stashes: "Stashes",
};

export function RepositoryWorkspaceToolbar({
	branches,
	ignoreWhitespace,
	onApplyStash,
	onCancelSync,
	onDropStash,
	onMergeBranch,
	onOpenInEditor,
	onPopStash,
	onRecover,
	onSetIgnoreWhitespace,
	onSetTab,
	onStashChanges,
	onSync,
	onToggleAllFiles,
	pendingAction,
	snapshot,
	stashes,
	syncAction,
	tab,
}: RepositoryWorkspaceToolbarProps): ReactElement {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const getAnchor = useCallback((): Element | null => triggerRef.current, []);
	const changeTab = useCallback(
		async (nextTab: RepositoryTab): Promise<void> => {
			await onSetTab(nextTab);
		},
		[onSetTab]
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

	const selectTab = (nextTab: RepositoryTab): void => {
		changeTab(nextTab).catch(() => {
			// The workspace hook exposes the operation error in the app notice.
		});
	};
	const viewLabel = REPOSITORY_TAB_LABELS[tab];

	return (
		<div
			className="relative z-10 flex w-full shrink-0 items-center justify-between gap-2 px-2"
			data-name="RepositoryTitlebarControls"
			style={{ height: WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight }}
		>
			<LiquidMenuRoot
				anchor={getAnchor}
				anchorGeometry={LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY}
				modal
			>
				<LiquidMenuTrigger
					aria-label={`Repository view: ${viewLabel}`}
					className="flex h-7 min-w-20 items-center justify-between gap-2 rounded-lg px-2 font-medium text-[10px] text-editor-ink outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20"
					ref={triggerRef}
				>
					{viewLabel}
					<CaretDownIcon
						aria-hidden
						className="size-3 text-editor-faint"
						weight="bold"
					/>
				</LiquidMenuTrigger>
				<LiquidMenuContent
					align="start"
					alignOffset={16}
					aria-label="Repository view"
					className="min-w-36 max-w-36 p-1"
					sideOffset={4}
				>
					<DropdownMenuItem closeOnClick onClick={() => selectTab("changes")}>
						<CheckIcon
							aria-hidden
							className={tab === "changes" ? "opacity-100" : "opacity-0"}
							weight="bold"
						/>
						Changes
						<DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem closeOnClick onClick={() => selectTab("history")}>
						<CheckIcon
							aria-hidden
							className={tab === "history" ? "opacity-100" : "opacity-0"}
							weight="bold"
						/>
						History
						<DropdownMenuShortcut>⌘2</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuItem closeOnClick onClick={() => selectTab("stashes")}>
						<CheckIcon
							aria-hidden
							className={tab === "stashes" ? "opacity-100" : "opacity-0"}
							weight="bold"
						/>
						Stashes
						<DropdownMenuShortcut>⌘3</DropdownMenuShortcut>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuLabel>Diff</DropdownMenuLabel>
					<DropdownMenuCheckboxItem
						checked={ignoreWhitespace}
						closeOnClick={false}
						onCheckedChange={onSetIgnoreWhitespace}
					>
						Ignore whitespace
					</DropdownMenuCheckboxItem>
				</LiquidMenuContent>
			</LiquidMenuRoot>

			<RepositoryQuickActions
				allFilesStaged={areAllFilesStaged(snapshot.files)}
				branches={branches}
				changedFileCount={snapshot.files.length}
				head={snapshot.head}
				onApplyStash={onApplyStash}
				onCancelSync={onCancelSync}
				onDropStash={onDropStash}
				onMergeBranch={onMergeBranch}
				onOpenInEditor={onOpenInEditor}
				onPopStash={onPopStash}
				onRecover={onRecover}
				onSetTab={onSetTab}
				onStashChanges={onStashChanges}
				onSync={onSync}
				onToggleAllFiles={onToggleAllFiles}
				operationState={snapshot.operationState}
				pendingAction={pendingAction}
				stashes={stashes}
				syncAction={syncAction}
			/>
		</div>
	);
}
