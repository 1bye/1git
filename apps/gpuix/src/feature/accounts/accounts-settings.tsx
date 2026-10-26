import {
	IgnoredHistorySettings,
	type IgnoredHistorySettingsHandle,
} from "../ignored-history/ignored-history-settings";
import type {
	IgnoredHistory,
	IgnoredRepository,
} from "../ignored-history/ignored-history";
import type { IgnoredHistoryStatus } from "../ignored-history/use-ignored-histories";
import { createThemedStyles, useAppTheme } from "../../styles/theme";
import { spacing } from "@1git/design-tokens";
import {
	cloneElement,
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
	type ReactElement,
	type ComponentProps,
	type Ref,
} from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Scrollbars } from "@1git/gpuix-ui/scrollbar";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { AppShell } from "../../fixture/app-shell";
import {
	WorkspaceRail,
	workspaceRailWidth,
} from "../repository-workspace/components/workspace-rail";
import { settingsNavigation } from "./lib/settings-shortcut";
import {
	AccountConnectionFields,
	AccountConnectionActions,
} from "./account-connection-form";
import { useAccountConnection } from "./use-account-connection";
import { accountSetup } from "./lib/account-setup";
import { AccountList } from "./account-list";
import { NativeBrowser } from "../../platform/browser";
import { Accounts } from "./lib/accounts";
import type { RemoteAccounts } from "./lib/remote-accounts";
import { AccountStore, type SavedAccount } from "./lib/account-store";
import { NativeCredentials } from "./lib/native-credentials";

import { workspaceLayout } from "../../styles/workspace-layout";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { WorkspaceTabHeading } from "../workspace-tabs/components/workspace-tab";
import type { RepositoryView } from "../repository-workspace/types";
import type { SpaceDirection } from "../spaces/workspace-spaces";
import { NativeClipboard } from "../../platform/clipboard";
import {
	GitSettings,
	type GitSettingsHandle,
} from "../git-settings/git-settings";
import { GitSettingsModel } from "../git-settings/git-settings-model";
import { StateMessage } from "../../fixture/state-message";
import {
	EditorSettings,
	type EditorSettingsHandle,
} from "../editor-settings/editor-settings";
import type { ExternalEditors } from "../editor-settings/external-editors";
import {
	SettingsPage,
	SettingsSection as SettingsLayoutSection,
	SettingsSplit,
	settingsStyles,
} from "../settings/settings-layout";
import type { SpacesSettingsHandle } from "../spaces/space-manager";
import { AppearanceSettings } from "../appearance-settings/appearance-settings";
import { PrivacySettings } from "../analytics/privacy-settings";
import { KeybindSettings } from "../keybinds/keybind-settings";
import { AiSettings, type AiSettingsHandle } from "../ai/ai-settings";
import { RepositoryAppearance } from "../repository-appearance/repository-appearance";
import type { RepositoryAppearanceValue } from "../repository-appearance/repository-patterns";

const sidebarWidth = 200;

// Clear the traffic lights and keep the tab, including its curved shoulder, over the sidebar.
const titleInset = workspaceLayout.desktopTitlebarControlsWidth;

const settingsTitleWidth =
	workspaceRailWidth + sidebarWidth - titleInset - spacing[4];

/** Settings pages distinguish application defaults from the active repository's configuration. */
export type SettingsSection =
	| "accounts"
	| "spaces"
	| "appearance"
	| "privacy"
	| "keybinds"
	| "ai"
	| "git"
	| "editor"
	| "repository-remotes"
	| "repository-ignored-history"
	| "repository-appearance"
	| "repository-identity";

interface SettingsNavItem {
	section: SettingsSection;
	label: string;
	icon: ComponentProps<typeof WorkspaceTabIcon>["name"];
	group: "application" | "repository";
}
const settingsPages = [
	{ section: "spaces", label: "Spaces", icon: "layers", group: "application" },
	{
		section: "appearance",
		label: "Appearance",
		icon: "contrast",
		group: "application",
	},
	{
		section: "keybinds",
		label: "Keybinds",
		icon: "keyboard",
		group: "application",
	},
	{
		section: "privacy",
		label: "Privacy",
		icon: "shield",
		group: "application",
	},
	{
		section: "accounts",
		label: "Accounts",
		icon: "userCircle",
		group: "application",
	},
	{
		section: "git",
		label: "Git",
		icon: "branch",
		group: "application",
	},
	{
		section: "editor",
		label: "External editor",
		icon: "pencil",
		group: "application",
	},
	{ section: "ai", label: "AI", icon: "sparkle", group: "application" },
	{
		section: "repository-remotes",
		label: "Remotes",
		icon: "network",
		group: "repository",
	},
	{
		section: "repository-appearance",
		label: "Appearance",
		icon: "palette",
		group: "repository",
	},
	{
		section: "repository-identity",
		label: "Commit identity",
		icon: "idCard",
		group: "repository",
	},
	{
		section: "repository-ignored-history",
		label: "Ignored file history",
		icon: "history",
		group: "repository",
	},
] as const satisfies readonly SettingsNavItem[];

function SettingsNavButton({
	item,
	active,
	disabled,
	onSelect,
	ref,
}: {
	item: SettingsNavItem;
	active: boolean;
	disabled: boolean;
	onSelect: (section: SettingsSection) => void;
	ref?: Ref<PublicInstance>;
}) {
	const { tokens } = useAppTheme();

	return (
		<Button
			testId={`settings-${item.section}`}
			ref={ref}
			tokens={tokens}
			size="sm"
			variant={active ? "secondary" : "ghost"}
			aria-current={active ? "page" : undefined}
			disabled={disabled}
			style={{ justifyContent: "flex-start" }}
			onPress={() => onSelect(item.section)}
		>
			<WorkspaceTabIcon
				name={item.icon}
				testId={`settings-${item.section}-icon`}
			/>
			{item.label}
		</Button>
	);
}
const themedStyles = createThemedStyles((theme) => ({
	groupHeading: {
		...settingsStyles.get(theme).navGroup,
		paddingLeft: spacing[2.5],
		marginTop: spacing[3],
	},
}));

/** Account settings are window-local. Tokens are transient refs and uncontrolled native password inputs, never renderer props. */
export function AccountsSettings({
	onBack,
	onReplayTips,
	onSetup,
	accounts: supplied,
	remoteAccounts,
	children,
	initialForm = "list",
	initialReconnectKey,
	openLink = NativeBrowser.open,
	copyText = NativeClipboard.write,
	preferredAccountKey,
	onAccount,
	repositoryView,
	onRepositoryView,
	initialSection = "accounts",
	repositorySettings,
	repositoryAppearance,
	repositoryAppearanceName,
	onCustomizeRepositoryAppearance,
	onChangeRepositoryAppearance,
	ignoredHistory,
	spaceSwitcher,
	onSpaceSwipe,
	spacesSettings,
	readGitSettings = GitSettingsModel.read,
	writeGitSettings = GitSettingsModel.write,
	autoIncludeChanges = false,
	onAutoIncludeChanges,
	externalEditors,
}: {
	onBack: () => void;
	onReplayTips?: () => void;
	onSetup?: () => void;
	accounts?: Accounts;
	remoteAccounts?: RemoteAccounts;
	children?: ReactNode;
	/** Clone's Add account entry opens setup immediately; normal Settings starts with the list. */
	initialForm?: "list" | "connect";
	/** A user-requested recovery opens this account's existing reconnect form, without authorizing it. */
	initialReconnectKey?: string;
	/** System-browser boundary; native tests capture setup links without opening a real account. */
	openLink?: (url: string) => Promise<void>;
	/** Public setup values only; tests capture writes without replacing the user's clipboard. */
	copyText?: (value: string) => Promise<void>;
	preferredAccountKey?: string;
	onAccount?: (key: string) => void;
	/** Keep the active repository's rail available while Settings covers its workspace. */
	repositoryView?: RepositoryView;
	onRepositoryView?: (view: RepositoryView) => void;
	initialSection?: SettingsSection;
	repositorySettings?: { root: string; name: string; disabled: boolean };
	ignoredHistory?: {
		history: IgnoredHistory;
		repository: IgnoredRepository;
		status?: IgnoredHistoryStatus;
		onRefresh: () => Promise<void>;
		active?: boolean;
		onOpen?: () => void;
	};
	repositoryAppearance?: RepositoryAppearanceValue;
	repositoryAppearanceName?: string;
	onCustomizeRepositoryAppearance?: (value: RepositoryAppearanceValue) => void;
	onChangeRepositoryAppearance?: (value: RepositoryAppearanceValue) => void;
	spaceSwitcher?: (disabled: boolean) => ReactNode;
	onSpaceSwipe?: (direction: SpaceDirection) => void;
	spacesSettings?: ReactElement<{ ref?: Ref<SpacesSettingsHandle> }>;
	readGitSettings?: typeof GitSettingsModel.read;
	writeGitSettings?: typeof GitSettingsModel.write;
	autoIncludeChanges?: boolean;
	onAutoIncludeChanges?: (enabled: boolean) => void;
	externalEditors?: ExternalEditors;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const { groupHeading } = themedStyles.get(theme);
	const styles = settingsStyles.get(theme);

	const renderer = useGpuixRequired();

	const [accounts] = useState(
		() =>
			supplied ??
			new Accounts(
				new AccountStore(AccountStore.defaultPath()),
				new NativeCredentials(renderer)
			)
	);

	const connection = useAccountConnection({
		accounts,
		initialForm,
		initialReconnectKey,
		openLink,
	});

	const {
		saved,
		setSaved,
		form,
		setForm,
		replacing,
		busy,
		error,
		setError,
		status,
		setStatus,
		perform,
		startConnection,
		clearToken,
		cancelConnection,
	} = connection;

	const readAccountIdentity = useCallback(
		(account: SavedAccount, signal: AbortSignal) =>
			accounts.commitIdentity(account, signal),
		[accounts]
	);

	const [removing, setRemoving] = useState<SavedAccount>();

	useEffect(() => {
		setRemoving(undefined);
	}, [accounts, initialForm, initialReconnectKey]);

	const [section, setSection] = useState(initialSection);
	const [gitBusy, setGitBusy] = useState(false);
	const gitBusyRef = useRef(false);
	const spacesEditor = useRef<SpacesSettingsHandle | null>(null);
	const ignoredSettings = useRef<IgnoredHistorySettingsHandle | null>(null);
	const gitSettings = useRef<GitSettingsHandle | null>(null);
	const editorSettings = useRef<EditorSettingsHandle | null>(null);
	const aiSettings = useRef<AiSettingsHandle | null>(null);
	const settingsBusy = busy || gitBusy;

	const repositorySection =
		section === "repository-remotes" ||
		section === "repository-identity" ||
		section === "repository-appearance" ||
		section === "repository-ignored-history";

	const mounted = useRef(true);
	const view = useRef<PublicInstance | null>(null);
	const initialPage = useRef<PublicInstance | null>(null);
	const navigation = useRef<PublicInstance>(null);
	const addButton = useRef<PublicInstance | null>(null);

	useEffect(() => {
		mounted.current = true;
		const focus = setTimeout(() => {
			if (initialPage.current) renderer.focusElement?.(initialPage.current.id);
		}, 0);

		return () => {
			clearTimeout(focus);
			mounted.current = false;
		};
	}, [renderer]);

	useEffect(() => {
		settingsNavigation.set(renderer, {
			scope: () => view.current?.id ?? null,
			back: () => {
				if (gitBusyRef.current) return;

				if (spacesEditor.current?.cancelEditor()) return;

				if (ignoredSettings.current?.cancelEditor()) return;

				if (gitSettings.current?.cancelEditor()) return;

				if (editorSettings.current?.cancelEditor()) return;

				if (aiSettings.current?.cancelEditor()) return;

				if (!cancelConnection()) onBack();
			},
		});

		return () => {
			settingsNavigation.delete(renderer);
		};
	}, [renderer, onBack, cancelConnection]);

	const removingHost = removing ? new URL(removing.webUrl) : undefined;

	const availablePages = settingsPages.filter((item) => {
		switch (item.section) {
			case "spaces":
				return !!spacesSettings;
			case "repository-remotes":
			case "repository-identity":
				return !!repositorySettings;
			case "repository-appearance":
				return !!repositoryAppearance;
			case "repository-ignored-history":
				return !!ignoredHistory;
			default:
				return true;
		}
	});

	return (
		<AppShell
			testId="settings-view"
			ref={view}
			workspaceLabel="Settings"
			rail={
				<WorkspaceRail
					ignoredHistory={
						ignoredHistory?.status?.data?.preferences.enabled &&
						ignoredHistory.onOpen
							? {
									active: ignoredHistory.active ?? false,
									onOpen: () => {
										if (!settingsBusy) ignoredHistory.onOpen?.();
									},
								}
							: undefined
					}
					spaceSwitcher={spaceSwitcher}
					onSpaceSwipe={onSpaceSwipe}
					accounts={accounts}
					savedAccounts={saved}
					preferredAccountKey={preferredAccountKey}
					onAccount={onAccount}
					settingsActive
					disabled={settingsBusy}
					view={repositoryView}
					onView={(next) => {
						if (!connection.isPending() && !gitBusyRef.current)
							onRepositoryView?.(next);
					}}
					onSettings={() => {
						if (settingsBusy) return;

						clearToken();
						setError(undefined);
						setForm("list");
						setSection("accounts");
					}}
					onAddAccount={() => {
						if (!settingsBusy) {
							setSection("accounts");
							startConnection();
						}
					}}
				/>
			}
			toolbar={
				<div
					testId="settings-toolbar"
					windowDrag
					style={{
						display: "flex",
						flexDirection: "row",
						height: workspaceLayout.toolbarHeight,
						flexShrink: 0,
						alignItems: "end",
						paddingLeft: titleInset,
					}}
				>
					<WorkspaceTabHeading
						label="Settings"
						testId="settings-title-tab"
						width={settingsTitleWidth}
						onClose={onBack}
						disabled={settingsBusy}
					/>
				</div>
			}
			navigation={
				<>
					<div
						ref={navigation}
						testId="settings-navigation"
						style={{
							display: "flex",
							flexDirection: "column",
							minHeight: 0,
							overflowY: "scroll",
							width: sidebarWidth,
							flexShrink: 0,
							padding: spacing[2],
							gap: spacing[1.5],
							borderRightWidth: 1,
							borderColor: appTokens.colors.border,
						}}
					>
						{(["application", "repository"] as const).map((group) => {
							const pages = availablePages.filter(
								(item) => item.group === group
							);

							return pages.length ? (
								<div
									key={group}
									style={{
										display: "flex",
										flexDirection: "column",
										gap: spacing[1.5],
										flexShrink: 0,
									}}
								>
									<text
										testId={`settings-${group}-group`}
										role="heading"
										aria-level={2}
										style={{
											...groupHeading,
											marginTop:
												group === "repository" ? spacing[5] : spacing[3],
										}}
									>
										{group === "application" ? "Application" : "Repository"}
									</text>
									{pages.map((item) => (
										<SettingsNavButton
											key={item.section}
											item={item}
											ref={section === item.section ? initialPage : undefined}
											active={section === item.section}
											disabled={settingsBusy}
											onSelect={(next) => {
												clearToken();
												setForm("list");
												setSection(next);
											}}
										/>
									))}
								</div>
							) : null;
						})}
					</div>
					<Scrollbars
						vertical={navigation}
						tokens={appTokens}
						testId="settings-navigation-scrollbar"
					/>
				</>
			}
		>
			{children}
			{section === "spaces" ? (
				spacesSettings ? (
					cloneElement(spacesSettings, { ref: spacesEditor })
				) : null
			) : section === "appearance" ? (
				<AppearanceSettings
					onReplayTips={onReplayTips}
					onSetup={onSetup}
					busy={settingsBusy}
				/>
			) : section === "keybinds" ? (
				<KeybindSettings />
			) : section === "privacy" ? (
				<PrivacySettings />
			) : section === "ai" ? (
				<AiSettings
					ref={aiSettings}
					openLink={openLink}
					onBusy={(next) => {
						gitBusyRef.current = next;
						setGitBusy(next);
					}}
				/>
			) : section === "editor" ? (
				<EditorSettings
					ref={editorSettings}
					editors={externalEditors}
					onBusy={(next) => {
						gitBusyRef.current = next;
						setGitBusy(next);
					}}
				/>
			) : repositorySection &&
			  !repositorySettings &&
			  !(section === "repository-appearance" && repositoryAppearance) ? (
				<StateMessage
					artwork="repository"
					title="Open a repository to edit its settings"
				/>
			) : section === "repository-ignored-history" && ignoredHistory ? (
				<IgnoredHistorySettings
					ref={ignoredSettings}
					key={ignoredHistory.repository.root}
					{...ignoredHistory}
					disabled={repositorySettings?.disabled}
					onBusy={(next) => {
						gitBusyRef.current = next;
						setGitBusy(next);
					}}
				/>
			) : section === "repository-appearance" && repositoryAppearance ? (
				<RepositoryAppearance
					key={repositorySettings?.root ?? repositoryAppearanceName}
					{...repositoryAppearance}
					name={
						repositoryAppearanceName ?? repositorySettings?.name ?? "Repository"
					}
					onCustomize={onCustomizeRepositoryAppearance}
					onChange={onChangeRepositoryAppearance}
				/>
			) : section !== "accounts" ? (
				<GitSettings
					ref={gitSettings}
					key={section}
					page={section === "repository-remotes" ? "remotes" : "identity"}
					root={repositorySection ? (repositorySettings?.root ?? null) : null}
					disabled={repositorySection && repositorySettings?.disabled}
					read={readGitSettings}
					write={writeGitSettings}
					autoIncludeChanges={autoIncludeChanges}
					onAutoIncludeChanges={onAutoIncludeChanges}
					accounts={saved}
					remoteAccounts={remoteAccounts}
					readAccountIdentity={readAccountIdentity}
					onBusy={(next) => {
						gitBusyRef.current = next;
						setGitBusy(next);
					}}
				/>
			) : (
				<>
					<SettingsSplit
						testId="accounts-settings"
						list={
							<SettingsPage
								testId="accounts-list-panel"
								scrollTestId="accounts-list-scroll"
								headerTestId="accounts-list-header"
								title="Accounts"
								titleTestId="accounts-heading"
								description="Connected hosting accounts."
								descriptionTestId="accounts-description"
								action={
									<Button
										variant="secondary"
										testId="account-add"
										ref={addButton}
										size="sm"
										tokens={appTokens}
										disabled={busy || form === "connect"}
										onPress={() => startConnection()}
									>
										Add account
									</Button>
								}
							>
								<SettingsLayoutSection testId="accounts-list-content">
									{error && form === "list" && !removing ? (
										<text
											role="alert"
											testId="accounts-error"
											style={{ ...styles.error }}
										>
											{error}
										</text>
									) : null}
									<AccountList
										accounts={saved}
										status={status}
										disabled={busy || form === "connect"}
										onReconnect={startConnection}
										onCheck={(account) => {
											void perform(async (signal) => {
												const message = await accounts.check(account, signal);

												if (mounted.current)
													setStatus((previous) => ({
														...previous,
														[AccountStore.key(account)]: message,
													}));
											});
										}}
										onRemove={(account) => {
											setError(undefined);
											setRemoving(account);
										}}
									/>
								</SettingsLayoutSection>
							</SettingsPage>
						}
						panel={
							form === "connect"
								? {
										testId: "account-setup-panel",
										titleTestId: "account-setup-heading",
										title: replacing ? "Reconnect account" : "Add account",
										label: replacing ? "Reconnect account" : "Add account",
										description: "Git credentials stay separate.",
										scrollTestId: "account-setup-scroll",
										footerTestId: "account-setup-footer",
										body: (
											<AccountConnectionFields
												connection={connection}
												copyText={copyText}
											/>
										),
										footer: (
											<AccountConnectionActions connection={connection} />
										),
									}
								: undefined
						}
					/>
					<Popover
						open={removing !== undefined}
						onOpenChange={(open) => {
							if (!open && !busy) {
								setRemoving(undefined);
								setError(undefined);
							}
						}}
						modal
					>
						<PopoverContent
							testId="account-remove-dialog"
							aria-label="Confirm account removal"
							placement="center"
							width={340}
							dismissible={!busy}
							tokens={appTokens}
						>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: spacing[2.5],
									padding: spacing[1],
								}}
							>
								<text role="heading" aria-level={2} style={styles.sectionTitle}>
									Remove account?
								</text>
								{removing && removingHost ? (
									<text style={{ ...styles.label }}>
										{`${removing.username} · ${accountSetup[removing.provider].name} · ${removingHost.host}${removingHost.pathname === "/" ? "" : removingHost.pathname}`}
									</text>
								) : null}
								<text style={styles.description}>
									{removing?.credentialSource === "github-cli"
										? "Removes this connection from 1git. You stay signed in to GitHub CLI."
										: `Removes this account and its saved credentials from 1git. Your ${removing ? accountSetup[removing.provider].name : "hosting"} account and repositories stay unchanged.`}
								</text>
								{error ? (
									<text role="alert" style={{ ...styles.error }}>
										{error}
									</text>
								) : null}
								<div
									style={{
										display: "flex",
										flexDirection: "row",
										justifyContent: "flex-end",
										gap: spacing[2],
									}}
								>
									<Button
										testId="account-remove-cancel"
										size="sm"
										variant="secondary"
										tokens={appTokens}
										disabled={busy}
										onPress={() => {
											setRemoving(undefined);
											setError(undefined);
										}}
									>
										Cancel
									</Button>
									<Button
										variant="secondary"
										textStyle={{ color: appTokens.colors.danger }}
										testId="account-remove-confirm"
										size="sm"
										tokens={appTokens}
										disabled={busy || !removing}
										onPress={() => {
											if (!removing) return;

											const account = removing;

											void perform(async () => {
												const next = await accounts.disconnect(account);

												if (mounted.current) {
													setSaved(next);
													setRemoving(undefined);

													if (addButton.current)
														renderer.focusElement?.(addButton.current.id);
												}
											});
										}}
									>
										{busy ? "Removing…" : "Remove account"}
									</Button>
								</div>
							</div>
						</PopoverContent>
					</Popover>
				</>
			)}
		</AppShell>
	);
}
