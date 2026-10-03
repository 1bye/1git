import { useEffect, useRef, useState, type ReactNode } from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import type { DeviceAuthorization } from "@1git/hosting/device-oauth";
import { AppShell } from "../../fixture/app-shell";
import { settingsNavigation } from "./lib/settings-shortcut";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@1git/gpuix-ui/select";
import { Accounts } from "./lib/accounts";
import { AccountStore, type SavedAccount } from "./lib/account-store";
import { NativeCredentials } from "./lib/native-credentials";
import { appTokens } from "../../styles/tokens";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";

const providers = [
	{ value: "github", label: "GitHub" },
	{ value: "gitlab", label: "GitLab" },
];

const fieldStyle = {
	height: 32,
	fontSize: 13,
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

/** Account settings are window-local. Tokens are transient refs and uncontrolled native password inputs, never renderer props. */
export function AccountsSettings({
	onBack,
	accounts: supplied,
	children,
}: {
	onBack: () => void;
	accounts?: Accounts;
	children?: ReactNode;
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
	const [webUrl, setWebUrl] = useState("https://github.com");
	const [clientId, setClientId] = useState("");

	const [redirectUri, setRedirectUri] = useState(
		"http://127.0.0.1:8765/oauth/callback"
	);

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
		setWebUrl(account?.webUrl ?? "https://github.com");
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
					setRedirectUri(
						registration.redirectUri ?? "http://127.0.0.1:8765/oauth/callback"
					);
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
					style={{
						display: "flex",
						flexDirection: "row",
						height: 46,
						alignItems: "center",
						paddingLeft: 92,
						gap: 12,
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
					>
						Back
					</Button>
					<text style={{ fontSize: 13, color: appTokens.colors.text }}>
						Settings
					</text>
					<div windowDrag style={{ height: "100%", flexGrow: 1 }} />
				</div>
			}
			navigation={
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						width: 200,
						padding: 12,
						borderRightWidth: 1,
						borderColor: appTokens.colors.border,
					}}
				>
					<Button
						tokens={appTokens}
						variant="secondary"
						aria-current="page"
						style={{ justifyContent: "flex-start" }}
					>
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
					flexDirection: "column",
					flexGrow: 1,
					overflowY: "scroll",
					padding: 28,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						width: "100%",
						maxWidth: 480,
						gap: 12,
					}}
				>
					<text
						role="heading"
						aria-level={1}
						style={{
							fontSize: 14,
							fontWeight: 500,
							color: appTokens.colors.text,
						}}
					>
						Accounts
					</text>
					<text style={labelStyle}>
						Connect your hosting accounts. Git credentials stay separate.
					</text>
					{form === "connect" ? (
						<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							<text style={labelStyle}>Provider</text>
							<Select
								items={providers}
								value={provider}
								onValueChange={(value) => {
									if (value !== "github" && value !== "gitlab") return;

									setProvider(value);
									setClientId("");
									setWebUrl(
										value === "github"
											? "https://github.com"
											: "https://gitlab.com"
									);
								}}
							>
								<SelectTrigger
									disabled={busy || !!replacing}
									aria-label="Hosting provider"
									style={{ width: "100%" }}
									testId="account-provider"
									tokens={appTokens}
								>
									<SelectValue tokens={appTokens} />
									<WorkspaceTabIcon name="caretDown" />
								</SelectTrigger>
								<SelectContent tokens={appTokens}>
									{providers.map((entry) => (
										<SelectItem
											testId={`account-provider-${entry.value}`}
											key={entry.value}
											value={entry.value}
											tokens={appTokens}
										>
											{entry.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
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
							{manual ? (
								<>
									<text style={labelStyle}>Access token</text>
									<input
										key={editorVersion}
										autoFocus={!busy}
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
								</>
							) : (
								<>
									<text style={labelStyle}>Application client ID</text>
									<input
										aria-label="Application client ID"
										testId="account-client-id"
										value={clientId}
										autoFocus
										tabIndex={0}
										readOnly={busy}
										style={fieldStyle}
										placeholder="Public client ID from the application registration"
										onChange={(event) => setClientId(event.value ?? "")}
									/>
									{provider === "gitlab" ? (
										<>
											<text style={labelStyle}>Registered callback URL</text>
											<input
												aria-label="Registered callback URL"
												testId="account-callback"
												value={redirectUri}
												tabIndex={0}
												readOnly={busy}
												style={fieldStyle}
												onChange={(event) => setRedirectUri(event.value ?? "")}
											/>
										</>
									) : null}
									<text style={{ ...labelStyle, fontSize: 11 }}>
										{provider === "github"
											? "Register an OAuth app with device flow enabled. Requests profile access only."
											: "Register a public (non-confidential) OAuth app with this exact callback URL. Requests profile access only."}
									</text>
								</>
							)}
							<Button
								tokens={appTokens}
								size="sm"
								variant="ghost"
								testId="account-auth-method"
								disabled={busy}
								style={{ alignSelf: "flex-start" }}
								onPress={() => {
									setManual(!manual);
									token.current = "";
									setHasToken(false);
									setError(undefined);
								}}
							>
								{manual ? "Use browser sign-in" : "Use an access token instead"}
							</Button>
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
						</div>
					) : (
						<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
							{!saved.length ? (
								<text testId="accounts-empty" style={labelStyle}>
									No accounts connected.
								</text>
							) : null}
							{saved.map((account) => {
								const key = AccountStore.key(account);

								return (
									<div
										key={key}
										style={{ display: "flex", flexDirection: "column", gap: 5 }}
									>
										<text
											style={{ fontSize: 14, color: appTokens.colors.text }}
										>
											{account.username} ·{" "}
											{account.provider === "github" ? "GitHub" : "GitLab"}
										</text>
										<text style={{ ...labelStyle, fontSize: 11 }}>
											{new URL(account.webUrl).host}
											{new URL(account.webUrl).pathname === "/"
												? ""
												: new URL(account.webUrl).pathname}{" "}
											· {status[key] ?? "Not checked"}
										</text>
										<div
											style={{ display: "flex", flexDirection: "row", gap: 6 }}
										>
											<Button
												size="sm"
												variant="secondary"
												tokens={appTokens}
												disabled={busy}
												testId={`account-check-${key}`}
												onPress={() => {
													void perform(async (signal) => {
														const message = await accounts.check(
															account,
															signal
														);

														if (mounted.current)
															setStatus((previous) => ({
																...previous,
																[key]: message,
															}));
													});
												}}
											>
												Check
											</Button>
											<Button
												size="sm"
												variant="ghost"
												tokens={appTokens}
												disabled={busy}
												onPress={() => startConnection(account)}
											>
												Reconnect
											</Button>
											<Button
												size="sm"
												variant="ghost"
												tokens={appTokens}
												disabled={busy}
												testId={`account-remove-${key}`}
												onPress={() => {
													void perform(async () => {
														const next = await accounts.disconnect(account);

														if (mounted.current) setSaved(next);
													});
												}}
											>
												Remove
											</Button>
										</div>
									</div>
								);
							})}
						</div>
					)}
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
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "space-between",
							gap: 8,
							marginTop: 4,
						}}
					>
						{form === "connect" || busy ? (
							<Button
								tokens={appTokens}
								variant="secondary"
								testId="accounts-cancel"
								disabled={busy && !waiting}
								onPress={() => {
									if (busy) {
										request.current?.abort();

										return;
									}

									if (form === "connect") {
										token.current = "";
										setHasToken(false);
										setError(undefined);
										setForm("list");
									} else onBack();
								}}
							>
								{busy
									? "Cancel sign-in"
									: form === "connect"
										? "Cancel"
										: "Back"}
							</Button>
						) : (
							<div />
						)}
						<Button
							tokens={appTokens}
							testId={form === "connect" ? "account-connect" : "account-add"}
							disabled={
								busy ||
								(form === "connect" &&
									(!(manual ? hasToken : clientId.trim()) || !webUrl.trim()))
							}
							onPress={form === "connect" ? connect : () => startConnection()}
						>
							{busy
								? "Working…"
								: form === "connect"
									? manual
										? "Connect"
										: "Sign in with browser"
									: "Add account"}
						</Button>
					</div>
				</div>
			</div>
		</AppShell>
	);
}
