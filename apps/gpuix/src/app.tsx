import { usePopoverOpen } from "@1git/gpuix-ui/popover";
import {
	GuidedTour,
	tourSteps,
	type TourStepId,
	type TourTips,
} from "./feature/guided-tour/guided-tour";
import { GuidedTourLayer } from "./feature/guided-tour/guided-tour-layer";
import { IgnoredHistory } from "./feature/ignored-history/ignored-history";
import { DesktopAnalytics } from "./feature/analytics/desktop-analytics";
import { useIgnoredHistories } from "./feature/ignored-history/use-ignored-histories";
import { IgnoredHistoryView } from "./feature/ignored-history/ignored-history-view";
import { randomUUID } from "node:crypto";
import {
	WorkspaceSpaces,
	type WorkspaceSpace,
	type SpaceDirection,
} from "./feature/spaces/workspace-spaces";
import { SpaceSwitcher } from "./feature/spaces/space-switcher";
import { SpaceManager, SpacesSettings } from "./feature/spaces/space-manager";
import { Keybinds } from "./feature/keybinds/keybinds";
import {
	KeybindContext,
	useKeybinds,
} from "./feature/keybinds/keybind-context";
import { OnboardingSpaces } from "./feature/onboarding/onboarding-spaces";
import { MachineContext } from "./feature/machines/machine-context";
import { RemoteFolderPicker } from "./feature/machines/remote-folder-picker";
import { AppThemeContext, appThemes, useAppTheme } from "./styles/theme";
import { TypographyPreferences } from "./feature/appearance-settings/app-typography";
import { useSystemAppearance } from "./styles/system-appearance";
import type { AppAppearancePreference } from "./styles/tokens";
import { RepositoryTheme } from "./styles/repository-theme";
import { RepositoryColors } from "./feature/repository-appearance/repository-colors";
import { RepositoryAppearanceEditor } from "./feature/repository-appearance/repository-appearance-editor";
import {
	RepositoryPatterns,
	type RepositoryPattern,
	type RepositoryAppearanceSection,
	type RepositoryAppearanceValue,
	type RepositoryPatternAdjustments,
} from "./feature/repository-appearance/repository-patterns";
import { Machines } from "./feature/machines/machines";
import { MachineLocation } from "./feature/machines/machine-location";
import { MachinesPanel } from "./feature/machines/machines-panel";
import type { RepositoryDiscoveryPreferences } from "./feature/repository-discovery/repository-discovery";
import { RepositoryDiscovery } from "./feature/repository-discovery/repository-discovery";
import type { RepositoryDiscoveryCache } from "./feature/repository-discovery/repository-discovery-cache";
import { RepositoryQuickSwitcher } from "./feature/repository-discovery/repository-quick-switcher";
import { RepositoryQuickSwitcherModel } from "./feature/repository-discovery/repository-quick-switcher-model";
import {
	RepositoryLibrary,
	type RepositoryLibraryPreferences,
} from "./feature/repository-discovery/repository-library";
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
import { RepositoryAvatarCache } from "./feature/repository-workspace/lib/repository-avatar-cache";
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
import {
	RepositoryFileViewProvider,
	useRepositoryFileLayout,
} from "./feature/repository-workspace/components/repository-file-view";
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
import { RepositorySyncReview } from "./feature/repository-comparison/repository-sync-review";
import { RepositoryComparison as ComparisonReader } from "./feature/repository-comparison/lib/repository-comparison";
import { RepositoryPullRequest } from "./feature/repository-pull-request/repository-pull-request";
import { RepositoryPullRequestView } from "./feature/repository-pull-request/repository-pull-request-view";
import { RepositoryHistorySquash } from "./feature/repository-workspace/lib/repository-history-squash";
import { RepositoryCommitDetails } from "./feature/repository-workspace/components/repository-commit-details";
import { RepositoryGraph } from "./feature/repository-graph/repository-graph";
import { RepositoryGraphReader } from "./feature/repository-graph/repository-graph-reader";
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

	const [keybindOverrides, setKeybindOverrides] = useState(() =>
		Keybinds.parse(props.initialSession?.keybinds)
	);

	const keybindContext = useMemo(
		() => ({ overrides: keybindOverrides, setOverrides: setKeybindOverrides }),
		[keybindOverrides]
	);

	useLayoutEffect(
		() => Keybinds.register(renderer, keybindOverrides),
		[renderer, keybindOverrides]
	);

	const [appearancePreference, setAppearance] =
		useState<AppAppearancePreference>(
			props.initialSession?.appearance ?? "system"
		);

	const systemAppearance = useSystemAppearance(renderer, appearancePreference);

	const appearance =
		appearancePreference === "system" ? systemAppearance : appearancePreference;

	const [commitTypeBadges, setCommitTypeBadges] = useState(
		props.initialSession?.commitTypeBadges ?? true
	);

	const [typographyPreferences, setTypography] = useState(() =>
		TypographyPreferences.parse(props.initialSession?.typography)
	);

	const [showGrain, setShowGrain] = useState(
		props.initialSession?.showGrain ?? true
	);

	const [showScrollbars, setShowScrollbars] = useState(
		props.initialSession?.showScrollbars ?? true
	);

	const [smoothTransitions, setSmoothTransitions] = useState(
		props.initialSession?.smoothTransitions ?? true
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
			tokens: { ...appThemes[appearance].tokens, showScrollbars },
			typography: typographyPreferences,
			setTypography,
			showGrain,
			setShowGrain,
			showScrollbars,
			setShowScrollbars,
			appearancePreference,
			setAppearance,
			commitTypeBadges,
			setCommitTypeBadges,
			smoothTransitions,
			setSmoothTransitions,
		}),
		[
			appearance,
			appearancePreference,
			commitTypeBadges,
			smoothTransitions,
			showGrain,
			showScrollbars,
			typographyPreferences,
		]
	);

	return (
		<KeybindContext value={keybindContext}>
			<AppThemeContext value={theme}>
				<RepositoryFileViewProvider
					initialLayout={props.initialSession?.fileListLayout}
				>
					<AiProvider service={ai}>
						<MachineContext value={props.machines ?? Machines.shared}>
							<AppContent {...props} />
						</MachineContext>
					</AiProvider>
				</RepositoryFileViewProvider>
			</AppThemeContext>
		</KeybindContext>
	);
}

/** Owns one window's workspaces, cancellable reads and explicit commit transactions. */
function AppContent({
	ignoredHistory: suppliedIgnoredHistory,
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
	readGraphReferences = RepositoryGraphReader.references,
	readGraphPage = RepositoryGraphReader.page,
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
	discoveryCache,
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
	ignoredHistory?: IgnoredHistory;
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
	readGraphReferences?: typeof RepositoryGraphReader.references;
	readGraphPage?: typeof RepositoryGraphReader.page;
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
	discoveryCache?: RepositoryDiscoveryCache;
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
			suppliedAvatars ??
			new RepositoryAvatars(
				() => accounts.hostProviders(),
				undefined,
				new RepositoryAvatarCache(RepositoryAvatarCache.defaultPath())
			),
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
			WorkspaceSpaces.initialize(
				options.initialSession && !options.preview
					? WorkspaceSession.restore(options.initialSession)
					: WorkspaceTabsModel.create(
							options.initialTabCount ?? (options.preview ? 1 : 0),
							options.preview
						),
				RepositoryDiscovery.preferences(
					options.initialSession?.repositoryDiscovery
				),
				RepositoryLibrary.preferences(options.initialSession?.repositoryLibrary)
			)
	);

	const visibleTabs = WorkspaceSpaces.tabs(state);

	const activeSpace = useMemo(() => {
		const space = WorkspaceSpaces.current(state);

		if (!space)
			throw new Error("The active space is missing from this session.");

		return space;
	}, [state]);

	const activeSpaceId = activeSpace.id;
	const discoveryPreferences = activeSpace.discovery;
	const repositoryLibrary = activeSpace.library;
	const selectedMachine = repositoryLibrary.machine ?? "local";

	const setDiscoveryPreferences = useCallback(
		(action: SetStateAction<RepositoryDiscoveryPreferences>) => {
			dispatch({
				type: "space-preferences",
				id: activeSpaceId,
				discovery: action,
			});
		},
		[activeSpaceId]
	);

	const setRepositoryLibrary = useCallback(
		(action: SetStateAction<RepositoryLibraryPreferences>) => {
			dispatch({
				type: "space-preferences",
				id: activeSpaceId,
				library: action,
			});
		},
		[activeSpaceId]
	);

	const [spaceEditor, setSpaceEditor] = useState<{ space?: WorkspaceSpace }>();

	const [onboarding, setOnboarding] = useState<OnboardingStep>(
		preview
			? "complete"
			: (initialSession?.onboarding ?? initialOnboarding ?? "complete")
	);

	const [tips, setTips] = useState<TourTips>(
		() =>
			initialSession?.tips ?? {
				completed: onboarding === "complete" ? tourSteps : [],
			}
	);

	const tabTourAnchor = useRef<PublicInstance>(null);
	const worktreesTourAnchor = useRef<PublicInstance>(null);
	const spaceTourAnchor = useRef<PublicInstance>(null);
	const railTourAnchor = useRef<PublicInstance>(null);
	const [tabMenuOpen, setTabMenuOpen] = useState(false);
	const previousTabMenuOpen = useRef(false);
	const [tabMenuBusy, setTabMenuBusy] = useState(false);
	const [spaceMenuOpen, setSpaceMenuOpen] = useState(false);
	const [railMenuOpen, setRailMenuOpen] = useState(false);
	const popoverOpen = usePopoverOpen();
	const activeTourStep = useRef<TourStepId | null>(null);

	const completeTip = useCallback(
		(id: TourStepId) => {
			if (activeTourStep.current === id)
				setTips((current) => GuidedTour.complete(current, id));
		},
		[setTips]
	);

	const tabMenuChanged = useCallback(
		(open: boolean) => {
			setTabMenuOpen(open);

			if (open || previousTabMenuOpen.current)
				completeTip(open ? "tab-menu" : "worktrees");

			previousTabMenuOpen.current = open;
		},
		[completeTip]
	);

	const tourTabChanged = useCallback((instance: PublicInstance | null) => {
		tabTourAnchor.current = instance;
	}, []);

	const worktreesOpened = useCallback(
		() => completeTip("worktrees"),
		[completeTip]
	);

	const skipTour = useCallback(
		() => setTips((current) => GuidedTour.skip(current)),
		[setTips]
	);

	const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);

	const [repositoryColors, setRepositoryColors] = useState(() =>
		RepositoryColors.parse(initialSession?.repositoryColors)
	);

	const [repositoryPatterns, setRepositoryPatterns] = useState(() =>
		RepositoryPatterns.parse(initialSession?.repositoryPatterns)
	);

	const onboardingOpen = onboarding !== "complete";
	const [onboardingId, setOnboardingId] = useState<string | null>(null);
	const [onboardingClone, setOnboardingClone] = useState(false);

	const onboardingWorkspace = state.tabs.find(
		(tab) => tab.id === onboardingId
	)?.workspace;

	const { overrides: keybindOverrides } = useKeybinds();
	const { layout: fileListLayout } = useRepositoryFileLayout();

	const session = useWorkspaceSession(
		state,
		saveSession,
		preview ? undefined : sessionError,
		diffSettings,
		theme.appearancePreference ?? theme.appearance,
		theme.commitTypeBadges,
		onboarding,
		repositoryColors,
		discoveryPreferences,
		repositoryPatterns,
		repositoryLibrary,
		theme.smoothTransitions,
		theme.showScrollbars,
		theme.typography,
		tips,
		keybindOverrides,
		fileListLayout,
		theme.showGrain
	);

	useEffect(() => {
		if (onboardingOpen && onboardingWorkspace?.repository) {
			void DesktopAnalytics.capture({ name: "onboarding_completed" });
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

	const [ignoredHistory] = useState(
		() =>
			suppliedIgnoredHistory ??
			new IgnoredHistory(new NativeCredentials(renderer))
	);

	const [ignoredRoot, setIgnoredRoot] = useState<string | null>(null);

	const ignoredHistories = useIgnoredHistories(
		state.tabs.flatMap((tab) =>
			tab.workspace.repository &&
			!tab.workspace.preview &&
			!MachineLocation.isRemote(tab.workspace.repository.root)
				? [tab.workspace.repository]
				: []
		),
		ignoredHistory
	);

	const activeTab = state.tabs.find((tab) => tab.id === state.activeId);
	const workspace = activeTab?.workspace;
	const commonDirectory = workspace?.repository?.commonDirectory;
	const lastAppearanceTab = useRef<string | undefined>(undefined);

	useLayoutEffect(() => {
		if (activeTab?.workspace.repository && !activeTab.workspace.preview)
			lastAppearanceTab.current = activeTab.id;
	}, [activeTab]);

	const appearanceTarget =
		workspace?.repository && !workspace.preview
			? activeTab
			: visibleTabs.find((tab) => tab.id === lastAppearanceTab.current);

	const [appearanceEditor, setAppearanceEditor] = useState<{
		commonDirectory: string;
		name: string;
		section: RepositoryAppearanceSection;
		draft: RepositoryAppearanceValue;
		previewColor?: string;
	}>();

	const appearanceEditing =
		appearanceEditor?.commonDirectory === commonDirectory
			? appearanceEditor
			: undefined;

	const customizingRepository = appearanceEditing !== undefined;

	const workspaceTheme = useMemo(
		() => ({
			...theme,
			smoothTransitions: customizingRepository
				? false
				: theme.smoothTransitions,
		}),
		[theme, customizingRepository]
	);

	const ignoredStatus = workspace?.repository
		? ignoredHistories.statuses[workspace.repository.root]
		: undefined;

	const ignoredVisible =
		!!workspace?.repository &&
		ignoredRoot === workspace.repository.root &&
		!!ignoredStatus?.data?.preferences.enabled &&
		!activeTab?.comparison;

	const repositoryColor = commonDirectory
		? repositoryColors[commonDirectory]
		: undefined;

	const repositoryPatternSelection = useMemo(
		() =>
			commonDirectory
				? RepositoryPatterns.selection(
						repositoryPatterns[commonDirectory],
						commonDirectory
					)
				: undefined,
		[repositoryPatterns, commonDirectory]
	);

	const repositoryPattern = repositoryPatternSelection?.id;
	const repositoryPatternAdjustments = repositoryPatternSelection?.adjustments;

	const repositoryPatternSeed = commonDirectory
		? (repositoryPatternSelection?.seed ??
			RepositoryPatterns.defaultSeed(commonDirectory))
		: undefined;

	const repositoryAppearance = commonDirectory
		? {
				color: repositoryColor,
				pattern: repositoryPattern,
				patternSeed: repositoryPatternSeed,
				patternAdjustments: repositoryPatternAdjustments,
				onChange: (color: string | undefined) => {
					if (appearanceEditing) {
						setAppearanceEditor(
							(current) =>
								current && {
									...current,
									draft: { ...current.draft, color },
									previewColor: undefined,
								}
						);

						return;
					}

					setRepositoryColors((choices) =>
						RepositoryColors.set(choices, commonDirectory, color)
					);
				},
				onPatternChange: (
					pattern: RepositoryPattern | undefined,
					seed?: number,
					adjustments?: RepositoryPatternAdjustments
				) => {
					if (appearanceEditing) {
						setAppearanceEditor(
							(current) =>
								current && {
									...current,
									draft: {
										...current.draft,
										pattern,
										patternSeed: seed ?? current.draft.patternSeed,
										patternAdjustments:
											adjustments ?? current.draft.patternAdjustments,
									},
								}
						);

						return;
					}

					setRepositoryPatterns((choices) =>
						RepositoryPatterns.set(
							choices,
							commonDirectory,
							pattern,
							seed,
							adjustments
						)
					);
				},
			}
		: undefined;

	const displayedColor = appearanceEditing
		? (appearanceEditing.previewColor ?? appearanceEditing.draft.color)
		: repositoryColor;

	const displayedPattern = appearanceEditing
		? appearanceEditing.draft.pattern
		: repositoryPattern;

	const displayedPatternSeed = appearanceEditing
		? appearanceEditing.draft.patternSeed
		: repositoryPatternSeed;

	const displayedPatternAdjustments = appearanceEditing
		? appearanceEditing.draft.patternAdjustments
		: repositoryPatternAdjustments;

	const repositoryTheme = useMemo(
		() => ({
			...workspaceTheme,
			...RepositoryTheme.create(
				workspaceTheme,
				displayedColor,
				displayedPattern,
				displayedPatternSeed,
				displayedPatternAdjustments
			),
		}),
		[
			workspaceTheme,
			displayedColor,
			displayedPattern,
			displayedPatternSeed,
			displayedPatternAdjustments,
		]
	);

	const settingsAppearanceDirectory =
		appearanceTarget?.workspace.repository?.commonDirectory;

	const settingsPattern = settingsAppearanceDirectory
		? RepositoryPatterns.selection(
				repositoryPatterns[settingsAppearanceDirectory],
				settingsAppearanceDirectory
			)
		: undefined;

	const settingsRepositoryAppearance = settingsAppearanceDirectory
		? {
				color: repositoryColors[settingsAppearanceDirectory],
				pattern: settingsPattern?.id,
				patternSeed: settingsPattern?.seed,
				patternAdjustments: settingsPattern?.adjustments,
			}
		: undefined;

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

	const editingDirectory = appearanceEditor?.commonDirectory;

	useEffect(() => {
		if (
			editingDirectory &&
			(settingsOpen || onboardingOpen || editingDirectory !== commonDirectory)
		)
			setAppearanceEditor(undefined);
	}, [editingDirectory, commonDirectory, settingsOpen, onboardingOpen]);

	const [settingsSection, setSettingsSection] =
		useState<SettingsSection>("accounts");

	const [reconnectAccountKey, setReconnectAccountKey] = useState<string>();

	const [preferredAccountKey, setPreferredAccountKey] = useState<string>();
	const [cloneId, setCloneId] = useState<string | null>(null);
	const [folderPickerRoot, setFolderPickerRoot] = useState<string>();

	const [cloneMachine, setCloneMachine] = useState<{
		id: string;
		name: string;
		home: string;
	}>();

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
				(activeSpaceId !== "default"
					? discoveryPreferences.folders
							.filter(
								(path) =>
									MachineLocation.parse(path)?.machineId === selectedMachine
							)
							.map(MachineLocation.display)
					: selectedSavedMachine?.folders
				)?.map((folder) => MachineLocation.encode(selectedMachine, folder)) ??
				[],
			hidden: discoveryPreferences.hidden,
		}),
		[
			selectedSavedMachine,
			selectedMachine,
			activeSpaceId,
			discoveryPreferences.folders,
			discoveryPreferences.hidden,
		]
	);

	const updateRemotePreferences = useCallback(
		(action: SetStateAction<RepositoryDiscoveryPreferences>): void => {
			if (!selectedSavedMachine) return;

			const next =
				typeof action === "function" ? action(remotePreferences) : action;

			if (activeSpaceId !== "default") {
				setDiscoveryPreferences((current) => ({
					...current,
					folders: [
						...current.folders.filter(
							(path) =>
								MachineLocation.parse(path)?.machineId !== selectedMachine
						),
						...next.folders,
					],
					hidden: next.hidden,
				}));

				return;
			}

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
		[
			machines,
			selectedSavedMachine,
			remotePreferences,
			activeSpaceId,
			selectedMachine,
			setDiscoveryPreferences,
		]
	);

	const remoteScan = useCallback<typeof RepositoryDiscovery.scan>(
		async (folders, signal, report, options) =>
			await machines.scan(selectedMachine, folders, signal, report, options),
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

	const discoveryRemote = remoteMachine && !onboardingOpen;

	const discovery = useRepositoryDiscovery({
		cache: discoveryCache,
		enabled:
			((!onboardingOpen && (welcomeVisible || quickSwitcherOpen)) ||
				(onboarding === "repository" && !onboardingClone)) &&
			!settingsOpen &&
			!preview &&
			(!discoveryRemote || !!machineHome),
		scan: preview
			? undefined
			: discoveryRemote
				? remoteScan
				: discoverRepositories,
		preferences: discoveryRemote ? remotePreferences : discoveryPreferences,
		onPreferencesChange: discoveryRemote
			? updateRemotePreferences
			: setDiscoveryPreferences,
		home: discoveryRemote ? remoteHome : undefined,
		remote: discoveryRemote,
		scanHome: onboardingOpen || activeSpaceId === "default",
	});

	const connection = useRepositoryConnection(
		state,
		dispatch,
		readRepository,
		setup,
		discovery.remember
	);

	const quickRepositories = (() => {
		if (!quickSwitcherOpen) return [];

		const opened = visibleTabs.flatMap((tab) => {
			const path =
				tab.workspace.repository?.root ?? tab.workspace.repositoryPath;

			return path && !tab.comparison
				? [{ path, name: tab.name, branch: tab.branch ?? undefined }]
				: [];
		});

		return RepositoryQuickSwitcherModel.catalog(
			[
				...activeSpace.repositories,
				...opened.map((tab) => tab.path),
				...repositoryLibrary.starred,
				...discovery.knownPaths,
			],
			opened,
			(id) => machines.name(id)
		);
	})();

	const welcomePaths = useMemo(
		() =>
			[
				...new Set([
					...activeSpace.repositories,
					...discovery.paths,
					...repositoryLibrary.starred,
				]),
			].filter((path) =>
				remoteMachine
					? MachineLocation.parse(path)?.machineId === selectedMachine
					: !MachineLocation.isRemote(path)
			),
		[
			activeSpace,
			discovery.paths,
			repositoryLibrary,
			remoteMachine,
			selectedMachine,
		]
	);

	const canReadOverview = useCallback(
		(path: string): boolean => {
			const remote = MachineLocation.parse(path);

			return !remote || machines.state(remote.machineId).status === "Connected";
		},
		[machines]
	);

	const workspaceFocus = useRef<number | null>(null);
	const railSettingsButton = useRef<PublicInstance>(null);
	const railAccountButton = useRef<PublicInstance>(null);
	const railViewButtons = useRef(new Map<RepositoryView, PublicInstance>());

	const railFocus = useRef<"settings" | "account" | RepositoryView | null>(
		null
	);

	const rememberWorkspaceFocus = useCallback(() => {
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
	}, [renderer]);

	const openSettings = useCallback(
		(initialForm: "list" | "connect" = "list") => {
			setAppearanceEditor(undefined);

			if (settingsOpen) return;

			if (!customizingRepository) rememberWorkspaceFocus();

			setSettingsView(initialForm);
			setSettingsSection("accounts");
			setReconnectAccountKey(undefined);
		},
		[
			settingsOpen,
			customizingRepository,
			rememberWorkspaceFocus,
			setAppearanceEditor,
			setSettingsView,
			setSettingsSection,
			setReconnectAccountKey,
		]
	);

	const closeSettings = useCallback(() => {
		setSpaceEditor(undefined);
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

			// Live customization can remove the original control by changing repository views.
			if (target == null || !renderer.getElementBounds?.(target))
				target = railSettingsButton.current?.id ?? null;

			if (target !== null && target !== undefined)
				renderer.focusElement?.(target);
		}, 0);
	}, [renderer, setSettingsView, setSpaceEditor]);

	const openAppearance = (
		section: RepositoryAppearanceSection = "color",
		draft?: RepositoryAppearanceValue
	): void => {
		const repository = appearanceTarget?.workspace.repository;

		if (
			!appearanceTarget ||
			!repository ||
			appearanceTarget.workspace.preview ||
			onboardingOpen
		)
			return;

		if (appearanceEditing) {
			setAppearanceEditor((current) => current && { ...current, section });

			return;
		}

		if (!settingsOpen) rememberWorkspaceFocus();

		const selection = RepositoryPatterns.selection(
			repositoryPatterns[repository.commonDirectory],
			repository.commonDirectory
		);

		setAppearanceEditor({
			commonDirectory: repository.commonDirectory,
			name: appearanceTarget.name,
			section,
			draft: draft ?? {
				color: repositoryColors[repository.commonDirectory],
				pattern: selection?.id,
				patternSeed:
					selection?.seed ??
					RepositoryPatterns.defaultSeed(repository.commonDirectory),
				patternAdjustments: selection?.adjustments,
			},
		});
		setSettingsView(null);

		if (state.activeId !== appearanceTarget.id)
			dispatch({ type: "activate", id: appearanceTarget.id });
	};

	const cancelAppearance = (): void => {
		setAppearanceEditor(undefined);
		closeSettings();
	};

	const applyRepositoryAppearance = (
		directory: string,
		value: RepositoryAppearanceValue
	): void => {
		setRepositoryColors((choices) =>
			RepositoryColors.set(choices, directory, value.color)
		);
		setRepositoryPatterns((choices) =>
			RepositoryPatterns.set(
				choices,
				directory,
				value.pattern,
				value.patternSeed,
				value.patternAdjustments
			)
		);
	};

	const saveAppearance = (value: RepositoryAppearanceValue): void => {
		if (!appearanceEditing) return;

		applyRepositoryAppearance(appearanceEditing.commonDirectory, value);
		setAppearanceEditor(undefined);
		closeSettings();
	};

	const onboardingTab = (path?: string): string => {
		if (
			onboardingId &&
			state.tabs.some(
				(tab) =>
					tab.id === onboardingId &&
					(tab.spaceId ?? "default") === activeSpaceId
			)
		) {
			if (path) void connection.read(onboardingId, path);

			return onboardingId;
		}

		const id = `workspace-${state.nextId}`;

		dispatch({ type: "add", path });
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

	const selectSpace = useCallback(
		(id: string) => {
			setQuickSwitcherOpen(false);
			setFolderPickerRoot(undefined);
			setMachineError(null);
			setSettingsView(null);
			dispatch({ type: "space-select", id });
		},
		[
			setQuickSwitcherOpen,
			setFolderPickerRoot,
			setMachineError,
			setSettingsView,
			dispatch,
		]
	);

	const moveSpace = useCallback(
		(direction: SpaceDirection): boolean => {
			if (onboardingOpen || connection.pickingId !== null) return false;

			const destination = WorkspaceSpaces.destination(
				state.spaces ?? [],
				activeSpaceId,
				direction
			);

			if (!destination) return false;

			selectSpace(destination);

			return true;
		},
		[
			onboardingOpen,
			connection.pickingId,
			state.spaces,
			activeSpaceId,
			selectSpace,
		]
	);

	useEffect(() => {
		workspaceShortcuts.set(renderer, (key) => {
			if (onboardingOpen) return;

			if (key === "previous-space" || key === "next-space") {
				moveSpace(key === "previous-space" ? "previous" : "next");

				return;
			}

			if (key === "p") {
				if (!settingsOpen && connection.pickingId === null)
					setQuickSwitcherOpen(true);

				return;
			}

			if (key === "left" || key === "right") {
				let id: string | undefined;

				if (activeTab)
					id = WorkspaceTabsModel.destination(visibleTabs, activeTab.id, key);
				else id = (key === "left" ? visibleTabs.at(-1) : visibleTabs[0])?.id;

				if (id) dispatch({ type: "activate", id });

				return;
			}

			if (/^[1-9]$/.test(key)) {
				const tab = visibleTabs[Number(key) - 1];

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
		moveSpace,
		state.tabs,
		visibleTabs,
		state.nextId,
		activeTab,
		workspace,
		connection,
		onboardingOpen,
		settingsOpen,
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
		workspace && (workspace.view === "history" || workspace.view === "stashes")
			? RepositoryWorkspaceModel.revision(workspace, workspace.view)
			: undefined;

	const selectedId = workspace
		? workspace.view === "changes"
			? workspace.views.changes.selectedId
			: workspace.view === "graph"
				? null
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
		setIgnoredRoot(null);

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

	const manageSpaces = () => {
		openSettings();
		setSettingsSection("spaces");
	};

	const swipeSpace = (direction: SpaceDirection): void => {
		if (moveSpace(direction)) completeTip("space-swipe");
	};

	const spaceSwitcher = (disabled: boolean) => (
		<SpaceSwitcher
			anchorRef={spaceTourAnchor}
			onOpenChange={setSpaceMenuOpen}
			disabled={disabled}
			spaces={state.spaces ?? []}
			activeId={activeSpace.id}
			onSelect={selectSpace}
			onCreate={() => {
				manageSpaces();
				setSpaceEditor({});
			}}
			onManage={manageSpaces}
		/>
	);

	const spacesSettings = (
		<SpacesSettings
			editor={spaceEditor}
			onCancel={() => setSpaceEditor(undefined)}
			onSave={(value) => {
				if (spaceEditor?.space)
					dispatch({ type: "space-edit", id: spaceEditor.space.id, ...value });
				else
					dispatch({
						type: "space-create",
						space: { id: randomUUID(), ...value, repositories: [] },
						discovery: discoveryPreferences,
						library: repositoryLibrary,
					});

				setSpaceEditor(undefined);
			}}
			tabCounts={Object.fromEntries(
				(state.spaces ?? []).map((space) => [
					space.id,
					state.tabs.filter((tab) => (tab.spaceId ?? "default") === space.id)
						.length,
				])
			)}
			spaces={state.spaces ?? []}
			activeId={activeSpace.id}
			onCreate={() => setSpaceEditor({})}
			onEdit={(space) => setSpaceEditor({ space })}
			onSelect={selectSpace}
			onDelete={(id) => dispatch({ type: "space-delete", id })}
		/>
	);

	const closeNotice = mutations.closeProtection.requested ? (
		<RepositoryCloseNotice
			state={state}
			onDismiss={mutations.closeProtection.dismiss}
			onStop={mutations.cancelSync}
		/>
	) : null;

	const tourContext = {
		onboardingComplete: !onboardingOpen,
		hasRepositoryTab: !!workspace?.repository,
		spaceCount: state.spaces?.length ?? 1,
		blocked: false,
	};

	const pendingTip = GuidedTour.current(tips, tourContext);

	tourContext.blocked =
		preview ||
		settingsOpen ||
		!!spaceEditor ||
		quickSwitcherOpen ||
		!!folderPickerRoot ||
		onboardingBusy ||
		popoverOpen ||
		spaceMenuOpen ||
		railMenuOpen ||
		!!appearanceEditor ||
		!!closeNotice ||
		(tabMenuOpen && (pendingTip !== "worktrees" || tabMenuBusy));
	activeTourStep.current = GuidedTour.current(tips, tourContext);

	return (
		<RepositoryAvatarContext value={avatars}>
			<div
				textScale={(theme.typography?.fontSize ?? 12) / 12}
				style={{
					display: "flex",
					position: "relative",
					fontFamily: theme.typography?.fontFamily || undefined,
					flexDirection: "column",
					width: "100%",
					height: "100%",
				}}
			>
				<GuidedTourLayer
					tips={tips}
					context={tourContext}
					repositoryKey={
						workspace?.repository
							? `${activeTab?.id}:${workspace.repository.root}`
							: null
					}
					tabAnchor={tabTourAnchor}
					worktreesAnchor={worktreesTourAnchor}
					spaceAnchor={spaceTourAnchor}
					railAnchor={railTourAnchor}
					onSkip={skipTour}
				/>

				<AppShell
					palette={repositoryTheme}
					hidden={settingsOpen || onboardingOpen}
					rail={
						settingsOpen || onboardingOpen ? undefined : (
							<WorkspaceRail
								tourAnchorRef={railTourAnchor}
								onMenuOpenChange={setRailMenuOpen}
								ignoredHistory={
									workspace?.repository &&
									ignoredStatus?.data?.preferences.enabled
										? {
												active: ignoredVisible,
												onOpen: () =>
													setIgnoredRoot(workspace.repository?.root ?? null),
											}
										: undefined
								}
								spaceSwitcher={spaceSwitcher}
								onSpaceSwipe={
									(state.spaces?.length ?? 1) > 1 ? swipeSpace : undefined
								}
								repositoryAppearance={repositoryAppearance}
								onAppearance={openAppearance}
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
										onCompare={(data, intent) => {
											const repository = workspace.repository;

											if (!repository?.head) return;

											dispatch({
												type: "compare",
												id: activeTab.id,
												comparison:
													intent === "sync" && repository.branchName
														? ComparisonReader.syncRequest(
																repository.root,
																repository.head,
																repository.branchName,
																data
															)
														: {
																root: repository.root,
																base: repository.head,
																baseName: repository.branchName ?? "HEAD",
																branches: data.branches.branches.map(
																	(item) => ({
																		value: item.fullName,
																		label: item.name,
																		oid: item.oid,
																	})
																),
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
						!activeTab.comparison &&
						workspace.view !== "graph" &&
						!ignoredVisible ? (
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
								onCancelCommit={() => mutations.cancelCommit(activeTab.id)}
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
							onTourAnchor={tourTabChanged}
							onTabMenuOpenChange={tabMenuChanged}
							worktreesAnchorRef={worktreesTourAnchor}
							onWorktreesOpen={worktreesOpened}
							onMenuBusyChange={setTabMenuBusy}
							state={{ ...state, tabs: visibleTabs }}
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
					{folderPickerRoot ? (
						<RemoteFolderPicker
							location={folderPickerRoot}
							title="Open repository"
							confirmLabel="Open folder"
							onClose={() => setFolderPickerRoot(undefined)}
							onSelect={(path) => {
								setFolderPickerRoot(undefined);
								const existing = visibleTabs.find(
									(tab) => tab.workspace.repository?.root === path
								);

								if (existing) dispatch({ type: "activate", id: existing.id });
								else if (activeTab) void connection.read(activeTab.id, path);
								else dispatch({ type: "add", path });
							}}
						/>
					) : null}
					{cloneTab ? (
						<RepositoryCloneView
							key={cloneTab.id}
							machine={cloneMachine}
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
							key={activeSpaceId}
							readRepository={readRepository}
							canReadRepository={canReadOverview}
							openWorkspaces={visibleTabs
								.filter((tab) => !tab.comparison)
								.map((tab) => tab.workspace)}
							paths={welcomePaths}
							remote={remoteMachine}
							machines={
								!preview ? (
									<MachinesPanel
										service={machines}
										selected={selectedMachine}
										onConnected={() => discovery.rescan()}
										onSelect={(id) => {
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
							savedPaths={activeSpace.repositories}
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
								if (remoteHome) {
									setFolderPickerRoot(remoteHome);

									return;
								}

								const id = activeTab?.id ?? `workspace-${state.nextId}`;

								if (!activeTab) dispatch({ type: "add" });

								void connection.open(id);
							}}
							onOpenRecent={(path) => {
								const existing = visibleTabs.find(
									(tab) => tab.workspace.repository?.root === path
								);

								if (existing) dispatch({ type: "activate", id: existing.id });
								else if (activeTab) void connection.read(activeTab.id, path);
								else dispatch({ type: "add", path });
							}}
							actions={
								<RepositorySetupActions
									machineRoot={remoteHome}
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

										setCloneMachine(
											selectedSavedMachine && machineHome
												? {
														id: selectedSavedMachine.id,
														name: selectedSavedMachine.name,
														home: machineHome,
													}
												: undefined
										);
										setCloneId(id);
									}}
									onBegin={() => {
										if (!activeTab) dispatch({ type: "add" });
									}}
									disabled={
										(remoteMachine && !machineHome) ||
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
							fileTreeScope={activeTab.id}
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
					) : activeTab?.comparison?.intent === "sync" && workspace ? (
						<RepositorySyncReview
							fileTreeScope={activeTab.id}
							key={`${activeTab.id}:${activeTab.comparison.base}:${activeTab.comparison.incoming}:${activeTab.comparison.branches.map((branch) => branch.oid).join(":")}`}
							request={activeTab.comparison}
							state={workspace}
							onClose={() => dispatch({ type: "compare", id: activeTab.id })}
							onIntegrate={(choice) =>
								mutations.changeBranch(activeTab.id, choice)
							}
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
							fileTreeScope={activeTab.id}
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
					) : ignoredVisible && workspace?.repository ? (
						<IgnoredHistoryView
							key={`ignored:${workspace.repository.root}`}
							repository={workspace.repository}
							history={ignoredHistory}
							status={ignoredStatus}
							onRefresh={() =>
								ignoredHistories.refresh(workspace.repository?.root ?? "")
							}
							onSettings={() => {
								openSettings();
								setSettingsSection("repository-ignored-history");
							}}
							settings={diffSettings}
							onSettingsChange={setDiffSettings}
							disabled={
								workspace.loading || RepositoryWorkspaceModel.isBusy(workspace)
							}
						/>
					) : activeTab &&
					  workspace?.repository &&
					  workspace.view === "graph" ? (
						<RepositoryGraph
							fileTreeScope={activeTab.id}
							key={`graph:${activeTab.id}:${workspace.repository.root}`}
							root={workspace.repository.root}
							head={workspace.repository.head}
							version={workspace.metadataVersion ?? 0}
							disabled={
								workspace.loading || RepositoryWorkspaceModel.isBusy(workspace)
							}
							readReferences={readGraphReferences}
							readPage={readGraphPage}
							readCommitFiles={readCommitFiles}
							readDiff={readDiff}
							previewCache={previewCache}
							diffSettings={diffSettings}
							onDiffSettingsChange={setDiffSettings}
						/>
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
							onResolve={(hash, side, expectedSideOid) =>
								mutations.resolve(
									activeTab.id,
									comparison.path,
									hash,
									side,
									expectedSideOid
								)
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
				<RepositoryQuickSwitcher
					open={quickSwitcherOpen}
					items={quickRepositories}
					onClose={() => setQuickSwitcherOpen(false)}
					onOpen={(path) => {
						const existing = visibleTabs.find(
							(tab) =>
								!tab.comparison &&
								(tab.workspace.repository?.root ??
									tab.workspace.repositoryPath) === path
						);

						if (existing) dispatch({ type: "activate", id: existing.id });
						else dispatch({ type: "add", path });
					}}
				/>
				{onboarding !== "complete" ? (
					<Onboarding
						step={onboarding}
						active={!settingsOpen}
						busy={onboardingBusy}
						spaceName={activeSpace.name}
						spacesView={
							<OnboardingSpaces
								spaces={state.spaces ?? []}
								activeId={activeSpaceId}
								disabled={onboardingBusy || !!spaceEditor || settingsOpen}
								onCreate={() => setSpaceEditor({})}
								onCreatePreset={(preset) =>
									dispatch({
										type: "space-create",
										space: { id: randomUUID(), ...preset, repositories: [] },
										discovery: discoveryPreferences,
										library: repositoryLibrary,
									})
								}
								onEdit={(space) => setSpaceEditor({ space })}
							/>
						}
						error={onboardingWorkspace?.error ?? undefined}
						discovery={discovery}
						onOpenRepository={(path) => {
							onboardingTab(path);
						}}
						onStep={setOnboarding}
						onSkip={() => {
							void DesktopAnalytics.capture({ name: "onboarding_completed" });
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
				{spaceEditor && onboardingOpen ? (
					<SpaceManager
						presentation="dialog"
						key={spaceEditor.space?.id ?? "new"}
						space={spaceEditor.space}
						onClose={() => setSpaceEditor(undefined)}
						onSave={(value) => {
							if (spaceEditor.space)
								dispatch({
									type: "space-edit",
									id: spaceEditor.space.id,
									...value,
								});
							else {
								dispatch({
									type: "space-create",
									space: { id: randomUUID(), ...value, repositories: [] },
									discovery: discoveryPreferences,
									library: repositoryLibrary,
								});
								setSettingsView(null);
							}

							setSpaceEditor(undefined);
						}}
					/>
				) : null}
				{settingsOpen ? (
					<AccountsSettings
						onReplayTips={() => {
							setTips({ completed: [] });
							closeSettings();
						}}
						ignoredHistory={
							workspace?.repository
								? {
										repository: workspace.repository,
										history: ignoredHistory,
										status: ignoredStatus,
										active: ignoredVisible,
										onOpen: () => {
											setIgnoredRoot(workspace.repository?.root ?? null);
											closeSettings();
										},
										onRefresh: () =>
											ignoredHistories.refresh(
												workspace.repository?.root ?? ""
											),
									}
								: undefined
						}
						spaceSwitcher={spaceSwitcher}
						onSpaceSwipe={
							(state.spaces?.length ?? 1) > 1 ? swipeSpace : undefined
						}
						spacesSettings={spacesSettings}
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
						autoIncludeChanges={state.autoIncludeChanges ?? false}
						onAutoIncludeChanges={(enabled) =>
							dispatch({ type: "auto-include-changes", enabled })
						}
						readGitSettings={readGitSettings}
						repositoryAppearance={settingsRepositoryAppearance}
						repositoryAppearanceName={appearanceTarget?.name}
						onCustomizeRepositoryAppearance={(draft) =>
							openAppearance("color", draft)
						}
						onChangeRepositoryAppearance={
							settingsAppearanceDirectory
								? (value) =>
										applyRepositoryAppearance(
											settingsAppearanceDirectory,
											value
										)
								: undefined
						}
						writeGitSettings={mutations.saveSettings}
					>
						{closeNotice}
					</AccountsSettings>
				) : null}
				{appearanceEditing &&
				repositoryAppearance &&
				!settingsOpen &&
				!onboardingOpen ? (
					<RepositoryAppearanceEditor
						key={appearanceEditing.commonDirectory}
						name={appearanceEditing.name}
						{...appearanceEditing.draft}
						section={appearanceEditing.section}
						onSectionChange={(section) =>
							setAppearanceEditor(
								(current) => current && { ...current, section }
							)
						}
						onChange={repositoryAppearance.onChange}
						onPatternChange={repositoryAppearance.onPatternChange}
						onPreview={(previewColor) =>
							setAppearanceEditor(
								(current) => current && { ...current, previewColor }
							)
						}
						onDone={saveAppearance}
						onCancel={cancelAppearance}
						onBack={() => {
							setAppearanceEditor(undefined);
							setSettingsSection("repository-appearance");
							setSettingsView("list");
						}}
					/>
				) : null}
				{syncAccount.dialog}
			</div>
		</RepositoryAvatarContext>
	);
}
