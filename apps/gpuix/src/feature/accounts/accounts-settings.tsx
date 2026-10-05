import { typography, radius, spacing, fontWeight } from "@1git/design-tokens";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import type { DeviceAuthorization } from "@1git/hosting/device-oauth";
import { AppShell } from "../../fixture/app-shell";
import {
	WorkspaceRail,
	workspaceRailWidth,
} from "../repository-workspace/components/workspace-rail";
import { settingsNavigation } from "./lib/settings-shortcut";
import {
	AccountConnectionGuide,
	AccountMethodChoices,
	AccountProviderChoices,
	AccountSetupSection,
} from "./account-connection-guide";
import { AccountList } from "./account-list";
import { openAuthorizationBrowser } from "./lib/account-authorization";
import {
	accountSetup,
	accountSetupUrl,
	defaultAccountCallback,
} from "./lib/account-setup";
import { Accounts } from "./lib/accounts";
import { AccountStore, type SavedAccount } from "./lib/account-store";
import { NativeCredentials } from "./lib/native-credentials";
import { appTokens } from "../../styles/tokens";
import { workspaceLayout } from "../../styles/workspace-layout";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { WorkspaceTabHeading } from "../workspace-tabs/components/workspace-tab";
import type { RepositoryView } from "../repository-workspace/types";
import { NativeClipboard } from "../../platform/clipboard";

const fieldStyle = {
	height: appTokens.layout.controlHeight,
	...typography.md,
	color: appTokens.colors.text,
	backgroundColor: "transparent",
	borderWidth: 1,
	borderRadius: radius.md,
	borderColor: appTokens.colors.border,
	paddingLeft: spacing[2.5],
	paddingRight: spacing[2.5],
	flexShrink: 0,
};

const labelStyle = { ...typography.md, color: appTokens.colors.textMuted };
const sidebarWidth = 200;
const contentPadding = spacing[4];
const sectionMaxWidth = 480;

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

const titleInset =
	workspaceRailWidth +
	sidebarWidth +
	contentPadding -
	workspaceLayout.tabContentInsetInlineStart;

/** Account settings are window-local. Tokens are transient refs and uncontrolled native password inputs, never renderer props. */
export function AccountsSettings({
	onBack,
	accounts: supplied,
	children,
	initialForm = "list",
	openLink = openAuthorizationBrowser,
	copyText = NativeClipboard.write,
	preferredAccountKey,
	onAccount,
	repositoryView,
	onRepositoryView,
}: {
	onBack: () => void;
	accounts?: Accounts;
	children?: ReactNode;
	/** Clone's Add account entry opens setup immediately; normal Settings starts with the list. */
	initialForm?: "list" | "connect";
	/** System-browser boundary; native tests capture setup links without opening a real account. */
	openLink?: (url: string) => Promise<void>;
	/** Public setup values only; tests capture writes without replacing the user's clipboard. */
	copyText?: (value: string) => Promise<void>;
	preferredAccountKey?: string;
	onAccount?: (key: string) => void;
	/** Keep the active repository's rail available while Settings covers its workspace. */
	repositoryView?: RepositoryView;
	onRepositoryView?: (view: RepositoryView) => void;
}) {
	const renderer = useGpuixRequired();

	const [accounts] = useState(
		() =>
			supplied ??
			new Accounts(
				new AccountStore(AccountStore.defaultPath()),
				new NativeCredentials(renderer)
			)
	);

	const [saved, setSaved] = useState<SavedAccount[]>([]);
	const [form, setForm] = useState<"list" | "connect">(initialForm);
	const [provider, setProvider] = useState<SavedAccount["provider"]>("github");
	const [webUrl, setWebUrl] = useState<string>(accountSetup.github.host);
	const [clientId, setClientId] = useState("");

	const [redirectUri, setRedirectUri] = useState(defaultAccountCallback);
	const [advanced, setAdvanced] = useState(false);

	const [manual, setManual] = useState(false);
	const [repositoryAccess, setRepositoryAccess] = useState(false);
	const [device, setDevice] = useState<DeviceAuthorization>();
	const [replacing, setReplacing] = useState<SavedAccount>();
	const [removing, setRemoving] = useState<SavedAccount>();
	const [busy, setBusy] = useState(false);
	const [waiting, setWaiting] = useState(false);
	const [error, setError] = useState<string>();
	const [status, setStatus] = useState<Record<string, string>>({});
	const [hasToken, setHasToken] = useState(false);
	const [editorVersion, setEditorVersion] = useState(0);
	const token = useRef("");
	const request = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	const view = useRef<PublicInstance | null>(null);
	const backButton = useRef<PublicInstance | null>(null);
	const addButton = useRef<PublicInstance | null>(null);

	useEffect(() => {
		mounted.current = true;
		const focus = setTimeout(() => {
			if (backButton.current) renderer.focusElement?.(backButton.current.id);
		}, 0);

		return () => {
			clearTimeout(focus);
			mounted.current = false;
			request.current?.abort();
			token.current = "";
		};
	}, [renderer]);

	useEffect(() => {
		token.current = "";
		setHasToken(false);
		setForm(initialForm);
		setRemoving(undefined);
		setError(undefined);
		setStatus({});

		try {
			setSaved(accounts.load());
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not load accounts."
			);
		}
	}, [accounts, initialForm]);

	useEffect(() => {
		settingsNavigation.set(renderer, {
			scope: () => view.current?.id ?? null,
			back: () => {
				if (request.current) {
					if (waiting) request.current.abort();
				} else if (form === "connect") {
					token.current = "";
					setHasToken(false);
					setError(undefined);
					setForm("list");
				} else onBack();
			},
		});

		return () => {
			settingsNavigation.delete(renderer);
		};
	}, [renderer, form, onBack, waiting]);

	const startConnection = (account?: SavedAccount) => {
		setReplacing(account);
		setProvider(account?.provider ?? "github");
		setWebUrl(account?.webUrl ?? accountSetup.github.host);
		setAdvanced(
			!!account &&
				account.webUrl !== new URL(accountSetup[account.provider].host).href
		);
		setRedirectUri(defaultAccountCallback);
		setError(undefined);
		token.current = "";
		setHasToken(false);
		setForm("connect");
		setManual(false);
		setClientId("");
		setDevice(undefined);
		setRepositoryAccess(false);

		if (account)
			void perform(async () => {
				const [registration, access] = await Promise.all([
					accounts.registration(account),
					accounts.repositoryAccess(account),
				]);

				if (!mounted.current) return;

				setRepositoryAccess(access === true);

				if (registration) {
					setClientId(registration.clientId);
					setRedirectUri(registration.redirectUri ?? defaultAccountCallback);
				}
			});
	};

	const perform = async (operation: (signal: AbortSignal) => Promise<void>) => {
		if (request.current) return;

		const controller = new AbortController();

		request.current = controller;
		setBusy(true);
		setError(undefined);

		try {
			await operation(controller.signal);
		} catch (cause) {
			if (mounted.current && !controller.signal.aborted)
				setError(
					cause instanceof Error ? cause.message : "Account action failed."
				);
		} finally {
			request.current = null;

			if (mounted.current) {
				setBusy(false);
				setWaiting(false);
				setDevice(undefined);
			}
		}
	};

	const changeMethod = (useToken: boolean) => {
		if (manual === useToken) return;

		setManual(useToken);
		token.current = "";
		setHasToken(false);
		setEditorVersion((version) => version + 1);
		setError(undefined);
	};

	const openSetupLink = async (url: string) => {
		try {
			await openLink(url);
		} catch {
			if (mounted.current)
				setError("Could not open the setup page in your browser. Try again.");
		}
	};

	const connect = () => {
		if (request.current) return;

		const credential = token.current;

		token.current = "";
		setHasToken(false);
		setEditorVersion((version) => version + 1);

		void perform(async (signal) => {
			setWaiting(!manual);
			const next = manual
				? await accounts.connect({
						provider,
						webUrl,
						token: credential,
						replacing,
						signal,
					})
				: await accounts.connectBrowser({
						provider,
						webUrl,
						repositoryAccess,
						registration: {
							clientId: clientId.trim(),
							redirectUri:
								provider === "gitlab" ? redirectUri.trim() : undefined,
						},
						replacing,
						signal,
						onDeviceCode: (code) => {
							if (mounted.current && !signal.aborted) setDevice(code);
						},
						onAuthorized: () => {
							if (mounted.current) {
								setWaiting(false);
								setDevice(undefined);
							}
						},
					});

			if (!mounted.current) return;

			setSaved(next);
			setForm("list");
			const connected = next.at(-1);

			if (connected)
				setStatus((previous) => ({
					...previous,
					[AccountStore.key(connected)]: "Connected",
				}));
		});
	};

	const removingHost = removing ? new URL(removing.webUrl) : undefined;

	return (
		<AppShell
			testId="settings-view"
			ref={view}
			workspaceLabel="Settings"
			rail={
				<WorkspaceRail
					accounts={accounts}
					savedAccounts={saved}
					preferredAccountKey={preferredAccountKey}
					onAccount={onAccount}
					settingsActive
					disabled={busy}
					view={repositoryView}
					onView={(next) => {
						if (!request.current) onRepositoryView?.(next);
					}}
					onSettings={() => {
						if (busy) return;

						token.current = "";
						setHasToken(false);
						setError(undefined);
						setForm("list");
					}}
					onAddAccount={() => {
						if (!busy) startConnection();
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
					<WorkspaceTabHeading label="Settings" testId="settings-title-tab" />
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
						padding: spacing[3],
						gap: spacing[1.5],
						borderRightWidth: 1,
						borderColor: appTokens.colors.border,
					}}
				>
					<Button
						ref={backButton}
						tokens={appTokens}
						size="sm"
						variant="ghost"
						testId="settings-back"
						disabled={busy}
						onPress={onBack}
						style={{ justifyContent: "flex-start" }}
					>
						<WorkspaceTabIcon name="arrowLeft" testId="settings-back-icon" />
						Back
					</Button>
					<Button
						testId="settings-accounts"
						tokens={appTokens}
						size="sm"
						variant="secondary"
						aria-current="page"
						style={{ justifyContent: "flex-start" }}
					>
						<WorkspaceTabIcon
							name="userCircle"
							testId="settings-accounts-icon"
						/>
						Accounts
					</Button>
				</div>
			}
		>
			{children}
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
							<div
								testId="account-setup-content"
								style={{
									display: "flex",
									flexDirection: "column",
									gap: spacing[3.5],
									width: "100%",
									maxWidth: sectionMaxWidth,
									flexShrink: 0,
								}}
							>
								<AccountSetupSection label="Provider">
									<AccountProviderChoices
										value={provider}
										disabled={busy || !!replacing}
										onOpen={(url) => {
											void openSetupLink(url);
										}}
										onChange={(value) => {
											if (value === provider) return;

											setProvider(value);
											setClientId("");
											setWebUrl(accountSetup[value].host);
											setRedirectUri(defaultAccountCallback);
											setAdvanced(false);
											token.current = "";
											setHasToken(false);
											setEditorVersion((version) => version + 1);
											setError(undefined);
										}}
									/>
								</AccountSetupSection>
								<AccountSetupSection label="Connect with">
									<AccountMethodChoices
										value={manual ? "token" : "browser"}
										disabled={busy}
										onChange={(method) => changeMethod(method === "token")}
									/>
								</AccountSetupSection>
								<AccountConnectionGuide
									repositoryAccess={repositoryAccess}
									provider={provider}
									manual={manual}
									host={webUrl}
									callback={redirectUri}
									disabled={busy}
									copyText={copyText}
									onOpen={(url) => {
										void openSetupLink(url);
									}}
								/>
								{manual ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: spacing[1.5],
											flexShrink: 0,
										}}
									>
										<text
											style={{
												...labelStyle,
												color: appTokens.colors.text,
												fontWeight: fontWeight.medium,
											}}
										>
											Access token
										</text>
										<input
											key={editorVersion}
											type="password"
											aria-label="Access token"
											aria-description="Masked. Stored only in the OS credential store."
											testId="account-token"
											readOnly={busy}
											tabIndex={0}
											placeholder="Paste an access token"
											style={fieldStyle}
											onChange={(event) => {
												token.current = event.value ?? "";
												setHasToken(!!token.current);
											}}
										/>
										<text style={{ ...labelStyle, ...typography.sm }}>
											{process.platform === "darwin"
												? "Stored securely in macOS Keychain."
												: "Stored securely in the OS credential store."}
										</text>
									</div>
								) : (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: spacing[1.5],
											flexShrink: 0,
										}}
									>
										<text
											style={{
												...labelStyle,
												color: appTokens.colors.text,
												fontWeight: fontWeight.medium,
											}}
										>
											{provider === "github" ? "Client ID" : "Application ID"}
										</text>
										<input
											aria-label="Application client ID"
											testId="account-client-id"
											value={clientId}
											tabIndex={0}
											readOnly={busy}
											style={fieldStyle}
											placeholder={
												provider === "github" ? "Client ID" : "Application ID"
											}
											onChange={(event) => setClientId(event.value ?? "")}
										/>
										<text style={{ ...labelStyle, ...typography.sm }}>
											Use the public ID, not the client secret.
										</text>
									</div>
								)}
								<AccountSetupSection label="Repository access">
									<Checkbox
										testId="account-repository-access"
										tokens={appTokens}
										label="Browse and clone private repositories"
										checked={repositoryAccess}
										disabled={busy}
										onCheckedChange={setRepositoryAccess}
									/>
									<text style={{ ...labelStyle, ...typography.sm }}>
										{repositoryAccess
											? provider === "github"
												? "GitHub OAuth's repo scope grants read and write access. For selected repositories with read-only access, use a fine-grained token instead."
												: "Requests read-only API and Git access. Enable read_user, read_api and read_repository on your application or token."
											: "Profile-only sign-in. GitHub can list public repositories; GitLab repository browsing needs read_api."}
									</text>
								</AccountSetupSection>
								{busy && !manual ? (
									<text
										testId="account-authorization-progress"
										style={labelStyle}
									>
										{device
											? `Enter ${device.userCode} in your browser to authorize 1git.`
											: "Waiting for authorization…"}
									</text>
								) : null}
								{device ? (
									<text
										testId="account-device-code"
										style={{
											...typography["2xl"],
											color: appTokens.colors.text,
											userSelect: "auto",
										}}
									>
										{device.userCode}
									</text>
								) : null}
								<Button
									testId="account-advanced"
									tokens={appTokens}
									size="sm"
									variant="ghost"
									aria-expanded={advanced}
									disabled={busy}
									style={{
										alignSelf: "flex-start",
										flexDirection: "row",
										gap: spacing[1],
										paddingLeft: spacing[0],
									}}
									onPress={() => setAdvanced(!advanced)}
								>
									<WorkspaceTabIcon
										name={advanced ? "caretDown" : "caretRight"}
									/>
									Advanced
								</Button>
								{!advanced &&
								webUrl.replace(/\/+$/u, "") !== accountSetup[provider].host ? (
									<text
										style={{ ...labelStyle, ...typography.sm }}
									>{`Host: ${webUrl}`}</text>
								) : null}
								{advanced ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: spacing[1.5],
										}}
									>
										<text style={labelStyle}>Host URL</text>
										<input
											value={webUrl}
											aria-label="Host URL"
											testId="account-host"
											readOnly={busy || !!replacing}
											tabIndex={0}
											style={fieldStyle}
											onChange={(event) => setWebUrl(event.value ?? "")}
										/>
										<text style={{ ...labelStyle, ...typography.sm }}>
											For GitHub Enterprise or self-managed GitLab. Register on
											this host.
										</text>
										{provider === "gitlab" && !manual ? (
											<>
												<text style={labelStyle}>Registered callback URL</text>
												<input
													aria-label="Registered callback URL"
													testId="account-callback"
													value={redirectUri}
													tabIndex={0}
													readOnly={busy}
													style={fieldStyle}
													onChange={(event) =>
														setRedirectUri(event.value ?? "")
													}
												/>
											</>
										) : null}
									</div>
								) : null}
							</div>
						</div>
						<div testId="account-setup-footer" style={footerStyle}>
							{error ? (
								<text
									role="alert"
									testId="accounts-error"
									style={{ ...labelStyle, color: appTokens.colors.danger }}
								>
									{error}
								</text>
							) : null}
							<div
								testId="account-setup-actions"
								style={{
									display: "flex",
									flexDirection: "row",
									justifyContent: "space-between",
									gap: spacing[2],
									width: "100%",
									maxWidth: sectionMaxWidth,
								}}
							>
								<Button
									tokens={appTokens}
									size="sm"
									variant="secondary"
									testId="accounts-cancel"
									disabled={busy && !waiting}
									onPress={() => {
										if (busy) {
											request.current?.abort();

											return;
										}

										token.current = "";
										setHasToken(false);
										setError(undefined);
										setForm("list");
									}}
								>
									{busy ? "Cancel sign-in" : "Cancel"}
								</Button>
								<Button
									tokens={appTokens}
									size="sm"
									testId="account-connect"
									disabled={
										busy ||
										!(manual ? hasToken : clientId.trim()) ||
										!accountSetupUrl(
											provider,
											webUrl,
											manual ? "token" : "browser"
										)
									}
									onPress={connect}
								>
									{busy
										? "Working…"
										: manual
											? "Connect"
											: "Sign in with browser"}
								</Button>
							</div>
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
							<text style={{ ...typography.md, color: appTokens.colors.text }}>
								{`${removing.username} · ${accountSetup[removing.provider].name} · ${removingHost.host}${removingHost.pathname === "/" ? "" : removingHost.pathname}`}
							</text>
						) : null}
						<text style={labelStyle}>
							{`Removes this account and its saved credentials from 1git. Your ${removing ? accountSetup[removing.provider].name : "hosting"} account and repositories stay unchanged.`}
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
		</AppShell>
	);
}
