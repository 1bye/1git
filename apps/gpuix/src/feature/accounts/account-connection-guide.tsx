import { Button } from "@1git/gpuix-ui/button";
import type { ReactNode } from "react";
import { appTokens } from "../../styles/tokens";
import type { SavedAccount } from "./lib/account-store";
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
	github:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M206.13,75.92A57.79,57.79,0,0,0,201.2,29a6,6,0,0,0-5.2-3,57.77,57.77,0,0,0-47,24H123A57.77,57.77,0,0,0,76,26a6,6,0,0,0-5.2,3,57.79,57.79,0,0,0-4.93,46.92A55.88,55.88,0,0,0,58,104v8a54.06,54.06,0,0,0,50.45,53.87A37.85,37.85,0,0,0,98,192v10H72a26,26,0,0,1-26-26A38,38,0,0,0,8,138a6,6,0,0,0,0,12,26,26,0,0,1,26,26,38,38,0,0,0,38,38H98v18a6,6,0,0,0,12,0V192a26,26,0,0,1,52,0v40a6,6,0,0,0,12,0V192a37.85,37.85,0,0,0-10.45-26.13A54.06,54.06,0,0,0,214,112v-8A55.88,55.88,0,0,0,206.13,75.92ZM202,112a42,42,0,0,1-42,42H112a42,42,0,0,1-42-42v-8a43.86,43.86,0,0,1,7.3-23.69,6,6,0,0,0,.81-5.76,45.85,45.85,0,0,1,1.43-36.42,45.85,45.85,0,0,1,35.23,21.1A6,6,0,0,0,119.83,62h32.34a6,6,0,0,0,5.06-2.76,45.83,45.83,0,0,1,35.23-21.11,45.85,45.85,0,0,1,1.43,36.42,6,6,0,0,0,.79,5.74A43.78,43.78,0,0,1,202,104Z"/></svg>',
	gitlab:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M228.21,117.61,208.32,41.49a9.94,9.94,0,0,0-19-.93L171.17,90H84.83L66.66,40.56a9.94,9.94,0,0,0-19,.93L27.79,117.61A55.18,55.18,0,0,0,49,176.42l73.27,51.77a9.94,9.94,0,0,0,11.44,0L207,176.42A55.18,55.18,0,0,0,228.21,117.61ZM57.65,50.82,75,98.07A6,6,0,0,0,80.64,102h94.72A6,6,0,0,0,181,98.07l17.36-47.25,15,57.52L128,168.66,42.62,108.34ZM39.38,120.74,117.6,176,93.41,193.1,55.94,166.62A43.1,43.1,0,0,1,39.38,120.74ZM128,217.53l-24.19-17.09L128,183.35l24.19,17.09Zm72.06-50.91L162.59,193.1,138.4,176l78.22-55.26A43.1,43.1,0,0,1,200.06,166.62Z"/></svg>',
	other:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M138,180a10,10,0,1,1-10-10A10,10,0,0,1,138,180ZM128,74c-21,0-38,15.25-38,34v4a6,6,0,0,0,12,0v-4c0-12.13,11.66-22,26-22s26,9.87,26,22-11.66,22-26,22a6,6,0,0,0-6,6v8a6,6,0,0,0,12,0v-2.42c18.11-2.58,32-16.66,32-33.58C166,89.25,149,74,128,74Zm102,54A102,102,0,1,1,128,26,102.12,102.12,0,0,1,230,128Zm-12,0a90,90,0,1,0-90,90A90.1,90.1,0,0,0,218,128Z"/></svg>',
};

const column = { display: "flex", flexDirection: "column", gap: 6 };
const detail = { fontSize: 11, color: appTokens.colors.textMuted };
const title = { fontSize: 12, color: appTokens.colors.text, fontWeight: 500 };

function AccountChoiceTile({
	label,
	source,
	selected,
	disabled,
	autoFocus,
	testId,
	accessibleName = label,
	description,
	onPress,
}: {
	label: string;
	source: string;
	selected?: boolean;
	disabled: boolean;
	autoFocus?: boolean;
	testId: string;
	accessibleName?: string;
	description?: string;
	onPress: () => void;
}) {
	return (
		<Button
			testId={testId}
			aria-label={accessibleName}
			aria-description={description}
			aria-pressed={selected}
			disabled={disabled}
			autoFocus={autoFocus}
			tokens={appTokens}
			size="sm"
			variant={selected ? "secondary" : "ghost"}
			style={{
				flexGrow: 1,
				flexBasis: 0,
				height: 64,
				flexDirection: "column",
				gap: 6,
				borderColor: selected
					? appTokens.colors.accentBorder
					: appTokens.colors.border,
			}}
			onPress={onPress}
		>
			<svg
				testId={`${testId}-icon`}
				source={source}
				style={{
					width: 22,
					height: 22,
					color: selected
						? appTokens.colors.accent
						: appTokens.colors.textMuted,
					pointerEvents: "none",
				}}
			/>
			<text
				style={{
					fontSize: 12,
					color: appTokens.colors.text,
					pointerEvents: "none",
				}}
			>
				{label}
			</text>
		</Button>
	);
}

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
			style={{ display: "flex", flexDirection: "row", gap: 8 }}
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
						source={icons[provider]}
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
	disabled,
	onChange,
}: {
	value: "browser" | "token";
	disabled: boolean;
	onChange: (method: "browser" | "token") => void;
}) {
	return (
		<div
			role="group"
			aria-label="Connection method"
			style={{ display: "flex", flexDirection: "row", gap: 8 }}
		>
			{(["browser", "token"] as const).map((method) => (
				<AccountChoiceTile
					key={method}
					testId={`account-auth-${method}`}
					label={method === "browser" ? "Browser sign-in" : "Access token"}
					source={method === "browser" ? icons.browser : icons.key}
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

/** A numbered section in the account setup flow. */
export function AccountSetupStep({
	number,
	label,
	children,
}: {
	number: number;
	label: string;
	children: ReactNode;
}) {
	return (
		<div testId={`account-step-${number}`} style={{ ...column, flexShrink: 0 }}>
			<text style={title}>{`${number}. ${label}`}</text>
			{children}
		</div>
	);
}

/** Provider-specific setup instructions. Links are computed from public host metadata, never token input. */
export function AccountConnectionGuide({
	provider,
	manual,
	host,
	callback,
	disabled,
	onOpen,
}: {
	provider: SavedAccount["provider"];
	manual: boolean;
	host: string;
	callback: string;
	disabled: boolean;
	onOpen: (url: string) => void;
}) {
	const setupUrl = accountSetupUrl(
		provider,
		host,
		manual ? "token" : "browser"
	);

	const name = accountSetup[provider].name;

	return (
		<div testId="account-setup-guide" style={{ ...column, gap: 14 }}>
			<AccountSetupStep
				number={3}
				label={manual ? "Create an access token" : "Register an application"}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 8,
					}}
				>
					<text
						style={{ ...detail, flexGrow: 1, flexBasis: 0, minWidth: 0 }}
					>{`Name it 1git in your ${name} settings.`}</text>
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
			</AccountSetupStep>
			<AccountSetupStep
				number={4}
				label={manual ? "Choose permissions" : "Configure the application"}
			>
				{manual ? (
					<text style={detail}>
						{provider === "github"
							? "Use a fine-grained token with an expiry date. Keep repository access public-only; no extra permissions are needed for account connection."
							: "Choose an expiry date and select only read_user, then create the token."}
					</text>
				) : (
					<>
						{provider === "github" ? (
							<text style={{ ...detail, userSelect: "auto" }}>
								{`Homepage: ${applicationHomepage}`}
							</text>
						) : null}
						<text
							testId="account-setup-callback"
							style={{ ...detail, userSelect: "auto" }}
						>
							{`${provider === "github" ? "Callback" : "Redirect URI"}: ${provider === "github" ? defaultAccountCallback : callback}`}
						</text>
						<text style={detail}>
							{provider === "github"
								? "Enable Device Flow, then register the application."
								: "Uncheck Confidential, select read_user, then save the application."}
						</text>
					</>
				)}
			</AccountSetupStep>
		</div>
	);
}
