import { MachineContext } from "./feature/machines/machine-context";
import { AppThemeContext, appThemes, useAppTheme } from "./styles/theme";
import type { AppAppearance } from "./styles/tokens";
import { RepositoryTheme } from "./styles/repository-theme";
import { RepositoryColors } from "./feature/repository-appearance/repository-colors";
import {
	RepositoryPatterns,
	type RepositoryPattern,
} from "./feature/repository-appearance/repository-patterns";
import { Machines } from "./feature/machines/machines";
import { MachineLocation } from "./feature/machines/machine-location";
import { MachinesPanel } from "./feature/machines/machines-panel";
import type { RepositoryDiscoveryPreferences } from "./feature/repository-discovery/repository-discovery";
import { RepositoryDiscovery } from "./feature/repository-discovery/repository-discovery";
import { RepositoryLibrary } from "./feature/repository-discovery/repository-library";
import { useRepositoryDiscovery } from "./feature/repository-discovery/use-repository-discovery";
import { spacing, typography } from "@1git/design-tokens";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useState,
	useRef,
	useSyncExternalStore,
	type ComponentProps,
	type SetStateAction,
} from "react";
import { RepositoryPreviewCache } from "./feature/repository-workspace/lib/repository-preview-cache";
import { RepositoryAvatars } from "./feature/repository-workspace/lib/repository-avatars";
import { RepositoryAvatarContext } from "./feature/repository-workspace/components/repository-avatar";
import {
	AccountsSettings,
	type SettingsSection,
} from "./feature/accounts/accounts-settings";
import { GitSettingsModel } from "./feature/git-settings/git-settings-model";
import { ExternalEditors } from "./feature/editor-settings/external-editors";
import { Accounts } from "./feature/accounts/lib/accounts";
import { AccountStore } from "./feature/accounts/lib/account-store";
import { NativeCredentials } from "./feature/accounts/lib/native-credentials";
import { RemoteAccounts } from "./feature/accounts/lib/remote-accounts";
import { useSyncAccount } from "./feature/accounts/use-sync-account";
import { settingsShortcuts } from "./feature/accounts/lib/settings-shortcut";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { workspaceShortcuts } from "./feature/repository-workspace/lib/repository-filter-shortcut";
import { Button } from "@1git/gpuix-ui/button";

import {
	WorkspaceSession,
	type WorkspaceSessionDocument,
} from "./feature/workspace-tabs/lib/workspace-session";
import { useWorkspaceSession } from "./feature/workspace-tabs/hooks/use-workspace-session";

import { RepositoryNavigation } from "./feature/repository-workspace/components/repository-navigation";
import { RepositoryFileActions } from "./feature/repository-workspace/lib/repository-file-actions";
import { RepositoryDiffEmpty } from "./feature/repository-workspace/components/repository-diff-empty";
import { RepositoryDiff } from "./feature/repository-workspace/components/repository-diff";
import {
	RepositoryDiff as DiffReader,
	defaultDiffSettings,
} from "./feature/repository-workspace/lib/repository-diff";
import { RepositoryReader } from "./feature/repository-workspace/lib/repository-reader";
import { RepositorySetup } from "./feature/repository-workspace/lib/repository-setup";
import { RepositorySetupActions } from "./feature/repository-workspace/components/repository-setup";
import { RepositoryCloneView } from "./feature/repository-workspace/components/repository-clone-view";
import { RepositoryWelcome } from "./feature/repository-workspace/components/repository-welcome";
import type { RepositoryWatcher } from "./feature/repository-workspace/lib/repository-watcher";
import { useRepositoryAutoRefresh } from "./feature/repository-workspace/hooks/use-repository-auto-refresh";
import { RepositoryHistory } from "./feature/repository-workspace/lib/repository-history";
import { RepositoryTags } from "./feature/repository-workspace/lib/repository-tags";
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
import {
	RepositoryPublish,
	type PublishedRepository,
} from "./feature/repository-publish/repository-publish";
import { RepositoryPublishView } from "./feature/repository-publish/repository-publish-view";
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
import { RepositorySyncButton } from "./feature/repository-workspace/components/repository-sync-button";
import type { RepositoryView } from "./feature/repository-workspace/types";
import { RepositoryComparison } from "./feature/repository-comparison/repository-comparison";
import { RepositoryComparison as ComparisonReader } from "./feature/repository-comparison/lib/repository-comparison";
import { RepositoryPullRequest } from "./feature/repository-pull-request/repository-pull-request";
import { RepositoryPullRequestView } from "./feature/repository-pull-request/repository-pull-request-view";
import { RepositoryHistorySquash } from "./feature/repository-workspace/lib/repository-history-squash";
import { RepositoryCommitDetails } from "./feature/repository-workspace/components/repository-commit-details";
import { AiProvider } from "./feature/ai/ai-provider";
import type { AiIntegration } from "./feature/ai/lib/ai-integration";
import { Onboarding } from "./feature/onboarding/onboarding";
import type { OnboardingStep } from "./feature/workspace-tabs/lib/workspace-session";

/** Owns appearance independently of repository state, so a live switch preserves every draft and viewport. */
export function App({
	ai,
	...props
}: ComponentProps<typeof AppContent> & { ai?: AiIntegration }) {
	const renderer = useGpuixRequired();

	const [appearance, setAppearance] = useState<AppAppearance>(
		props.initialSession?.appearance ?? "light"
	);

	const [commitTypeBadges, setCommitTypeBadges] = useState(
		props.initialSession?.commitTypeBadges ?? true
	);

	useLayoutEffect(() => {
		// TestRenderer has no OS window; the production addon is pinned by native/preload.ts.
		if (
			"setWindowAppearance" in renderer &&
			typeof renderer.setWindowAppearance === "function"
		)
			renderer.setWindowAppearance(appearance);
	}, [renderer, appearance]);

	const theme = useMemo(
		() => ({
			...appThemes[appearance],
			setAppearance,
			commitTypeBadges,
			setCommitTypeBadges,
		}),
		[appearance, commitTypeBadges]
	);

	return (
		<AppThemeContext value={theme}>
			<AiProvider service={ai}>
				<MachineContext value={props.machines ?? Machines.shared}>
					<AppContent {...props} />
				</MachineContext>
			</AiProvider>
		</AppThemeContext>
	);
}

/** Owns one window's workspaces, cancellable reads and explicit commit transactions. */
function AppContent({
	accounts: suppliedAccounts,
	remoteAccounts: suppliedRemoteAccounts,
	avatars: suppliedAvatars,
	initialTabCount,
	preview = false,
	initialSession,
	initialOnboarding,
	sessionError,
	saveSession,
	readRepository = RepositoryReader.read,
	setupRepository,
	readComparison = ComparisonReader.read,
	readPullRequest,
	readDiff = DiffReader.read,
	readHistory = RepositoryHistory.read,
	readHistoryCount = RepositoryHistory.readCount,
	readUnpushedCommits = RepositoryHistory.readUnpushed,
	readCommitFiles = RepositoryHistory.readFiles,
	readStashes = RepositoryStashes.read,
	readStashFiles = RepositoryStashes.readFiles,
	writeCommit = RepositoryCommit.write,
	readLastCommit = RepositoryCommit.readLast,
	undoCommit = RepositoryCommit.undo,
	revertCommit = RepositoryHistory.revert,
	cherryPickCommit = RepositoryHistory.cherryPick,
	readTags = RepositoryTags.read,
	createTag = RepositoryTags.create,
	pushTag,
	readSquash = RepositoryHistorySquash.read,
	squashCommits = RepositoryHistorySquash.write,
	readReset = RepositoryHistory.readReset,
	resetCommit = RepositoryHistory.reset,
	readReorder = RepositoryHistory.readReorder,
	reorderCommits = RepositoryHistory.reorder,
	readBranches = RepositoryBranches.read,
	writeBranch = RepositoryBranches.write,
	writeWorktree = RepositoryWorktrees.create,
	removeWorktree = RepositoryWorktrees.remove,
	fetchRepository,
	writeSyncRepository,
	writeStash = RepositoryStashes.write,
	watchRepository,
	discoverRepositories,
	resolveConflict = RepositoryConflicts.write,
	openConflictEditor,
	writeOperation = RepositoryOperation.write,
	discardFile = RepositoryFileActions.discard,
	ignoreFile = RepositoryFileActions.ignore,
	openFile,
	externalEditors: suppliedEditors,
	machines: suppliedMachines,
	readGitSettings = GitSettingsModel.read,
	writeGitSettings = GitSettingsModel.write,
}: {
	machines?: Machines;
	accounts?: Accounts;
	remoteAccounts?: RemoteAccounts;
	avatars?: RepositoryAvatars;
	initialTabCount?: number;
	preview?: boolean;
	initialSession?: WorkspaceSessionDocument;
	/** Set only by startup when no previous session exists; older sessions stay uninterrupted. */
	initialOnboarding?: OnboardingStep;
	sessionError?: string;
	saveSession?: (document: WorkspaceSessionDocument) => void;
	readRepository?: typeof RepositoryReader.read;
	setupRepository?: typeof RepositorySetup.write;
	readComparison?: typeof ComparisonReader.read;
	readPullRequest?: RepositoryPullRequest["read"];
	readDiff?: typeof DiffReader.read;
	readHistory?: typeof RepositoryHistory.read;
	readHistoryCount?: typeof RepositoryHistory.readCount;
	readUnpushedCommits?: typeof RepositoryHistory.readUnpushed;
	readCommitFiles?: typeof RepositoryHistory.readFiles;
	readStashes?: typeof RepositoryStashes.read;
	readStashFiles?: typeof RepositoryStashes.readFiles;
	writeCommit?: typeof RepositoryCommit.write;
	readLastCommit?: typeof RepositoryCommit.readLast;
	undoCommit?: typeof RepositoryCommit.undo;
	revertCommit?: typeof RepositoryHistory.revert;
	cherryPickCommit?: typeof RepositoryHistory.cherryPick;
	readTags?: typeof RepositoryTags.read;
	createTag?: typeof RepositoryTags.create;
	pushTag?: typeof RepositorySync.pushTag;
	readSquash?: typeof RepositoryHistorySquash.read;
	squashCommits?: typeof RepositoryHistorySquash.write;
	readReset?: typeof RepositoryHistory.readReset;
	resetCommit?: typeof RepositoryHistory.reset;
	readReorder?: typeof RepositoryHistory.readReorder;
	reorderCommits?: typeof RepositoryHistory.reorder;
	readBranches?: typeof RepositoryBranches.read;
	writeBranch?: typeof RepositoryBranches.write;
	writeWorktree?: typeof RepositoryWorktrees.create;
	removeWorktree?: typeof RepositoryWorktrees.remove;
	fetchRepository?: typeof RepositorySync.fetch;
	writeSyncRepository?: typeof RepositorySync.write;
	writeStash?: typeof RepositoryStashes.write;
	watchRepository?: typeof RepositoryWatcher.watch;
	discoverRepositories?: typeof RepositoryDiscovery.scan;
	resolveConflict?: typeof RepositoryConflicts.write;
	openConflictEditor?: typeof RepositoryConflicts.openEditor;
	writeOperation?: typeof RepositoryOperation.write;
	discardFile?: typeof RepositoryFileActions.discard;
	ignoreFile?: typeof RepositoryFileActions.ignore;
	openFile?: typeof RepositoryFileActions.open;
	externalEditors?: ExternalEditors;
	readGitSettings?: typeof GitSettingsModel.read;
	writeGitSettings?: typeof GitSettingsModel.write;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const renderer = useGpuixRequired();

	const [externalEditors] = useState(
		() => suppliedEditors ?? new ExternalEditors()
	);

	useEffect(() => {
		void externalEditors.discover();
	}, [externalEditors]);
	const launchFile = useCallback<typeof RepositoryFileActions.open>(
		(root, path, kind, application) => {
			if (openFile)
				return application === undefined
					? openFile(root, path, kind)
					: openFile(root, path, kind, application);

			return RepositoryFileActions.open(
				root,
				path,
				kind,
				application,
				externalEditors
			);
		},
		[openFile, externalEditors]
	);

	const launchConflict = useCallback<typeof RepositoryConflicts.openEditor>(
		(root, path) =>
			openConflictEditor
				? openConflictEditor(root, path)
				: RepositoryConflicts.openEditor(
						root,
						path,
						undefined,
						externalEditors
					),
		[openConflictEditor, externalEditors]
	);

	const previewCache = useMemo(
		() => new RepositoryPreviewCache(readDiff),
		[readDiff]
	);

	const [diffSettings, setDiffSettings] = useState(() =>
		preview
			? defaultDiffSettings
			: (initialSession?.diffSettings ?? defaultDiffSettings)
	);

	useEffect(() => () => previewCache.dispose(), [previewCache]);

	const [accounts] = useState(
		() =>
			suppliedAccounts ??
			new Accounts(
				new AccountStore(AccountStore.defaultPath()),
				new NativeCredentials(renderer)
			)
	);

	const [machines] = useState(() => suppliedMachines ?? Machines.shared);

	useSyncExternalStore(machines.subscribe, machines.snapshot);

	const [selectedMachine, setSelectedMachine] = useState(
		() =>
			RepositoryLibrary.preferences(initialSession?.repositoryLibrary)
				.machine ?? "local"
	);

	const [machineError, setMachineError] = useState<string | null>(null);

	useLayoutEffect(() => {
		machines.setVault(new NativeCredentials(renderer));
	}, [machines, renderer]);

	useEffect(
		() => () => {
			void machines.dispose();
		},
		[machines]
	);

	const avatars = useMemo(
		() =>
			suppliedAvatars ?? new RepositoryAvatars(() => accounts.hostProviders()),
		[accounts, suppliedAvatars]
	);

	const [remoteAccounts] = useState(
		() => suppliedRemoteAccounts ?? new RemoteAccounts(accounts)
	);

	const syncAccount = useSyncAccount();

	const pullRequests = useMemo(
		() => new RepositoryPullRequest(accounts, remoteAccounts),
		[accounts, remoteAccounts]
	);

	const readReview = useCallback<RepositoryPullRequest["read"]>(
		(root, signal) =>
			readPullRequest
				? readPullRequest(root, signal)
				: pullRequests.read(root, signal),
		[readPullRequest, pullRequests]
	);

	const publisher = useMemo(
		() => new RepositoryPublish(accounts, remoteAccounts),
		[accounts, remoteAccounts]
	);

	const [publishId, setPublishId] = useState<string | null>(null);
	const [publishOpen, setPublishOpen] = useState(false);

	const [published, setPublished] = useState<
		ReadonlyMap<string, PublishedRepository>
	>(() => new Map());

	const [uncertainPublications, setUncertainPublications] = useState<
		ReadonlySet<string>
	>(() => new Set());

	const fetchWithAccounts = useCallback<typeof RepositorySync.fetch>(
		(root, signal, _authentication, onProgress) =>
			fetchRepository
				? fetchRepository(root, signal, undefined, onProgress)
				: RepositorySync.fetch(
						root,
						signal,
						{
							accounts: remoteAccounts,
							choose: syncAccount.choose,
						},
						onProgress
					),
		[fetchRepository, remoteAccounts, syncAccount.choose]
	);

	const syncWithAccounts = useCallback<typeof RepositorySync.write>(
		(root, input, signal, _authentication, onProgress) =>
			writeSyncRepository
				? writeSyncRepository(root, input, signal, undefined, onProgress)
				: RepositorySync.write(
						root,
						input,
						signal,
						{
							accounts: remoteAccounts,
							choose: syncAccount.choose,
						},
						onProgress
					),
		[writeSyncRepository, remoteAccounts, syncAccount.choose]
	);

	const pushTagWithAccounts = useCallback<typeof RepositorySync.pushTag>(
		(root, input, signal) =>
			pushTag
				? pushTag(root, input, signal)
				: RepositorySync.pushTag(root, input, signal, {
						accounts: remoteAccounts,
						choose: syncAccount.choose,
					}),
		[pushTag, remoteAccounts, syncAccount.choose]
	);

	useEffect(
		() => () => {
			if (!suppliedAvatars) avatars.dispose();
		},
		[avatars, suppliedAvatars]
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
				: WorkspaceTabsModel.create(
						options.initialTabCount ?? (options.preview ? 1 : 0),
						options.preview
					)
	);

	const [onboarding, setOnboarding] = useState<OnboardingStep>(
		preview
			? "complete"
			: (initialSession?.onboarding ?? initialOnboarding ?? "complete")
	);

	const [repositoryColors, setRepositoryColors] = useState(() =>
		RepositoryColors.parse(initialSession?.repositoryColors)
	);

	const [repositoryPatterns, setRepositoryPatterns] = useState(() =>
		RepositoryPatterns.parse(initialSession?.repositoryPatterns)
	);

	const [discoveryPreferences, setDiscoveryPreferences] = useState(() =>
		RepositoryDiscovery.preferences(initialSession?.repositoryDiscovery)
	);

	const [repositoryLibrary, setRepositoryLibrary] = useState(() =>
		RepositoryLibrary.preferences(initialSession?.repositoryLibrary)
	);

	const onboardingOpen = onboarding !== "complete";
	const [onboardingId, setOnboardingId] = useState<string | null>(null);
	const [onboardingClone, setOnboardingClone] = useState(false);

	const onboardingWorkspace = state.tabs.find(
		(tab) => tab.id === onboardingId
	)?.workspace;

	const session = useWorkspaceSession(
		state,
		saveSession,
		preview ? undefined : sessionError,
		diffSettings,
		theme.appearance,
		theme.commitTypeBadges,
		onboarding,
		repositoryColors,
		discoveryPreferences,
		repositoryPatterns,
		repositoryLibrary
	);

	const connection = useRepositoryConnection(
		state,
		dispatch,
		readRepository,
		setup
	);

	useEffect(() => {
		if (onboardingOpen && onboardingWorkspace?.repository) {
			setOnboarding("complete");
			setOnboardingClone(false);
		}
	}, [onboardingOpen, onboardingWorkspace?.repository]);

	const mutations = useRepositoryMutations(
		state,
		dispatch,
		writeCommit,
		writeBranch,
		readRepository,
		fetchWithAccounts,
		syncWithAccounts,
		session.retry,
		writeStash,
		resolveConflict,
		writeOperation,
		discardFile,
		writeWorktree,
		removeWorktree,
		undoCommit,
		async (root, request) => {
			const result = await writeGitSettings(root, request);

			if (root && request.kind !== "identity") {
				const repository = state.tabs.find(
					(tab) => tab.workspace.repository?.root === root
				)?.workspace.repository;

				for (const tab of state.tabs) {
					if (
						repository &&
						tab.workspace.repository?.commonDirectory ===
							repository.commonDirectory
					)
						void avatars.invalidate(tab.workspace.repository.root);
				}
			}

			return result;
		},
		revertCommit,
		ignoreFile,
		cherryPickCommit,
		createTag,
		pushTagWithAccounts,
		squashCommits,
		resetCommit,
		reorderCommits
	);

	useRepositoryAutoRefresh(state, dispatch, readRepository, watchRepository);

	const activeTab = state.tabs.find((tab) => tab.id === state.activeId);
	const workspace = activeTab?.workspace;
	const commonDirectory = workspace?.repository?.commonDirectory;

	const repositoryColor = commonDirectory
		? repositoryColors[commonDirectory]
		: undefined;

	const repositoryPattern = commonDirectory
		? repositoryPatterns[commonDirectory]
		: undefined;

	const repositoryAppearance = commonDirectory
		? {
				color: repositoryColor,
				pattern: repositoryPattern,
				onChange: (color: string | undefined) =>
					setRepositoryColors((choices) =>
						RepositoryColors.set(choices, commonDirectory, color)
					),
				onPatternChange: (pattern: RepositoryPattern | undefined) => {
					setRepositoryPatterns((choices) =>
						RepositoryPatterns.set(choices, commonDirectory, pattern)
					);
				},
			}
		: undefined;

	const repositoryTheme = useMemo(
		() => ({
			...theme,
			...RepositoryTheme.create(theme, repositoryColor, repositoryPattern),
		}),
		[theme, repositoryColor, repositoryPattern]
	);

	const publishTab = state.tabs.find(
		(tab) => tab.id === publishId && tab.workspace.repository
	);

	const publishRepository = publishTab?.workspace.repository;
	const publishingVisible = publishOpen && activeTab?.id === publishId;

	const openPublish = (id: string): void => {
		setPublishId(id);
		setPublishOpen(true);
	};

	useEffect(() => {
		previewCache.retain(
			state.tabs.flatMap((tab) => {
				const repository = tab.workspace.repository;

				return repository
					? [{ root: repository.root, version: repository }]
					: [];
			})
		);
	}, [previewCache, state.tabs]);

	const [settingsView, setSettingsView] = useState<"list" | "connect" | null>(
		null
	);

	const settingsOpen = settingsView !== null;

	const [settingsSection, setSettingsSection] =
		useState<SettingsSection>("accounts");

	const [reconnectAccountKey, setReconnectAccountKey] = useState<string>();

	const [preferredAccountKey, setPreferredAccountKey] = useState<string>();
	const [cloneId, setCloneId] = useState<string | null>(null);
	const cloneTrigger = useRef<PublicInstance | null>(null);

	const cloneTab = state.tabs.find(
		(tab) =>
			tab.id === cloneId &&
			!tab.workspace.repository &&
			!tab.workspace.repositoryPath
	);

	const welcomeVisible =
		!publishingVisible &&
		!(cloneTab && activeTab?.id === cloneTab.id) &&
		!workspace?.preview &&
		!workspace?.repository &&
		!workspace?.repositoryPath;

	const remoteMachine = selectedMachine !== "local";

	const machineHome = remoteMachine
		? machines.home(selectedMachine)
		: undefined;

	const remoteHome = remoteMachine
		? MachineLocation.encode(selectedMachine, machineHome ?? "/")
		: undefined;

	const selectedSavedMachine = (() => {
		if (!remoteMachine) return undefined;

		try {
			return machines.list().find((machine) => machine.id === selectedMachine);
		} catch {
			return undefined;
		}
	})();

	const remotePreferences = useMemo<RepositoryDiscoveryPreferences>(
		() => ({
			folders:
				selectedSavedMachine?.folders.map((folder) =>
					MachineLocation.encode(selectedSavedMachine.id, folder)
				) ?? [],
			hidden: discoveryPreferences.hidden,
		}),
		[selectedSavedMachine, discoveryPreferences.hidden]
	);

	const updateRemotePreferences = useCallback(
		(action: SetStateAction<RepositoryDiscoveryPreferences>): void => {
			if (!selectedSavedMachine) return;

			const next =
				typeof action === "function" ? action(remotePreferences) : action;

			setDiscoveryPreferences((current) => ({
				...current,
				hidden: next.hidden,
			}));
			void (async () => {
				try {
					await machines.save({
						...selectedSavedMachine,
						folders: next.folders.map(MachineLocation.display),
					});
				} catch (cause) {
					setMachineError(
						cause instanceof Error
							? cause.message
							: "Could not save remote folders."
					);
				}
			})();
		},
		[machines, selectedSavedMachine, remotePreferences]
	);

	const remoteScan = useCallback<typeof RepositoryDiscovery.scan>(
		async (folders, signal, report) =>
			await machines.scan(selectedMachine, folders, signal, report),
		[machines, selectedMachine]
	);

	useEffect(() => {
		if (
			!remoteMachine ||
			!welcomeVisible ||
			settingsOpen ||
			onboardingOpen ||
			preview
		)
			return;

		void (async () => {
			try {
				await machines.connect(selectedMachine);
			} catch {
				// The machine panel presents connection failures and an explicit retry.
			}
		})();
	}, [
		machines,
		selectedMachine,
		remoteMachine,
		welcomeVisible,
		settingsOpen,
		onboardingOpen,
		preview,
	]);

	const discovery = useRepositoryDiscovery({
		enabled:
			welcomeVisible &&
			!settingsOpen &&
			!onboardingOpen &&
			!preview &&
			(!remoteMachine || !!machineHome),
		scan: preview
			? undefined
			: remoteMachine
				? remoteScan
				: discoverRepositories,
		preferences: remoteMachine ? remotePreferences : discoveryPreferences,
		onPreferencesChange: remoteMachine
			? updateRemotePreferences
			: setDiscoveryPreferences,
		home: remoteHome,
		remote: remoteMachine,
	});

	const welcomePaths = useMemo(
		() =>
			[
				...new Set([
					...(state.recentRepositories ?? []),
					...discovery.paths,
					...repositoryLibrary.starred,
				]),
			].filter((path) =>
				remoteMachine
					? MachineLocation.parse(path)?.machineId === selectedMachine
					: !MachineLocation.isRemote(path)
			),
		[
			state.recentRepositories,
			discovery.paths,
			repositoryLibrary.starred,
			remoteMachine,
			selectedMachine,
		]
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
			setSettingsSection("accounts");
			setReconnectAccountKey(undefined);
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

	const onboardingTab = (): string => {
		if (onboardingId && state.tabs.some((tab) => tab.id === onboardingId))
			return onboardingId;

		const id = `workspace-${state.nextId}`;

		dispatch({ type: "add" });
		setOnboardingId(id);

		return id;
	};

	const onboardingBusy =
		connection.pickingId !== null ||
		!!onboardingWorkspace?.loading ||
		(!!onboardingWorkspace &&
			RepositoryWorkspaceModel.isBusy(onboardingWorkspace));

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
			if (onboardingOpen) return;

			if (key === "left" || key === "right") {
				let id: string | undefined;

				if (activeTab)
					id = WorkspaceTabsModel.destination(state.tabs, activeTab.id, key);
				else id = (key === "left" ? state.tabs.at(-1) : state.tabs[0])?.id;

				if (id) dispatch({ type: "activate", id });

				return;
			}

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
	}, [
		renderer,
		state.tabs,
		state.nextId,
		activeTab,
		workspace,
		connection,
		onboardingOpen,
	]);

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
		readCommitFiles,
		readTags,
		readHistoryCount,
		readUnpushedCommits
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
		<RepositoryAvatarContext value={avatars}>
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
					palette={repositoryTheme}
					hidden={settingsOpen || onboardingOpen}
					rail={
						settingsOpen || onboardingOpen ? undefined : (
							<WorkspaceRail
								repositoryAppearance={repositoryAppearance}
								settingsButtonRef={railSettingsButton}
								accountButtonRef={railAccountButton}
								viewButtonRefs={railViewButtons}
								accounts={accounts}
								preferredAccountKey={preferredAccountKey}
								onAccount={setPreferredAccountKey}
								onSettings={(section = "accounts") => {
									openSettings();
									setSettingsSection(section);
								}}
								onAddAccount={() => openSettings("connect")}
								view={repositoryView}
								onView={selectRepositoryView}
							>
								{activeTab && workspace?.repository && !workspace.preview ? (
									<RepositorySyncButton
										key={activeTab.id}
										state={workspace}
										readBranches={readBranches}
										onAccounts={(key) => {
											mutations.dismissSyncError(activeTab.id);
											openSettings();
											setReconnectAccountKey(key);
										}}
										onRemotes={() => {
											mutations.dismissSyncError(activeTab.id);
											openSettings();
											setSettingsSection("repository-remotes");
										}}
										onFetch={async () => {
											await mutations.fetch(activeTab.id);
										}}
										onSync={async (choice) => {
											await mutations.synchronize(activeTab.id, choice);
										}}
										onCancel={() => mutations.cancelSync(activeTab.id)}
										onPublish={() => openPublish(activeTab.id)}
										onRefresh={() => {
											void connection.refresh(activeTab.id);
										}}
										resumePublish={
											published.has(workspace.repository.commonDirectory) ||
											uncertainPublications.has(
												workspace.repository.commonDirectory
											)
										}
										onCompare={(data) => {
											const repository = workspace.repository;

											if (!repository?.head) return;

											dispatch({
												type: "compare",
												id: activeTab.id,
												comparison: {
													root: repository.root,
													base: repository.head,
													baseName: repository.branchName ?? "HEAD",
													branches: data.branches.branches.map((item) => ({
														value: item.fullName,
														label: item.name,
														oid: item.oid,
													})),
												},
											});
										}}
										onPreviewPullRequest={() => {
											const repository = workspace.repository;

											if (!repository?.head) return;

											dispatch({
												type: "compare",
												id: activeTab.id,
												comparison: {
													root: repository.root,
													base: repository.head,
													baseName: repository.branchName ?? "HEAD",
													intent: "pull-request",
													branches: [],
												},
											});
										}}
									/>
								) : null}
							</WorkspaceRail>
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
								onAiSettings={() => {
									openSettings();
									setSettingsSection("ai");
								}}
								onPreviewIntent={(entry) => {
									const change = entry?.change ?? entry?.commitFile;
									const repository = workspace.repository;

									const available =
										repository &&
										!workspace.loading &&
										!workspace.error &&
										!RepositoryWorkspaceModel.isBusy(workspace);

									previewCache.intent(
										change && available
											? {
													root: repository.root,
													change,
													version: repository,
													ignoreWhitespace: diffSettings.ignoreWhitespace,
												}
											: null
									);
								}}
								openFile={launchFile}
								externalEditors={externalEditors}
								onDiscard={(request) =>
									mutations.discardFile(activeTab.id, request)
								}
								onIgnore={(request) =>
									mutations.ignoreFile(activeTab.id, request)
								}
								key={activeTab.id}
								workspaceId={activeTab.id}
								state={workspace}
								history={history}
								stashes={stashes}
								onCommit={() => {
									void mutations.commit(activeTab.id);
								}}
								onUndoCommit={(input) =>
									mutations.undoCommit(activeTab.id, input)
								}
								onRevertCommit={(input) =>
									mutations.revertCommit(activeTab.id, input)
								}
								onCherryPickCommit={(input) =>
									mutations.cherryPickCommit(activeTab.id, input)
								}
								onCreateTag={(input) =>
									mutations.createTag(activeTab.id, input)
								}
								onPushTag={(input) => mutations.pushTag(activeTab.id, input)}
								onSquash={(input) =>
									mutations.squashCommits(activeTab.id, input)
								}
								readSquash={readSquash}
								onReset={(input) => mutations.resetCommit(activeTab.id, input)}
								readReset={readReset}
								onReorder={(input) =>
									mutations.reorderCommits(activeTab.id, input)
								}
								readReorder={readReorder}
								readBranches={readBranches}
								readCommitLink={async (root, oid, signal) =>
									RepositoryHistory.readCommitLink(
										root,
										oid,
										signal,
										await accounts.hostProviders()
									)
								}
								readLastCommit={readLastCommit}
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
							onSettings={() => {
								openSettings();
								setSettingsSection("repository-remotes");
							}}
						/>
					}
					workspaceLabel={activeTab ? `${activeTab.name} workspace` : "Home"}
				>
					{publishTab && publishRepository ? (
						<RepositoryPublishView
							key={publishTab.id}
							accounts={accounts}
							name={publishRepository.name}
							active={publishingVisible && !settingsOpen}
							disabled={
								publishTab.workspace.loading ||
								!!publishTab.workspace.error ||
								RepositoryWorkspaceModel.isBusy(publishTab.workspace)
							}
							created={published.get(publishRepository.commonDirectory)}
							uncertain={uncertainPublications.has(
								publishRepository.commonDirectory
							)}
							blockedReason={
								!publishRepository.head
									? "Create your first commit before publishing."
									: !publishRepository.branchName
										? "Switch to a branch before publishing."
										: publishRepository.operation !== "normal"
											? "Finish the current Git operation before publishing."
											: publishTab.workspace.commit.needsReview
												? "Refresh and review this repository before publishing."
												: undefined
							}
							preferredAccountKey={preferredAccountKey}
							onSubmit={async (request) => {
								const result = await mutations.publishRepository(
									publishTab.id,
									(root, identity, signal, onProgress) =>
										publisher.write(
											root,
											request,
											identity,
											signal,
											(receipt) =>
												setPublished((previous) =>
													new Map(previous).set(
														receipt.commonDirectory,
														receipt
													)
												),
											() =>
												setUncertainPublications((previous) =>
													new Set(previous).add(
														publishRepository.commonDirectory
													)
												),
											onProgress
										)
								);

								if (result?.ok) {
									setPublished((previous) => {
										const next = new Map(previous);

										next.delete(publishRepository.commonDirectory);

										return next;
									});
									void avatars.invalidate(publishRepository.root);
								}

								return result;
							}}
							onClose={() => setPublishOpen(false)}
							onCancel={() => mutations.cancelSync(publishTab.id)}
							onSettings={() => openSettings("connect")}
						/>
					) : null}
					{settingsOpen ? null : closeNotice}
					{session.error ? (
						<div
							style={{
								padding: spacing[2.5],
								flexShrink: 0,
								gap: spacing[1.5],
							}}
						>
							<text
								testId="session-notice"
								role="alert"
								style={{
									...typography.sm,
									color: appTokens.colors.textMuted,
								}}
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
					{!publishingVisible &&
					!(cloneTab && activeTab?.id === cloneTab.id) &&
					!activeTab?.comparison &&
					workspace?.view === "history" &&
					revision?.commit ? (
						<RepositoryCommitDetails
							key={`commit-details:${activeTab?.id}:${workspace.repository?.root}:${revision.id}`}
							commit={revision.commit}
							tags={history.tags}
						/>
					) : null}
					{publishingVisible ||
					(cloneTab &&
						activeTab?.id === cloneTab.id) ? null : welcomeVisible ? (
						<RepositoryWelcome
							paths={welcomePaths}
							remote={remoteMachine}
							machines={
								!preview ? (
									<MachinesPanel
										service={machines}
										selected={selectedMachine}
										onConnected={() => discovery.rescan()}
										onSelect={(id) => {
											setSelectedMachine(id);
											setMachineError(null);
											setRepositoryLibrary((current) => ({
												...current,
												folder: undefined,
												machine: id === "local" ? undefined : id,
											}));
										}}
									/>
								) : undefined
							}
							library={repositoryLibrary}
							onLibraryChange={setRepositoryLibrary}
							savedPaths={state.recentRepositories ?? []}
							discovery={discovery.available ? discovery : undefined}
							onForget={(path) => {
								discovery.hide(path);
								setRepositoryLibrary((current) =>
									RepositoryLibrary.star(current, path, false)
								);
								dispatch({ type: "forget-repository", path });
							}}
							busy={connection.pickingId !== null || !!workspace?.loading}
							error={machineError ?? workspace?.error}
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
					) : activeTab?.comparison?.intent === "pull-request" && workspace ? (
						<RepositoryPullRequestView
							key={`${activeTab.id}:pull-request`}
							root={activeTab.comparison.root}
							state={workspace}
							read={readReview}
							onFetch={() => mutations.fetch(activeTab.id)}
							onSync={(choice, identity) =>
								mutations.synchronize(activeTab.id, choice, undefined, identity)
							}
							onClose={() => dispatch({ type: "compare", id: activeTab.id })}
							readComparison={readComparison}
							readHistory={readHistory}
							readCommitFiles={readCommitFiles}
							readDiff={readDiff}
							previewCache={previewCache}
							diffSettings={diffSettings}
							onDiffSettingsChange={setDiffSettings}
						/>
					) : activeTab?.comparison ? (
						<RepositoryComparison
							key={activeTab.id}
							request={activeTab.comparison}
							readComparison={readComparison}
							readHistory={readHistory}
							readCommitFiles={readCommitFiles}
							readDiff={readDiff}
							previewCache={previewCache}
							diffSettings={diffSettings}
							onDiffSettingsChange={setDiffSettings}
							onClose={() => dispatch({ type: "compare", id: activeTab.id })}
						>
							{workspace?.repository && !workspace.preview
								? () => (
										<Button
											testId="preview-pull-request"
											tokens={appTokens}
											variant="secondary"
											size="sm"
											disabled={
												workspace.loading ||
												RepositoryWorkspaceModel.isBusy(workspace) ||
												!!workspace.error ||
												workspace.repository?.operation !== "normal" ||
												!workspace.repository?.head ||
												!workspace.repository.branchName ||
												workspace.repository.remoteCount === 0
											}
											onPress={() => {
												const request = activeTab.comparison;

												if (!request) return;

												dispatch({
													type: "compare",
													id: activeTab.id,
													comparison: {
														...request,
														intent: "pull-request",
													},
												});
											}}
										>
											Preview pull request…
										</Button>
									)
								: undefined}
						</RepositoryComparison>
					) : activeTab && workspace?.repository && comparison ? (
						<RepositoryDiff
							key={`${activeTab.id}:${workspace.repository.root}:${revision?.id ?? "changes"}`}
							root={workspace.repository.root}
							change={comparison}
							inclusion={
								workspace.view === "changes" &&
								workspace.repository.operation === "normal"
									? {
											included: workspace.includedFileIds.includes(
												comparison.path
											),
											selection: workspace.partialFiles?.[comparison.path],
											onChange: (expectedPatch, includedLines, total) =>
												dispatch({
													type: "workspace",
													id: activeTab.id,
													action: {
														type: "include-lines",
														id: comparison.path,
														expectedPatch,
														includedLines,
														total,
													},
												}),
										}
									: undefined
							}
							cache={previewCache}
							settings={diffSettings}
							onSettingsChange={setDiffSettings}
							version={workspace.repository}
							files={files}
							refreshing={
								workspace.loading || RepositoryWorkspaceModel.isBusy(workspace)
							}
							statusError={workspace.error}
							readDiff={readDiff}
							onResolve={(hash, side) =>
								mutations.resolve(activeTab.id, comparison.path, hash, side)
							}
							openConflictEditor={launchConflict}
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
				{onboarding !== "complete" ? (
					<Onboarding
						step={onboarding}
						active={!settingsOpen}
						busy={onboardingBusy}
						error={onboardingWorkspace?.error ?? undefined}
						onStep={setOnboarding}
						onSkip={() => {
							setOnboarding("complete");
							setOnboardingClone(false);
						}}
						accounts={accounts}
						readIdentity={readGitSettings}
						writeIdentity={mutations.saveSettings}
						cloneView={
							onboardingClone ? (
								<RepositoryCloneView
									accounts={accounts}
									preferredAccountKey={preferredAccountKey}
									active={!settingsOpen}
									disabled={onboardingBusy}
									onSubmit={(request) =>
										connection.setup(
											onboardingTab(),
											request,
											mutations.closeProtection.block
										)
									}
									onCancel={() => {
										if (onboardingId) connection.cancelSetup(onboardingId);
									}}
									onOpen={(path) => {
										void connection.read(onboardingTab(), path);
									}}
									onSettings={openSettings}
									onAddAccount={() => openSettings("connect")}
									onBack={() => setOnboardingClone(false)}
								/>
							) : undefined
						}
						repositoryActions={
							<div
								style={{
									display: "flex",
									flexDirection: "row",
									gap: spacing[1],
									minWidth: 0,
								}}
							>
								<Button
									testId="onboarding-open"
									tokens={appTokens}
									size="sm"
									variant="ghost"
									disabled={onboardingBusy}
									style={{
										flexGrow: 1,
										flexBasis: 0,
										minWidth: 0,
										height: 88,
										flexDirection: "column",
										gap: spacing[2],
										borderColor: appTokens.colors.border,
									}}
									onPress={() => {
										void connection.open(onboardingTab());
									}}
								>
									<svg
										source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
										style={{
											width: 14,
											height: 14,
											color: appTokens.colors.textMuted,
											pointerEvents: "none",
										}}
									/>
									Open from disk
								</Button>
								<RepositorySetupActions
									testIdPrefix="onboarding-"
									presentation="tiles"
									disabled={onboardingBusy}
									onBegin={onboardingTab}
									onClone={() => {
										onboardingTab();
										setOnboardingClone(true);
									}}
									onSubmit={(request) =>
										connection.setup(
											onboardingTab(),
											request,
											mutations.closeProtection.block
										)
									}
									onCancel={() => {
										if (onboardingId) connection.cancelSetup(onboardingId);
									}}
									onOpen={(path) => {
										void connection.read(onboardingTab(), path);
									}}
								/>
							</div>
						}
					>
						{closeNotice}
						{session.error ? (
							<text
								role="alert"
								style={{
									...typography.sm,
									padding: spacing[3],
									color: appTokens.colors.danger,
								}}
							>
								{session.error}
							</text>
						) : null}
					</Onboarding>
				) : null}
				{settingsOpen ? (
					<AccountsSettings
						onBack={closeSettings}
						onSetup={
							!preview &&
							!state.tabs.some(
								(tab) =>
									tab.workspace.loading ||
									RepositoryWorkspaceModel.isBusy(tab.workspace)
							)
								? () => {
										closeSettings();
										setOnboardingId(null);
										setOnboardingClone(false);
										setOnboarding("welcome");
									}
								: undefined
						}
						accounts={accounts}
						externalEditors={externalEditors}
						initialForm={settingsView ?? "list"}
						initialReconnectKey={reconnectAccountKey}
						remoteAccounts={remoteAccounts}
						preferredAccountKey={preferredAccountKey}
						onAccount={setPreferredAccountKey}
						repositoryView={repositoryView}
						onRepositoryView={selectRepositoryView}
						initialSection={settingsSection}
						repositorySettings={
							workspace?.repository
								? {
										root: workspace.repository.root,
										name: activeTab?.name ?? "Repository",
										disabled:
											workspace.loading ||
											!!workspace.error ||
											RepositoryWorkspaceModel.isBusy(workspace),
									}
								: undefined
						}
						readGitSettings={readGitSettings}
						repositoryAppearance={repositoryAppearance}
						writeGitSettings={mutations.saveSettings}
					>
						{closeNotice}
					</AccountsSettings>
				) : null}
				{syncAccount.dialog}
			</div>
		</RepositoryAvatarContext>
	);
}
