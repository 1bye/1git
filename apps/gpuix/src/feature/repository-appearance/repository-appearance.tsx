import { radius, spacing } from "@1git/design-tokens";
import {
	SettingsPage,
	SettingsSection,
	settingsStyles,
} from "../settings/settings-layout";
import { Button } from "@1git/gpuix-ui/button";
import { useAppTheme } from "../../styles/theme";
import {
	repositoryPatternPresets,
	type RepositoryAppearanceValue,
} from "./repository-patterns";

/** Settings entry point; customization happens over the user's mounted repository. */
export function RepositoryAppearance({
	name,
	color,
	pattern,
	onCustomize,
}: { name: string; onCustomize?: () => void } & RepositoryAppearanceValue) {
	const theme = useAppTheme();
	const { tokens, colors } = theme;
	const styles = settingsStyles.get(theme);

	const patternName =
		repositoryPatternPresets.find((preset) => preset.id === pattern)?.name ??
		"No pattern";

	return (
		<SettingsPage
			testId="repository-appearance"
			title="Repository appearance"
			description={`Customize ${name} while looking at your actual workspace.`}
		>
			<SettingsSection>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: spacing[2],
					}}
				>
					<div
						aria-hidden
						style={{
							width: 20,
							height: 20,
							flexShrink: 0,
							borderRadius: radius.full,
							backgroundColor: color ?? colors.brand,
							borderWidth: 1,
							borderColor: tokens.colors.border,
						}}
					/>
					<text
						style={{ ...styles.label }}
					>{`${color ?? "Default color"} · ${patternName}`}</text>
				</div>
				<Button
					testId="repository-appearance-customize"
					style={{ alignSelf: "flex-start" }}
					tokens={tokens}
					onPress={onCustomize}
					disabled={!onCustomize}
				>
					Customize on repository
				</Button>
				<text style={{ ...styles.description }}>
					Settings steps aside while you choose a color or pattern. Done saves
					your changes; Escape cancels. Saved on this device and shared by this
					repository’s worktrees.
				</text>
			</SettingsSection>
		</SettingsPage>
	);
}
