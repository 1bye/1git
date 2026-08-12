import type { FileDiff, StashInfo } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import {
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import {
	ScrollArea,
	ScrollAreaContent,
	ScrollAreaViewport,
	ScrollBar,
} from "@1git/ui/components/scroll-area";
import { cn } from "@1git/ui/lib/utils";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { ReactElement, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { formatRelativeTime } from "@/feature/workspace/lib/workspace-model.js";
import type { RepositoryTab } from "@/feature/workspace/types/git-workspace.js";
import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import {
	LiquidMenuContent,
	LiquidMenuRoot,
	LiquidMenuTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";
import { LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY } from "@/fixture/liquid-menu/constants/liquid-menu.js";
import { RepositoryFilePath } from "@/fixture/repository-workspace/components/repository-file-item.js";
import { RepositoryFileStatusBadge } from "@/fixture/repository-workspace/components/repository-file-status.js";
import {
	getRepositoryRevisionFileStatus,
	type RepositoryDiffFileEntry,
} from "@/fixture/repository-workspace/lib/repository-diff-files.js";
import { getRepositoryFileRowId } from "@/fixture/repository-workspace/lib/repository-navigation.js";
import {
	focusRepositoryRevisionNavigationGroup,
	focusRepositoryRevisionNavigationItem,
	getRepositoryRevisionNavigationGroupTarget,
	getRepositoryRevisionNavigationItemKey,
	getRepositoryRevisionNavigationTarget,
} from "@/fixture/repository-workspace/lib/repository-revision-navigation.js";

interface RepositoryRevisionFileRailProps {
	readonly diffs: readonly FileDiff[];
	readonly entries: readonly RepositoryDiffFileEntry[];
	readonly isPending: boolean;
	readonly onApplyStash: (stash: StashInfo) => Promise<boolean>;
	readonly onDropStash: (stash: StashInfo) => Promise<boolean>;
	readonly onPopStash: (stash: StashInfo) => Promise<boolean>;
	readonly onSelectFile: (path: string) => Promise<void>;
	readonly selectedFilePath: string | null;
	readonly selectedStash: StashInfo | null;
	readonly tab: RepositoryTab;
}

interface RepositoryStashRailProps {
	readonly isPending: boolean;
	readonly onSelectStash: (stash: StashInfo) => Promise<void>;
	readonly selectedStashOid: string | null;
	readonly stashes: readonly StashInfo[];
}

interface RepositoryStashActionsProps {
	readonly isPending: boolean;
	readonly onApply: (stash: StashInfo) => Promise<boolean>;
	readonly onDrop: (stash: StashInfo) => Promise<boolean>;
	readonly onPop: (stash: StashInfo) => Promise<boolean>;
	readonly stash: StashInfo;
}

const revisionFileRailLabel = (tab: RepositoryTab): string => {
	if (tab === "history") {
		return "Files in commit";
	}
	if (tab === "stashes") {
		return "Files in stash";
	}
	return "Files in revision";
};

function RepositoryStashActions({
	isPending,
	onApply,
	onDrop,
	onPop,
	stash,
}: RepositoryStashActionsProps): ReactElement {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [isConfirmingDrop, setIsConfirmingDrop] = useState(false);
	const [isOpen, setIsOpen] = useState(false);
	const getAnchor = useCallback((): Element | null => triggerRef.current, []);
	const changeOpen = (nextIsOpen: boolean): void => {
		setIsOpen(nextIsOpen);
		if (!nextIsOpen) {
			setIsConfirmingDrop(false);
		}
	};

	return (
		<div className="flex shrink-0 items-center gap-0.5">
			<Button
				className="h-7 px-2 text-[10px]"
				disabled={isPending}
				onClick={async () => await onApply(stash)}
				size="sm"
				variant="ghost"
			>
				Apply
			</Button>
			<Button
				className="h-7 px-2 text-[10px]"
				disabled={isPending}
				onClick={async () => await onPop(stash)}
				size="sm"
				title="Pop removes the stash after a successful apply. Git keeps it if conflicts occur."
				variant="ghost"
			>
				Pop
			</Button>
			<LiquidMenuRoot
				anchor={getAnchor}
				anchorGeometry={LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY}
				modal
				onOpenChange={changeOpen}
				open={isOpen}
			>
				<LiquidMenuTrigger
					aria-label={`More actions for ${stash.summary}`}
					className="ml-auto flex size-7 items-center justify-center rounded-lg text-editor-muted outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20"
					ref={triggerRef}
				>
					<DotsThreeIcon aria-hidden className="size-3.5" weight="bold" />
				</LiquidMenuTrigger>
				{isOpen ? (
					<LiquidMenuContent
						align="end"
						aria-label={`Actions for ${stash.summary}`}
						className="w-60 min-w-60 p-1"
						side="bottom"
						sideOffset={4}
					>
						<LiquidMenuAutoSize
							viewKey={isConfirmingDrop ? "confirm-drop" : "actions"}
						>
							{isConfirmingDrop ? (
								<>
									<DropdownMenuItem
										closeOnClick={false}
										onClick={() => setIsConfirmingDrop(false)}
									>
										<ArrowLeftIcon aria-hidden weight="bold" />
										Keep stash
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuLabel className="py-2 font-normal text-xss normal-case leading-4 tracking-normal">
										Permanently remove “{stash.summary}”?
									</DropdownMenuLabel>
									<DropdownMenuItem
										aria-label={`Drop stash ${stash.summary}`}
										closeOnClick
										disabled={isPending}
										onClick={async () => await onDrop(stash)}
										variant="destructive"
									>
										<TrashIcon aria-hidden weight="duotone" />
										Drop stash
									</DropdownMenuItem>
								</>
							) : (
								<DropdownMenuItem
									closeOnClick={false}
									disabled={isPending}
									onClick={() => setIsConfirmingDrop(true)}
									variant="destructive"
								>
									<TrashIcon aria-hidden weight="duotone" />
									Drop stash…
								</DropdownMenuItem>
							)}
						</LiquidMenuAutoSize>
					</LiquidMenuContent>
				) : null}
			</LiquidMenuRoot>
		</div>
	);
}

export function RepositoryRevisionFileRail({
	diffs,
	entries,
	isPending,
	onApplyStash,
	onDropStash,
	onPopStash,
	onSelectFile,
	selectedFilePath,
	selectedStash,
	tab,
}: RepositoryRevisionFileRailProps): ReactElement {
	const isOpen = tab !== "changes";
	const stats = diffs[0]?.stats ?? [];
	const paths = stats.map((stat) => stat.path);
	const label = revisionFileRailLabel(tab);
	const statusByPath = useMemo(
		() =>
			new Map(
				entries.map((entry) => [
					entry.path,
					getRepositoryRevisionFileStatus(entry.file),
				])
			),
		[entries]
	);
	const navigateFiles = (
		event: ReactKeyboardEvent<HTMLButtonElement>
	): void => {
		if (
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			event.defaultPrevented
		) {
			return;
		}
		const currentPath = getRepositoryRevisionNavigationItemKey(event.target);
		if (!currentPath) {
			return;
		}
		const targetGroup = getRepositoryRevisionNavigationGroupTarget(
			"files",
			event.key
		);
		if (targetGroup) {
			event.preventDefault();
			focusRepositoryRevisionNavigationGroup(event.currentTarget, targetGroup);
			return;
		}
		const targetPath = getRepositoryRevisionNavigationTarget(
			paths,
			currentPath,
			event.key
		);
		if (!targetPath) {
			return;
		}
		event.preventDefault();
		if (targetPath === currentPath) {
			return;
		}
		const list = event.currentTarget.closest<HTMLUListElement>(
			'[data-repository-revision-navigation-group="files"]'
		);
		if (!list) {
			return;
		}
		focusRepositoryRevisionNavigationItem(list, targetPath);
		onSelectFile(targetPath).catch(() => {
			// The workspace hook reports selection errors in the app notice.
		});
	};

	return (
		<aside
			aria-hidden={isOpen ? undefined : true}
			aria-label={label}
			className={cn(
				"relative min-h-0 shrink-0 overflow-hidden bg-editor-sunken-2 transition-[width] duration-200 ease-out motion-reduce:transition-none",
				isOpen
					? "w-(--repository-context-rail-width)"
					: "pointer-events-none w-0"
			)}
			data-name="RepositoryRevisionFileRail"
			data-repository-context-shelf=""
			data-repository-file-liquid-rail={isOpen ? "true" : undefined}
			data-state={isOpen ? "open" : "closed"}
			inert={isOpen ? undefined : true}
		>
			<div className="absolute inset-y-0 right-0 flex w-(--repository-context-rail-width) flex-col">
				<header
					className="relative z-20 flex shrink-0 items-center justify-end px-2"
					data-desktop-drag
					style={{ height: WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight }}
				>
					{tab === "stashes" && selectedStash ? (
						<RepositoryStashActions
							isPending={isPending}
							onApply={onApplyStash}
							onDrop={onDropStash}
							onPop={onPopStash}
							stash={selectedStash}
						/>
					) : null}
				</header>
				<header className="relative z-20 flex h-9 shrink-0 items-center gap-1 px-2 text-[10px] text-editor-muted">
					<span className="mr-auto pl-1">{label}</span>
					<span className="tabular-nums">{stats.length}</span>
				</header>
				{stats.length > 0 ? (
					<ScrollArea
						className="relative z-20 min-h-0 flex-1"
						overflowEdgeThreshold={1}
					>
						<ScrollAreaViewport
							className="min-h-0"
							data-repository-file-viewport
							data-repository-revision-navigation-viewport
						>
							<ScrollAreaContent>
								<ul
									className="space-y-0.5 px-1.5 pb-1.5"
									data-repository-file-list
									data-repository-revision-navigation-group="files"
								>
									{stats.map((stat) => {
										const isSelected = selectedFilePath === stat.path;
										return (
											<li
												className="relative flex min-h-7 items-center rounded-lg"
												id={getRepositoryFileRowId(stat.path)}
												key={stat.path}
											>
												<button
													aria-current={isSelected ? "true" : undefined}
													className={cn(
														"flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-hover",
														isSelected && "relative z-20"
													)}
													data-repository-revision-navigation-item={stat.path}
													onClick={async () => await onSelectFile(stat.path)}
													onKeyDown={navigateFiles}
													tabIndex={isSelected ? 0 : -1}
													type="button"
												>
													<RepositoryFilePath path={stat.path} />
													<RepositoryFileStatusBadge
														status={statusByPath.get(stat.path) ?? "modified"}
													/>
												</button>
											</li>
										);
									})}
								</ul>
							</ScrollAreaContent>
						</ScrollAreaViewport>
						<ScrollBar />
					</ScrollArea>
				) : (
					<p className="relative z-20 min-h-0 flex-1 px-4 py-10 text-center text-editor-faint text-xss">
						{tab === "stashes" && !selectedStash
							? "Select a stash to inspect."
							: "This revision has no changed files."}
					</p>
				)}
			</div>
		</aside>
	);
}

export function RepositoryStashRail({
	isPending,
	onSelectStash,
	selectedStashOid,
	stashes,
}: RepositoryStashRailProps): ReactElement {
	const stashOids = stashes.map((stash) => stash.oid);
	const navigateStashes = (
		event: ReactKeyboardEvent<HTMLButtonElement>
	): void => {
		if (
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			event.defaultPrevented
		) {
			return;
		}
		const currentOid = getRepositoryRevisionNavigationItemKey(event.target);
		if (!currentOid) {
			return;
		}
		const targetGroup = getRepositoryRevisionNavigationGroupTarget(
			"revisions",
			event.key
		);
		if (targetGroup) {
			event.preventDefault();
			focusRepositoryRevisionNavigationGroup(event.currentTarget, targetGroup);
			return;
		}
		const targetOid = getRepositoryRevisionNavigationTarget(
			stashOids,
			currentOid,
			event.key
		);
		if (!targetOid) {
			return;
		}
		event.preventDefault();
		if (targetOid === currentOid) {
			return;
		}
		const targetStash = stashes.find((stash) => stash.oid === targetOid);
		if (!targetStash) {
			return;
		}
		const list = event.currentTarget.closest<HTMLUListElement>(
			'[data-repository-revision-navigation-group="revisions"]'
		);
		if (!list) {
			return;
		}
		focusRepositoryRevisionNavigationItem(list, targetOid);
		onSelectStash(targetStash).catch(() => {
			// The workspace hook reports selection errors in the app notice.
		});
	};

	return (
		<aside
			aria-label="Stash shelf"
			className="flex min-h-0 flex-1 flex-col bg-transparent"
			data-name="RepositoryStashRail"
		>
			<header className="flex h-9 shrink-0 items-center justify-between px-3 text-[10px] text-editor-muted">
				<span>Saved work</span>
				<span className="tabular-nums">{stashes.length}</span>
			</header>
			{stashes.length > 0 ? (
				<ScrollArea className="min-h-0 flex-1" overflowEdgeThreshold={1}>
					<ScrollAreaViewport
						className="min-h-0"
						data-repository-revision-navigation-viewport
					>
						<ScrollAreaContent>
							<ul
								className="space-y-0.5 px-1.5 pb-1.5"
								data-repository-revision-navigation-group="revisions"
							>
								{stashes.map((stash) => {
									const isSelected = selectedStashOid === stash.oid;
									return (
										<li key={stash.oid}>
											<button
												aria-current={isSelected ? "true" : undefined}
												className={cn(
													"w-full rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset",
													isSelected && "bg-brand-softer"
												)}
												data-repository-revision-navigation-item={stash.oid}
												disabled={isPending}
												onClick={async () => await onSelectStash(stash)}
												onKeyDown={navigateStashes}
												tabIndex={isSelected ? 0 : -1}
												type="button"
											>
												<span className="block truncate font-medium text-editor-ink text-xss">
													{stash.summary}
												</span>
												<span className="mt-0.5 block text-[9px] text-editor-faint tabular-nums">
													{formatRelativeTime(stash.createdAt)}
												</span>
											</button>
										</li>
									);
								})}
							</ul>
						</ScrollAreaContent>
					</ScrollAreaViewport>
					<ScrollBar />
				</ScrollArea>
			) : (
				<p className="min-h-0 flex-1 px-4 py-10 text-center text-editor-faint text-xss">
					No saved changes yet.
				</p>
			)}
		</aside>
	);
}
