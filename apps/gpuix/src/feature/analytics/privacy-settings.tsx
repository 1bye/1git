import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { useState } from "react";
import { useAppTheme } from "../../styles/theme";
import { SettingsPage, settingsStyles } from "../settings/settings-layout";
import { SettingsGroup, SettingsGroupRow } from "../settings/settings-group";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { spacing } from "@1git/design-tokens";
import { DesktopAnalytics } from "./desktop-analytics";
import type { AnonymousAnalytics } from "@1git/analytics/client";

/** Immediate, persistent control over the application's small set of anonymous usage events. */
export function PrivacySettings({
	analytics = DesktopAnalytics.preferences(),
}: {
	analytics?: AnonymousAnalytics;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);
	const [enabled, setEnabled] = useState(() => analytics.enabled);
	const [error, setError] = useState<string | null>(null);

	return (
		<SettingsPage testId="privacy-settings" title="Privacy" width="single">
			<SettingsGroup testId="privacy-usage" title="Usage statistics">
				<SettingsGroupRow
					label="Share anonymous usage statistics"
					description="Help improve 1git with a small set of anonymous usage events. Enabled by default."
					trailing={
						<Checkbox
							testId="analytics-enabled"
							aria-label="Share anonymous usage statistics"
							checked={enabled}
							tokens={tokens}
							onCheckedChange={(next) => {
								try {
									analytics.setEnabled(next);
									setError(null);
								} catch (failure) {
									setError(
										failure instanceof Error
											? failure.message
											: "Could not save your analytics preference."
									);
								}

								setEnabled(analytics.enabled);
							}}
						/>
					}
				/>
			</SettingsGroup>
			<SettingsGroup
				testId="privacy-data"
				title="What's sent"
				footer="Random identifiers stay in memory and rotate. No session recordings or automatic click tracking. Disabling stops new events and cancels pending requests. Events already received by PostHog remain there."
			>
				<div role="group" aria-label="Sent">
					<text
						role="heading"
						aria-level={3}
						style={{
							...styles.navGroup,
							padding: spacing[3],
							paddingLeft: spacing[4],
						}}
					>
						Sent
					</text>
					{["App launches", "App version", "Onboarding completion"].map(
						(label) => (
							<SettingsGroupRow
								key={label}
								label={label}
								leading={<WorkspaceTabIcon name="check" />}
							/>
						)
					)}
				</div>
				<div role="group" aria-label="Never sent">
					<text
						role="heading"
						aria-level={3}
						style={{
							...styles.navGroup,
							padding: spacing[3],
							paddingLeft: spacing[4],
						}}
					>
						Never sent
					</text>
					{[
						"Repository names",
						"Paths",
						"Code",
						"Commit messages",
						"Account details",
					].map((label) => (
						<SettingsGroupRow
							key={label}
							label={label}
							leading={<WorkspaceTabIcon name="shield" />}
						/>
					))}
				</div>
			</SettingsGroup>
			{error ? (
				<text
					testId="analytics-preference-error"
					role="alert"
					style={styles.error}
				>
					{error}
				</text>
			) : null}
		</SettingsPage>
	);
}
