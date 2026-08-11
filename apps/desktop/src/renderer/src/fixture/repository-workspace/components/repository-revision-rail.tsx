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
import type { ReactElement } from "react";
import { useCallback, useRef, useState } from "react";
import { formatRelativeTime } from "@/feature/workspace/lib/workspace-model.js";
import type { RepositoryTab } from "@/feature/workspace/types/git-workspace.js";
import {
	LiquidMenuContent,
	LiquidMenuRoot,
	LiquidMenuTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";
import { LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY } from "@/fixture/liquid-menu/constants/liquid-menu.js";
import { OverflowingLabel } from "@/fixture/overflowing-label/components/overflowing-label.js";
import {
	getRepositoryFileRowId,
	splitRepositoryFilePath,
} from "@/fixture/repository-workspace/lib/repository-navigation.js";

interface RepositoryRevisionFileRailProps {
	readonly diffs: readonly FileDiff[];
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
		<footer className="flex h-10 shrink-0 items-center gap-1 border-editor-hairline border-t px-2">
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
						side="top"
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
		</footer>
	);
}

export function RepositoryRevisionFileRail({
	diffs,
	isPending,
	onApplyStash,
	onDropStash,
	onPopStash,
	onSelectFile,
	selectedFilePath,
	selectedStash,
	tab,
}: RepositoryRevisionFileRailProps): ReactElement | null {
	if (tab === "changes") {
		return null;
	}
	const stats = diffs[0]?.stats ?? [];
	const label = tab === "history" ? "Files in commit" : "Files in stash";

	return (
		<aside
			aria-label={label}
			className="fade-in slide-in-from-right-2 relative z-20 flex min-h-0 w-60 shrink-0 animate-in flex-col border-editor-hairline border-r bg-white/20 duration-150"
			data-name="RepositoryRevisionFileRail"
			data-repository-file-liquid-rail
		>
			<header className="flex h-9 shrink-0 items-center justify-between px-3 text-[10px] text-editor-muted">
				<span>{label}</span>
				<span className="tabular-nums">{stats.length}</span>
			</header>
			{stats.length > 0 ? (
				<ScrollArea className="min-h-0 flex-1" overflowEdgeThreshold={1}>
					<ScrollAreaViewport className="min-h-0" data-repository-file-viewport>
						<ScrollAreaContent>
							<ul
								className="space-y-0.5 px-1.5 pb-1.5"
								data-repository-file-list
							>
								{stats.map((stat) => {
									const path = splitRepositoryFilePath(stat.path);
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
													"flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-inset",
													isSelected && "relative z-20"
												)}
												onClick={async () => await onSelectFile(stat.path)}
												type="button"
											>
												<OverflowingLabel
													className="min-w-0 flex-1 text-[11px]"
													deferUntilVisible
													direction="end-to-start"
													title={stat.path}
												>
													{path.directory ? (
														<span className="text-editor-muted/75">
															{path.directory}
														</span>
													) : null}
													<span className="font-medium text-editor-ink">
														{path.name}
													</span>
												</OverflowingLabel>
												<span className="flex shrink-0 items-center gap-1 font-medium text-[9px] tabular-nums">
													<span className="text-[#1a7f37]">
														+{stat.addedLines ?? "–"}
													</span>
													<span className="text-[#cf222e]">
														−{stat.deletedLines ?? "–"}
													</span>
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
					{tab === "stashes" && !selectedStash
						? "Select a stash to inspect."
						: "This revision has no changed files."}
				</p>
			)}
			{tab === "stashes" && selectedStash ? (
				<RepositoryStashActions
					isPending={isPending}
					onApply={onApplyStash}
					onDrop={onDropStash}
					onPop={onPopStash}
					stash={selectedStash}
				/>
			) : null}
		</aside>
	);
}

export function RepositoryStashRail({
	isPending,
	onSelectStash,
	selectedStashOid,
	stashes,
}: RepositoryStashRailProps): ReactElement {
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
					<ScrollAreaViewport className="min-h-0">
						<ScrollAreaContent>
							<ul className="space-y-0.5 px-1.5 pb-1.5">
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
												disabled={isPending}
												onClick={async () => await onSelectStash(stash)}
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
