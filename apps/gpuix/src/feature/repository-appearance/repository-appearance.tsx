import { radius, spacing } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { AppThemeContext, useAppTheme } from "../../styles/theme";
import { RepositoryTheme } from "../../styles/repository-theme";
import { SettingsPage, settingsStyles } from "../settings/settings-layout";
import { SettingsGroup } from "../settings/settings-group";
import { RepositoryPatternLayer } from "./repository-pattern-layer";
import { repositoryColorPresets } from "./repository-colors";
import {
	repositoryPatternPresets,
	type RepositoryAppearanceValue,
} from "./repository-patterns";

/** Local preview and quick colours; full customization uses the mounted repository. */
export function RepositoryAppearance({
	name,
	color,
	pattern,
	patternSeed,
	patternAdjustments,
	onCustomize,
	onChange,
}: {
	name: string;
	onCustomize?: () => void;
	onChange?: (value: RepositoryAppearanceValue) => void;
} & RepositoryAppearanceValue) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);

	const preview = RepositoryTheme.create(
		theme,
		color,
		pattern,
		patternSeed,
		patternAdjustments
	);

	const patternName =
		repositoryPatternPresets.find((preset) => preset.id === pattern)?.name ??
		"No pattern";

	return (
		<SettingsPage
			testId="repository-appearance"
			title="Repository appearance"
			description={`A local look for ${name}.`}
		>
			<SettingsGroup
				title="Workspace"
				icon="palette"
				footer="Settings steps aside while you choose a color or pattern. Done saves your changes; Escape cancels. Saved on this device and shared by this repository’s worktrees."
			>
				<div style={{ ...styles.column, padding: spacing[4] }}>
					<AppThemeContext value={{ ...theme, ...preview }}>
						<div
							testId="repository-appearance-preview"
							aria-label={`Workspace preview for ${name}`}
							style={{
								display: "flex",
								flexDirection: "column",
								height: 184,
								position: "relative",
								overflowX: "hidden",
								overflowY: "hidden",
								borderWidth: 1,
								borderColor: preview.tokens.colors.border,
								borderRadius: radius.md,
								backgroundColor: preview.colors.chrome,
							}}
						>
							{pattern ? (
								<RepositoryPatternLayer
									pattern={pattern}
									seed={patternSeed}
									adjustments={patternAdjustments}
								/>
							) : null}
							<div
								style={{
									display: "flex",
									flexDirection: "row",
									height: 40,
									paddingLeft: spacing[3],
									alignItems: "flex-end",
								}}
							>
								<div
									testId="repository-appearance-preview-tab"
									style={{
										display: "flex",
										flexDirection: "row",
										alignItems: "center",
										gap: spacing[2],
										padding: spacing[2],
										backgroundColor: preview.colors.editorSurface,
										borderTopLeftRadius: radius.md,
										borderTopRightRadius: radius.md,
									}}
								>
									<div
										style={{
											width: 7,
											height: 7,
											borderRadius: radius.full,
											backgroundColor: preview.colors.brand,
										}}
									/>
									<text
										style={{
											...styles.label,
											color: preview.tokens.colors.text,
										}}
									>
										{name}
									</text>
								</div>
							</div>
							<div
								style={{ display: "flex", flexDirection: "row", flexGrow: 1 }}
							>
								<div
									testId="repository-appearance-preview-rail"
									style={{
										width: 52,
										alignItems: "center",
										paddingTop: spacing[3],
										gap: spacing[3],
										display: "flex",
										flexDirection: "column",
									}}
								>
									{["Changes", "History", "Branches"].map((label, index) => (
										<div
											key={label}
											aria-hidden
											style={{
												width: 22,
												height: 22,
												borderRadius: radius.sm,
												backgroundColor:
													index === 0
														? preview.tokens.colors.accent
														: preview.tokens.colors.surface,
												borderWidth: 1,
												borderColor: preview.tokens.colors.border,
											}}
										/>
									))}
								</div>
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										flexGrow: 1,
										padding: spacing[3],
										gap: spacing[2],
										backgroundColor: preview.colors.editorSurface,
										borderTopLeftRadius: radius.md,
									}}
								>
									<text
										style={{
											...styles.label,
											color: preview.tokens.colors.text,
										}}
									>
										Changes
									</text>
									<text
										style={{
											...styles.description,
											color: preview.tokens.colors.textMuted,
										}}
									>
										Working tree is up to date
									</text>
									<div
										style={{
											height: 1,
											backgroundColor: preview.tokens.colors.border,
										}}
									/>
									<text
										style={{
											...styles.description,
											color: preview.colors.brand,
										}}
									>
										{patternName}
									</text>
								</div>
							</div>
						</div>
					</AppThemeContext>
					<text style={styles.label}>Quick color</text>
					<div
						role="group"
						aria-label="Repository colors"
						style={{
							display: "flex",
							flexDirection: "row",
							flexWrap: "wrap",
							gap: spacing[2],
						}}
					>
						<Button
							testId="repository-appearance-color-default"
							tokens={tokens}
							size="sm"
							variant="secondary"
							disabled={!onChange}
							aria-description={!color ? "Selected" : undefined}
							onPress={() =>
								onChange?.({
									color: undefined,
									pattern,
									patternSeed,
									patternAdjustments,
								})
							}
						>
							Default
						</Button>
						{repositoryColorPresets.map((preset) => (
							<Button
								key={preset.color}
								testId={`repository-appearance-color-${preset.name.toLowerCase()}`}
								aria-label={`${preset.name} repository color`}
								aria-description={
									color === preset.color ? "Selected" : undefined
								}
								tokens={tokens}
								variant="secondary"
								size="sm"
								disabled={!onChange}
								onPress={() =>
									onChange?.({
										color: preset.color,
										pattern,
										patternSeed,
										patternAdjustments,
									})
								}
								style={{
									width: 28,
									height: 28,
									padding: 0,
									borderWidth: 2,
									borderColor:
										color === preset.color
											? tokens.colors.focusRing
											: tokens.colors.border,
								}}
							>
								<div
									aria-hidden
									style={{
										width: 18,
										height: 18,
										borderRadius: radius.full,
										backgroundColor: preset.color,
										pointerEvents: "none",
									}}
								/>
							</Button>
						))}
					</div>
					<Button
						testId="repository-appearance-customize"
						tokens={tokens}
						variant="secondary"
						onPress={onCustomize}
						disabled={!onCustomize}
						style={{ alignSelf: "flex-start" }}
					>
						Customize on repository
					</Button>
				</div>
			</SettingsGroup>
		</SettingsPage>
	);
}
