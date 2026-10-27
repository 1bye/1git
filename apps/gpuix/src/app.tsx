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
import { RepositoryOverviews } from "./feature/repository-discovery/repository-overviews";
import {
	repositoryPaletteActions,
	type RepositoryPaletteActionId,
} from "./feature/repository-discovery/repository-palette-actions";
import { repositoryPaletteSyncChoice } from "./feature/repository-discovery/repository-palette-sync";
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
import { NativeClipboard } from "./platform/clipboard";
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
import { applicationBundlePath } from "./launcher/launcher-installation";
import type { LauncherRequestHandler } from "./launcher/launcher-service";
import type { LauncherRequest } from "./launcher/launcher-protocol";
import type { ApplicationLauncherIntent } from "./feature/settings/application-settings";

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
	subscribeLauncherRequests,
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
	/** Process-owned launcher subscription; tests provide isolated queues. */
	subscribeLauncherRequests?: (listener: LauncherRequestHandler) => () => void;
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
	const allTabsRef = useRef(state.tabs);

	allTabsRef.current = state.tabs;

	const activeSpace = useMemo(() => {
		const space = WorkspaceSpaces.current(state);

		if (!space)
			throw new Error("The active space is missing from this session.");

		return space;
	}, [state]);

	const activeSpaceId = activeSpace.id;
	const activeSpaceIdRef = useRef(activeSpaceId);

	activeSpaceIdRef.current = activeSpaceId;
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
	const [quickSwitcherSession, setQuickSwitcherSession] = useState(0);
	const quickSwitcherTarget = useRef<string | null>(null);

	const [paletteActionError, setPaletteActionError] = useState<string | null>(
		null
	);

	const [workspaceMenuRequest, setWorkspaceMenuRequest] = useState<{
		id: string;
		intent: "new" | "switch";
	} | null>(null);

	const stashRequestSequence = useRef(0);

	const [stashCreateRequest, setStashCreateRequest] = useState<{
		id: string;
		sequence: number;
	} | null>(null);

	useEffect(() => {
		if (!quickSwitcherOpen) quickSwitcherTarget.current = null;
	}, [quickSwitcherOpen]);

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
	const settingsTab = state.tabs.find((tab) => tab.kind === "settings");
	const settingsOpen = activeTab?.kind === "settings";
	const settingsContextId = useRef<string | null>(null);
	const settingsOriginFocus = useRef<number | null>(null);
	const lastAppearanceTab = useRef<string | undefined>(undefined);
	const appearanceOriginFocus = useRef<number | null>(null);
	const appearanceSettingsButton = useRef<PublicInstance | null>(null);

	const settingsContextTab =
		state.tabs.find((tab) => tab.id === settingsContextId.current) ??
		(settingsOpen
			? (visibleTabs.find(
					(tab) =>
						tab.id === lastAppearanceTab.current && tab.kind === "repository"
				) ??
				[...visibleTabs].reverse().find((tab) => tab.kind === "repository"))
			: undefined);

	const settingsContextWorkspace = settingsContextTab?.workspace;
	// Settings is a real tab, but its repository context remains mounted as the
	// content owner so native editors and diff scroll state keep their identity.
	const contentTab = settingsOpen ? settingsContextTab : activeTab;
	const contentWorkspace = settingsOpen ? settingsContextWorkspace : workspace;

	useEffect(() => {
		if (
			settingsContextId.current &&
			!state.tabs.some((tab) => tab.id === settingsContextId.current)
		)
			settingsContextId.current = null;

		if (!settingsOpen || settingsContextId.current) return;

		settingsContextId.current =
			visibleTabs.find(
				(tab) =>
					tab.id === lastAppearanceTab.current && tab.kind === "repository"
			)?.id ??
			visibleTabs.find(
				(tab) =>
					tab.kind === "repository" &&
					(tab.spaceId ?? "default") === activeSpaceId
			)?.id ??
			null;
	}, [activeSpaceId, settingsOpen, state.tabs, visibleTabs]);
	const commonDirectory = contentWorkspace?.repository?.commonDirectory;

	useLayoutEffect(() => {
		if (activeTab?.workspace.repository && !activeTab.workspace.preview)
			lastAppearanceTab.current = activeTab.id;
	}, [activeTab]);

	const appearanceTarget =
		(settingsOpen ? settingsContextWorkspace : workspace)?.repository &&
		!(settingsOpen ? settingsContextWorkspace : workspace)?.preview
			? settingsOpen
				? settingsContextTab
				: activeTab
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

	const ignoredStatus = contentWorkspace?.repository
		? ignoredHistories.statuses[contentWorkspace.repository.root]
		: undefined;

	const ignoredVisible =
		!!contentWorkspace?.repository &&
		ignoredRoot === contentWorkspace.repository.root &&
		!!ignoredStatus?.data?.preferences.enabled &&
		!contentTab?.comparison;

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

	const settingsAppearanceDirectory = (
		settingsTab
			? settingsContextWorkspace?.repository
			: appearanceTarget?.workspace.repository
	)?.commonDirectory;

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

	const [settingsForm, setSettingsForm] = useState<"list" | "connect">("list");
	const [settingsBusy, setSettingsBusy] = useState(false);

	const editingDirectory = appearanceEditor?.commonDirectory;

	useEffect(() => {
		if (
			editingDirectory &&
			(onboardingOpen || editingDirectory !== commonDirectory)
		)
			setAppearanceEditor(undefined);
	}, [editingDirectory, commonDirectory, settingsOpen, onboardingOpen]);

	const [settingsSection, setSettingsSection] =
		useState<SettingsSection>("accounts");

	const [applicationSettingsIntent, setApplicationSettingsIntent] =
		useState<ApplicationLauncherIntent>();

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
		!contentWorkspace?.preview &&
		!contentWorkspace?.repository &&
		!contentWorkspace?.repositoryPath;

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

	const readTabRepository = useCallback(
		(id: string, path: string): void => {
			if (state.tabs.find((tab) => tab.id === id)?.kind === "empty")
				dispatch({ type: "fill", id, path });

			void connection.read(id, path);
		},
		[connection, dispatch, state.tabs]
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

	const repositoryOverviews = useMemo(
		() => new RepositoryOverviews(readRepository, canReadOverview),
		[canReadOverview, readRepository]
	);

	useEffect(() => {
		repositoryOverviews.setOpen(
			state.tabs
				.filter((tab) => tab.kind === "repository")
				.map((tab) => tab.workspace)
		);
	}, [repositoryOverviews, state.tabs]);

	useEffect(() => () => repositoryOverviews.dispose(), [repositoryOverviews]);

	const paletteActions = useMemo(
		() =>
			repositoryPaletteActions(keybindOverrides, {
				hasRepository:
					activeTab?.kind === "repository" &&
					!!workspace?.repository &&
					!workspace.preview,
				canFetch:
					activeTab?.kind === "repository" &&
					!!workspace?.repository &&
					!workspace.preview &&
					!workspace.loading &&
					!workspace.error &&
					!RepositoryWorkspaceModel.isBusy(workspace),
				canBranch:
					activeTab?.kind === "repository" &&
					!!workspace?.repository &&
					!workspace.preview &&
					!workspace.loading &&
					!workspace.error &&
					!RepositoryWorkspaceModel.isBusy(workspace),
				canSynchronize:
					activeTab?.kind === "repository" &&
					!!workspace?.repository &&
					RepositoryWorkspaceModel.canSync(workspace),
				canStash:
					activeTab?.kind === "repository" &&
					!!workspace?.repository &&
					!workspace.preview &&
					!workspace.loading &&
					!workspace.error &&
					workspace.entries.changes.length > 0 &&
					!RepositoryWorkspaceModel.isBusy(workspace),
				canReveal:
					activeTab?.kind === "repository" &&
					!!workspace?.repository &&
					!MachineLocation.isRemote(workspace.repository.root),
				canClose:
					!!activeTab &&
					!!workspace &&
					!settingsBusy &&
					!RepositoryWorkspaceModel.isBusy(workspace),
				launcherAvailable: applicationBundlePath() !== undefined,
			}),
		[activeTab, keybindOverrides, settingsBusy, workspace]
	);

	const openSettings = useCallback(
		(initialForm: "list" | "connect" = "list") => {
			setAppearanceEditor(undefined);

			const existingSettings = WorkspaceTabsModel.settingsId(state);

			if (!existingSettings)
				settingsOriginFocus.current = renderer.getFocusedElementId?.() ?? null;

			if (activeTab?.kind === "repository")
				settingsContextId.current = activeTab.id;
			else if (!settingsOpen) settingsContextId.current = null;

			if (initialForm === "connect") {
				setSettingsForm(initialForm);
				setSettingsSection("accounts");
				setReconnectAccountKey(undefined);
			}

			dispatch({ type: "open-settings", form: initialForm });
		},
		[
			activeTab,
			dispatch,
			renderer,
			state,
			settingsOpen,
			setAppearanceEditor,
			setSettingsForm,
			setSettingsSection,
			setReconnectAccountKey,
		]
	);

	const closeSettings = useCallback(() => {
		if (settingsBusy) return;

		setApplicationSettingsIntent(undefined);
		setSpaceEditor(undefined);
		const id = WorkspaceTabsModel.settingsId(state);

		if (!id) return;

		const contextId = settingsContextId.current;

		dispatch({ type: "close", id });

		if (contextId && state.tabs.some((tab) => tab.id === contextId))
			dispatch({ type: "activate", id: contextId });

		const target = settingsOriginFocus.current;

		settingsOriginFocus.current = null;
		setTimeout(() => {
			if (target !== null && renderer.getElementBounds?.(target))
				renderer.focusElement?.(target);
		}, 0);
	}, [
		dispatch,
		renderer,
		setApplicationSettingsIntent,
		setSpaceEditor,
		settingsBusy,
		state,
	]);

	const closeActiveTab = useCallback((): void => {
		if (
			!activeTab ||
			!workspace ||
			settingsBusy ||
			RepositoryWorkspaceModel.isBusy(workspace)
		)
			return;

		if (activeTab.kind === "settings") closeSettings();
		else dispatch({ type: "close", id: activeTab.id });
	}, [activeTab, closeSettings, dispatch, settingsBusy, workspace]);

	const reportPaletteActionError = useCallback(
		(cause: unknown): void => {
			setPaletteActionError(
				cause instanceof Error
					? cause.message
					: "The command could not be completed."
			);
			setQuickSwitcherOpen(true);
		},
		[setQuickSwitcherOpen, setPaletteActionError]
	);

	const fetchActiveRepository = useCallback(async (): Promise<void> => {
		if (
			activeTab?.kind !== "repository" ||
			!workspace?.repository ||
			workspace.preview ||
			workspace.loading ||
			RepositoryWorkspaceModel.isBusy(workspace)
		)
			return;

		if (workspace.repository.remoteCount === 0) {
			await connection.refresh(activeTab.id);

			return;
		}

		await mutations.fetch(activeTab.id);
	}, [activeTab, connection, mutations, workspace]);

	const runPaletteAction = useCallback(
		(id: RepositoryPaletteActionId): void => {
			setQuickSwitcherOpen(false);

			if (id === "new-tab") {
				const target = `workspace-${state.nextId}`;

				quickSwitcherTarget.current = target;
				dispatch({ type: "add", kind: "empty" });
				setQuickSwitcherSession((session) => session + 1);
				setQuickSwitcherOpen(true);

				return;
			}

			if (id === "close-tab") {
				closeActiveTab();

				return;
			}

			if (id === "settings") {
				openSettings();

				return;
			}

			if (id === "install-launcher" || id === "uninstall-launcher") {
				setApplicationSettingsIntent(
					id === "install-launcher" ? "install" : "uninstall"
				);
				openSettings();
				setSettingsSection("application");

				return;
			}

			if (id.startsWith("settings:")) {
				openSettings();
				setSettingsSection(id.slice("settings:".length) as SettingsSection);

				return;
			}

			const repository = workspace?.repository;

			if (!activeTab || activeTab.kind !== "repository" || !repository) return;

			const syncExplicit = async (kind: "pull" | "push"): Promise<void> => {
				const result = await readBranches(
					repository.root,
					new AbortController().signal
				);

				if (!result.ok) throw new Error(result.error.message);

				const current = result.value.branches.branches.find(
					(branch) =>
						branch.type === "local" &&
						branch.checkedOut &&
						branch.name === repository.branchName
				);

				const choice = current && repositoryPaletteSyncChoice(kind, current);

				if (!choice) throw new Error("This branch has no configured upstream.");

				if (!repository.head || !repository.branchName)
					throw new Error("This branch is not ready to synchronize.");

				const error = await mutations.synchronize(
					activeTab.id,
					choice,
					undefined,
					{
						expectedHead: repository.head,
						expectedBranch: repository.branchName,
					}
				);

				if (error) throw new Error(error);
			};

			switch (id) {
				case "fetch":
					void fetchActiveRepository();

					return;
				case "pull":
				case "push":
					void syncExplicit(id).catch(reportPaletteActionError);

					return;
				case "new-branch":
				case "switch-branch":
					setWorkspaceMenuRequest({
						id: activeTab.id,
						intent: id === "new-branch" ? "new" : "switch",
					});

					return;
				case "stash":
					setStashCreateRequest({
						id: activeTab.id,
						sequence: ++stashRequestSequence.current,
					});
					dispatch({
						type: "workspace",
						id: activeTab.id,
						action: { type: "view", view: "stashes" },
					});

					return;
				case "external-editor":
					void externalEditors
						.openDirectory(repository.root)
						.catch(reportPaletteActionError);

					return;
				case "finder":
					void RepositoryFileActions.revealRepository(repository.root).catch(
						reportPaletteActionError
					);

					return;
				case "copy-path":
					void NativeClipboard.write(repository.root).catch(
						reportPaletteActionError
					);

					return;
			}
		},
		[
			activeTab,
			closeActiveTab,
			dispatch,
			externalEditors,
			fetchActiveRepository,
			mutations,
			openSettings,
			reportPaletteActionError,
			readBranches,
			setApplicationSettingsIntent,
			setQuickSwitcherOpen,
			setSettingsSection,
			state.nextId,
			workspace,
		]
	);

	const restoreAppearanceFocus = useCallback(() => {
		const target = appearanceOriginFocus.current;

		appearanceOriginFocus.current = null;
		setTimeout(() => {
			if (target !== null && renderer.getElementBounds?.(target)) {
				renderer.focusElement?.(target);

				return;
			}

			if (appearanceSettingsButton.current)
				renderer.focusElement?.(appearanceSettingsButton.current.id);
		}, 0);
	}, [renderer]);

	const returnFromAppearance = useCallback(() => {
		setAppearanceEditor(undefined);
		restoreAppearanceFocus();
	}, [restoreAppearanceFocus, setAppearanceEditor]);

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

		appearanceOriginFocus.current = renderer.getFocusedElementId?.() ?? null;

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

		if (state.activeId !== appearanceTarget.id)
			dispatch({ type: "activate", id: appearanceTarget.id });
	};

	const cancelAppearance = (): void => {
		returnFromAppearance();
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
		returnFromAppearance();
	};

	const onboardingTab = useCallback(
		(path?: string): string => {
			if (
				onboardingId &&
				state.tabs.some(
					(tab) =>
						tab.id === onboardingId &&
						(tab.spaceId ?? "default") === activeSpaceId
				)
			) {
				if (path) readTabRepository(onboardingId, path);

				return onboardingId;
			}

			const id = `workspace-${state.nextId}`;

			dispatch({ type: "add", path });
			setOnboardingId(id);

			return id;
		},
		[
			activeSpaceId,
			dispatch,
			onboardingId,
			readTabRepository,
			setOnboardingId,
			state.nextId,
			state.tabs,
		]
	);

	const launcherMountedRef = useRef(false);

	const openLauncherRequest = async (
		request: LauncherRequest,
		signal: AbortSignal,
		requestSpaceId: string
	): Promise<void> => {
		if (signal.aborted || !launcherMountedRef.current) return;

		renderer.activateWindow?.();

		if (request.path === undefined) return;

		let opened: Awaited<ReturnType<typeof readRepository>> | undefined;

		try {
			opened = await readRepository(request.path, signal);
		} catch {
			opened = undefined;
		}

		if (signal.aborted || !launcherMountedRef.current) return;

		if (opened?.ok) {
			const root = opened.value.repository.root;

			const existing = allTabsRef.current.find(
				(tab) =>
					!tab.comparison &&
					(tab.workspace.repository?.root ?? tab.workspace.repositoryPath) ===
						root
			);

			if (existing) {
				const owner = existing.spaceId ?? "default";

				dispatch({ type: "space-select", id: owner });

				dispatch({ type: "activate", id: existing.id });
			} else
				dispatch({
					type: "open-worktree",
					snapshot: opened.value,
					spaceId: requestSpaceId,
				});

			setOnboarding("complete");
			setOnboardingId(null);
			setOnboardingClone(false);

			return;
		}

		if (activeSpaceIdRef.current !== requestSpaceId) return;

		if (onboardingOpen) {
			onboardingTab(request.path);
			setOnboarding("repository");

			return;
		}

		if (activeTab?.kind === "empty")
			readTabRepository(activeTab.id, request.path);
		else dispatch({ type: "add", path: request.path });
	};

	const openLauncherRequestRef = useRef(openLauncherRequest);

	openLauncherRequestRef.current = openLauncherRequest;
	const launcherRequestTail = useRef(Promise.resolve());

	useEffect(() => {
		if (preview || !subscribeLauncherRequests) return;

		launcherMountedRef.current = true;
		const controller = new AbortController();

		const unsubscribe = subscribeLauncherRequests((request) => {
			const requestSpaceId = activeSpaceIdRef.current ?? "default";

			launcherRequestTail.current = launcherRequestTail.current
				.then(() =>
					openLauncherRequestRef.current(
						request,
						controller.signal,
						requestSpaceId
					)
				)
				.catch((error: unknown) => {
					if (controller.signal.aborted || !launcherMountedRef.current) return;

					setPaletteActionError(
						error instanceof Error
							? error.message
							: "Could not open the requested repository."
					);
					setQuickSwitcherOpen(true);
				});
		});

		return () => {
			launcherMountedRef.current = false;
			controller.abort();
			unsubscribe();
		};
	}, [preview, subscribeLauncherRequests]);

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
			if (spaceEditor) return;

			setQuickSwitcherOpen(false);
			setFolderPickerRoot(undefined);
			setMachineError(null);

			if (!settingsOpen) setSettingsForm("list");

			dispatch({ type: "space-select", id });
		},
		[
			setQuickSwitcherOpen,
			setFolderPickerRoot,
			setMachineError,
			spaceEditor,
			settingsOpen,
			setSettingsForm,
			dispatch,
		]
	);

	const moveSpace = useCallback(
		(direction: SpaceDirection): boolean => {
			if (onboardingOpen || spaceEditor || connection.pickingId !== null)
				return false;

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
			spaceEditor,
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
				if (connection.pickingId !== null) return;

				quickSwitcherTarget.current =
					activeTab?.kind === "empty" ? activeTab.id : null;
				setPaletteActionError(null);
				setQuickSwitcherSession((session) => session + 1);
				setQuickSwitcherOpen(true);

				return;
			}

			if (key === "t") {
				if (connection.pickingId !== null) return;

				const id = `workspace-${state.nextId}`;

				quickSwitcherTarget.current = id;
				dispatch({ type: "add", kind: "empty" });
				setPaletteActionError(null);
				setQuickSwitcherSession((session) => session + 1);
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

				const reuseTab =
					activeTab && activeTab.kind !== "settings" && !workspace?.repository;

				const id = reuseTab ? activeTab.id : `workspace-${state.nextId}`;

				if (id !== activeTab?.id)
					dispatch({
						type: "add",
						kind: activeTab?.kind === "settings" ? "empty" : undefined,
					});

				void connection.open(id);
			} else if (activeTab && workspace) {
				if (key === "w") closeActiveTab();

				if (key === "r") void fetchActiveRepository();
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
		closeActiveTab,
		fetchActiveRepository,
	]);

	const workspaceAction = useCallback(
		(id: string, action: RepositoryWorkspaceAction): void =>
			dispatch({ type: "workspace", id, action }),
		[]
	);

	const history = useRepositoryHistory(
		contentTab?.id,
		contentWorkspace,
		workspaceAction,
		readHistory,
		readCommitFiles,
		readTags,
		readHistoryCount,
		readUnpushedCommits
	);

	const stashes = useRepositoryStashes(
		contentTab?.id,
		contentWorkspace,
		workspaceAction,
		readStashes,
		readStashFiles
	);

	const revision =
		contentWorkspace &&
		(contentWorkspace.view === "history" || contentWorkspace.view === "stashes")
			? RepositoryWorkspaceModel.revision(
					contentWorkspace,
					contentWorkspace.view
				)
			: undefined;

	const selectedId = contentWorkspace
		? contentWorkspace.view === "changes"
			? contentWorkspace.views.changes.selectedId
			: contentWorkspace.view === "graph"
				? null
				: contentWorkspace.views[contentWorkspace.view].files.selectedId
		: null;

	const files =
		contentWorkspace?.view === "changes"
			? contentWorkspace.entries.changes
			: revision?.files;

	const selected = files?.find((file) => file.id === selectedId);
	const comparison = selected?.change ?? selected?.commitFile;

	const settingsRepositoryView =
		settingsContextWorkspace &&
		(settingsContextWorkspace.repository ||
			settingsContextWorkspace.preview ||
			settingsContextWorkspace.repositoryPath) &&
		!settingsContextTab?.comparison
			? settingsContextWorkspace.view
			: undefined;

	const repositoryView = settingsOpen
		? settingsRepositoryView
		: contentWorkspace &&
			  (contentWorkspace.repository ||
					contentWorkspace.preview ||
					contentWorkspace.repositoryPath) &&
			  !contentTab?.comparison
			? contentWorkspace.view
			: undefined;

	const selectRepositoryView = (view: RepositoryView) => {
		setIgnoredRoot(null);

		const target = settingsOpen ? settingsContextTab : activeTab;

		if (!target) return;

		dispatch({
			type: "workspace",
			id: target.id,
			action: { type: "view", view },
		});

		if (settingsOpen) dispatch({ type: "activate", id: target.id });
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
				else {
					dispatch({
						type: "space-create",
						space: { id: randomUUID(), ...value, repositories: [] },
						discovery: discoveryPreferences,
						library: repositoryLibrary,
					});

					if (settingsOpen) dispatch({ type: "open-settings" });
				}

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

	const settingsIgnoredRepository =
		settingsContextWorkspace?.repository ?? workspace?.repository;

	const settingsIgnoredStatus = settingsContextWorkspace?.repository
		? ignoredHistories.statuses[settingsContextWorkspace.repository.root]
		: ignoredStatus;

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

	const settingsContent = settingsTab ? (
		<AccountsSettings
			key={settingsTab.id}
			active={settingsOpen}
			onReplayTips={() => {
				setTips({ completed: [] });
				closeSettings();
			}}
			ignoredHistory={
				settingsIgnoredRepository
					? {
							repository: settingsIgnoredRepository,
							history: ignoredHistory,
							status: settingsIgnoredStatus,
							active: settingsContextWorkspace
								? ignoredRoot === settingsIgnoredRepository.root
								: ignoredVisible,
							onOpen: () => {
								setIgnoredRoot(settingsIgnoredRepository.root);
								closeSettings();
							},
							onRefresh: () =>
								ignoredHistories.refresh(settingsIgnoredRepository.root),
						}
					: undefined
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
			initialForm={settingsForm}
			onFormChange={(form) => {
				if (form === "list" && settingsForm === "connect")
					setReconnectAccountKey(undefined);

				setSettingsForm(form);
			}}
			onBusyChange={setSettingsBusy}
			initialReconnectKey={reconnectAccountKey}
			remoteAccounts={remoteAccounts}
			initialSection={settingsSection}
			onSectionChange={setSettingsSection}
			applicationSettingsIntent={applicationSettingsIntent}
			onApplicationSettingsIntentConsumed={() =>
				setApplicationSettingsIntent(undefined)
			}
			repositorySettings={
				settingsContextWorkspace?.repository
					? {
							root: settingsContextWorkspace.repository.root,
							name: settingsContextTab?.name ?? "Repository",
							disabled:
								settingsContextWorkspace.loading ||
								!!settingsContextWorkspace.error ||
								RepositoryWorkspaceModel.isBusy(settingsContextWorkspace),
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
							applyRepositoryAppearance(settingsAppearanceDirectory, value)
					: undefined
			}
			writeGitSettings={mutations.saveSettings}
		>
			{closeNotice}
		</AccountsSettings>
	) : null;

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
					hidden={onboardingOpen && !settingsOpen}
					rail={
						onboardingOpen ? undefined : (
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
								accounts={accounts}
								settingsButtonRef={appearanceSettingsButton}
								disabled={settingsBusy}
								preferredAccountKey={preferredAccountKey}
								onAccount={setPreferredAccountKey}
								onSettings={(section) => {
									openSettings();

									if (section) setSettingsSection(section);
								}}
								settingsActive={settingsOpen}
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
						contentTab &&
						contentWorkspace &&
						(contentWorkspace.repository ||
							contentWorkspace.preview ||
							contentWorkspace.repositoryPath) &&
						!contentTab.comparison &&
						contentWorkspace.view !== "graph" &&
						!ignoredVisible ? (
							<RepositoryNavigation
								onAiSettings={() => {
									openSettings();
									setSettingsSection("ai");
								}}
								onPreviewIntent={(entry) => {
									const change = entry?.change ?? entry?.commitFile;
									const repository = contentWorkspace.repository;

									const available =
										repository &&
										!contentWorkspace.loading &&
										!contentWorkspace.error &&
										!RepositoryWorkspaceModel.isBusy(contentWorkspace);

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
									mutations.discardFile(contentTab.id, request)
								}
								onIgnore={(request) =>
									mutations.ignoreFile(contentTab.id, request)
								}
								key={contentTab.id}
								workspaceId={contentTab.id}
								state={contentWorkspace}
								hidden={settingsOpen}
								history={history}
								stashes={stashes}
								stashCreateRequest={
									!settingsOpen && stashCreateRequest?.id === contentTab.id
										? stashCreateRequest.sequence
										: undefined
								}
								onStashCreateRequestHandled={() => setStashCreateRequest(null)}
								onCommit={() => {
									void mutations.commit(contentTab.id);
								}}
								onCancelCommit={() => mutations.cancelCommit(contentTab.id)}
								onUndoCommit={(input) =>
									mutations.undoCommit(contentTab.id, input)
								}
								onRevertCommit={(input) =>
									mutations.revertCommit(contentTab.id, input)
								}
								onCherryPickCommit={(input) =>
									mutations.cherryPickCommit(contentTab.id, input)
								}
								onCreateTag={(input) =>
									mutations.createTag(contentTab.id, input)
								}
								onPushTag={(input) => mutations.pushTag(contentTab.id, input)}
								onSquash={(input) =>
									mutations.squashCommits(contentTab.id, input)
								}
								readSquash={readSquash}
								onReset={(input) => mutations.resetCommit(contentTab.id, input)}
								readReset={readReset}
								onReorder={(input) =>
									mutations.reorderCommits(contentTab.id, input)
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
								onStash={(request) => mutations.stash(contentTab.id, request)}
								onOperation={(request) =>
									mutations.finishOperation(contentTab.id, request)
								}
								onRefresh={() => {
									void connection.refresh(contentTab.id);
								}}
								onAction={(action) =>
									dispatch({ type: "workspace", id: contentTab.id, action })
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
							closeDisabledId={
								settingsBusy ? WorkspaceTabsModel.settingsId(state) : undefined
							}
							onCloseSettings={closeSettings}
							openMenuFor={workspaceMenuRequest?.id}
							branchIntent={workspaceMenuRequest?.intent}
							onOpenMenuFor={() => setWorkspaceMenuRequest(null)}
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
					<div
						aria-hidden={settingsOpen || undefined}
						style={{
							display: "flex",
							flexDirection: "column",
							flexGrow: 1,
							minWidth: 0,
							minHeight: 0,
							...(settingsOpen
								? {
										position: "absolute",
										top: 0,
										right: 0,
										bottom: 0,
										left: 0,
										visibility: "hidden",
										pointerEvents: "none",
									}
								: {}),
						}}
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
									else if (activeTab) readTabRepository(activeTab.id, path);
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
									readTabRepository(cloneTab.id, path);
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
						!(cloneTab && contentTab?.id === cloneTab.id) &&
						!contentTab?.comparison &&
						contentWorkspace?.view === "history" &&
						revision?.commit ? (
							<RepositoryCommitDetails
								key={`commit-details:${contentTab?.id}:${contentWorkspace.repository?.root}:${revision.id}`}
								commit={revision.commit}
								tags={history.tags}
							/>
						) : null}
						{publishingVisible ||
						(cloneTab &&
							contentTab?.id === cloneTab.id) ? null : welcomeVisible ? (
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
								busy={
									connection.pickingId !== null || !!contentWorkspace?.loading
								}
								error={machineError ?? contentWorkspace?.error}
								onOpen={() => {
									if (remoteHome) {
										setFolderPickerRoot(remoteHome);

										return;
									}

									const id = contentTab?.id ?? `workspace-${state.nextId}`;

									if (!contentTab) dispatch({ type: "add" });

									void connection.open(id);
								}}
								onOpenRecent={(path) => {
									const existing = visibleTabs.find(
										(tab) => tab.workspace.repository?.root === path
									);

									if (existing) dispatch({ type: "activate", id: existing.id });
									else if (contentTab) readTabRepository(contentTab.id, path);
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

											const id = contentTab?.id ?? `workspace-${state.nextId}`;

											if (!contentTab) dispatch({ type: "add" });

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
											if (!contentTab) dispatch({ type: "add" });
										}}
										disabled={
											(remoteMachine && !machineHome) ||
											connection.pickingId !== null ||
											!!contentWorkspace?.loading ||
											(!!contentWorkspace &&
												RepositoryWorkspaceModel.isBusy(contentWorkspace))
										}
										onSubmit={(request) =>
											contentTab
												? connection.setup(
														contentTab.id,
														request,
														mutations.closeProtection.block
													)
												: Promise.resolve({
														ok: false,
														message: "Open a workspace first.",
													})
										}
										onCancel={() => {
											if (contentTab) connection.cancelSetup(contentTab.id);
										}}
										onOpen={(path) => {
											if (contentTab) readTabRepository(contentTab.id, path);
										}}
									/>
								}
							/>
						) : contentTab?.comparison?.intent === "pull-request" &&
						  contentWorkspace ? (
							<RepositoryPullRequestView
								fileTreeScope={contentTab.id}
								key={`${contentTab.id}:pull-request`}
								root={contentTab.comparison.root}
								state={contentWorkspace}
								read={readReview}
								onFetch={() => mutations.fetch(contentTab.id)}
								onSync={(choice, identity) =>
									mutations.synchronize(
										contentTab.id,
										choice,
										undefined,
										identity
									)
								}
								onClose={() => dispatch({ type: "compare", id: contentTab.id })}
								readComparison={readComparison}
								readHistory={readHistory}
								readCommitFiles={readCommitFiles}
								readDiff={readDiff}
								previewCache={previewCache}
								diffSettings={diffSettings}
								onDiffSettingsChange={setDiffSettings}
							/>
						) : contentTab?.comparison?.intent === "sync" &&
						  contentWorkspace ? (
							<RepositorySyncReview
								fileTreeScope={contentTab.id}
								key={`${contentTab.id}:${contentTab.comparison.base}:${contentTab.comparison.incoming}:${contentTab.comparison.branches.map((branch) => branch.oid).join(":")}`}
								request={contentTab.comparison}
								state={contentWorkspace}
								onClose={() => dispatch({ type: "compare", id: contentTab.id })}
								onIntegrate={(choice) =>
									mutations.changeBranch(contentTab.id, choice)
								}
								readComparison={readComparison}
								readHistory={readHistory}
								readCommitFiles={readCommitFiles}
								readDiff={readDiff}
								previewCache={previewCache}
								diffSettings={diffSettings}
								onDiffSettingsChange={setDiffSettings}
							/>
						) : contentTab?.comparison ? (
							<RepositoryComparison
								fileTreeScope={contentTab.id}
								key={contentTab.id}
								request={contentTab.comparison}
								readComparison={readComparison}
								readHistory={readHistory}
								readCommitFiles={readCommitFiles}
								readDiff={readDiff}
								previewCache={previewCache}
								diffSettings={diffSettings}
								onDiffSettingsChange={setDiffSettings}
								onClose={() => dispatch({ type: "compare", id: contentTab.id })}
							>
								{contentWorkspace?.repository && !contentWorkspace.preview
									? () => (
											<Button
												testId="preview-pull-request"
												tokens={appTokens}
												variant="secondary"
												size="sm"
												disabled={
													contentWorkspace.loading ||
													RepositoryWorkspaceModel.isBusy(contentWorkspace) ||
													!!contentWorkspace.error ||
													contentWorkspace.repository?.operation !== "normal" ||
													!contentWorkspace.repository?.head ||
													!contentWorkspace.repository.branchName ||
													contentWorkspace.repository.remoteCount === 0
												}
												onPress={() => {
													const request = contentTab.comparison;

													if (!request) return;

													dispatch({
														type: "compare",
														id: contentTab.id,
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
						) : ignoredVisible && contentWorkspace?.repository ? (
							<IgnoredHistoryView
								key={`ignored:${contentWorkspace.repository.root}`}
								repository={contentWorkspace.repository}
								history={ignoredHistory}
								status={ignoredStatus}
								onRefresh={() =>
									ignoredHistories.refresh(
										contentWorkspace.repository?.root ?? ""
									)
								}
								onSettings={() => {
									openSettings();
									setSettingsSection("repository-ignored-history");
								}}
								settings={diffSettings}
								onSettingsChange={setDiffSettings}
								disabled={
									contentWorkspace.loading ||
									RepositoryWorkspaceModel.isBusy(contentWorkspace)
								}
							/>
						) : contentTab &&
						  contentWorkspace?.repository &&
						  contentWorkspace.view === "graph" ? (
							<RepositoryGraph
								fileTreeScope={contentTab.id}
								key={`graph:${contentTab.id}:${contentWorkspace.repository.root}`}
								root={contentWorkspace.repository.root}
								head={contentWorkspace.repository.head}
								version={contentWorkspace.metadataVersion ?? 0}
								disabled={
									contentWorkspace.loading ||
									RepositoryWorkspaceModel.isBusy(contentWorkspace)
								}
								readReferences={readGraphReferences}
								readPage={readGraphPage}
								readCommitFiles={readCommitFiles}
								readDiff={readDiff}
								previewCache={previewCache}
								diffSettings={diffSettings}
								onDiffSettingsChange={setDiffSettings}
							/>
						) : contentTab && contentWorkspace?.repository && comparison ? (
							<RepositoryDiff
								key={`${contentTab.id}:${contentWorkspace.repository.root}:${revision?.id ?? "changes"}`}
								root={contentWorkspace.repository.root}
								change={comparison}
								inclusion={
									contentWorkspace.view === "changes" &&
									contentWorkspace.repository.operation === "normal"
										? {
												included: contentWorkspace.includedFileIds.includes(
													comparison.path
												),
												selection:
													contentWorkspace.partialFiles?.[comparison.path],
												onChange: (expectedPatch, includedLines, total) =>
													dispatch({
														type: "workspace",
														id: contentTab.id,
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
								version={contentWorkspace.repository}
								files={files}
								refreshing={
									contentWorkspace.loading ||
									RepositoryWorkspaceModel.isBusy(contentWorkspace)
								}
								statusError={contentWorkspace.error}
								readDiff={readDiff}
								onResolve={(hash, side, expectedSideOid) =>
									mutations.resolve(
										contentTab.id,
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
								view={contentWorkspace?.view}
								hasWorkspace={!!contentTab}
								workspace={contentWorkspace}
								picking={connection.pickingId !== null}
								onOpen={() => {
									if (!contentTab) return;

									if (contentWorkspace?.repositoryPath)
										void connection.refresh(contentTab.id);
									else void connection.open(contentTab.id);
								}}
							/>
						)}
					</div>
					{settingsContent}
				</AppShell>
				<RepositoryQuickSwitcher
					key={quickSwitcherSession}
					open={quickSwitcherOpen}
					items={quickRepositories}
					actions={paletteActions}
					settingsFirst={settingsOpen || !workspace?.repository}
					overviews={repositoryOverviews}
					error={paletteActionError}
					onClose={() => setQuickSwitcherOpen(false)}
					onAction={runPaletteAction}
					onOpen={(path) => {
						const targetId = quickSwitcherTarget.current;

						quickSwitcherTarget.current = null;
						const existing = visibleTabs.find(
							(tab) =>
								!tab.comparison &&
								(tab.workspace.repository?.root ??
									tab.workspace.repositoryPath) === path
						);

						if (
							targetId &&
							visibleTabs.some(
								(tab) => tab.id === targetId && tab.kind === "empty"
							)
						)
							readTabRepository(targetId, path);
						else if (existing) dispatch({ type: "activate", id: existing.id });
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
										readTabRepository(onboardingTab(), path);
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
										readTabRepository(onboardingTab(), path);
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
								setSettingsForm("list");
							}

							setSpaceEditor(undefined);
						}}
					/>
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
							openSettings("list");
							setSettingsSection("repository-appearance");
							setSettingsForm("list");
						}}
					/>
				) : null}
				{syncAccount.dialog}
			</div>
		</RepositoryAvatarContext>
	);
}
