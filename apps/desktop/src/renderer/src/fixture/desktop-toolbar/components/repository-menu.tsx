import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@1git/ui/components/dropdown-menu";
import { Input } from "@1git/ui/components/input";
import { Kbd } from "@1git/ui/components/kbd";
import { TooltipProvider } from "@1git/ui/components/tooltip";
import { cn } from "@1git/ui/lib/utils";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type {
	ChangeEvent,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	OpenRepositoryOptions,
	PendingWorkspaceAction,
	WorkspaceTabState,
} from "@/feature/workspace/hooks/use-git-workspace.js";
import { recentRepositoryName } from "@/feature/workspace/lib/workspace-model.js";
import { useCommandLensTarget } from "@/fixture/command-lens/hooks/use-command-lens-target.js";
import type { CommandLensCommand } from "@/fixture/command-lens/lib/command-lens-shortcut.js";
import {
	REPOSITORY_MENU_ALIGN_OFFSET,
	REPOSITORY_MENU_ANCHOR_GEOMETRY,
} from "@/fixture/desktop-toolbar/constants/repository-menu.js";
import { WORKSPACE_COMMAND_LENS_GROUP } from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import { AnimatedFolderOpenIcon } from "@/fixture/icons/components/animated-folder-open-icon.js";
import {
	LiquidMenuContent,
	LiquidMenuRoot,
	LiquidMenuTrigger,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";
import { RepositoryContextMenu } from "@/fixture/repository-item/components/repository-context-menu.js";
import { REPOSITORY_ITEM_TOOLTIP_DELAY_MS } from "@/fixture/repository-item/constants/repository-context-menu.js";
import { useRecentRepositoryPreviews } from "@/fixture/repository-item/hooks/use-recent-repository-previews.js";
import {
	type RepositoryContextLayer,
	updateRepositoryContextLayerOpen,
	updateRepositoryContextLayerPresence,
} from "@/fixture/repository-item/lib/repository-context-layer.js";
import { useKeyboardModifiers } from "@/hooks/use-keyboard-modifiers.js";
import type { RecentRepositoryRecord } from "../../../../../shared/repository-session.js";

interface RepositoryMenuProps {
	readonly isOpen: boolean;
	readonly isVisible: boolean;
	readonly onForgetRecent: (path: string) => Promise<void>;
	readonly onOpenChange: (isOpen: boolean) => void;
	readonly onOpenRecent: (
		path: string,
		options?: OpenRepositoryOptions
	) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
	readonly workspaces: readonly WorkspaceTabState[];
}

const REPOSITORY_MENU_COMMANDS: readonly CommandLensCommand[] = [
	{
		allowInEditable: true,
		key: "k",
		label: "Open repositories",
	},
];

export function RepositoryMenu({
	isOpen,
	isVisible,
	onForgetRecent,
	onOpenChange,
	onOpenRecent,
	onPickRepository,
	pendingAction,
	recentRepositories,
	workspaces,
}: RepositoryMenuProps): ReactElement {
	const [query, setQuery] = useState("");
	const [contextLayer, setContextLayer] =
		useState<RepositoryContextLayer | null>(null);
	const { metaKey } = useKeyboardModifiers();
	const searchInputRef = useRef<HTMLInputElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const previews = useRecentRepositoryPreviews(recentRepositories, isOpen);
	const workspacesByPath = new Map(
		workspaces.map((workspace) => [
			workspace.session.repository.root,
			workspace,
		])
	);
	const matchingRecentRepositories = recentRepositories.filter((repository) => {
		const workspace = workspacesByPath.get(repository.path);
		return (
			!normalizedQuery ||
			recentRepositoryName(repository)
				.toLocaleLowerCase()
				.includes(normalizedQuery) ||
			repository.path.toLocaleLowerCase().includes(normalizedQuery) ||
			workspace?.branch?.toLocaleLowerCase().includes(normalizedQuery)
		);
	});

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const focusTimer = window.setTimeout(() => {
			searchInputRef.current?.focus();
		});
		return () => window.clearTimeout(focusTimer);
	}, [isOpen]);

	const closeMenu = (): void => {
		onOpenChange(false);
		setQuery("");
		setContextLayer(null);
	};
	const changeMenuOpen = (nextIsOpen: boolean): void => {
		onOpenChange(nextIsOpen);
		if (!nextIsOpen) {
			setQuery("");
			setContextLayer(null);
		}
	};
	const changeRepositoryContextOpen = (
		repositoryPath: string,
		nextIsOpen: boolean
	): void => {
		setContextLayer((currentLayer) =>
			updateRepositoryContextLayerOpen(currentLayer, repositoryPath, nextIsOpen)
		);
	};
	const changeRepositoryContextPresence = (
		repositoryPath: string,
		isPresent: boolean
	): void => {
		setContextLayer((currentLayer) =>
			updateRepositoryContextLayerPresence(
				currentLayer,
				repositoryPath,
				isPresent
			)
		);
	};
	const updateQuery = (event: ChangeEvent<HTMLInputElement>): void => {
		setQuery(event.target.value);
	};
	const stopMenuNavigation = (
		event: ReactKeyboardEvent<HTMLInputElement>
	): void => {
		if (event.key !== "Escape") {
			event.stopPropagation();
		}
	};
	const pickRepository = async (): Promise<void> => {
		closeMenu();
		await onPickRepository();
	};
	const getMenuAnchor = useCallback(
		(): Element | null => triggerRef.current,
		[]
	);
	const commandLensTarget = useCommandLensTarget({
		commands: REPOSITORY_MENU_COMMANDS,
		disabled: !isVisible || pendingAction === "open",
		hintLayout: "floating",
		id: "repository-menu",
		navigationAction: {
			label: "Open repositories",
			onInvoke: () => changeMenuOpen(true),
		},
		navigationGroup: WORKSPACE_COMMAND_LENS_GROUP,
		navigationOrder: 0,
		navigationOrientation: "horizontal",
		placement: "bottom",
		radius: 10,
	});
	const setTriggerElement = useCallback(
		(element: HTMLButtonElement | null): void => {
			triggerRef.current = element;
			commandLensTarget.ref(element);
		},
		[commandLensTarget.ref]
	);

	return (
		<TooltipProvider delay={REPOSITORY_ITEM_TOOLTIP_DELAY_MS}>
			<div
				aria-hidden={isVisible ? undefined : true}
				className={cn(
					"relative flex h-full shrink-0 items-center border-editor-hairline opacity-100 transition-[max-width,opacity,transform,padding] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
					isVisible
						? "max-w-24 overflow-visible pl-2"
						: "pointer-events-none max-w-0 -translate-x-1 overflow-hidden p-0 opacity-0"
				)}
				data-name="RepositoryMenu"
				data-visible={isVisible ? "true" : "false"}
				inert={isVisible ? undefined : true}
			>
				<LiquidMenuRoot
					anchor={getMenuAnchor}
					anchorGeometry={REPOSITORY_MENU_ANCHOR_GEOMETRY}
					disabled={!isVisible || pendingAction === "open"}
					modal
					onOpenChange={changeMenuOpen}
					open={isOpen}
				>
					<LiquidMenuTrigger
						aria-keyshortcuts="Meta+K Control+K"
						aria-label="Open repositories"
						className="relative flex h-8 items-center gap-2 rounded-lg px-2.5 font-semibold text-editor-ink text-xss outline-none transition-colors duration-150 hover:bg-white focus-visible:bg-studio-glass-strong"
						data-name="RepositoryMenuTrigger"
						ref={setTriggerElement}
					>
						{pendingAction === "open" ? (
							<SpinnerGapIcon
								aria-hidden
								className="size-4 animate-spin text-editor-muted"
								weight="bold"
							/>
						) : (
							<AnimatedFolderOpenIcon
								aria-hidden
								className="size-4 text-editor-muted"
								triggerRef={triggerRef}
							/>
						)}
						Repos
					</LiquidMenuTrigger>

					{isOpen ? (
						<LiquidMenuContent
							align="start"
							alignOffset={REPOSITORY_MENU_ALIGN_OFFSET}
							aria-busy={pendingAction === "open"}
							aria-label="Repositories"
							className="max-h-[min(70vh,32rem)] w-[370px] min-w-[370px] p-1.5"
							data-name="RepositoryMenuContent"
							sideOffset={8}
						>
							<LiquidMenuAutoSize>
								<div className="p-1">
									<div className="relative">
										<MagnifyingGlassIcon
											aria-hidden
											className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-editor-faint"
											weight="regular"
										/>
										<Input
											aria-label="Find a repository or worktree"
											autoFocus
											className="h-8 bg-editor-sunken pl-8 text-xs shadow-none"
											onChange={updateQuery}
											onKeyDown={stopMenuNavigation}
											placeholder="Find a repository or worktree"
											ref={searchInputRef}
											type="search"
											value={query}
										/>
										<Kbd
											aria-hidden
											className="absolute top-1/2 right-2.5 -translate-y-1/2 gap-0.5 text-[10px] text-editor-faint"
										>
											<span>⌘</span>
											<span>K</span>
										</Kbd>
									</div>
								</div>

								{matchingRecentRepositories.length > 0 ? (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuGroup data-name="RecentRepositoryList">
											{/*<DropdownMenuLabel>Recent</DropdownMenuLabel>*/}
											{matchingRecentRepositories.map((repository) => (
												<RepositoryContextMenu
													disabled={pendingAction === "open"}
													key={repository.path}
													metaKey={metaKey}
													onContextOpenChange={(nextIsOpen) =>
														changeRepositoryContextOpen(
															repository.path,
															nextIsOpen
														)
													}
													onContextPresenceChange={(isPresent) =>
														changeRepositoryContextPresence(
															repository.path,
															isPresent
														)
													}
													onForgetRecent={onForgetRecent}
													onOpen={onOpenRecent}
													onOpenForeground={closeMenu}
													open={
														contextLayer?.repositoryPath === repository.path &&
														contextLayer.isOpen
													}
													preview={previews.get(repository.path) ?? null}
													repository={repository}
													variant="menu"
													workspace={
														workspacesByPath.get(repository.path) ?? null
													}
												/>
											))}
										</DropdownMenuGroup>
									</>
								) : null}

								{matchingRecentRepositories.length === 0 && normalizedQuery ? (
									<p
										aria-live="polite"
										className="px-3 py-5 text-center text-editor-faint text-xs"
									>
										No repositories match “{query.trim()}”.
									</p>
								) : null}

								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="gap-2.5 py-2"
									closeOnClick
									onClick={pickRepository}
								>
									<PlusIcon
										aria-hidden
										className="text-editor-faint"
										weight="bold"
									/>
									Open local repository…
								</DropdownMenuItem>
							</LiquidMenuAutoSize>
						</LiquidMenuContent>
					) : null}
				</LiquidMenuRoot>
			</div>
		</TooltipProvider>
	);
}
