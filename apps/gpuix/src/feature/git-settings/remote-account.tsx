import { useAppTheme } from "../../styles/theme";
import { useState } from "react";
import { iconSize, spacing, typography } from "@1git/design-tokens";
import { parseRemote } from "@1git/hosting/remote";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";
import { AccountStore, type SavedAccount } from "../accounts/lib/account-store";
import type { RemoteAccounts } from "../accounts/lib/remote-accounts";
import { accountProviderIcons } from "../accounts/account-provider-icons";
import { accountActionIcons } from "../accounts/account-list";
import { settingsStyles } from "../settings/settings-layout";
import { ChoiceTile } from "../../fixture/choice-tile";

import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";

/** Remote-host glyph, independent of authentication; unknown/local destinations use the Git icon. */
export function RemoteProviderIcon({
	url,
	accounts,
	testId,
}: {
	url: string;
	accounts: readonly SavedAccount[];
	testId: string;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const parsed = parseRemote(
		url,
		accounts.map((account) =>
			account.provider === "github"
				? new GitHubProvider({ webUrl: account.webUrl })
				: new GitLabProvider({ webUrl: account.webUrl })
		)
	);

	const provider = parsed.ok ? parsed.value.providerId : undefined;

	const source =
		provider === "github" || provider === "gitlab"
			? accountProviderIcons[provider]
			: undefined;

	return (
		<div
			testId={testId}
			aria-hidden
			style={{
				width: iconSize.xl,
				height: iconSize.xl,
				flexShrink: 0,
				pointerEvents: "none",
			}}
		>
			{source ? (
				<svg
					testId={`${testId}-${provider}`}
					source={source}
					style={{
						width: iconSize.xl,
						height: iconSize.xl,
						color: appTokens.colors.textMuted,
					}}
				/>
			) : (
				<WorkspaceTabIcon
					testId={`${testId}-custom`}
					name="branch"
					size={iconSize.xl}
				/>
			)}
		</div>
	);
}

/** Public authentication summary, or draft tiles inside the remote editor. Never reads credentials. */
export function RemoteAccount({
	bindings,
	directory,
	remote,
	url,
	label = "Account",
	value,
	disabled = false,
	onChange,
}: {
	bindings: RemoteAccounts;
	directory: string;
	remote: string;
	url: string;
	label?: string;
	value?: string;
	disabled?: boolean;
	onChange?: (value: string) => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const styles = settingsStyles.get(theme);

	const [state] = useState(() => {
		try {
			return {
				choice: bindings.choice(directory, remote, url),
				accounts: bindings.matching(url),
				error: "",
			};
		} catch {
			return {
				choice: "automatic",
				accounts: [],
				error: "Could not read remote account settings.",
			};
		}
	});

	const choice = value ?? state.choice;
	const destinationId = `${remote}-${encodeURIComponent(url)}`;

	const account =
		choice === "automatic"
			? state.accounts.length === 1
				? state.accounts[0]
				: undefined
			: state.accounts.find((item) => AccountStore.key(item) === choice);

	const unavailable = !account && choice !== "automatic" && choice !== "system";

	const name =
		account?.username ??
		(unavailable
			? "Account unavailable"
			: choice === "automatic" && state.accounts.length > 1
				? "Choose an account"
				: "System Git credentials");

	const choices = [
		{
			value: "automatic",
			label: "Automatic",
			source: accountActionIcons.check,
			detail:
				state.accounts.length === 1
					? state.accounts[0]?.username
					: state.accounts.length
						? "Ask when syncing"
						: "System Git credentials",
		},
		{
			value: "system",
			label: "System Git",
			source: accountActionIcons.reconnect,
			detail: "Existing Git credentials",
		},
		...state.accounts.map((item) => ({
			value: AccountStore.key(item),
			label: item.username,
			source: accountProviderIcons[item.provider],
			detail: new URL(item.webUrl).host,
		})),
	];

	return (
		<div
			testId={`remote-account-${onChange ? "editor-" : ""}${destinationId}`}
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[2],
				flexShrink: 0,
			}}
		>
			{onChange ? (
				<div
					role="group"
					aria-label={label}
					style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
				>
					<text style={styles.label}>{label}</text>
					{choices.map((item, index) =>
						index % 2 === 0 ? (
							<div
								key={item.value}
								style={{
									display: "flex",
									flexDirection: "row",
									gap: spacing[2],
									flexShrink: 0,
								}}
							>
								{choices.slice(index, index + 2).map((tile) => (
									<ChoiceTile
										key={tile.value}
										testId={`remote-account-choice-${destinationId}-${tile.value}`}
										label={tile.label}
										source={tile.source}
										detail={tile.detail}
										accessibleName={`${label}: ${tile.label}`}
										selected={choice === tile.value}
										disabled={disabled || !!state.error}
										onPress={() => onChange(tile.value)}
									/>
								))}
							</div>
						) : null
					)}
					{unavailable ? (
						<text style={{ ...styles.error }}>
							Account unavailable. Choose another account.
						</text>
					) : null}
				</div>
			) : (
				<div
					role="group"
					aria-label={`${label}: ${name}${choice === "automatic" ? ", Automatic" : ""}`}
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: spacing[1.5],
						minWidth: 0,
					}}
				>
					{label !== "Account" ? (
						<text style={{ ...styles.description }}>{`${label}:`}</text>
					) : null}
					<text
						style={{
							...typography.sm,
							color: unavailable
								? appTokens.colors.danger
								: appTokens.colors.text,
						}}
					>
						{name}
					</text>
					{choice === "automatic" ? (
						<text style={{ ...styles.description }}>Automatic</text>
					) : null}
				</div>
			)}
			{state.error ? (
				<text role="alert" style={{ ...styles.error }}>
					{state.error}
				</text>
			) : null}
		</div>
	);
}
