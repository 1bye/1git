import { Button, buttonVariants } from "@1git/ui/components/button";
import { DropdownMenuTrigger } from "@1git/ui/components/dropdown-menu";
import { Input } from "@1git/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@1git/ui/components/tooltip";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type {
	ChangeEvent,
	FormEvent,
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
	ReactNode,
} from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
	OpenRepositoryOptions,
	WorkspaceTabState,
} from "@/feature/workspace/hooks/use-git-workspace.js";
import { getRepositoryOwner } from "@/feature/workspace/lib/repository-owner.js";
import {
	formatCommitDate,
	formatRelativeTime,
	recentRepositoryName,
} from "@/feature/workspace/lib/workspace-model.js";
import { RepositoryOwnerThumbnail } from "@/fixture/desktop-toolbar/components/repository-owner-thumbnail.js";
import { useRecentRepositoryPreviews } from "@/fixture/desktop-toolbar/hooks/use-recent-repository-previews.js";
import {
	LiquidMenuContent,
	LiquidMenuRoot,
} from "@/fixture/liquid-menu/components/liquid-menu.js";
import { LiquidMenuAutoSize } from "@/fixture/liquid-menu/components/liquid-menu-auto-size.js";
import {
	CLONE_MENU_ANCHOR_GEOMETRY,
	CLONE_MENU_SIDE_OFFSET,
} from "@/fixture/workspace-content/constants/repository-welcome.js";
import type {
	RecentRepositoryPreview,
	RecentRepositoryRecord,
} from "../../../../../shared/repository-session.js";

interface RepositoryWelcomeProps {
	readonly isLoading: boolean;
	readonly onCloneRepository: (remoteUrl: string) => Promise<boolean>;
	readonly onCreateRepository: () => Promise<boolean>;
	readonly onOpenRecent: (
		path: string,
		options?: OpenRepositoryOptions
	) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
	readonly workspaces: readonly WorkspaceTabState[];
}

interface QuickActionProps {
	readonly children: ReactNode;
	readonly disabled: boolean;
	readonly icon: ReactElement;
	readonly onClick: () => void;
}

interface RepositoryListItemProps {
	readonly disabled: boolean;
	readonly onOpen: (
		path: string,
		options?: OpenRepositoryOptions
	) => Promise<void>;
	readonly preview: RecentRepositoryPreview | null;
	readonly repository: RecentRepositoryRecord;
	readonly workspace: WorkspaceTabState | null;
}

function QuickAction({
	children,
	disabled,
	icon,
	onClick,
}: QuickActionProps): ReactElement {
	return (
		<Button
			className="w-full justify-start px-2.5"
			disabled={disabled}
			onClick={onClick}
			size="sm"
			type="button"
			variant="ghost"
		>
			{icon}
			{children}
		</Button>
	);
}

function RepositoryListItem({
	disabled,
	onOpen,
	preview,
	repository,
	workspace,
}: RepositoryListItemProps): ReactElement {
	const tooltipId = useId();
	const repositoryName = recentRepositoryName(repository);
	const owner =
		workspace?.owner ??
		(preview
			? getRepositoryOwner(preview.remotes, preview.head.upstream)
			: null);
	const branchName =
		workspace?.branch ?? (preview ? preview.head.branch : null);
	const thumbnailLabel = owner ? owner.namespace : repositoryName;
	const ownerTitle = owner
		? `${owner.namespace} on ${owner.host}`
		: "Local repository";
	const lastUsed = formatRelativeTime(repository.lastOpenedAt);
	const openRepository = async (
		event: ReactMouseEvent<HTMLButtonElement>
	): Promise<void> => {
		await onOpen(repository.path, { activate: !event.metaKey });
	};
	const row = (
		<button
			aria-describedby={tooltipId}
			aria-label={`${repositoryName}${branchName ? `, branch ${branchName}` : ""}, last used ${lastUsed}${workspace ? ", open" : ""}`}
			className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-editor-sunken focus-visible:bg-editor-sunken focus-visible:ring-2 focus-visible:ring-editor-muted/15 disabled:pointer-events-none disabled:opacity-50"
			disabled={disabled}
			onClick={openRepository}
			type="button"
		>
			<RepositoryOwnerThumbnail
				label={thumbnailLabel}
				owner={owner}
				size="md"
				title={ownerTitle}
			/>
			<span className="flex min-w-0 flex-1 items-baseline overflow-hidden">
				<span className="shrink-0 font-semibold text-editor-ink text-xs">
					{repositoryName}
				</span>
				{branchName ? (
					<>
						<span className="shrink-0 text-editor-faint">&nbsp;/&nbsp;</span>
						<span className="min-w-0 truncate text-editor-muted text-xs">
							{branchName}
						</span>
					</>
				) : null}
			</span>
			<time
				className="shrink-0 text-editor-faint text-xss tabular-nums"
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
		</button>
	);

	return (
		<Tooltip>
			<TooltipTrigger render={row} />
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
					{preview?.latestCommit ? (
						<span className="mt-1.5 block text-[10px] opacity-65">
							Latest commit {formatCommitDate(preview.latestCommit.committedAt)}{" "}
							by {preview.latestCommit.author.name}
						</span>
					) : null}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

function RepositoryGroup({
	disabled,
	heading,
	onOpen,
	previews,
	repositories,
	workspacesByPath,
}: {
	readonly disabled: boolean;
	readonly heading: string;
	readonly onOpen: (
		path: string,
		options?: OpenRepositoryOptions
	) => Promise<void>;
	readonly previews: ReadonlyMap<string, RecentRepositoryPreview>;
	readonly repositories: readonly RecentRepositoryRecord[];
	readonly workspacesByPath: ReadonlyMap<string, WorkspaceTabState>;
}): ReactElement | null {
	if (repositories.length === 0) {
		return null;
	}

	return (
		<section className="mt-6 first:mt-5">
			<h3 className="mb-1 px-3 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]">
				{heading}
			</h3>
			<ul>
				{repositories.map((repository) => (
					<li key={repository.path}>
						<RepositoryListItem
							disabled={disabled}
							onOpen={onOpen}
							preview={previews.get(repository.path) ?? null}
							repository={repository}
							workspace={workspacesByPath.get(repository.path) ?? null}
						/>
					</li>
				))}
			</ul>
		</section>
	);
}

export function RepositoryWelcome({
	isLoading,
	onCloneRepository,
	onCreateRepository,
	onOpenRecent,
	onPickRepository,
	recentRepositories,
	workspaces,
}: RepositoryWelcomeProps): ReactElement {
	const [cloneUrl, setCloneUrl] = useState("");
	const [isCloneMenuOpen, setIsCloneMenuOpen] = useState(false);
	const [query, setQuery] = useState("");
	const cloneInputRef = useRef<HTMLInputElement>(null);
	const cloneTriggerRef = useRef<HTMLButtonElement>(null);
	const previews = useRecentRepositoryPreviews(recentRepositories, true);
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const workspacesByPath = new Map(
		workspaces.map((workspace) => [
			workspace.session.repository.root,
			workspace,
		])
	);
	const matchingRepositories = recentRepositories.filter((repository) => {
		const repositoryName = recentRepositoryName(repository);
		const preview = previews.get(repository.path);
		const workspace = workspacesByPath.get(repository.path);
		const branchName =
			workspace?.branch ?? (preview ? preview.head.branch : null);
		return (
			!normalizedQuery ||
			repositoryName.toLocaleLowerCase().includes(normalizedQuery) ||
			repository.path.toLocaleLowerCase().includes(normalizedQuery) ||
			branchName?.toLocaleLowerCase().includes(normalizedQuery)
		);
	});
	const openRepositories = matchingRepositories.filter((repository) =>
		workspacesByPath.has(repository.path)
	);
	const otherRepositories = matchingRepositories.filter(
		(repository) => !workspacesByPath.has(repository.path)
	);

	const updateQuery = (event: ChangeEvent<HTMLInputElement>): void => {
		setQuery(event.target.value);
	};
	const updateCloneUrl = (event: ChangeEvent<HTMLInputElement>): void => {
		setCloneUrl(event.target.value);
	};
	const closeCloneMenu = (): void => {
		setCloneUrl("");
		setIsCloneMenuOpen(false);
	};
	const changeCloneMenuOpen = (isOpen: boolean): void => {
		setIsCloneMenuOpen(isOpen);
		if (!isOpen) {
			setCloneUrl("");
		}
	};
	const stopCloneMenuNavigation = (
		event: ReactKeyboardEvent<HTMLInputElement>
	): void => {
		if (event.key !== "Escape") {
			event.stopPropagation();
		}
	};
	const getCloneMenuAnchor = useCallback(
		(): Element | null => cloneTriggerRef.current,
		[]
	);
	const pickRepository = async (): Promise<void> => {
		await onPickRepository();
	};
	const createRepository = async (): Promise<void> => {
		await onCreateRepository();
	};
	const submitClone = async (
		event: FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();
		const remoteUrl = cloneUrl.trim();
		if (!remoteUrl) {
			return;
		}
		if (await onCloneRepository(remoteUrl)) {
			closeCloneMenu();
		}
	};

	useEffect(() => {
		if (!isCloneMenuOpen) {
			return;
		}
		const focusTimer = window.setTimeout(() => {
			cloneInputRef.current?.focus();
		});
		return () => window.clearTimeout(focusTimer);
	}, [isCloneMenuOpen]);

	return (
		<TooltipProvider delay={300}>
			<main
				aria-busy={isLoading}
				className="min-h-0 flex-1 overflow-y-auto bg-editor-surface px-6 py-10 sm:px-10 sm:py-12"
				data-name="RepositoryWelcome"
			>
				<h1 className="sr-only">Repositories</h1>
				<div className="mx-auto grid w-full max-w-[980px] grid-cols-1 items-start gap-10 md:grid-cols-[220px_minmax(0,1fr)] md:gap-16">
					<section aria-labelledby="quick-actions-heading">
						<h2
							className="mb-3 px-2.5 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]"
							id="quick-actions-heading"
						>
							Quick actions
						</h2>
						<div className="space-y-1">
							<QuickAction
								disabled={isLoading}
								icon={
									<PlusIcon aria-hidden className="size-4" weight="regular" />
								}
								onClick={createRepository}
							>
								Create repository
							</QuickAction>
							<LiquidMenuRoot
								anchor={getCloneMenuAnchor}
								anchorGeometry={CLONE_MENU_ANCHOR_GEOMETRY}
								disabled={isLoading && !isCloneMenuOpen}
								modal
								onOpenChange={changeCloneMenuOpen}
								open={isCloneMenuOpen}
							>
								<DropdownMenuTrigger
									className={buttonVariants({
										className:
											"relative z-10 w-full justify-start px-2.5 text-editor-muted",
										size: "sm",
										variant: "ghost",
									})}
									ref={cloneTriggerRef}
								>
									<GitBranchIcon
										aria-hidden
										className="size-4"
										weight="duotone"
									/>
									Clone from URL
								</DropdownMenuTrigger>
								{isCloneMenuOpen ? (
									<LiquidMenuContent
										align="center"
										aria-label="Clone repository"
										className="w-[340px] min-w-[340px] p-1.5"
										side="right"
										sideOffset={CLONE_MENU_SIDE_OFFSET}
									>
										<LiquidMenuAutoSize
											viewKey={isLoading ? "cloning" : "form"}
										>
											{isLoading ? (
												<div
													className="flex items-center gap-2.5 px-3 py-4 text-editor-muted text-xs"
													role="status"
												>
													<SpinnerGapIcon
														aria-hidden
														className="size-4 animate-spin"
														weight="duotone"
													/>
													Cloning repository…
												</div>
											) : (
												<form className="p-3" onSubmit={submitClone}>
													<div className="mb-4">
														<h3 className="font-semibold text-editor-ink text-sm">
															Clone repository
														</h3>
														<p className="mt-1 text-editor-muted text-xss leading-4">
															Enter a Git URL, then choose where to clone it.
														</p>
													</div>
													<label
														className="mb-1.5 block font-medium text-editor-muted text-xss"
														htmlFor="welcome-clone-url"
													>
														Repository URL
													</label>
													<Input
														className="bg-editor-sunken text-xs shadow-none"
														id="welcome-clone-url"
														onChange={updateCloneUrl}
														onKeyDown={stopCloneMenuNavigation}
														placeholder="https://github.com/owner/repo.git"
														ref={cloneInputRef}
														required
														type="url"
														value={cloneUrl}
													/>
													<div className="mt-5 flex justify-end gap-2">
														<Button
															onClick={closeCloneMenu}
															size="sm"
															type="button"
															variant="ghost"
														>
															Cancel
														</Button>
														<Button size="sm" type="submit" variant="default">
															Choose folder
														</Button>
													</div>
												</form>
											)}
										</LiquidMenuAutoSize>
									</LiquidMenuContent>
								) : null}
							</LiquidMenuRoot>
							<QuickAction
								disabled={isLoading}
								icon={
									<FolderOpenIcon
										aria-hidden
										className="size-4"
										weight="duotone"
									/>
								}
								onClick={pickRepository}
							>
								Open from disk
							</QuickAction>
						</div>
					</section>

					<section aria-labelledby="all-repositories-heading">
						<h2
							className="mb-3 px-1 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]"
							id="all-repositories-heading"
						>
							All repositories
						</h2>
						<div className="relative">
							<MagnifyingGlassIcon
								aria-hidden
								className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-editor-faint"
								weight="regular"
							/>
							<Input
								aria-label="Search all repositories"
								className="h-9 bg-editor-sunken pl-9 text-xs shadow-none"
								disabled={isLoading}
								onChange={updateQuery}
								placeholder="Search all repositories"
								type="search"
								value={query}
							/>
						</div>

						{isLoading && recentRepositories.length === 0 ? (
							<p
								className="flex items-center gap-2 px-3 py-8 text-editor-faint text-xss"
								role="status"
							>
								<SpinnerGapIcon
									aria-hidden
									className="size-4 animate-spin"
									weight="duotone"
								/>
								Loading repositories…
							</p>
						) : null}

						{!isLoading && recentRepositories.length === 0 ? (
							<p className="px-3 py-8 text-editor-faint text-xss">
								Repositories you open, clone, or create will appear here.
							</p>
						) : null}

						{recentRepositories.length > 0 &&
						matchingRepositories.length === 0 ? (
							<p className="px-3 py-8 text-editor-faint text-xss">
								No repositories match “{query.trim()}”.
							</p>
						) : null}

						<RepositoryGroup
							disabled={isLoading}
							heading="Open"
							onOpen={onOpenRecent}
							previews={previews}
							repositories={openRepositories}
							workspacesByPath={workspacesByPath}
						/>
						<RepositoryGroup
							disabled={isLoading}
							heading={openRepositories.length > 0 ? "Other" : "Repositories"}
							onOpen={onOpenRecent}
							previews={previews}
							repositories={otherRepositories}
							workspacesByPath={workspacesByPath}
						/>
					</section>
				</div>
			</main>
		</TooltipProvider>
	);
}
