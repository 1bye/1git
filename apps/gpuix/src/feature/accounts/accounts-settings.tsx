import { IgnoredHistorySettings } from "../ignored-history/ignored-history-settings";
import type {
	IgnoredHistory,
	IgnoredRepository,
} from "../ignored-history/ignored-history";
import type { IgnoredHistoryStatus } from "../ignored-history/use-ignored-histories";
import { createThemedStyles, useAppTheme } from "../../styles/theme";
import { spacing } from "@1git/design-tokens";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
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
import { AccountList, accountActionIcons } from "./account-list";
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
	ignoredHistory,
	spaceSwitcher,
	onSpaceSwipe,
	spacesSettings,
	readGitSettings = GitSettingsModel.read,
	writeGitSettings = GitSettingsModel.write,
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
	onCustomizeRepositoryAppearance?: () => void;
	spaceSwitcher?: (disabled: boolean) => ReactNode;
	onSpaceSwipe?: (direction: SpaceDirection) => void;
	spacesSettings?: ReactNode;
	readGitSettings?: typeof GitSettingsModel.read;
	writeGitSettings?: typeof GitSettingsModel.write;
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
				<div
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
					<text
						testId="settings-application-group"
						role="heading"
						aria-level={2}
						style={groupHeading}
					>
						Application
					</text>
					{spacesSettings ? (
						<Button
							testId="settings-spaces"
							ref={section === "spaces" ? initialPage : undefined}
							tokens={appTokens}
							size="sm"
							variant={section === "spaces" ? "secondary" : "ghost"}
							aria-current={section === "spaces" ? "page" : undefined}
							disabled={settingsBusy}
							style={{ justifyContent: "flex-start" }}
							onPress={() => {
								clearToken();
								setForm("list");
								setSection("spaces");
							}}
						>
							<WorkspaceTabIcon name="layers" testId="settings-spaces-icon" />
							Spaces
						</Button>
					) : null}
					<Button
						testId="settings-appearance"
						ref={section === "appearance" ? initialPage : undefined}
						tokens={appTokens}
						size="sm"
						variant={section === "appearance" ? "secondary" : "ghost"}
						aria-current={section === "appearance" ? "page" : undefined}
						disabled={settingsBusy}
						style={{ justifyContent: "flex-start" }}
						onPress={() => {
							clearToken();
							setForm("list");
							setSection("appearance");
						}}
					>
						<svg
							source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="12" cy="12" r="8"/><path d="M12 4v16M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/></svg>'
							style={{
								width: 14,
								height: 14,
								color: appTokens.colors.textMuted,
								pointerEvents: "none",
							}}
						/>
						Appearance
					</Button>
					<Button
						testId="settings-keybinds"
						ref={section === "keybinds" ? initialPage : undefined}
						tokens={appTokens}
						size="sm"
						variant={section === "keybinds" ? "secondary" : "ghost"}
						aria-current={section === "keybinds" ? "page" : undefined}
						disabled={settingsBusy}
						style={{ justifyContent: "flex-start" }}
						onPress={() => {
							clearToken();
							setForm("list");
							setSection("keybinds");
						}}
					>
						<WorkspaceTabIcon name="keyboard" />
						Keybinds
					</Button>
					<Button
						testId="settings-privacy"
						ref={section === "privacy" ? initialPage : undefined}
						tokens={appTokens}
						size="sm"
						variant={section === "privacy" ? "secondary" : "ghost"}
						aria-current={section === "privacy" ? "page" : undefined}
						disabled={settingsBusy}
						style={{ justifyContent: "flex-start" }}
						onPress={() => {
							clearToken();
							setForm("list");
							setSection("privacy");
						}}
					>
						<WorkspaceTabIcon name="shield" testId="settings-privacy-icon" />
						Privacy
					</Button>
					<Button
						testId="settings-accounts"
						ref={section === "accounts" ? initialPage : undefined}
						tokens={appTokens}
						size="sm"
						variant={section === "accounts" ? "secondary" : "ghost"}
						aria-current={section === "accounts" ? "page" : undefined}
						disabled={settingsBusy}
						onPress={() => {
							clearToken();
							setSection("accounts");
							setForm("list");
						}}
						style={{ justifyContent: "flex-start" }}
					>
						<WorkspaceTabIcon
							name="userCircle"
							testId="settings-accounts-icon"
						/>
						Accounts
					</Button>
					<Button
						testId="settings-git"
						ref={section === "git" ? initialPage : undefined}
						tokens={appTokens}
						size="sm"
						variant={section === "git" ? "secondary" : "ghost"}
						aria-current={section === "git" ? "page" : undefined}
						disabled={settingsBusy}
						style={{ justifyContent: "flex-start" }}
						onPress={() => {
							clearToken();
							setForm("list");
							setSection("git");
						}}
					>
						<WorkspaceTabIcon name="branch" />
						Commit identity
					</Button>
					<Button
						testId="settings-editor"
						ref={section === "editor" ? initialPage : undefined}
						tokens={appTokens}
						size="sm"
						variant={section === "editor" ? "secondary" : "ghost"}
						aria-current={section === "editor" ? "page" : undefined}
						disabled={settingsBusy}
						style={{ justifyContent: "flex-start" }}
						onPress={() => {
							clearToken();
							setForm("list");
							setSection("editor");
						}}
					>
						<svg
							source={accountActionIcons.reconnect}
							style={{
								width: 14,
								height: 14,
								color: appTokens.colors.textMuted,
								pointerEvents: "none",
							}}
						/>
						External editor
					</Button>
					<Button
						testId="settings-ai"
						ref={section === "ai" ? initialPage : undefined}
						tokens={appTokens}
						size="sm"
						variant={section === "ai" ? "secondary" : "ghost"}
						aria-current={section === "ai" ? "page" : undefined}
						disabled={settingsBusy}
						style={{ justifyContent: "flex-start" }}
						onPress={() => {
							clearToken();
							setForm("list");
							setSection("ai");
						}}
					>
						<WorkspaceTabIcon name="sparkle" />
						AI
					</Button>

					{repositorySettings || repositoryAppearance ? (
						<>
							<text
								testId="settings-repository-group"
								role="heading"
								aria-level={2}
								style={{ ...groupHeading, marginTop: spacing[5] }}
							>
								Repository
							</text>
							{(
								[
									...(repositorySettings
										? [["repository-remotes", "Remotes", "branch"] as const]
										: []),
									...(repositoryAppearance
										? [
												[
													"repository-appearance",
													"Appearance",
													"sparkle",
												] as const,
											]
										: []),
									...(repositorySettings
										? [
												[
													"repository-identity",
													"Commit identity",
													"userCircle",
												] as const,
											]
										: []),
									...(ignoredHistory
										? [
												[
													"repository-ignored-history",
													"Ignored file history",
													"check",
												] as const,
											]
										: []),
								] as const
							).map(([next, label, icon]) => (
								<Button
									key={next}
									ref={section === next ? initialPage : undefined}
									testId={`settings-${next}`}
									tokens={appTokens}
									size="sm"
									variant={section === next ? "secondary" : "ghost"}
									aria-current={section === next ? "page" : undefined}
									disabled={settingsBusy}
									style={{ justifyContent: "flex-start" }}
									onPress={() => {
										clearToken();
										setForm("list");
										setSection(next);
									}}
								>
									<WorkspaceTabIcon name={icon} />
									{label}
								</Button>
							))}
						</>
					) : null}
				</div>
			}
		>
			{children}
			{section === "spaces" ? (
				spacesSettings
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
