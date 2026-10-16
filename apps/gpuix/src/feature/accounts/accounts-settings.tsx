import { IgnoredHistorySettings } from "../ignored-history/ignored-history-settings";
import type {
	IgnoredHistory,
	IgnoredRepository,
} from "../ignored-history/ignored-history";
import type { IgnoredHistoryStatus } from "../ignored-history/use-ignored-histories";
import { createThemedStyles, useAppTheme } from "../../styles/theme";
import { typography, spacing, fontWeight } from "@1git/design-tokens";
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
import { AppearanceSettings } from "../appearance-settings/appearance-settings";
import { AiSettings, type AiSettingsHandle } from "../ai/ai-settings";
import { RepositoryAppearance } from "../repository-appearance/repository-appearance";
import type { RepositoryAppearanceOptions } from "../repository-appearance/repository-patterns";

const sidebarWidth = 200;
const contentPadding = spacing[4];
const sectionMaxWidth = 480;

// Clear the traffic lights and keep the tab, including its curved shoulder, over the sidebar.
const titleInset = workspaceLayout.desktopTitlebarControlsWidth;

const settingsTitleWidth =
	workspaceRailWidth + sidebarWidth - titleInset - spacing[4];

/** Settings pages distinguish application defaults from the active repository's configuration. */
export type SettingsSection =
	| "accounts"
	| "spaces"
	| "appearance"
	| "ai"
	| "git"
	| "editor"
	| "repository-remotes"
	| "repository-ignored-history"
	| "repository-appearance"
	| "repository-identity";

const themedStyles = createThemedStyles(({ tokens: appTokens }) => {
	const labelStyle = { ...typography.md, color: appTokens.colors.textMuted };

	const headingStyle = {
		...typography.lg,
		fontWeight: fontWeight.medium,
		color: appTokens.colors.text,
	};

	const footerStyle = {
		display: "flex",
		flexDirection: "column",
		flexShrink: 0,
		gap: spacing[2],
		paddingTop: spacing[3],
		paddingBottom: spacing[3],
		paddingLeft: contentPadding,
		paddingRight: contentPadding,
		borderTopWidth: 1,
		borderColor: appTokens.colors.border,
	};

	const groupHeading = {
		...typography.xs,
		fontWeight: fontWeight.medium,
		color: appTokens.colors.textMuted,
		paddingLeft: spacing[2.5],
		marginTop: spacing[3],
	};

	return { labelStyle, headingStyle, footerStyle, groupHeading };
});

/** Account settings are window-local. Tokens are transient refs and uncontrolled native password inputs, never renderer props. */
export function AccountsSettings({
	onBack,
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
	ignoredHistory,
	spaceSwitcher,
	spacesSettings,
	readGitSettings = GitSettingsModel.read,
	writeGitSettings = GitSettingsModel.write,
	externalEditors,
}: {
	onBack: () => void;
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
	repositoryAppearance?: RepositoryAppearanceOptions;
	spaceSwitcher?: (disabled: boolean) => ReactNode;
	spacesSettings?: ReactNode;
	readGitSettings?: typeof GitSettingsModel.read;
	writeGitSettings?: typeof GitSettingsModel.write;
	externalEditors?: ExternalEditors;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const { labelStyle, headingStyle, footerStyle, groupHeading } =
		themedStyles[theme.appearance];

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
					{onSetup ? (
						<Button
							testId="settings-run-setup"
							tokens={appTokens}
							size="sm"
							variant="ghost"
							disabled={settingsBusy}
							style={{ justifyContent: "flex-start", marginTop: spacing[3] }}
							onPress={onSetup}
						>
							<WorkspaceTabIcon name="home" />
							Run setup again
						</Button>
					) : null}
					{repositorySettings ? (
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
									["repository-remotes", "Remotes", "branch"],
									...(repositoryAppearance
										? [
												[
													"repository-appearance",
													"Appearance",
													"sparkle",
												] as const,
											]
										: []),
									["repository-identity", "Commit identity", "userCircle"],
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
				<AppearanceSettings />
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
			) : repositorySection && !repositorySettings ? (
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
			) : section === "repository-appearance" &&
			  repositorySettings &&
			  repositoryAppearance ? (
				<RepositoryAppearance
					key={repositorySettings.root}
					{...repositoryAppearance}
					name={repositorySettings.name}
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
					<div
						testId="accounts-settings"
						style={{
							display: "flex",
							flexDirection: "row",
							flexGrow: 1,
							minHeight: 0,
							minWidth: 0,
						}}
					>
						<div
							testId="accounts-list-panel"
							style={{
								display: "flex",
								flexDirection: "column",
								width: form === "connect" ? "50%" : "100%",
								flexGrow: form === "connect" ? 0 : 1,
								flexShrink: 0,
								minHeight: 0,
							}}
						>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: spacing[1],
									width: "100%",
									maxWidth: sectionMaxWidth + contentPadding * 2,
									padding: contentPadding,
									flexShrink: 0,
								}}
							>
								<div
									testId="accounts-list-header"
									style={{
										display: "flex",
										flexDirection: "row",
										alignItems: "center",
										justifyContent: "space-between",
										gap: spacing[3],
									}}
								>
									<text
										testId="accounts-heading"
										role="heading"
										aria-level={1}
										style={headingStyle}
									>
										Accounts
									</text>
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
								</div>
								<text testId="accounts-description" style={labelStyle}>
									Connected hosting accounts.
								</text>
								{error && form === "list" && !removing ? (
									<text
										role="alert"
										testId="accounts-error"
										style={{ ...labelStyle, color: appTokens.colors.danger }}
									>
										{error}
									</text>
								) : null}
							</div>
							<div
								testId="accounts-list-scroll"
								style={{
									display: "flex",
									flexDirection: "column",
									flexGrow: 1,
									minHeight: 0,
									overflowY: "scroll",
									paddingLeft: contentPadding,
									paddingRight: contentPadding,
									paddingBottom: contentPadding,
								}}
							>
								<div
									testId="accounts-list-content"
									style={{
										display: "flex",
										flexDirection: "column",
										width: "100%",
										maxWidth: sectionMaxWidth,
										flexGrow: 1,
										flexShrink: 0,
									}}
								>
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
								</div>
							</div>
						</div>
						{form === "connect" ? (
							<div
								testId="account-setup-panel"
								role="region"
								aria-label={replacing ? "Reconnect account" : "Add account"}
								style={{
									display: "flex",
									flexDirection: "column",
									flexGrow: 1,
									flexBasis: 0,
									minWidth: 0,
									minHeight: 0,
									borderLeftWidth: 1,
									borderColor: appTokens.colors.border,
								}}
							>
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: spacing[1],
										width: "100%",
										maxWidth: sectionMaxWidth + contentPadding * 2,
										padding: contentPadding,
										flexShrink: 0,
									}}
								>
									<text
										testId="account-setup-heading"
										role="heading"
										aria-level={2}
										style={headingStyle}
									>
										{replacing ? "Reconnect account" : "Add account"}
									</text>
									<text style={labelStyle}>Git credentials stay separate.</text>
								</div>
								<div
									testId="account-setup-scroll"
									style={{
										flexGrow: 1,
										minHeight: 0,
										minWidth: 0,
										overflowY: "scroll",
										paddingLeft: contentPadding,
										paddingRight: contentPadding,
										paddingBottom: contentPadding,
									}}
								>
									<AccountConnectionFields
										connection={connection}
										copyText={copyText}
									/>
								</div>
								<div testId="account-setup-footer" style={footerStyle}>
									<AccountConnectionActions connection={connection} />
								</div>
							</div>
						) : null}
					</div>
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
								<text role="heading" aria-level={2} style={headingStyle}>
									Remove account?
								</text>
								{removing && removingHost ? (
									<text
										style={{ ...typography.md, color: appTokens.colors.text }}
									>
										{`${removing.username} · ${accountSetup[removing.provider].name} · ${removingHost.host}${removingHost.pathname === "/" ? "" : removingHost.pathname}`}
									</text>
								) : null}
								<text style={labelStyle}>
									{removing?.credentialSource === "github-cli"
										? "Removes this connection from 1git. You stay signed in to GitHub CLI."
										: `Removes this account and its saved credentials from 1git. Your ${removing ? accountSetup[removing.provider].name : "hosting"} account and repositories stay unchanged.`}
								</text>
								{error ? (
									<text
										role="alert"
										style={{ ...labelStyle, color: appTokens.colors.danger }}
									>
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
