import type { BranchCollection, RepositorySnapshot } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import { Input } from "@1git/ui/components/input";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { RobotIcon } from "@phosphor-icons/react/dist/csr/Robot";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ChangeEvent, FormEvent, MouseEvent, ReactElement } from "react";
import { useEffect, useState } from "react";
import type {
	RecentRepositoryRecord,
	RepositorySessionId,
} from "../../shared/repository-session.js";
import type {
	PendingWorkspaceAction,
	WorkspaceTabState,
} from "./use-git-workspace.js";
import { recentRepositoryName } from "./use-git-workspace.js";
import {
	formatRelativeTime,
	getRepositoryName,
	getWorkspaceLabel,
} from "./workspace-model.js";

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

const RepositoryMenu = ({
	activeSessionId,
	isOpen,
	onActivateWorkspace,
	onOpenChange,
	onOpenRecent,
	onPickRepository,
	pendingAction,
	recentRepositories,
	workspaces,
}: RepositoryMenuProps): ReactElement => {
	const [query, setQuery] = useState("");
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

	const closeMenu = (): void => {
		onOpenChange(false);
		setQuery("");
	};
	const toggleMenu = (): void => onOpenChange(!isOpen);
	const handleQueryChange = (event: ChangeEvent<HTMLInputElement>): void => {
		setQuery(event.target.value);
	};
	const pickRepository = async (): Promise<void> => {
		closeMenu();
		await onPickRepository();
	};

	return (
		<div
			className="relative flex h-full shrink-0 items-center border-editor-hairline border-r px-2"
			data-name="RepositoryMenu"
		>
			<button
				aria-expanded={isOpen}
				aria-haspopup="dialog"
				className="flex h-8 items-center gap-2 rounded-xl px-2.5 font-semibold text-[12px] text-editor-ink outline-none transition-colors hover:bg-white/65 focus-visible:bg-white/75"
				disabled={pendingAction === "open"}
				onClick={toggleMenu}
				type="button"
			>
				{pendingAction === "open" ? (
					<SpinnerGapIcon
						aria-hidden
						className="size-4 animate-spin text-editor-muted"
						weight="bold"
					/>
				) : (
					<FolderOpenIcon
						aria-hidden
						className="size-4 text-editor-muted"
						weight="regular"
					/>
				)}
				Repos
				<CaretDownIcon
					aria-hidden
					className="size-3 text-editor-faint"
					weight="bold"
				/>
			</button>

			{isOpen ? (
				<>
					<button
						aria-label="Close repositories"
						className="fixed inset-0 z-40 cursor-default"
						onClick={closeMenu}
						type="button"
					/>
					<section
						aria-label="Repositories"
						className="absolute top-[calc(100%-3px)] left-2 z-50 w-[370px] overflow-hidden rounded-2xl border border-editor-hairline bg-white/94 p-1.5 shadow-surface-6 backdrop-blur-2xl"
						data-name="RepositoryMenuPopover"
					>
						<div className="p-1.5">
							<div className="relative">
								<MagnifyingGlassIcon
									aria-hidden
									className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-editor-faint"
									weight="regular"
								/>
								<Input
									autoFocus
									className="h-8 bg-editor-sunken pl-8 text-[12px] shadow-none"
									onChange={handleQueryChange}
									placeholder="Find a repository or worktree"
									value={query}
								/>
								<kbd className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[10px] text-editor-faint">
									⌘K
								</kbd>
							</div>
						</div>

						{matchingWorkspaces.length > 0 ? (
							<div data-name="OpenWorkspaceList">
								<p className="px-2.5 pt-2 pb-1 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]">
									Open workspaces
								</p>
								{matchingWorkspaces.map((workspace) => {
									const activateWorkspace = async (): Promise<void> => {
										closeMenu();
										await onActivateWorkspace(workspace.session.id);
									};
									const isActive = workspace.session.id === activeSessionId;
									return (
										<button
											aria-current={isActive ? "page" : undefined}
											className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors hover:bg-editor-sunken focus-visible:bg-editor-sunken"
											key={workspace.session.id}
											onClick={activateWorkspace}
											type="button"
										>
											<span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-editor-sunken text-editor-muted group-hover:bg-white">
												<GitBranchIcon
													aria-hidden
													className="size-3.5"
													weight="regular"
												/>
											</span>
											<span className="min-w-0 flex-1">
												<span className="block truncate font-medium text-[12px] text-editor-ink">
													{getRepositoryName(workspace.session.repository.root)}
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
													<span className="size-1.5 rounded-full bg-brand" />
													<span className="sr-only">Current workspace</span>
												</>
											) : null}
										</button>
									);
								})}
							</div>
						) : null}

						{matchingRecentRepositories.length > 0 ? (
							<div className="mt-1" data-name="RecentRepositoryList">
								<p className="border-editor-hairline border-t px-2.5 pt-2.5 pb-1 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]">
									Recent
								</p>
								{matchingRecentRepositories.map((repository) => {
									const openRecent = async (): Promise<void> => {
										closeMenu();
										await onOpenRecent(repository.path);
									};
									return (
										<button
											className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors hover:bg-editor-sunken focus-visible:bg-editor-sunken"
											key={repository.path}
											onClick={openRecent}
											type="button"
										>
											<span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-editor-sunken text-editor-muted group-hover:bg-white">
												<FolderOpenIcon
													aria-hidden
													className="size-3.5"
													weight="regular"
												/>
											</span>
											<span className="min-w-0 flex-1">
												<span className="block truncate font-medium text-[12px] text-editor-ink">
													{recentRepositoryName(repository)}
												</span>
												<span className="block truncate text-[10px] text-editor-faint">
													{repository.path}
												</span>
											</span>
										</button>
									);
								})}
							</div>
						) : null}

						{matchingWorkspaces.length === 0 &&
						matchingRecentRepositories.length === 0 &&
						normalizedQuery ? (
							<p className="px-3 py-5 text-center text-[12px] text-editor-faint">
								No repositories match “{query.trim()}”.
							</p>
						) : null}

						<div className="mt-1 border-editor-hairline border-t pt-1">
							<button
								className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left font-medium text-[12px] text-editor-ink outline-none transition-colors hover:bg-editor-sunken focus-visible:bg-editor-sunken"
								onClick={pickRepository}
								type="button"
							>
								<span className="flex size-7 items-center justify-center rounded-lg bg-editor-ink text-white">
									<PlusIcon aria-hidden className="size-3.5" weight="bold" />
								</span>
								Open local repository…
							</button>
						</div>
					</section>
				</>
			) : null}
		</div>
	);
};

interface WorkspaceTabProps {
	readonly isActive: boolean;
	readonly isBusy: boolean;
	readonly onActivate: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onClose: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onOpenActions: (left: number) => void;
	readonly workspace: WorkspaceTabState;
}

const WorkspaceTab = ({
	isActive,
	isBusy,
	onActivate,
	onClose,
	onOpenActions,
	workspace,
}: WorkspaceTabProps): ReactElement => {
	const label = getWorkspaceLabel(
		workspace.session.repository.root,
		workspace.branch
	);
	const activateWorkspace = async (): Promise<void> => {
		await onActivate(workspace.session.id);
	};
	const closeWorkspace = async (): Promise<void> => {
		await onClose(workspace.session.id);
	};
	const openActions = (event: MouseEvent<HTMLButtonElement>): void => {
		onOpenActions(event.currentTarget.getBoundingClientRect().left);
	};

	return (
		<div
			className={`group relative flex h-9 min-w-0 max-w-[250px] items-center rounded-xl border transition-colors ${
				isActive
					? "border-editor-hairline-strong bg-white/80 text-editor-ink shadow-surface-1"
					: "border-transparent text-editor-muted hover:bg-white/45 hover:text-editor-ink"
			}`}
			data-name="WorkspaceTab"
		>
			<button
				aria-controls="repository-workspace"
				aria-selected={isActive}
				className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/20"
				disabled={isBusy}
				onClick={activateWorkspace}
				role="tab"
				title={label}
				type="button"
			>
				{workspace.changedFiles ? (
					<>
						<span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
						<span className="sr-only">
							{workspace.changedFiles} changed files
						</span>
					</>
				) : (
					<span className="size-1.5 shrink-0 rounded-full bg-editor-hairline-strong" />
				)}
				<span className="min-w-0 truncate text-[12px]">
					<span className={isActive ? "font-semibold" : "font-medium"}>
						{getRepositoryName(workspace.session.repository.root)}
					</span>
					{workspace.branch ? (
						<span className="text-editor-faint"> / {workspace.branch}</span>
					) : null}
				</span>
			</button>
			{isActive ? (
				<button
					aria-haspopup="menu"
					aria-label={`Open actions for ${label}`}
					className="flex h-full w-7 items-center justify-center text-editor-faint outline-none hover:text-editor-ink focus-visible:text-editor-ink"
					disabled={isBusy}
					onClick={openActions}
					type="button"
				>
					<CaretDownIcon aria-hidden className="size-3" weight="bold" />
				</button>
			) : null}
			<button
				aria-label={`Close ${label}`}
				className={`mr-1 flex size-6 shrink-0 items-center justify-center rounded-lg text-editor-faint outline-none hover:bg-editor-sunken-2 hover:text-editor-ink focus-visible:bg-editor-sunken-2 ${
					isActive
						? ""
						: "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
				}`}
				disabled={isBusy}
				onClick={closeWorkspace}
				type="button"
			>
				<XIcon aria-hidden className="size-3" weight="bold" />
			</button>
			{isActive ? (
				<span className="absolute inset-x-3 -bottom-[7px] h-0.5 rounded-full bg-brand" />
			) : null}
		</div>
	);
};

interface WorkspaceActionsMenuProps {
	readonly branches: BranchCollection | null;
	readonly currentBranch: string;
	readonly left: number;
	readonly onClose: () => void;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onSwitchBranch: (name: string) => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
}

const WorkspaceActionsMenu = ({
	branches,
	currentBranch,
	left,
	onClose,
	onCreateBranch,
	onFetch,
	onSwitchBranch,
	pendingAction,
}: WorkspaceActionsMenuProps): ReactElement => {
	const [isCreating, setIsCreating] = useState(false);
	const [branchName, setBranchName] = useState("");
	const localBranches =
		branches?.branches.filter((branch) => branch.type === "local") ?? [];
	const handleBranchNameChange = (
		event: ChangeEvent<HTMLInputElement>
	): void => {
		setBranchName(event.target.value);
	};
	const beginBranchCreation = (): void => setIsCreating(true);
	const cancelBranchCreation = (): void => {
		setIsCreating(false);
		setBranchName("");
	};
	const createBranch = async (
		event: FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();
		const didCreate = await onCreateBranch(branchName);
		if (didCreate) {
			onClose();
		}
	};
	const fetchRepository = async (): Promise<void> => {
		onClose();
		await onFetch();
	};

	return (
		<div data-name="WorkspaceActionsMenu">
			<button
				aria-label="Close workspace actions"
				className="fixed inset-0 z-40 cursor-default"
				onClick={onClose}
				type="button"
			/>
			<section
				aria-label="Workspace actions"
				className="fixed top-[72px] z-50 w-[310px] overflow-hidden rounded-2xl border border-editor-hairline bg-white/94 p-1.5 shadow-surface-6 backdrop-blur-2xl"
				style={{ left }}
			>
				<div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2">
					<span className="flex size-7 items-center justify-center rounded-lg bg-editor-sunken text-editor-muted">
						<GitBranchIcon aria-hidden className="size-3.5" weight="regular" />
					</span>
					<span className="min-w-0">
						<span className="block text-[10px] text-editor-faint">
							Current branch
						</span>
						<span className="block truncate font-semibold text-[12px] text-editor-ink">
							{currentBranch || "Detached HEAD"}
						</span>
					</span>
				</div>

				{isCreating ? (
					<form
						className="border-editor-hairline border-t p-2"
						data-name="CreateBranchForm"
						onSubmit={createBranch}
					>
						<label
							className="font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]"
							htmlFor="new-workspace-branch-name"
						>
							New branch name
						</label>
						<Input
							autoFocus
							className="mt-2 h-8 text-[12px]"
							id="new-workspace-branch-name"
							onChange={handleBranchNameChange}
							placeholder="feature/my-change"
							value={branchName}
						/>
						<div className="mt-2 flex justify-end gap-1.5">
							<Button
								onClick={cancelBranchCreation}
								size="sm"
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>
							<Button
								disabled={!branchName.trim() || pendingAction !== null}
								size="sm"
								type="submit"
								variant="brand"
							>
								Create branch
							</Button>
						</div>
					</form>
				) : (
					<>
						<div className="max-h-52 overflow-y-auto border-editor-hairline border-t pt-1">
							<p className="px-2.5 pt-1.5 pb-1 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]">
								Switch branch
							</p>
							{localBranches.map((branch) => {
								const switchBranch = async (): Promise<void> => {
									if (!branch.checkedOut) {
										await onSwitchBranch(branch.name);
									}
									onClose();
								};
								return (
									<button
										className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none hover:bg-editor-sunken focus-visible:bg-editor-sunken"
										key={branch.fullName}
										onClick={switchBranch}
										type="button"
									>
										<GitBranchIcon
											aria-hidden
											className="size-3.5 shrink-0 text-editor-faint"
											weight="regular"
										/>
										<span className="min-w-0 flex-1 truncate font-medium text-[12px] text-editor-ink">
											{branch.name}
										</span>
										{branch.checkedOut ? (
											<CheckIcon
												aria-hidden
												className="size-3.5 text-brand"
												weight="bold"
											/>
										) : null}
									</button>
								);
							})}
						</div>
						<div className="mt-1 border-editor-hairline border-t pt-1">
							<button
								className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left font-medium text-[12px] text-editor-ink outline-none hover:bg-editor-sunken focus-visible:bg-editor-sunken"
								onClick={beginBranchCreation}
								type="button"
							>
								<PlusIcon
									aria-hidden
									className="size-3.5 text-editor-faint"
									weight="bold"
								/>
								Create new branch…
							</button>
							<button
								className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left font-medium text-[12px] text-editor-ink outline-none hover:bg-editor-sunken focus-visible:bg-editor-sunken"
								disabled={pendingAction !== null}
								onClick={fetchRepository}
								type="button"
							>
								<ArrowsClockwiseIcon
									aria-hidden
									className="size-3.5 text-editor-faint"
									weight="regular"
								/>
								Fetch remote
							</button>
						</div>
					</>
				)}
			</section>
		</div>
	);
};

export interface DesktopToolbarProps {
	readonly activeSessionId: RepositorySessionId | null;
	readonly branches: BranchCollection | null;
	readonly lastFetchedAt: string | null;
	readonly onActivateWorkspace: (
		sessionId: RepositorySessionId
	) => Promise<void>;
	readonly onCloseWorkspace: (sessionId: RepositorySessionId) => Promise<void>;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onOpenRecent: (path: string) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly onSwitchBranch: (name: string) => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
	readonly snapshot: RepositorySnapshot | null;
	readonly workspaces: readonly WorkspaceTabState[];
}

const WORKSPACE_MENU_WIDTH = 310;
const WINDOW_EDGE_GAP = 12;

export const DesktopToolbar = ({
	activeSessionId,
	branches,
	lastFetchedAt,
	onActivateWorkspace,
	onCloseWorkspace,
	onCreateBranch,
	onFetch,
	onOpenRecent,
	onPickRepository,
	onSwitchBranch,
	pendingAction,
	recentRepositories,
	snapshot,
	workspaces,
}: DesktopToolbarProps): ReactElement => {
	const [isRepositoryMenuOpen, setIsRepositoryMenuOpen] = useState(false);
	const [workspaceMenuLeft, setWorkspaceMenuLeft] = useState<number | null>(
		null
	);
	const hasActiveSession = activeSessionId !== null;
	const currentBranch = snapshot?.head.branch ?? "";
	const upstreamRemote = snapshot?.head.upstream?.split("/")[0] ?? "origin";
	let fetchDescription = `Fetch ${upstreamRemote}`;
	if (snapshot?.head.upstream) {
		fetchDescription = `${snapshot.head.behind} behind · ${snapshot.head.ahead} ahead`;
	}
	if (lastFetchedAt) {
		fetchDescription = `Fetched ${formatRelativeTime(lastFetchedAt)}`;
	}

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setWorkspaceMenuLeft(null);
				setIsRepositoryMenuOpen(true);
				return;
			}
			if (event.key === "Escape") {
				setIsRepositoryMenuOpen(false);
				setWorkspaceMenuLeft(null);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const setRepositoryMenuOpen = (isOpen: boolean): void => {
		setWorkspaceMenuLeft(null);
		setIsRepositoryMenuOpen(isOpen);
	};
	const openRepositoryMenu = (): void => {
		setWorkspaceMenuLeft(null);
		setIsRepositoryMenuOpen(true);
	};
	const openWorkspaceMenu = (left: number): void => {
		setIsRepositoryMenuOpen(false);
		setWorkspaceMenuLeft(
			Math.max(
				WINDOW_EDGE_GAP,
				Math.min(
					left,
					window.innerWidth - WORKSPACE_MENU_WIDTH - WINDOW_EDGE_GAP
				)
			)
		);
	};
	const closeWorkspaceMenu = (): void => setWorkspaceMenuLeft(null);
	const fetchRepository = async (): Promise<void> => {
		await onFetch();
	};

	return (
		<header
			className="relative z-40 flex h-[76px] shrink-0 items-end border-editor-hairline border-b bg-studio-glass-surface pt-7 pb-1.5 backdrop-blur-2xl"
			data-name="DesktopToolbar"
		>
			<div
				aria-hidden
				className="absolute inset-x-0 top-0 h-7"
				data-desktop-drag
			/>
			<RepositoryMenu
				activeSessionId={activeSessionId}
				isOpen={isRepositoryMenuOpen}
				onActivateWorkspace={onActivateWorkspace}
				onOpenChange={setRepositoryMenuOpen}
				onOpenRecent={onOpenRecent}
				onPickRepository={onPickRepository}
				pendingAction={pendingAction}
				recentRepositories={recentRepositories}
				workspaces={workspaces}
			/>

			<div
				aria-label="Open repository workspaces"
				className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1.5 pb-px"
				data-name="WorkspaceTabList"
				role="tablist"
			>
				{workspaces.map((workspace) => (
					<WorkspaceTab
						isActive={workspace.session.id === activeSessionId}
						isBusy={pendingAction === "workspace"}
						key={workspace.session.id}
						onActivate={onActivateWorkspace}
						onClose={onCloseWorkspace}
						onOpenActions={openWorkspaceMenu}
						workspace={workspace}
					/>
				))}
				{workspaces.length === 0 ? (
					<span className="px-2 text-[11px] text-editor-faint">
						Open a repository to begin
					</span>
				) : null}
			</div>

			<div aria-hidden className="h-full min-w-8 flex-1" data-desktop-drag />

			<div
				className="flex shrink-0 items-center gap-1 border-editor-hairline border-l px-2"
				data-name="WorkspaceToolbarActions"
			>
				<Button
					aria-label="Find a repository or worktree"
					className="h-8 gap-2 px-2.5 text-[11px]"
					data-name="WorkspaceSearchButton"
					onClick={openRepositoryMenu}
					size="sm"
					title="Find a repository or worktree (Command K)"
					variant="ghost"
				>
					<MagnifyingGlassIcon
						aria-hidden
						className="size-3.5"
						weight="regular"
					/>
					<kbd className="text-[10px] text-editor-faint">⌘K</kbd>
				</Button>
				<Button
					aria-label={fetchDescription}
					className="relative"
					data-name="SyncButton"
					disabled={!hasActiveSession || pendingAction !== null}
					onClick={fetchRepository}
					size="icon-sm"
					title={fetchDescription}
					variant="ghost"
				>
					{pendingAction === "fetch" ? (
						<SpinnerGapIcon
							aria-hidden
							className="size-4 animate-spin"
							weight="bold"
						/>
					) : (
						<ArrowsClockwiseIcon
							aria-hidden
							className="size-4"
							weight="regular"
						/>
					)}
					{snapshot?.head.behind ? (
						<span className="absolute top-1 right-1 size-1.5 rounded-full bg-brand" />
					) : null}
				</Button>
				<Button
					className="h-8 px-2.5 text-[11px]"
					data-name="AgentButton"
					disabled
					size="sm"
					title="Agent workspace is coming next"
					variant="ghost"
				>
					<RobotIcon aria-hidden className="size-3.5" weight="regular" />
					Agent
				</Button>
			</div>

			{workspaceMenuLeft === null ? null : (
				<WorkspaceActionsMenu
					branches={branches}
					currentBranch={currentBranch}
					left={workspaceMenuLeft}
					onClose={closeWorkspaceMenu}
					onCreateBranch={onCreateBranch}
					onFetch={onFetch}
					onSwitchBranch={onSwitchBranch}
					pendingAction={pendingAction}
				/>
			)}
		</header>
	);
};
