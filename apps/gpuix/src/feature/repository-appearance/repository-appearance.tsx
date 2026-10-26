import { useRef, useState } from "react";
import type { PublicInstance } from "@gpuix/react";
import { spacing } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { AppThemeContext, useAppTheme } from "../../styles/theme";
import { RepositoryTheme } from "../../styles/repository-theme";
import {
	SettingsPage,
	SettingsPreview,
	SettingsSplit,
	settingsStyles,
} from "../settings/settings-layout";
import { SettingsGroup } from "../settings/settings-group";
import { RepositoryWorkspacePreview } from "./repository-workspace-preview";
import { useRepositoryAppearanceControls } from "./use-repository-appearance-controls";
import type {
	RepositoryAppearanceValue,
	RepositoryAppearanceSection,
} from "./repository-patterns";

/** Full appearance controls with immediate saves and an optional full-workspace editor. */
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
	onCustomize?: (value: RepositoryAppearanceValue) => void;
	onChange?: (value: RepositoryAppearanceValue) => void;
} & RepositoryAppearanceValue) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);
	const scroll = useRef<PublicInstance>(null);
	const [section, setSection] = useState<RepositoryAppearanceSection>("color");
	const [draft, setDraft] = useState<string>();

	const { fields, finish } = useRepositoryAppearanceControls({
		color,
		pattern,
		patternSeed,
		patternAdjustments,
		section,
		onSectionChange: setSection,
		onPreview: setDraft,
		onChange: (next) =>
			onChange?.({ color: next, pattern, patternSeed, patternAdjustments }),
		onPatternChange: (next, seed, adjustments) =>
			onChange?.({
				color,
				pattern: next,
				patternSeed: seed ?? patternSeed,
				patternAdjustments: adjustments ?? patternAdjustments,
			}),
		scrollContainer: scroll,
		disabled: !onChange,
	});

	const preview = RepositoryTheme.create(
		theme,
		draft ?? color,
		pattern,
		patternSeed,
		patternAdjustments
	);

	return (
		<SettingsSplit
			testId="repository-appearance"
			list={
				<SettingsPage
					testId="repository-appearance-page"
					scrollTestId="repository-appearance-scroll"
					scrollRef={scroll}
					title="Repository appearance"
					description={`A local look for ${name}.`}
				>
					<SettingsGroup
						title="Workspace"
						footer="Changes save automatically on this device and are shared by this repository’s worktrees. Use Apply or Enter to save a hex color."
					>
						<div
							testId="repository-appearance-controls"
							style={{ ...styles.column, padding: spacing[4] }}
						>
							<div
								role="group"
								aria-label="Appearance controls"
								style={{
									display: "flex",
									flexDirection: "row",
									gap: spacing[1],
								}}
							>
								{(["color", "pattern"] as const).map((choice) => (
									<Button
										key={choice}
										testId={`repository-appearance-tab-${choice}`}
										tokens={tokens}
										variant={section === choice ? "secondary" : "ghost"}
										size="sm"
										aria-pressed={section === choice}
										aria-description={
											section === choice ? "Selected" : undefined
										}
										onPress={() => setSection(choice)}
										style={{ flexGrow: 1, minWidth: 0 }}
									>
										{choice === "color" ? "Color" : "Pattern"}
									</Button>
								))}
							</div>
							{fields}
						</div>
					</SettingsGroup>
				</SettingsPage>
			}
			panel={
				<SettingsPreview testId="repository-appearance-preview-panel">
					<AppThemeContext value={{ ...theme, ...preview }}>
						<RepositoryWorkspacePreview name={name} />
					</AppThemeContext>
					<Button
						testId="repository-appearance-customize"
						tokens={tokens}
						variant="primary"
						onPress={() => onCustomize && finish(onCustomize)}
						disabled={!onCustomize}
						style={{
							width: "100%",
							height: undefined,
							minHeight: tokens.layout.controlHeight,
							paddingTop: spacing[2],
							paddingBottom: spacing[2],
						}}
						textStyle={{ minWidth: 0, textAlign: "center" }}
					>
						Customize on repository
					</Button>
					<text style={styles.description}>
						Customize on the full workspace. Done saves your changes; Escape
						cancels.
					</text>
				</SettingsPreview>
			}
		/>
	);
}
