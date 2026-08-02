import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@1git/ui/components/dropdown-menu";
import { Input } from "@1git/ui/components/input";
import { Kbd } from "@1git/ui/components/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@1git/ui/components/tooltip";
import { cn } from "@1git/ui/lib/utils";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type {
	ChangeEvent,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
} from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
	OpenRepositoryOptions,
	PendingWorkspaceAction,
	WorkspaceTabState,
} from "@/feature/workspace/hooks/use-git-workspace.js";
import { getRepositoryOwner } from "@/feature/workspace/lib/repository-owner.js";
import {
	formatCommitDate,
	formatRelativeTime,
	recentRepositoryName,
} from "@/feature/workspace/lib/workspace-model.js";
import { RepositoryOwnerThumbnail } from "@/fixture/desktop-toolbar/components/repository-owner-thumbnail.js";
import {
	REPOSITORY_MENU_ALIGN_OFFSET,
	REPOSITORY_MENU_ANCHOR_GEOMETRY,
	REPOSITORY_MENU_TOOLTIP_DELAY_MS,
} from "@/fixture/desktop-toolbar/constants/repository-menu.js";
import { useRecentRepositoryPreviews } from "@/fixture/desktop-toolbar/hooks/use-recent-repository-previews.js";
import { AnimatedFolderOpenIcon } from "@/fixture/icons/components/animated-folder-open-icon.js";
import {
	LiquidMenuContent,
	LiquidMenuRoot,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";
import { useKeyboardModifiers } from "@/hooks/use-keyboard-modifiers.js";
import type {
	RecentRepositoryPreview,
	RecentRepositoryRecord,
} from "../../../../../shared/repository-session.js";

interface RepositoryMenuProps {
	readonly isOpen: boolean;
	readonly isVisible: boolean;
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

interface RecentRepositoryMenuItemProps {
	readonly metaKey: boolean;
	readonly onClose: () => void;
	readonly onOpen: (
		path: string,
		options?: OpenRepositoryOptions
	) => Promise<void>;
	readonly preview: RecentRepositoryPreview | null;
	readonly repository: RecentRepositoryRecord;
	readonly workspace: WorkspaceTabState | null;
}

function RecentRepositoryTooltipDetails({
	preview,
}: {
	readonly preview: RecentRepositoryPreview | null;
}): ReactElement {
	if (!preview) {
		return (
			<span className="mt-1.5 block text-[10px] opacity-65">
				Loading repository details…
			</span>
		);
	}

	if (!preview.latestCommit) {
		return (
			<>
				{preview.head.branch ? (
					<span className="mt-1 block opacity-80">
						Branch {preview.head.branch}
					</span>
				) : null}
				<span className="mt-1.5 block text-[10px] opacity-65">
					No commits yet
				</span>
			</>
		);
	}

	return (
		<>
			{/*{preview.head.branch ? (
        <span className="mt-1 block opacity-80">
          Branch {preview.head.branch}
        </span>
      ) : null}*/}
			<span className="mt-1.5 line-clamp-2 block font-medium">
				{preview.latestCommit.summary}
			</span>
			<span className="mt-1 block text-[10px] opacity-65">
				Latest commit {formatCommitDate(preview.latestCommit.committedAt)} by{" "}
				{preview.latestCommit.author.name}
			</span>
		</>
	);
}

function RecentRepositoryMenuItem({
	metaKey,
	onClose,
	onOpen,
	preview,
	repository,
	workspace,
}: RecentRepositoryMenuItemProps): ReactElement {
	const tooltipId = useId();
	const owner =
		workspace?.owner ??
		(preview
			? getRepositoryOwner(preview.remotes, preview.head.upstream)
			: null);
	const repositoryName = recentRepositoryName(repository);
	const branchName =
		workspace?.branch ?? (preview ? preview.head.branch : null);
	const lastUsed = formatRelativeTime(repository.lastOpenedAt);
	const ownerTitle = owner
		? `${owner.namespace} on ${owner.host}`
		: "Local repository";
	const thumbnailLabel = owner ? owner.namespace : repositoryName;
	const openRecent = async (
		event: ReactMouseEvent<HTMLElement>
	): Promise<void> => {
		const openInBackground = event.metaKey || metaKey;
		if (!openInBackground) {
			onClose();
		}
		await onOpen(repository.path, { activate: !openInBackground });
	};

	const menuItem = (
		<DropdownMenuItem
			aria-describedby={tooltipId}
			aria-label={`${repositoryName}${branchName ? `, branch ${branchName}` : ""}, last used ${lastUsed}${workspace ? ", open" : ""}`}
			className="gap-2"
			closeOnClick={false}
			onClick={openRecent}
		>
			<RepositoryOwnerThumbnail
				label={thumbnailLabel}
				owner={owner}
				size="sm"
				title={ownerTitle}
			/>
			<span className="flex min-w-0 flex-1 items-baseline overflow-hidden">
				<span className="shrink-0 font-semibold">{repositoryName}</span>
				{branchName ? (
					<>
						<span className="shrink-0 text-editor-faint">&nbsp;/&nbsp;</span>
						<span className="min-w-0 truncate font-normal text-editor-muted">
							{branchName}
						</span>
					</>
				) : (
					<span className="min-w-0 truncate font-normal text-editor-faint">
						&nbsp;/ Loading branch…
					</span>
				)}
			</span>
			<time
				className="shrink-0 font-normal text-[10px] text-editor-faint tabular-nums"
				dateTime={repository.lastOpenedAt}
				title={formatCommitDate(repository.lastOpenedAt)}
			>
				{lastUsed}
			</time>
			{workspace ? (
				<>
					<span
						aria-hidden
						className="size-1.5 shrink-0 rounded-full bg-brand"
					/>
					<span className="sr-only">Open repository</span>
				</>
			) : null}
		</DropdownMenuItem>
	);

	return (
		<Tooltip>
			<TooltipTrigger render={menuItem} />
			<TooltipContent
				align="center"
				className="max-w-80 items-start"
				id={tooltipId}
				side="right"
				sideOffset={8}
			>
				<span className="min-w-0 py-1">
					<span className="block truncate font-semibold">{repositoryName}</span>
					<span className="mt-0.5 block break-all opacity-70">
						{repository.path}
					</span>
					<RecentRepositoryTooltipDetails preview={preview} />
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

export function RepositoryMenu({
	isOpen,
	isVisible,
	onOpenChange,
	onOpenRecent,
	onPickRepository,
	pendingAction,
	recentRepositories,
	workspaces,
}: RepositoryMenuProps): ReactElement {
	const [query, setQuery] = useState("");
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
		<TooltipProvider delay={REPOSITORY_MENU_TOOLTIP_DELAY_MS}>
			<div
				aria-hidden={isVisible ? undefined : true}
				className={cn(
					"relative flex h-full shrink-0 items-center overflow-hidden border-editor-hairline opacity-100 transition-[max-width,opacity,transform,padding] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
					isVisible
						? "max-w-24 translate-x-0 pl-2"
						: "pointer-events-none max-w-0 -translate-x-1 p-0 opacity-0"
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
					<DropdownMenuTrigger
						aria-keyshortcuts="Meta+K Control+K"
						aria-label="Open repositories"
						className="relative z-10 flex h-8 items-center gap-2 rounded-lg px-2.5 font-semibold text-editor-ink text-xss outline-none transition-colors hover:bg-white focus-visible:bg-studio-glass-strong"
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
							alignOffset={REPOSITORY_MENU_ALIGN_OFFSET}
							aria-busy={pendingAction === "open"}
							aria-label="Repositories"
							className="max-h-[min(70vh,32rem)] w-[370px] min-w-[370px] p-1.5"
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
												<RecentRepositoryMenuItem
													key={repository.path}
													metaKey={metaKey}
													onClose={closeMenu}
													onOpen={onOpenRecent}
													preview={previews.get(repository.path) ?? null}
													repository={repository}
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
