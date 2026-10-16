import { fontWeight, radius, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import type { StyleDesc } from "@gpuix/react";
import type { ReactNode } from "react";
import { NativeClipboard } from "../../platform/clipboard";
import { createThemedStyles, useAppTheme } from "../../styles/theme";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import {
	AccountConnectionGuide,
	AccountMethodChoices,
	AccountProviderChoices,
	AccountSetupSection,
} from "./account-connection-guide";
import { accountSetup, accountSetupUrl } from "./lib/account-setup";
import { GitHubCliAccounts } from "./github-cli-accounts";
import type { AccountConnection } from "./use-account-connection";

const themedStyles = createThemedStyles(({ tokens }) => ({
	fieldStyle: {
		height: tokens.layout.controlHeight,
		...typography.md,
		color: tokens.colors.text,
		backgroundColor: "transparent",
		borderWidth: 1,
		borderRadius: radius.md,
		borderColor: tokens.colors.border,
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		flexShrink: 0,
	},
	labelStyle: { ...typography.md, color: tokens.colors.textMuted },
}));

/** Same authentication controls in Settings and onboarding, with a composed provider picker. */
export function AccountConnectionFields({
	connection,
	providerChoices,
	copyText = NativeClipboard.write,
	maxWidth = 480,
}: {
	connection: AccountConnection;
	providerChoices?: ReactNode;
	copyText?: (value: string) => Promise<void>;
	maxWidth?: StyleDesc["maxWidth"];
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { fieldStyle, labelStyle } = themedStyles[theme.appearance];

	const {
		provider,
		busy,
		replacing,
		openSetupLink,
		changeProvider,
		manual,
		changeMethod,
		repositoryAccess,
		setRepositoryAccess,
		webUrl,
		redirectUri,
		editorVersion,
		setToken,
		clientId,
		setClientId,
		device,
		advanced,
		setAdvanced,
		setWebUrl,
		setRedirectUri,
	} = connection;

	return (
		<div
			testId="account-setup-content"
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[3.5],
				width: "100%",
				maxWidth,
				flexShrink: 0,
			}}
		>
			{providerChoices ?? (
				<AccountSetupSection label="Provider">
					<AccountProviderChoices
						value={provider}
						disabled={busy || !!replacing}
						onOpen={(url) => {
							void openSetupLink(url);
						}}
						onChange={changeProvider}
					/>
				</AccountSetupSection>
			)}
			<AccountSetupSection label="Connect with">
				<AccountMethodChoices
					value={connection.method}
					githubCli={provider === "github"}
					disabled={busy}
					onChange={changeMethod}
				/>
			</AccountSetupSection>
			{connection.method === "github-cli" ? (
				<GitHubCliAccounts connection={connection} />
			) : (
				<>
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
								onChange={(event) => setToken(event.value ?? "")}
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
						<text testId="account-authorization-progress" style={labelStyle}>
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
						<WorkspaceTabIcon name={advanced ? "caretDown" : "caretRight"} />
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
								For GitHub Enterprise or self-managed GitLab. Register on this
								host.
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
										onChange={(event) => setRedirectUri(event.value ?? "")}
									/>
								</>
							) : null}
						</div>
					) : null}
				</>
			)}
		</div>
	);
}

/** Keep actions outside the scrollable form so cancellation is always accessible. */
export function AccountConnectionActions({
	connection,
	maxWidth = 480,
}: {
	connection: AccountConnection;
	maxWidth?: StyleDesc["maxWidth"];
}) {
	const { tokens: appTokens } = useAppTheme();
	const labelStyle = { ...typography.md, color: appTokens.colors.textMuted };

	const {
		error,
		busy,
		waiting,
		cancelConnection,
		manual,
		hasToken,
		clientId,
		provider,
		webUrl,
		connect,
	} = connection;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[2],
				width: "100%",
			}}
		>
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
					maxWidth,
				}}
			>
				<Button
					tokens={appTokens}
					size="sm"
					variant="secondary"
					testId="accounts-cancel"
					disabled={busy && !waiting}
					onPress={cancelConnection}
				>
					{busy ? "Cancel sign-in" : "Cancel"}
				</Button>
				<Button
					tokens={appTokens}
					size="sm"
					testId="account-connect"
					disabled={
						busy ||
						(connection.method === "github-cli"
							? connection.cliLoading || !connection.cliSelected
							: !(manual ? hasToken : clientId.trim()) ||
								!accountSetupUrl(
									provider,
									webUrl,
									manual ? "token" : "browser"
								))
					}
					onPress={connect}
				>
					{busy
						? "Working…"
						: connection.method === "github-cli"
							? "Connect with GitHub CLI"
							: manual
								? "Connect"
								: "Sign in with browser"}
				</Button>
			</div>
		</div>
	);
}
