import { Button } from "@1git/gpuix-ui/button";
import { useState } from "react";
import { useAppTheme } from "../../styles/theme";
import { applicationHomepage } from "../accounts/lib/account-setup";
import { SettingsPage, settingsStyles } from "./settings-layout";
import { SettingsGroup, SettingsGroupRow } from "./settings-group";

const supportLinks = [
	{
		id: "create-issue",
		label: "Create an issue",
		description: "Report a bug or request a feature on GitHub.",
		action: "Create an issue",
		url: `${applicationHomepage}/issues/new`,
	},
	{
		id: "browse-issues",
		label: "Existing issues",
		description: "Check reported problems and planned improvements.",
		action: "Browse issues",
		url: `${applicationHomepage}/issues`,
	},
	{
		id: "project",
		label: "Project on GitHub",
		description: "Read about 1git, explore the source, or contribute.",
		action: "Open GitHub",
		url: applicationHomepage,
	},
] as const;

/** Setup, guided tips, and support links share a dedicated Settings destination. */
export function HelpSettings({
	onReplayTips,
	onSetup,
	busy = false,
	openLink,
}: {
	onReplayTips?: () => void;
	onSetup?: () => void;
	busy?: boolean;
	openLink: (url: string) => Promise<void>;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);
	const [error, setError] = useState<string | null>(null);

	const openSupportLink = async (url: string): Promise<void> => {
		setError(null);

		try {
			await openLink(url);
		} catch {
			setError("Could not open GitHub in your browser. Try again.");
		}
	};

	return (
		<SettingsPage
			testId="help-settings"
			scrollTestId="help-settings-scroll"
			title="Help"
			description="Guides, setup, and support for 1git."
			width="single"
		>
			{onReplayTips || onSetup ? (
				<SettingsGroup title="Getting started">
					{onReplayTips ? (
						<SettingsGroupRow
							label="Guided tips"
							description="Rediscover shortcuts and workspace features."
							trailing={
								<Button
									testId="settings-replay-tips"
									tokens={tokens}
									variant="secondary"
									size="sm"
									onPress={onReplayTips}
								>
									Show again
								</Button>
							}
						/>
					) : null}
					{onSetup ? (
						<SettingsGroupRow
							label="First-run setup"
							trailing={
								<Button
									testId="settings-run-setup"
									tokens={tokens}
									variant="secondary"
									size="sm"
									disabled={busy}
									onPress={onSetup}
								>
									Run setup again
								</Button>
							}
						/>
					) : null}
				</SettingsGroup>
			) : null}
			<SettingsGroup title="Support">
				{supportLinks.map((link) => (
					<SettingsGroupRow
						key={link.id}
						label={link.label}
						description={link.description}
						trailing={
							<Button
								testId={`help-${link.id}`}
								tokens={tokens}
								variant="secondary"
								size="sm"
								onPress={() => void openSupportLink(link.url)}
							>
								{link.action}
							</Button>
						}
					/>
				))}
			</SettingsGroup>
			{error ? (
				<text testId="help-link-error" role="alert" style={styles.error}>
					{error}
				</text>
			) : null}
		</SettingsPage>
	);
}
