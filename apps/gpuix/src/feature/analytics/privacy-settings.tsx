import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { fontWeight, spacing, typography } from "@1git/design-tokens";
import { useState } from "react";
import { useAppTheme } from "../../styles/theme";
import { DesktopAnalytics } from "./desktop-analytics";
import type { AnonymousAnalytics } from "@1git/analytics/client";

/** Immediate, persistent control over the application's small set of anonymous usage events. */
export function PrivacySettings({
	analytics = DesktopAnalytics.preferences(),
}: {
	analytics?: AnonymousAnalytics;
}) {
	const { tokens } = useAppTheme();
	const [enabled, setEnabled] = useState(() => analytics.enabled);
	const [error, setError] = useState<string | null>(null);

	return (
		<div
			testId="privacy-settings"
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				overflowY: "scroll",
				padding: spacing[4],
				gap: spacing[3],
			}}
		>
			<text
				role="heading"
				aria-level={1}
				style={{
					...typography.lg,
					fontWeight: fontWeight.medium,
					color: tokens.colors.text,
				}}
			>
				Privacy
			</text>
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
					...typography.sm,
					color: tokens.colors.textMuted,
					maxWidth: 480,
				}}
			>
				Help improve 1git by sharing app launches, version and workspace feature
				usage with PostHog. Enabled by default; you can change this at any time.
			</text>
			<text
				style={{
					...typography.sm,
					color: tokens.colors.textMuted,
					maxWidth: 480,
				}}
			>
				No repository names, paths, code, commit messages or account details.
				Random identifiers stay in memory and rotate. No session recordings or
				automatic click tracking.
			</text>
			<text
				style={{
					...typography.sm,
					color: tokens.colors.textMuted,
					maxWidth: 480,
				}}
			>
				Disabling stops new events and cancels pending requests. Events already
				received by PostHog remain there.
			</text>
			{error ? (
				<text
					testId="analytics-preference-error"
					role="alert"
					style={{ ...typography.sm, color: tokens.colors.text }}
				>
					{error}
				</text>
			) : null}
		</div>
	);
}
