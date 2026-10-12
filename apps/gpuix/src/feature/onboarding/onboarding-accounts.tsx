import { fontWeight, spacing, typography } from "@1git/design-tokens";
import { ChoiceTile } from "../../fixture/choice-tile";
import { useAppTheme } from "../../styles/theme";
import { accountProviderIcons } from "../accounts/account-provider-icons";
import { accountSetup } from "../accounts/lib/account-setup";
import { AccountStore } from "../accounts/lib/account-store";
import type { AccountConnection } from "../accounts/use-account-connection";

/** Account overview stays visible beside the separate connection editor. */
export function OnboardingAccounts({
	connection,
	disabled,
}: {
	connection: AccountConnection;
	disabled: boolean;
}) {
	const { tokens } = useAppTheme();
	const muted = { ...typography.sm, color: tokens.colors.textMuted };

	const providers = (
		<div
			role="group"
			aria-label="Connect a hosting account"
			style={{ display: "flex", flexDirection: "row", gap: spacing[2] }}
		>
			{(["github", "gitlab"] as const).map((provider) => (
				<ChoiceTile
					key={provider}
					testId={`onboarding-provider-${provider}`}
					label={accountSetup[provider].name}
					source={accountProviderIcons[provider]}
					accessibleName={`Connect ${accountSetup[provider].name}`}
					selected={
						connection.form === "connect" && connection.provider === provider
					}
					disabled={disabled}
					onPress={() => {
						if (connection.form === "connect")
							connection.changeProvider(provider);
						else connection.startConnection(undefined, provider);
					}}
				/>
			))}
		</div>
	);

	return (
		<div
			testId="onboarding-accounts"
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[3],
				flexShrink: 0,
			}}
		>
			<text style={{ ...muted, whiteSpace: "normal" }}>
				Connect GitHub or GitLab, or continue without an account. Git
				credentials stay separate.
			</text>
			{providers}
			{connection.saved.length ? (
				<div
					testId="onboarding-connected-accounts"
					style={{
						display: "flex",
						flexDirection: "column",
						gap: spacing[2],
						flexShrink: 0,
					}}
				>
					<text style={muted}>Your accounts</text>
					{connection.saved.map((account) => (
						<div
							key={AccountStore.key(account)}
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: spacing[2.5],
								flexShrink: 0,
							}}
						>
							<svg
								source={accountProviderIcons[account.provider]}
								style={{
									width: 22,
									height: 22,
									color: tokens.colors.textMuted,
								}}
							/>
							<div style={{ minWidth: 0, flexGrow: 1 }}>
								<text
									style={{
										...typography.md,
										color: tokens.colors.text,
										fontWeight: fontWeight.medium,
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{account.username}
								</text>
								<text
									style={{
										...muted,
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>{`${new URL(account.webUrl).host} · ${connection.status[AccountStore.key(account)] ?? "Saved account"}`}</text>
							</div>
						</div>
					))}
				</div>
			) : null}
			{connection.error && connection.form === "list" ? (
				<text
					role="alert"
					testId="accounts-error"
					style={{ ...muted, color: tokens.colors.danger }}
				>
					{connection.error}
				</text>
			) : null}
		</div>
	);
}
