import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@1git/ui/components/dropdown-menu";
import { Input } from "@1git/ui/components/input";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
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
	RecentRepositoryRecord,
	RepositorySessionId,
} from "../../../../../shared/repository-session.js";
import type {
	PendingWorkspaceAction,
	WorkspaceTabState,
} from "../../../feature/workspace/hooks/use-git-workspace.js";
import {
	getRepositoryName,
	recentRepositoryName,
} from "../../../feature/workspace/lib/workspace-model.js";
import { AnimatedFolderOpenIcon } from "../../icons/components/animated-folder-open-icon.js";
import {
	LiquidMenuContent,
	LiquidMenuRoot,
} from "../../liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "../../liquid-menu/components/liquid-menu-auto-size.js";
import { REPOSITORY_MENU_ANCHOR_GEOMETRY } from "../constants/repository-menu.js";

interface RepositoryMenuProps {
	readonly activeSessionId: RepositorySessionId | null;
	readonly isOpen: boolean;
	readonly onActivateWorkspace: (
		sessionId: RepositorySessionId
	) => Promise<void>;
	readonly onOpenChange: (isOpen: boolean) => void;
	readonly onOpenRecent: (path: string) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
	readonly workspaces: readonly WorkspaceTabState[];
}

export function RepositoryMenu({
	activeSessionId,
	isOpen,
	onActivateWorkspace,
	onOpenChange,
	onOpenRecent,
	onPickRepository,
	pendingAction,
	recentRepositories,
	workspaces,
}: RepositoryMenuProps): ReactElement {
	const [query, setQuery] = useState("");
	const searchInputRef = useRef<HTMLInputElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const openPaths = new Set(
		workspaces.map((workspace) => workspace.session.repository.root)
	);
	const matchingWorkspaces = workspaces.filter((workspace) => {
		const repositoryName = getRepositoryName(workspace.session.repository.root);
		return (
			!normalizedQuery ||
			repositoryName.toLocaleLowerCase().includes(normalizedQuery) ||
			workspace.session.repository.root
				.toLocaleLowerCase()
				.includes(normalizedQuery) ||
			workspace.branch?.toLocaleLowerCase().includes(normalizedQuery)
		);
	});
	const matchingRecentRepositories = recentRepositories.filter(
		(repository) =>
			!openPaths.has(repository.path) &&
			(!normalizedQuery ||
				recentRepositoryName(repository)
					.toLocaleLowerCase()
					.includes(normalizedQuery) ||
				repository.path.toLocaleLowerCase().includes(normalizedQuery))
	);

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
	};
	const changeMenuOpen = (nextIsOpen: boolean): void => {
		onOpenChange(nextIsOpen);
		if (!nextIsOpen) {
			setQuery("");
		}
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

	return (
		<div
			className="relative flex h-full shrink-0 items-center border-editor-hairline pl-2"
			data-name="RepositoryMenu"
		>
			<LiquidMenuRoot
				anchor={getMenuAnchor}
				anchorGeometry={REPOSITORY_MENU_ANCHOR_GEOMETRY}
				disabled={pendingAction === "open"}
				modal
				onOpenChange={changeMenuOpen}
				open={isOpen}
			>
				<DropdownMenuTrigger
					aria-keyshortcuts="Meta+K Control+K"
					aria-label="Open repositories"
					className="relative z-10 flex h-8 items-center gap-2 rounded-lg px-2.5 font-semibold text-editor-ink text-xss outline-none transition-colors hover:bg-hover focus-visible:bg-studio-glass-strong"
					ref={triggerRef}
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
				</DropdownMenuTrigger>

				{isOpen ? (
					<LiquidMenuContent
						align="start"
						aria-busy={pendingAction === "open"}
						aria-label="Repositories"
						className="max-h-[min(70vh,32rem)] w-[370px] min-w-[370px] p-1.5"
						sideOffset={2}
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
										className="h-8 border-editor-hairline bg-editor-sunken pl-8 text-xs shadow-none"
										onChange={updateQuery}
										onKeyDown={stopMenuNavigation}
										placeholder="Find a repository or worktree"
										ref={searchInputRef}
										type="search"
										value={query}
									/>
									<kbd
										aria-hidden
										className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[10px] text-editor-faint"
									>
										⌘K
									</kbd>
								</div>
							</div>

							{matchingWorkspaces.length > 0 ? (
								<DropdownMenuGroup data-name="OpenWorkspaceList">
									<DropdownMenuLabel>Open workspaces</DropdownMenuLabel>
									{matchingWorkspaces.map((workspace) => {
										const activateWorkspace = async (): Promise<void> => {
											closeMenu();
											await onActivateWorkspace(workspace.session.id);
										};
										const isActive = workspace.session.id === activeSessionId;
										return (
											<DropdownMenuItem
												aria-current={isActive ? "page" : undefined}
												className="gap-2.5 py-2"
												closeOnClick
												key={workspace.session.id}
												onClick={activateWorkspace}
											>
												<GitBranchIcon
													aria-hidden
													className="text-editor-faint"
													weight="regular"
												/>
												<span className="min-w-0 flex-1">
													<span className="block truncate font-medium text-editor-ink text-xs">
														{getRepositoryName(
															workspace.session.repository.root
														)}
													</span>
													<span className="block truncate text-[10px] text-editor-faint">
														{workspace.branch ?? "Loading branch…"}
													</span>
												</span>
												{workspace.changedFiles ? (
													<span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-[9px] text-amber-700">
														{workspace.changedFiles}
														<span className="sr-only"> changed files</span>
													</span>
												) : null}
												{isActive ? (
													<>
														<span
															aria-hidden
															className="size-1.5 rounded-full bg-brand"
														/>
														<span className="sr-only">Current workspace</span>
													</>
												) : null}
											</DropdownMenuItem>
										);
									})}
								</DropdownMenuGroup>
							) : null}

							{matchingRecentRepositories.length > 0 ? (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuGroup data-name="RecentRepositoryList">
										<DropdownMenuLabel>Recent</DropdownMenuLabel>
										{matchingRecentRepositories.map((repository) => {
											const openRecent = async (): Promise<void> => {
												closeMenu();
												await onOpenRecent(repository.path);
											};
											return (
												<DropdownMenuItem
													className="gap-2.5 py-2"
													closeOnClick
													key={repository.path}
													onClick={openRecent}
												>
													<FolderOpenIcon
														aria-hidden
														className="text-editor-faint"
														weight="regular"
													/>
													<span className="min-w-0 flex-1">
														<span className="block truncate font-medium text-editor-ink text-xs">
															{recentRepositoryName(repository)}
														</span>
														<span
															className="block truncate text-[10px] text-editor-faint"
															title={repository.path}
														>
															{repository.path}
														</span>
													</span>
												</DropdownMenuItem>
											);
										})}
									</DropdownMenuGroup>
								</>
							) : null}

							{matchingWorkspaces.length === 0 &&
							matchingRecentRepositories.length === 0 &&
							normalizedQuery ? (
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
	);
}
