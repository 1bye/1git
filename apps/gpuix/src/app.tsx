import { useCallback, useEffect, useReducer, useState, useRef } from "react";
import { AccountsSettings } from "./feature/accounts/accounts-settings";
import { Accounts } from "./feature/accounts/lib/accounts";
import { AccountStore } from "./feature/accounts/lib/account-store";
import { NativeCredentials } from "./feature/accounts/lib/native-credentials";
import { settingsShortcuts } from "./feature/accounts/lib/settings-shortcut";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { workspaceShortcuts } from "./feature/repository-workspace/lib/repository-filter-shortcut";
import { Button } from "@1git/gpuix-ui/button";
import { appTokens } from "./styles/tokens";
import {
	WorkspaceSession,
	type WorkspaceSessionDocument,
} from "./feature/workspace-tabs/lib/workspace-session";
import { useWorkspaceSession } from "./feature/workspace-tabs/hooks/use-workspace-session";

import { RepositoryNavigation } from "./feature/repository-workspace/components/repository-navigation";
import { RepositoryFileActions } from "./feature/repository-workspace/lib/repository-file-actions";
import { RepositoryDiffEmpty } from "./feature/repository-workspace/components/repository-diff-empty";
import { RepositoryDiff } from "./feature/repository-workspace/components/repository-diff";
import { RepositoryDiff as DiffReader } from "./feature/repository-workspace/lib/repository-diff";
import { RepositoryReader } from "./feature/repository-workspace/lib/repository-reader";
import { RepositorySetup } from "./feature/repository-workspace/lib/repository-setup";
import { RepositorySetupActions } from "./feature/repository-workspace/components/repository-setup";
import { RepositoryCloneView } from "./feature/repository-workspace/components/repository-clone-view";
import { RepositoryWelcome } from "./feature/repository-workspace/components/repository-welcome";
import type { RepositoryWatcher } from "./feature/repository-workspace/lib/repository-watcher";
import { useRepositoryAutoRefresh } from "./feature/repository-workspace/hooks/use-repository-auto-refresh";
import { RepositoryHistory } from "./feature/repository-workspace/lib/repository-history";
import { useRepositoryHistory } from "./feature/repository-workspace/hooks/use-repository-history";
import { RepositoryStashes } from "./feature/repository-workspace/lib/repository-stashes";
import { useRepositoryStashes } from "./feature/repository-workspace/hooks/use-repository-stashes";
import { useRepositoryConnection } from "./feature/repository-workspace/hooks/use-repository-connection";
import { useRepositoryMutations } from "./feature/repository-workspace/hooks/use-repository-mutations";
import { RepositoryBranches } from "./feature/workspace-tabs/lib/repository-branches";
import { RepositoryWorktrees } from "./feature/workspace-tabs/lib/repository-worktrees";
import { RepositoryCommit } from "./feature/repository-workspace/lib/repository-commit";
import { RepositoryCloseNotice } from "./feature/repository-workspace/components/repository-close-notice";
import { RepositorySync } from "./feature/repository-workspace/lib/repository-sync";
import { RepositoryConflicts } from "./feature/repository-workspace/lib/repository-conflicts";
import { RepositoryOperation } from "./feature/repository-workspace/lib/repository-operation";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceAction,
} from "./feature/repository-workspace/lib/repository-workspace-model";
import { WorkspaceTabs } from "./feature/workspace-tabs/workspace-tabs";
import { WorkspaceTabsModel } from "./feature/workspace-tabs/lib/workspace-tabs-model";
import { AppShell } from "./fixture/app-shell";
import { WorkspaceRail } from "./feature/repository-workspace/components/workspace-rail";
import type { RepositoryView } from "./feature/repository-workspace/types";
import { RepositoryComparison } from "./feature/repository-comparison/repository-comparison";
import { RepositoryComparison as ComparisonReader } from "./feature/repository-comparison/lib/repository-comparison";

/** Owns one window's workspaces, cancellable reads and explicit commit transactions. */
export function App({
	accounts: suppliedAccounts,
	initialTabCount = 1,
	preview = false,
	initialSession,
	sessionError,
	saveSession,
	readRepository = RepositoryReader.read,
	setupRepository,
	readComparison = ComparisonReader.read,
	readDiff = DiffReader.read,
	readHistory = RepositoryHistory.read,
	readCommitFiles = RepositoryHistory.readFiles,
	readStashes = RepositoryStashes.read,
	readStashFiles = RepositoryStashes.readFiles,
	writeCommit = RepositoryCommit.write,
	readBranches = RepositoryBranches.read,
	writeBranch = RepositoryBranches.write,
	writeWorktree = RepositoryWorktrees.create,
	removeWorktree = RepositoryWorktrees.remove,
	fetchRepository = RepositorySync.fetch,
	writeSyncRepository = RepositorySync.write,
	writeStash = RepositoryStashes.write,
	watchRepository,
	resolveConflict = RepositoryConflicts.write,
	openConflictEditor = RepositoryConflicts.openEditor,
	writeOperation = RepositoryOperation.write,
	discardFile = RepositoryFileActions.discard,
	openFile = RepositoryFileActions.open,
}: {
	accounts?: Accounts;
	initialTabCount?: number;
	preview?: boolean;
	initialSession?: WorkspaceSessionDocument;
	sessionError?: string;
	saveSession?: (document: WorkspaceSessionDocument) => void;
	readRepository?: typeof RepositoryReader.read;
	setupRepository?: typeof RepositorySetup.write;
	readComparison?: typeof ComparisonReader.read;
	readDiff?: typeof DiffReader.read;
	readHistory?: typeof RepositoryHistory.read;
	readCommitFiles?: typeof RepositoryHistory.readFiles;
	readStashes?: typeof RepositoryStashes.read;
	readStashFiles?: typeof RepositoryStashes.readFiles;
	writeCommit?: typeof RepositoryCommit.write;
	readBranches?: typeof RepositoryBranches.read;
	writeBranch?: typeof RepositoryBranches.write;
	writeWorktree?: typeof RepositoryWorktrees.create;
	removeWorktree?: typeof RepositoryWorktrees.remove;
	fetchRepository?: typeof RepositorySync.fetch;
	writeSyncRepository?: typeof RepositorySync.write;
	writeStash?: typeof RepositoryStashes.write;
	watchRepository?: typeof RepositoryWatcher.watch;
	resolveConflict?: typeof RepositoryConflicts.write;
	openConflictEditor?: typeof RepositoryConflicts.openEditor;
	writeOperation?: typeof RepositoryOperation.write;
	discardFile?: typeof RepositoryFileActions.discard;
	openFile?: typeof RepositoryFileActions.open;
}) {
	const renderer = useGpuixRequired();

	const [accounts] = useState(
		() =>
			suppliedAccounts ??
			new Accounts(
				new AccountStore(AccountStore.defaultPath()),
				new NativeCredentials(renderer)
			)
	);

	const setup = useCallback<typeof RepositorySetup.write>(
		(request, signal) =>
			setupRepository
				? setupRepository(request, signal)
				: RepositorySetup.write(request, signal, accounts),
		[setupRepository, accounts]
	);

	const [state, dispatch] = useReducer(
		WorkspaceTabsModel.reduce,
		{ initialTabCount, preview, initialSession },
		(options) =>
			options.initialSession && !options.preview
				? WorkspaceSession.restore(options.initialSession)
				: WorkspaceTabsModel.create(options.initialTabCount, options.preview)
	);

	const session = useWorkspaceSession(
		state,
		saveSession,
		preview ? undefined : sessionError
	);

	const connection = useRepositoryConnection(
		state,
		dispatch,
		readRepository,
		setup
	);

	const mutations = useRepositoryMutations(
		state,
		dispatch,
		writeCommit,
		writeBranch,
		readRepository,
		fetchRepository,
		writeSyncRepository,
		session.retry,
		writeStash,
		resolveConflict,
		writeOperation,
		discardFile,
		writeWorktree,
		removeWorktree
	);

	useRepositoryAutoRefresh(state, dispatch, readRepository, watchRepository);

	const activeTab = state.tabs.find((tab) => tab.id === state.activeId);
	const workspace = activeTab?.workspace;

	const [settingsView, setSettingsView] = useState<"list" | "connect" | null>(
		null
	);

	const settingsOpen = settingsView !== null;
	const [preferredAccountKey, setPreferredAccountKey] = useState<string>();
	const [cloneId, setCloneId] = useState<string | null>(null);
	const cloneTrigger = useRef<PublicInstance | null>(null);

	const cloneTab = state.tabs.find(
		(tab) =>
			tab.id === cloneId &&
			!tab.workspace.repository &&
			!tab.workspace.repositoryPath
	);

	const workspaceFocus = useRef<number | null>(null);
	const railSettingsButton = useRef<PublicInstance>(null);
	const railAccountButton = useRef<PublicInstance>(null);
	const railViewButtons = useRef(new Map<RepositoryView, PublicInstance>());

	const railFocus = useRef<"settings" | "account" | RepositoryView | null>(
		null
	);

	const openSettings = useCallback(
		(initialForm: "list" | "connect" = "list") => {
			if (settingsOpen) return;

			workspaceFocus.current = renderer.getFocusedElementId?.() ?? null;
			const railView = [...railViewButtons.current].find(
				([, button]) => button.id === workspaceFocus.current
			)?.[0];

			railFocus.current =
				workspaceFocus.current === railSettingsButton.current?.id
					? "settings"
					: workspaceFocus.current === railAccountButton.current?.id
						? "account"
						: (railView ?? null);
			setSettingsView(initialForm);
		},
		[renderer, settingsOpen]
	);

	const closeSettings = useCallback(() => {
		setSettingsView(null);
		const focused = workspaceFocus.current;

		setTimeout(() => {
			let target = focused;
			const railTarget = railFocus.current;

			if (railTarget === "settings")
				target = railSettingsButton.current?.id ?? null;
			else if (railTarget === "account")
				target = railAccountButton.current?.id ?? null;
			else if (railTarget)
				target =
					railViewButtons.current.get(railTarget)?.id ??
					railSettingsButton.current?.id ??
					null;

			if (target !== null && target !== undefined)
				renderer.focusElement?.(target);
		}, 0);
	}, [renderer]);

	useEffect(() => {
		const open = openSettings;

		settingsShortcuts.set(renderer, open);
		const interval = setInterval(() => {
			if (
				"takeSettingsRequested" in renderer &&
				typeof renderer.takeSettingsRequested === "function" &&
				renderer.takeSettingsRequested()
			)
				open();
		}, 100);

		return () => {
			clearInterval(interval);
			settingsShortcuts.delete(renderer);
		};
	}, [renderer, openSettings]);

	useEffect(() => {
		workspaceShortcuts.set(renderer, (key) => {
			if (/^[1-9]$/.test(key)) {
				const tab = state.tabs[Number(key) - 1];

				if (tab) dispatch({ type: "activate", id: tab.id });

				return;
			}

			if (key === "o") {
				if (connection.pickingId !== null) return;

				const id =
					activeTab && !workspace?.repository
						? activeTab.id
						: `workspace-${state.nextId}`;

				if (id !== activeTab?.id) dispatch({ type: "add" });

				void connection.open(id);
			} else if (
				activeTab &&
				workspace &&
				!RepositoryWorkspaceModel.isBusy(workspace)
			) {
				if (key === "w") dispatch({ type: "close", id: activeTab.id });

				if (key === "r" && !workspace.loading)
					void connection.refresh(activeTab.id);
			}
		});

		return () => {
			workspaceShortcuts.delete(renderer);
		};
	}, [renderer, state.tabs, state.nextId, activeTab, workspace, connection]);

	const workspaceAction = useCallback(
		(id: string, action: RepositoryWorkspaceAction): void =>
			dispatch({ type: "workspace", id, action }),
		[]
	);

	const history = useRepositoryHistory(
		activeTab?.id,
		workspace,
		workspaceAction,
		readHistory,
		readCommitFiles
	);

	const stashes = useRepositoryStashes(
		activeTab?.id,
		workspace,
		workspaceAction,
		readStashes,
		readStashFiles
	);

	const revision =
		workspace && workspace.view !== "changes"
			? RepositoryWorkspaceModel.revision(workspace, workspace.view)
			: undefined;

	const selectedId = workspace
		? workspace.view === "changes"
			? workspace.views.changes.selectedId
			: workspace.views[workspace.view].files.selectedId
		: null;

	const files =
		workspace?.view === "changes" ? workspace.entries.changes : revision?.files;

	const selected = files?.find((file) => file.id === selectedId);
	const comparison = selected?.change ?? selected?.commitFile;

	const repositoryView =
		workspace &&
		(workspace.repository || workspace.preview || workspace.repositoryPath) &&
		!activeTab?.comparison
			? workspace.view
			: undefined;

	const selectRepositoryView = (view: RepositoryView) => {
		if (!activeTab) return;

		dispatch({
			type: "workspace",
			id: activeTab.id,
			action: { type: "view", view },
		});

		if (settingsOpen) {
			railFocus.current = view;
			closeSettings();
		}
	};

	const closeNotice = mutations.closeProtection.requested ? (
		<RepositoryCloseNotice
			state={state}
			onDismiss={mutations.closeProtection.dismiss}
			onStop={mutations.cancelSync}
		/>
	) : null;

	return (
		<div
			style={{
				display: "flex",
				position: "relative",
				flexDirection: "column",
				width: "100%",
				height: "100%",
			}}
		>
			<AppShell
				hidden={settingsOpen}
				rail={
					settingsOpen ? undefined : (
						<WorkspaceRail
							settingsButtonRef={railSettingsButton}
							accountButtonRef={railAccountButton}
							viewButtonRefs={railViewButtons}
							accounts={accounts}
							preferredAccountKey={preferredAccountKey}
							onAccount={setPreferredAccountKey}
							onSettings={openSettings}
							onAddAccount={() => openSettings("connect")}
							view={repositoryView}
							onView={selectRepositoryView}
						/>
					)
				}
				navigation={
					activeTab &&
					workspace &&
					(workspace.repository ||
						workspace.preview ||
						workspace.repositoryPath) &&
					!activeTab.comparison ? (
						<RepositoryNavigation
							openFile={openFile}
							onDiscard={(request) =>
								mutations.discardFile(activeTab.id, request)
							}
							key={activeTab.id}
							workspaceId={activeTab.id}
							state={workspace}
							history={history}
							stashes={stashes}
							onCommit={(mode) => {
								void mutations.commit(activeTab.id, mode);
							}}
							onStash={(request) => mutations.stash(activeTab.id, request)}
							onOperation={(request) =>
								mutations.finishOperation(activeTab.id, request)
							}
							onRefresh={() => {
								void connection.refresh(activeTab.id);
							}}
							onAction={(action) =>
								dispatch({ type: "workspace", id: activeTab.id, action })
							}
						/>
					) : undefined
				}
				toolbar={
					<WorkspaceTabs
						state={state}
						dispatch={dispatch}
						readBranches={readBranches}
						readRepository={readRepository}
						onChangeBranch={mutations.changeBranch}
						onCreateWorktree={mutations.createWorktree}
						onRemoveWorktree={mutations.removeWorktree}
						onFetch={mutations.fetch}
						onSync={mutations.synchronize}
						onCancelSync={mutations.cancelSync}
					/>
				}
				workspaceLabel={
					activeTab ? `${activeTab.name} workspace` : "No workspace open"
				}
			>
				{settingsOpen ? null : closeNotice}
				{session.error ? (
					<div style={{ padding: 10, flexShrink: 0, gap: 6 }}>
						<text
							testId="session-notice"
							role="alert"
							style={{ fontSize: 11, color: appTokens.colors.textMuted }}
						>
							{session.error}
						</text>
						{saveSession ? (
							<Button
								testId="retry-session-save"
								tokens={appTokens}
								size="sm"
								variant="ghost"
								onPress={session.retry}
							>
								Retry saving session
							</Button>
						) : null}
					</div>
				) : null}
				{cloneTab ? (
					<RepositoryCloneView
						key={cloneTab.id}
						accounts={accounts}
						preferredAccountKey={preferredAccountKey}
						active={activeTab?.id === cloneTab.id && !settingsOpen}
						disabled={
							connection.pickingId !== null ||
							cloneTab.workspace.loading ||
							RepositoryWorkspaceModel.isBusy(cloneTab.workspace)
						}
						onSubmit={(request) =>
							connection.setup(
								cloneTab.id,
								request,
								mutations.closeProtection.block
							)
						}
						onCancel={() => connection.cancelSetup(cloneTab.id)}
						onOpen={(path) => {
							void connection.read(cloneTab.id, path);
						}}
						onSettings={openSettings}
						onAddAccount={() => openSettings("connect")}
						onBack={() => {
							setCloneId(null);
							setTimeout(() => {
								const trigger = cloneTrigger.current;

								if (trigger) renderer.focusElement?.(trigger.id);
							}, 0);
						}}
					/>
				) : null}
				{cloneTab && activeTab?.id === cloneTab.id ? null : !preview &&
				  !workspace?.repository &&
				  !workspace?.repositoryPath ? (
					<RepositoryWelcome
						paths={state.recentRepositories ?? []}
						onForget={(path) => dispatch({ type: "forget-repository", path })}
						busy={connection.pickingId !== null || !!workspace?.loading}
						error={workspace?.error}
						onOpen={() => {
							const id = activeTab?.id ?? `workspace-${state.nextId}`;

							if (!activeTab) dispatch({ type: "add" });

							void connection.open(id);
						}}
						onOpenRecent={(path) => {
							const existing = state.tabs.find(
								(tab) => tab.workspace.repository?.root === path
							);

							if (existing) dispatch({ type: "activate", id: existing.id });
							else if (activeTab) void connection.read(activeTab.id, path);
							else dispatch({ type: "add", path });
						}}
						actions={
							<RepositorySetupActions
								cloneRef={cloneTrigger}
								onClone={() => {
									if (
										cloneTab &&
										RepositoryWorkspaceModel.isBusy(cloneTab.workspace)
									) {
										dispatch({ type: "activate", id: cloneTab.id });

										return;
									}

									const id = activeTab?.id ?? `workspace-${state.nextId}`;

									if (!activeTab) dispatch({ type: "add" });

									setCloneId(id);
								}}
								onBegin={() => {
									if (!activeTab) dispatch({ type: "add" });
								}}
								disabled={
									connection.pickingId !== null ||
									!!workspace?.loading ||
									(!!workspace && RepositoryWorkspaceModel.isBusy(workspace))
								}
								onSubmit={(request) =>
									activeTab
										? connection.setup(
												activeTab.id,
												request,
												mutations.closeProtection.block
											)
										: Promise.resolve({
												ok: false,
												message: "Open a workspace first.",
											})
								}
								onCancel={() => {
									if (activeTab) connection.cancelSetup(activeTab.id);
								}}
								onOpen={(path) => {
									if (activeTab) void connection.read(activeTab.id, path);
								}}
							/>
						}
					/>
				) : activeTab?.comparison ? (
					<RepositoryComparison
						key={activeTab.id}
						request={activeTab.comparison}
						readComparison={readComparison}
						readHistory={readHistory}
						readCommitFiles={readCommitFiles}
						readDiff={readDiff}
						onClose={() => dispatch({ type: "compare", id: activeTab.id })}
					/>
				) : activeTab && workspace?.repository && comparison ? (
					<RepositoryDiff
						key={`${activeTab.id}:${revision?.id ?? "changes"}:${comparison.path}`}
						root={workspace.repository.root}
						change={comparison}
						refreshing={
							workspace.loading || RepositoryWorkspaceModel.isBusy(workspace)
						}
						statusError={workspace.error}
						readDiff={readDiff}
						onResolve={(hash, side) =>
							mutations.resolve(activeTab.id, comparison.path, hash, side)
						}
						onHunk={(request) =>
							mutations.hunk(activeTab.id, {
								...request,
								path: comparison.path,
							})
						}
						openConflictEditor={openConflictEditor}
					/>
				) : (
					<RepositoryDiffEmpty
						selected={selected}
						revision={revision}
						view={workspace?.view}
						hasWorkspace={!!activeTab}
						workspace={workspace}
						picking={connection.pickingId !== null}
						onOpen={() => {
							if (!activeTab) return;

							if (workspace?.repositoryPath)
								void connection.refresh(activeTab.id);
							else void connection.open(activeTab.id);
						}}
					/>
				)}
			</AppShell>
			{settingsOpen ? (
				<AccountsSettings
					onBack={closeSettings}
					accounts={accounts}
					initialForm={settingsView ?? "list"}
					preferredAccountKey={preferredAccountKey}
					onAccount={setPreferredAccountKey}
					repositoryView={repositoryView}
					onRepositoryView={selectRepositoryView}
				>
					{closeNotice}
				</AccountsSettings>
			) : null}
		</div>
	);
}
