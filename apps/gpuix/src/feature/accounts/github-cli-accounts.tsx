import { spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useAppTheme } from "../../styles/theme";
import { ChoiceTile } from "../../fixture/choice-tile";
import { accountProviderIcons } from "./account-provider-icons";
import { AccountSetupSection } from "./account-connection-guide";
import type { AccountConnection } from "./use-account-connection";

/** Account selection shared by onboarding and Settings; contains public identities only. */
export function GitHubCliAccounts({
	connection,
}: {
	connection: AccountConnection;
}) {
	const { tokens } = useAppTheme();

	const {
		cliAccounts,
		cliSelected,
		setCliSelected,
		cliLoading,
		cliError,
		refreshCli,
		busy,
	} = connection;

	const style = { ...typography.sm, color: tokens.colors.textMuted };

	return (
		<AccountSetupSection label="Select a GitHub account">
			<text testId="account-cli-selection-help" style={style}>
				{cliSelected
					? `Ready to connect as ${cliSelected.username}. Click “Connect with GitHub CLI” below.`
					: "Select an account below to enable “Connect with GitHub CLI”."}
			</text>
			{cliLoading ? (
				<text testId="account-cli-loading" style={style}>
					Finding GitHub CLI accounts…
				</text>
			) : null}
			{cliError ? (
				<text
					testId="account-cli-error"
					role="alert"
					style={{ ...style, color: tokens.colors.danger }}
				>
					{cliError}
				</text>
			) : null}
			{!cliLoading && !cliError && cliAccounts.length === 0 ? (
				<text testId="account-cli-empty" style={style}>
					No signed-in accounts found. Run gh auth login in your terminal, then
					refresh.
				</text>
			) : null}
			<div
				role="group"
				aria-label="GitHub CLI accounts"
				style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
			>
				{cliAccounts.map((account, index) =>
					index % 2 === 0 ? (
						<div
							key={`${account.host}/${account.username}`}
							style={{
								display: "flex",
								flexDirection: "row",
								gap: spacing[2],
								flexShrink: 0,
							}}
						>
							{cliAccounts.slice(index, index + 2).map((choice) => {
								const selected =
									choice.host === cliSelected?.host &&
									choice.username === cliSelected.username;

								return (
									<ChoiceTile
										key={`${choice.host}/${choice.username}`}
										testId={`account-cli-${choice.host}-${choice.username}`}
										label={choice.username}
										detail={`${choice.host} · ${selected ? "Selected" : "Select"}`}
										source={accountProviderIcons.github}
										accessibleName={`Select ${choice.username} on ${choice.host}`}
										description={
											selected ? "Selected account" : "Choose this account"
										}
										selected={selected}
										disabled={busy || cliLoading}
										onPress={() => setCliSelected(choice)}
									/>
								);
							})}
						</div>
					) : null
				)}
			</div>
			<text style={style}>
				GitHub CLI keeps managing your credentials and permissions.
			</text>
			<Button
				tokens={tokens}
				size="sm"
				variant="ghost"
				testId="account-cli-refresh"
				disabled={busy || cliLoading}
				onPress={refreshCli}
			>
				Refresh accounts
			</Button>
		</AccountSetupSection>
	);
}
