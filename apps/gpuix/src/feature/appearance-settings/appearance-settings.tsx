import {
	SettingsPage,
	SettingsSplit,
	SettingsPreview,
	settingsStyles,
} from "../settings/settings-layout";
import { SettingsGroup, SettingsGroupRow } from "../settings/settings-group";
import { FontSettings } from "./font-settings";
import { codeTypography, radius, spacing } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { useAppTheme } from "../../styles/theme";
import { appColors, type AppAppearance } from "../../styles/tokens";
import { RepositoryCommitSubject } from "../repository-workspace/components/repository-commit-subject";
import { repositoryDiffTheme } from "../repository-workspace/lib/repository-diff-theme";
import { defaultTypography } from "./app-typography";

/** Immediate appearance settings with a repository-free, live workspace preview. */
export function AppearanceSettings({
	onReplayTips,
	onSetup,
	busy = false,
}: {
	onReplayTips?: () => void;
	onSetup?: () => void;
	busy?: boolean;
}) {
	const theme = useAppTheme();

	const {
		tokens,
		commitTypeBadges,
		setCommitTypeBadges,
		smoothTransitions = true,
		setSmoothTransitions,
		showScrollbars = true,
		setShowScrollbars,
		showGrain = true,
		setShowGrain,
	} = theme;

	return (
		<SettingsSplit
			testId="appearance-settings"
			list={
				<SettingsPage
					testId="appearance-settings-page"
					scrollTestId="appearance-settings-scroll"
					title="Appearance"
				>
					<SettingsGroup title="Theme">
						<div style={{ padding: spacing[3] }}>
							<AppearanceChoices />
						</div>
					</SettingsGroup>
					<FontSettings />
					<SettingsGroup title="Interface">
						<SettingsGroupRow
							label="Grain texture"
							description="Add a subtle grain texture to window chrome."
							trailing={
								<Checkbox
									testId="appearance-grain"
									aria-label="Grain texture"
									checked={showGrain}
									onCheckedChange={(enabled) => setShowGrain?.(enabled)}
									disabled={!setShowGrain}
									tokens={tokens}
								/>
							}
						/>

						<SettingsGroupRow
							label="Pane scrollbars"
							description="Show scrollbars in lists, previews and output panes."
							trailing={
								<Checkbox
									testId="appearance-scrollbars"
									aria-label="Show pane scrollbars"
									checked={showScrollbars}
									onCheckedChange={(enabled) => setShowScrollbars?.(enabled)}
									disabled={!setShowScrollbars}
									tokens={tokens}
								/>
							}
						/>
						<SettingsGroupRow
							label="Smooth transitions"
							description="Animate tab selection and theme colors. Turn off for instant changes."
							trailing={
								<Checkbox
									testId="appearance-smooth-transitions"
									aria-label="Smooth transitions"
									aria-description="Slide the active tab surface and blend theme colors when switching tabs or changing appearance."
									checked={smoothTransitions}
									onCheckedChange={(enabled) => setSmoothTransitions?.(enabled)}
									disabled={!setSmoothTransitions}
									tokens={tokens}
								/>
							}
						/>
					</SettingsGroup>
					<SettingsGroup title="Commit messages">
						<SettingsGroupRow
							label="Commit type badges"
							description="Compact labels for feat, fix, refactor and other conventional prefixes. Original messages are unchanged."
							trailing={
								<Checkbox
									testId="appearance-commit-type-badges"
									aria-label="Show commit type badges"
									aria-description="Replace conventional commit prefixes with small, theme-colored labels. Original messages are unchanged."
									checked={commitTypeBadges}
									onCheckedChange={(enabled) => setCommitTypeBadges?.(enabled)}
									disabled={!setCommitTypeBadges}
									tokens={tokens}
								/>
							}
						/>
					</SettingsGroup>
					{onReplayTips || onSetup ? (
						<SettingsGroup title="Help">
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
				</SettingsPage>
			}
			panel={<AppearancePreview />}
		/>
	);
}

function AppearancePreview() {
	const theme = useAppTheme();
	const { tokens, colors, typography: preferences = defaultTypography } = theme;
	const styles = settingsStyles.get(theme);
	const diff = repositoryDiffTheme.get(theme);

	const lines = [
		{ text: "  export function greet(name: string) {", kind: "context" },
		{ text: '-   return "Hello";', kind: "removed" },
		{ text: "+   return `Hello, ${name}!`;", kind: "added" },
		{ text: "  }", kind: "context" },
	] as const;

	return (
		<SettingsPreview testId="appearance-workspace-preview">
			<div
				testId="appearance-live-preview"
				textScale={preferences.fontSize / 12}
				style={{
					...styles.column,
					gap: 0,
					borderWidth: 1,
					borderColor: tokens.colors.border,
					borderRadius: radius.md,
					backgroundColor: colors.editorSurface,
					fontFamily: preferences.fontFamily || undefined,
				}}
			>
				<div
					style={{
						...styles.column,
						padding: spacing[3],
						gap: spacing[2],
						backgroundColor: colors.editorSunken,
						borderTopLeftRadius: radius.md,
						borderTopRightRadius: radius.md,
					}}
				>
					<text style={styles.label}>Workspace</text>
					<text style={styles.description}>Sample commits and code</text>
				</div>
				<div style={{ ...styles.column, padding: spacing[3], gap: spacing[3] }}>
					<text style={styles.sectionTitle}>History</text>
					<RepositoryCommitSubject
						subject="feat(core): add workspace shortcuts"
						testId="appearance-commit-preview-feat"
						wrap
					/>
					<RepositoryCommitSubject
						subject="refactor(db): simplify queries"
						testId="appearance-commit-preview-refactor"
						wrap
					/>
					<RepositoryCommitSubject
						subject="Update the getting started guide"
						testId="appearance-commit-preview-plain"
						wrap
					/>
				</div>
				<div
					style={{
						...styles.column,
						gap: 0,
						borderTopWidth: 1,
						borderColor: tokens.colors.border,
					}}
				>
					<text
						style={{
							...styles.description,
							padding: spacing[3],
							fontFamily:
								preferences.codeFontFamily || codeTypography.fontFamily,
						}}
					>
						src/greeting.ts
					</text>
					{lines.map((line, index) => (
						<text
							key={line.text}
							testId={`appearance-diff-preview-${index}`}
							style={{
								...styles.label,
								fontFamily:
									preferences.codeFontFamily || codeTypography.fontFamily,
								paddingLeft: spacing[3],
								paddingRight: spacing[3],
								paddingTop: spacing[1],
								paddingBottom: spacing[1],
								color:
									line.kind === "removed"
										? colors.deletion
										: line.kind === "added"
											? colors.success
											: colors.editorInk,
								backgroundColor:
									line.kind === "removed"
										? diff.diffDelBg
										: line.kind === "added"
											? diff.diffAddBg
											: colors.editorSurface,
							}}
						>
							{line.text}
						</text>
					))}
				</div>
			</div>
			<text style={styles.description}>
				Updates as you adjust your appearance settings.
			</text>
		</SettingsPreview>
	);
}

/** The same live theme previews for Settings and first-run setup; no defaults change on mount. */
export function AppearanceChoices() {
	const styles = settingsStyles.get(useAppTheme());

	const {
		appearance,
		appearancePreference = appearance,
		tokens,
		setAppearance,
	} = useAppTheme();

	return (
		<div
			role="group"
			aria-label="Color theme"
			style={{
				display: "flex",
				flexDirection: "row",
				gap: spacing[2],
				width: "100%",
			}}
		>
			{(["light", "dark", "system"] as const).map((choice) => (
				<Button
					key={choice}
					tokens={tokens}
					testId={`appearance-${choice}`}
					aria-label={`${choice === "system" ? "Auto" : choice === "light" ? "Light" : "Dark"} theme`}
					aria-description={
						appearancePreference === choice ? "Selected" : undefined
					}
					variant="ghost"
					disabled={!setAppearance}
					onPress={() => setAppearance?.(choice)}
					style={{
						flexGrow: 1,
						flexBasis: 0,
						minWidth: 0,
						height: 124,
						flexDirection: "column",
						gap: spacing[2],
						padding: spacing[2],
						backgroundColor: "transparent",
						hover: { backgroundColor: "transparent" },
						active: { backgroundColor: "transparent" },
					}}
				>
					<ThemePreview
						appearance={choice === "system" ? appearance : choice}
					/>
					<text
						style={{
							...styles.label,
							color:
								appearancePreference === choice
									? tokens.colors.focusRing
									: tokens.colors.text,
							pointerEvents: "none",
						}}
					>
						{choice === "system"
							? "Auto"
							: choice === "light"
								? "Light"
								: "Dark"}
					</text>
				</Button>
			))}
		</div>
	);
}

function ThemePreview({ appearance }: { appearance: AppAppearance }) {
	const colors = appColors[appearance];

	return (
		<div
			aria-hidden
			testId={`appearance-preview-${appearance}`}
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: 76,
				overflowX: "hidden",
				overflowY: "hidden",
				borderRadius: 4,
				borderWidth: 1,
				borderColor: colors.editorHairlineStrong,
				backgroundColor: colors.editorSunken,
				padding: spacing[1.5],
				gap: spacing[1],
				pointerEvents: "none",
			}}
		>
			<div
				style={{
					height: 4,
					width: "50%",
					borderRadius: 2,
					backgroundColor: colors.editorFaint,
					pointerEvents: "none",
				}}
			/>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					flexGrow: 1,
					gap: spacing[1],
					pointerEvents: "none",
				}}
			>
				<div
					style={{
						width: "24%",
						backgroundColor: colors.editorSunken2,
						pointerEvents: "none",
						borderRadius: 2,
					}}
				/>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						flexGrow: 1,
						backgroundColor: colors.editorSurface,
						pointerEvents: "none",
						borderRadius: 2,
						padding: spacing[2],
						gap: spacing[1.5],
					}}
				>
					{["60%", "85%", "45%"].map((width) => (
						<div
							key={width}
							style={{
								height: 3,
								width,
								backgroundColor: colors.editorMuted,
								pointerEvents: "none",
								borderRadius: 2,
							}}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
