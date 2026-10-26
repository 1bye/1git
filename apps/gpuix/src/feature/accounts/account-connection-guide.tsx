import { settingsLayout, settingsStyles } from "../settings/settings-layout";
import { useAppTheme } from "../../styles/theme";
import { spacing, radius } from "@1git/design-tokens";
import { ChoiceTile as AccountChoiceTile } from "../../fixture/choice-tile";
import { Button } from "@1git/gpuix-ui/button";
import { useState, type ReactNode } from "react";

import type { SavedAccount } from "./lib/account-store";
import type { AccountConnectionMethod } from "./use-account-connection";
import { accountProviderIcons } from "./account-provider-icons";
import {
	accountSetup,
	accountSetupUrl,
	applicationHomepage,
	defaultAccountCallback,
	missingProviderUrl,
} from "./lib/account-setup";

// Phosphor Icons 2.1.10, Light weight. See ../../../LICENSES/Phosphor-Icons.txt.
const icons = {
	browser:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M216,42H40A14,14,0,0,0,26,56V200a14,14,0,0,0,14,14H216a14,14,0,0,0,14-14V56A14,14,0,0,0,216,42ZM40,54H216a2,2,0,0,1,2,2V90H38V56A2,2,0,0,1,40,54ZM216,202H40a2,2,0,0,1-2-2V102H218v98A2,2,0,0,1,216,202Z"/></svg>',
	key: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M215.15,40.85A78,78,0,0,0,86.2,121.31l-56.1,56.1a13.94,13.94,0,0,0-4.1,9.9V216a14,14,0,0,0,14,14H72a6,6,0,0,0,6-6V206H96a6,6,0,0,0,6-6V182h18a6,6,0,0,0,4.24-1.76l10.45-10.44A77.59,77.59,0,0,0,160,174h.1A78,78,0,0,0,215.15,40.85ZM226,98.16c-1.12,35.16-30.67,63.8-65.88,63.84a65.93,65.93,0,0,1-24.51-4.67,6,6,0,0,0-6.64,1.26L117.51,170H96a6,6,0,0,0-6,6v18H72a6,6,0,0,0-6,6v18H40a2,2,0,0,1-2-2V187.31a2,2,0,0,1,.58-1.41l58.83-58.83a6,6,0,0,0,1.26-6.64A65.61,65.61,0,0,1,94,95.92C94,60.71,122.68,31.16,157.83,30A66,66,0,0,1,226,98.16ZM190,76a10,10,0,1,1-10-10A10,10,0,0,1,190,76Z"/></svg>',
	other:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M138,180a10,10,0,1,1-10-10A10,10,0,0,1,138,180ZM128,74c-21,0-38,15.25-38,34v4a6,6,0,0,0,12,0v-4c0-12.13,11.66-22,26-22s26,9.87,26,22-11.66,22-26,22a6,6,0,0,0-6,6v8a6,6,0,0,0,12,0v-2.42c18.11-2.58,32-16.66,32-33.58C166,89.25,149,74,128,74Zm102,54A102,102,0,1,1,128,26,102.12,102.12,0,0,1,230,128Zm-12,0a90,90,0,1,0-90,90A90.1,90.1,0,0,0,218,128Z"/></svg>',
};

const column = {
	display: "flex",
	flexDirection: "column",
	gap: settingsLayout.labelGap,
};

/** Small, keyboard-activatable provider cells; unsupported providers open a contribution/request draft. */
export function AccountProviderChoices({
	value,
	disabled,
	onChange,
	onOpen,
}: {
	value: SavedAccount["provider"];
	disabled: boolean;
	onChange: (provider: SavedAccount["provider"]) => void;
	onOpen: (url: string) => void;
}) {
	return (
		<div
			role="group"
			aria-label="Hosting provider"
			style={{ display: "flex", flexDirection: "row", gap: spacing[2] }}
		>
			{(["github", "gitlab", "other"] as const).map((provider) => {
				const selected = value === provider;

				const name =
					provider === "other" ? "Other…" : accountSetup[provider].name;

				return (
					<AccountChoiceTile
						key={provider}
						testId={`account-provider-${provider}`}
						label={name}
						source={
							provider === "other"
								? icons.other
								: accountProviderIcons[provider]
						}
						accessibleName={
							provider === "other" ? "Request or contribute a provider" : name
						}
						description={
							provider === "other"
								? "Opens a GitHub issue draft with instructions for contributing a hosting provider."
								: selected
									? "Selected provider"
									: undefined
						}
						selected={provider === "other" ? undefined : selected}
						disabled={disabled}
						autoFocus={selected && !disabled}
						onPress={() =>
							provider === "other"
								? onOpen(missingProviderUrl)
								: onChange(provider)
						}
					/>
				);
			})}
		</div>
	);
}

/** Connection methods share the provider tiles' visual and native activation behavior. */
export function AccountMethodChoices({
	value,
	githubCli = false,
	disabled,
	onChange,
}: {
	value: AccountConnectionMethod;
	githubCli?: boolean;
	disabled: boolean;
	onChange: (method: AccountConnectionMethod) => void;
}) {
	return (
		<div
			role="group"
			aria-label="Connection method"
			style={{ display: "flex", flexDirection: "row", gap: spacing[2] }}
		>
			{(
				[
					"browser",
					"token",
					...(githubCli ? ["github-cli" as const] : []),
				] as const
			).map((method) => (
				<AccountChoiceTile
					key={method}
					testId={`account-auth-${method}`}
					label={
						method === "github-cli"
							? "GitHub CLI"
							: method === "browser"
								? "Browser"
								: "Access token"
					}
					accessibleName={method === "browser" ? "Browser sign-in" : undefined}
					source={
						method === "github-cli"
							? accountProviderIcons.github
							: method === "browser"
								? icons.browser
								: icons.key
					}
					selected={value === method}
					description={
						value === method ? "Selected connection method" : undefined
					}
					disabled={disabled}
					onPress={() => onChange(method)}
				/>
			))}
		</div>
	);
}

/** A compact, unnumbered group in the connection form. */
export function AccountSetupSection({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	const theme = useAppTheme();
	const { label: title } = settingsStyles.get(theme);

	return (
		<div style={{ ...column, flexShrink: 0 }}>
			<text style={title}>{label}</text>
			{children}
		</div>
	);
}

function AccountSetupValue({
	name,
	label,
	value,
	disabled,
	copyText,
}: {
	name: "name" | "homepage" | "callback";
	label: string;
	value: string;
	disabled: boolean;
	copyText: (value: string) => Promise<void>;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { description: detail } = settingsStyles.get(theme);

	const [result, setResult] = useState<"copying" | "copied" | "error">();

	const copy = async () => {
		setResult("copying");

		try {
			await copyText(value);
			setResult("copied");
		} catch {
			setResult("error");
		}
	};

	return (
		<div style={{ ...column, gap: spacing[1] }}>
			<text style={settingsStyles.get(theme).label}>{label}</text>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: spacing[2],
					minHeight: 32,
					borderWidth: 1,
					borderRadius: radius.md,
					borderColor: appTokens.colors.border,
					paddingLeft: spacing[2.5],
					paddingRight: spacing[1],
				}}
			>
				<text
					testId={`account-setup-${name}`}
					aria-label={`${label}: ${value}`}
					style={{
						...detail,
						color: appTokens.colors.text,
						userSelect: "auto",
						flexGrow: 1,
						flexBasis: 0,
						minWidth: 0,
						whiteSpace: "nowrap",
						overflowX: "hidden",
						textOverflow: "ellipsis",
					}}
				>
					{value}
				</text>
				<Button
					testId={`account-copy-${name}`}
					aria-label={`Copy ${label}`}
					aria-description={result === "copied" ? "Copied to clipboard" : value}
					size="sm"
					variant="ghost"
					tokens={appTokens}
					disabled={disabled || result === "copying"}
					style={{ width: 58 }}
					onPress={() => {
						void copy();
					}}
				>
					{result === "copied" ? "Copied" : "Copy"}
				</Button>
			</div>
			{result === "error" ? (
				<text
					role="alert"
					style={{ ...detail, color: appTokens.colors.danger }}
				>
					Could not copy. Try again.
				</text>
			) : null}
		</div>
	);
}

/** Provider-specific setup instructions. Links are computed from public host metadata, never token input. */
export function AccountConnectionGuide({
	repositoryAccess = false,
	provider,
	manual,
	host,
	callback,
	disabled,
	onOpen,
	copyText,
}: {
	repositoryAccess?: boolean;
	provider: SavedAccount["provider"];
	manual: boolean;
	host: string;
	callback: string;
	disabled: boolean;
	onOpen: (url: string) => void;
	copyText: (value: string) => Promise<void>;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { description: detail } = settingsStyles.get(theme);

	const setupUrl = accountSetupUrl(
		provider,
		host,
		manual ? "token" : "browser",
		repositoryAccess
	);

	const name = accountSetup[provider].name;

	return (
		<div
			testId="account-setup-guide"
			style={{ ...column, gap: settingsLayout.rowGap }}
		>
			<AccountSetupSection label={manual ? "Token setup" : "Application setup"}>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
						gap: spacing[2],
					}}
				>
					<text style={{ ...detail, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
						{manual
							? "Create a token using the details below."
							: "Register an OAuth app using these values."}
					</text>
					<Button
						testId="account-setup-open"
						size="sm"
						variant="secondary"
						tokens={appTokens}
						disabled={disabled || !setupUrl}
						onPress={() => {
							if (setupUrl) onOpen(setupUrl);
						}}
					>
						Open {name} settings
					</Button>
				</div>
				{!setupUrl ? (
					<text style={detail}>
						Enter a valid HTTPS host in Advanced to open its setup page.
					</text>
				) : null}
				<AccountSetupValue
					name="name"
					label={manual ? "Token name" : "Application name"}
					value="1git"
					disabled={disabled}
					copyText={copyText}
				/>
				{manual ? (
					<text style={detail}>
						{repositoryAccess
							? provider === "github"
								? "Use a fine-grained token with access to your chosen repositories and Contents: Read-only. Choose an expiry date; organization approval or SSO may be required."
								: "Choose an expiry date and select read_user, read_api and read_repository."
							: provider === "github"
								? "Use a fine-grained token with an expiry date. Keep repository access public-only; no extra permissions are needed for account connection."
								: "Choose an expiry date and select only read_user, then create the token."}
					</text>
				) : (
					<>
						{provider === "github" ? (
							<AccountSetupValue
								name="homepage"
								label="Homepage URL"
								value={applicationHomepage}
								disabled={disabled}
								copyText={copyText}
							/>
						) : null}
						<AccountSetupValue
							key={provider === "github" ? defaultAccountCallback : callback}
							name="callback"
							label={provider === "github" ? "Callback URL" : "Redirect URI"}
							value={provider === "github" ? defaultAccountCallback : callback}
							disabled={disabled}
							copyText={copyText}
						/>
						<text style={detail}>
							{provider === "github"
								? "Enable Device Flow, then register the application."
								: repositoryAccess
									? "Uncheck Confidential; enable read_user, read_api and read_repository, then save the application."
									: "Uncheck Confidential, select read_user, then save the application."}
						</text>
					</>
				)}
			</AccountSetupSection>
		</div>
	);
}
