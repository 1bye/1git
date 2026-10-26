import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { useState } from "react";
import { useAppTheme } from "../../styles/theme";
import {
	SettingsPage,
	SettingsSection,
	settingsStyles,
} from "../settings/settings-layout";
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
		<SettingsPage testId="privacy-settings" title="Privacy">
			<SettingsSection>
				<Checkbox
					testId="analytics-enabled"
					label="Share anonymous usage statistics"
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
				<text
					style={{
						...styles.description,
					}}
				>
					Help improve 1git by sharing app launches, version and onboarding
					completion with PostHog. Enabled by default; you can change this at
					any time.
				</text>
				<text
					style={{
						...styles.description,
					}}
				>
					No repository names, paths, code, commit messages or account details.
					Random identifiers stay in memory and rotate. No session recordings or
					automatic click tracking.
				</text>
				<text
					style={{
						...styles.description,
					}}
				>
					Disabling stops new events and cancels pending requests. Events
					already received by PostHog remain there.
				</text>
				{error ? (
					<text
						testId="analytics-preference-error"
						role="alert"
						style={styles.error}
					>
						{error}
					</text>
				) : null}
			</SettingsSection>
		</SettingsPage>
	);
}
