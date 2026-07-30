import type { BranchCollection, RepositorySnapshot } from "@1git/git";
import { Button } from "@1git/ui/components/button";
import { Input } from "@1git/ui/components/input";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { useState } from "react";
import type {
	RecentRepositoryRecord,
	RepositorySessionRecord,
} from "../../shared/repository-session.js";
import type { PendingWorkspaceAction } from "./use-git-workspace.js";
import { recentRepositoryName } from "./use-git-workspace.js";
import { formatRelativeTime, getRepositoryName } from "./workspace-model.js";

interface RepositoryMenuProps {
	readonly activeSession: RepositorySessionRecord | null;
	readonly onOpenRecent: (path: string) => Promise<void>;
	readonly onPickRepository: () => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
	readonly recentRepositories: readonly RecentRepositoryRecord[];
}

const RepositoryMenu = ({
	activeSession,
	onOpenRecent,
	onPickRepository,
	pendingAction,
	recentRepositories,
}: RepositoryMenuProps): ReactElement => {
	const [isOpen, setIsOpen] = useState(false);
	const repositoryName = activeSession
		? getRepositoryName(activeSession.repository.root)
		: "Open a repository";

	const toggleMenu = (): void => setIsOpen((current) => !current);
	const closeMenu = (): void => setIsOpen(false);
	const pickRepository = async (): Promise<void> => {
		closeMenu();
		await onPickRepository();
	};

	return (
		<div
			className="relative h-full min-w-[276px] border-editor-hairline border-r"
			data-name="RepositoryMenu"
		>
			<button
				aria-expanded={isOpen}
				aria-haspopup="menu"
				className="flex h-full w-full items-center gap-3 px-4 text-left outline-none transition-colors hover:bg-white/45 focus-visible:bg-white/60"
				disabled={pendingAction === "open"}
				onClick={toggleMenu}
				type="button"
			>
				<span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/65 text-editor-muted shadow-surface-1">
					{pendingAction === "open" ? (
						<SpinnerGapIcon
							aria-hidden
							className="size-4 animate-spin"
							weight="bold"
						/>
					) : (
						<FolderOpenIcon aria-hidden className="size-4" weight="regular" />
					)}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block text-[10px] text-editor-faint">
						Current repository
					</span>
					<span className="block truncate font-semibold text-[13px] text-editor-ink">
						{repositoryName}
					</span>
				</span>
				<CaretDownIcon
					aria-hidden
					className="size-3.5 shrink-0 text-editor-faint"
					weight="bold"
				/>
			</button>

			{isOpen ? (
				<>
					<button
						aria-label="Close repository menu"
						className="fixed inset-0 z-40 cursor-default"
						onClick={closeMenu}
						type="button"
					/>
					<div
						className="absolute top-[calc(100%-8px)] left-3 z-50 w-[330px] overflow-hidden rounded-2xl border border-editor-hairline bg-white/92 p-1.5 shadow-surface-6 backdrop-blur-2xl"
						data-name="RepositoryMenuPopover"
						role="menu"
					>
						<div className="px-2.5 pt-2 pb-1.5 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]">
							Recent repositories
						</div>
						{recentRepositories.length > 0 ? (
							recentRepositories.map((repository) => {
								const openRecent = async (): Promise<void> => {
									closeMenu();
									await onOpenRecent(repository.path);
								};
								const isActive =
									activeSession?.repository.root === repository.path;

								return (
									<button
										aria-current={isActive ? "true" : undefined}
										className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors hover:bg-editor-sunken focus-visible:bg-editor-sunken"
										key={repository.path}
										onClick={openRecent}
										role="menuitem"
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
										{isActive ? (
											<span className="size-1.5 rounded-full bg-brand" />
										) : null}
									</button>
								);
							})
						) : (
							<p className="px-2.5 py-4 text-[12px] text-editor-faint">
								Repositories you open will appear here.
							</p>
						)}
						<div className="mt-1 border-editor-hairline border-t pt-1">
							<button
								className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left font-medium text-[12px] text-editor-ink outline-none transition-colors hover:bg-editor-sunken focus-visible:bg-editor-sunken"
								onClick={pickRepository}
								role="menuitem"
								type="button"
							>
								<span className="flex size-7 items-center justify-center rounded-lg bg-editor-ink text-white">
									<FolderOpenIcon
										aria-hidden
										className="size-3.5"
										weight="bold"
									/>
								</span>
								Open local repository…
							</button>
						</div>
					</div>
				</>
			) : null}
		</div>
	);
};

interface DesktopToolbarProps extends RepositoryMenuProps {
	readonly branches: BranchCollection | null;
	readonly lastFetchedAt: string | null;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly onFetch: () => Promise<void>;
	readonly onSwitchBranch: (name: string) => Promise<void>;
	readonly snapshot: RepositorySnapshot | null;
}

interface BranchMenuProps {
	readonly branches: BranchCollection | null;
	readonly currentBranch: string;
	readonly onCreateBranch: (name: string) => Promise<boolean>;
	readonly onSwitchBranch: (name: string) => Promise<void>;
	readonly pendingAction: PendingWorkspaceAction;
}

const BranchMenu = ({
	branches,
	currentBranch,
	onCreateBranch,
	onSwitchBranch,
	pendingAction,
}: BranchMenuProps): ReactElement => {
	const [isOpen, setIsOpen] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [branchName, setBranchName] = useState("");
	const localBranches =
		branches?.branches.filter((branch) => branch.type === "local") ?? [];
	const toggleMenu = (): void => setIsOpen((current) => !current);
	const closeMenu = (): void => {
		setIsOpen(false);
		setIsCreating(false);
		setBranchName("");
	};
	const beginBranchCreation = (): void => setIsCreating(true);
	const handleBranchNameChange = (
		event: ChangeEvent<HTMLInputElement>
	): void => {
		setBranchName(event.target.value);
	};
	const createBranch = async (
		event: FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();
		const didCreate = await onCreateBranch(branchName);
		if (didCreate) {
			closeMenu();
		}
	};

	return (
		<div
			className="relative h-full min-w-[220px] border-editor-hairline border-r"
			data-name="BranchMenu"
		>
			<button
				aria-expanded={isOpen}
				aria-haspopup="menu"
				className="flex h-full w-full items-center gap-3 px-4 text-left outline-none transition-colors hover:bg-white/45 focus-visible:bg-white/60"
				disabled={!branches || pendingAction !== null}
				onClick={toggleMenu}
				type="button"
			>
				{pendingAction === "branch" ? (
					<SpinnerGapIcon
						aria-hidden
						className="size-4 shrink-0 animate-spin text-editor-muted"
						weight="bold"
					/>
				) : (
					<GitBranchIcon
						aria-hidden
						className="size-4 shrink-0 text-editor-muted"
						weight="regular"
					/>
				)}
				<span className="min-w-0 flex-1">
					<span className="block text-[10px] text-editor-faint">
						Current branch
					</span>
					<span className="block truncate font-semibold text-[13px] text-editor-ink">
						{currentBranch || "No branch"}
					</span>
				</span>
				<CaretDownIcon
					aria-hidden
					className="size-3.5 shrink-0 text-editor-faint"
					weight="bold"
				/>
			</button>

			{isOpen ? (
				<>
					<button
						aria-label="Close branch menu"
						className="fixed inset-0 z-40 cursor-default"
						onClick={closeMenu}
						type="button"
					/>
					<div
						className="absolute top-[calc(100%-8px)] left-2 z-50 w-[300px] overflow-hidden rounded-2xl border border-editor-hairline bg-white/92 p-1.5 shadow-surface-6 backdrop-blur-2xl"
						data-name="BranchMenuPopover"
					>
						{isCreating ? (
							<form
								className="p-2"
								data-name="CreateBranchForm"
								onSubmit={createBranch}
							>
								<label
									className="font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]"
									htmlFor="new-branch-name"
								>
									New branch name
								</label>
								<Input
									autoFocus
									className="mt-2 h-8 text-[12px]"
									id="new-branch-name"
									onChange={handleBranchNameChange}
									placeholder="feature/my-change"
									value={branchName}
								/>
								<div className="mt-2 flex justify-end gap-1.5">
									<Button
										onClick={closeMenu}
										size="sm"
										type="button"
										variant="ghost"
									>
										Cancel
									</Button>
									<Button
										disabled={!branchName.trim()}
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
								<div className="px-2.5 pt-2 pb-1.5 font-medium text-[10px] text-editor-faint uppercase tracking-[0.08em]">
									Local branches
								</div>
								<div className="max-h-64 overflow-y-auto">
									{localBranches.map((branch) => {
										const switchBranch = async (): Promise<void> => {
											if (!branch.checkedOut) {
												await onSwitchBranch(branch.name);
											}
											closeMenu();
										};
										return (
											<button
												className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none hover:bg-editor-sunken focus-visible:bg-editor-sunken"
												key={branch.fullName}
												onClick={switchBranch}
												role="menuitem"
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
										className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left font-medium text-[12px] text-editor-ink outline-none hover:bg-editor-sunken focus-visible:bg-editor-sunken"
										onClick={beginBranchCreation}
										role="menuitem"
										type="button"
									>
										<span className="flex size-7 items-center justify-center rounded-lg bg-editor-ink text-white">
											<PlusIcon
												aria-hidden
												className="size-3.5"
												weight="bold"
											/>
										</span>
										Create new branch…
									</button>
								</div>
							</>
						)}
					</div>
				</>
			) : null}
		</div>
	);
};

export const DesktopToolbar = ({
	activeSession,
	branches,
	lastFetchedAt,
	onCreateBranch,
	onFetch,
	onOpenRecent,
	onPickRepository,
	onSwitchBranch,
	pendingAction,
	recentRepositories,
	snapshot,
}: DesktopToolbarProps): ReactElement => {
	const fetchRepository = async (): Promise<void> => {
		await onFetch();
	};
	const currentBranch = snapshot?.head.branch ?? "";
	const upstreamRemote = snapshot?.head.upstream?.split("/")[0] ?? "origin";
	let fetchDescription = "Check for remote changes";
	if (snapshot?.head.upstream) {
		fetchDescription = `${snapshot.head.behind} behind · ${snapshot.head.ahead} ahead`;
	}
	if (lastFetchedAt) {
		fetchDescription = `Fetched ${formatRelativeTime(lastFetchedAt)}`;
	}

	return (
		<header
			className="relative z-40 flex h-[76px] shrink-0 items-stretch border-editor-hairline border-b bg-studio-glass-surface pt-7 backdrop-blur-2xl"
			data-name="DesktopToolbar"
		>
			<div
				aria-hidden
				className="absolute inset-x-0 top-0 h-7"
				data-desktop-drag
			/>
			<RepositoryMenu
				activeSession={activeSession}
				onOpenRecent={onOpenRecent}
				onPickRepository={onPickRepository}
				pendingAction={pendingAction}
				recentRepositories={recentRepositories}
			/>

			<BranchMenu
				branches={branches}
				currentBranch={currentBranch}
				onCreateBranch={onCreateBranch}
				onSwitchBranch={onSwitchBranch}
				pendingAction={pendingAction}
			/>

			<Button
				className="h-full min-w-[240px] justify-start rounded-none px-4"
				data-name="FetchButton"
				disabled={!activeSession || pendingAction !== null}
				onClick={fetchRepository}
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
				<span className="min-w-0 text-left">
					<span className="block font-semibold text-[13px] text-editor-ink">
						Fetch {upstreamRemote}
					</span>
					<span className="block truncate font-normal text-[10px] text-editor-faint">
						{fetchDescription}
					</span>
				</span>
			</Button>
			<div aria-hidden className="min-w-10 flex-1" data-desktop-drag />
		</header>
	);
};
