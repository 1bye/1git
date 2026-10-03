import { useEffect, useRef, useState, type ReactNode } from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import type { DeviceAuthorization } from "@1git/hosting/device-oauth";
import { AppShell } from "../../fixture/app-shell";
import { settingsNavigation } from "./lib/settings-shortcut";
import {
	AccountConnectionGuide,
	AccountMethodChoices,
	AccountProviderChoices,
	AccountSetupStep,
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

const fieldStyle = {
	height: appTokens.layout.controlHeight,
	fontSize: 12,
	color: appTokens.colors.text,
	backgroundColor: "transparent",
	borderWidth: 1,
	borderRadius: 6,
	borderColor: appTokens.colors.border,
	paddingLeft: 10,
	paddingRight: 10,
	flexShrink: 0,
};

const labelStyle = { fontSize: 12, color: appTokens.colors.textMuted };
const sidebarWidth = 200;
const contentPadding = appTokens.layout.pagePadding;
const sectionMaxWidth = 480;

const headingStyle = {
	fontSize: 14,
	fontWeight: 500,
	color: appTokens.colors.text,
};

const footerStyle = {
	display: "flex",
	flexDirection: "column",
	flexShrink: 0,
	gap: 8,
	paddingTop: 12,
	paddingBottom: 12,
	paddingLeft: contentPadding,
	paddingRight: contentPadding,
	borderTopWidth: 1,
	borderColor: appTokens.colors.border,
};

const titleInset =
	workspaceLayout.workspaceSurfaceInset +
	sidebarWidth +
	contentPadding -
	workspaceLayout.tabContentInsetInlineStart;

/** Account settings are window-local. Tokens are transient refs and uncontrolled native password inputs, never renderer props. */
export function AccountsSettings({
	onBack,
	accounts: supplied,
	children,
	openLink = openAuthorizationBrowser,
}: {
	onBack: () => void;
	accounts?: Accounts;
	children?: ReactNode;
	/** System-browser boundary; native tests capture setup links without opening a real account. */
	openLink?: (url: string) => Promise<void>;
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
	const [form, setForm] = useState<"list" | "connect">("list");
	const [provider, setProvider] = useState<SavedAccount["provider"]>("github");
	const [webUrl, setWebUrl] = useState<string>(accountSetup.github.host);
	const [clientId, setClientId] = useState("");

	const [redirectUri, setRedirectUri] = useState(defaultAccountCallback);
	const [advanced, setAdvanced] = useState(false);

	const [manual, setManual] = useState(false);
	const [device, setDevice] = useState<DeviceAuthorization>();
	const [replacing, setReplacing] = useState<SavedAccount>();
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
		setForm("list");
		setError(undefined);
		setStatus({});

		try {
			setSaved(accounts.load());
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not load accounts."
			);
		}
	}, [accounts]);

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

		if (account)
			void perform(async () => {
				const registration = await accounts.registration(account);

				if (!mounted.current) return;

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

	return (
		<AppShell
			testId="settings-view"
			ref={view}
			workspaceLabel="Settings"
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
						padding: 12,
						gap: 6,
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
							gap: 4,
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
								gap: 12,
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
						{error && form === "list" ? (
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
									void perform(async () => {
										const next = await accounts.disconnect(account);

										if (mounted.current) setSaved(next);
									});
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
								gap: 4,
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
									gap: 14,
									width: "100%",
									maxWidth: sectionMaxWidth,
									flexShrink: 0,
								}}
							>
								<AccountSetupStep number={1} label="Choose a provider">
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
								</AccountSetupStep>
								<AccountSetupStep number={2} label="Choose how to connect">
									<AccountMethodChoices
										value={manual ? "token" : "browser"}
										disabled={busy}
										onChange={(method) => changeMethod(method === "token")}
									/>
								</AccountSetupStep>
								<AccountConnectionGuide
									provider={provider}
									manual={manual}
									host={webUrl}
									callback={redirectUri}
									disabled={busy}
									onOpen={(url) => {
										void openSetupLink(url);
									}}
								/>
								{manual ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: 6,
											flexShrink: 0,
										}}
									>
										<text
											style={{
												...labelStyle,
												color: appTokens.colors.text,
												fontWeight: 500,
											}}
										>
											5. Paste your access token
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
										<text style={{ ...labelStyle, fontSize: 11 }}>
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
											gap: 6,
											flexShrink: 0,
										}}
									>
										<text
											style={{
												...labelStyle,
												color: appTokens.colors.text,
												fontWeight: 500,
											}}
										>
											{`5. Paste the ${provider === "github" ? "Client ID" : "Application ID"}`}
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
										<text style={{ ...labelStyle, fontSize: 11 }}>
											Use the public ID, not the client secret. Sign-in requests
											profile access only.
										</text>
									</div>
								)}
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
											fontSize: 20,
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
										gap: 4,
										paddingLeft: 0,
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
										style={{ ...labelStyle, fontSize: 11 }}
									>{`Host: ${webUrl}`}</text>
								) : null}
								{advanced ? (
									<div
										style={{ display: "flex", flexDirection: "column", gap: 6 }}
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
										<text style={{ ...labelStyle, fontSize: 11 }}>
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
									gap: 8,
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
		</AppShell>
	);
}
