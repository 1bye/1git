import { fontWeight, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { useAppTheme } from "../../styles/theme";
import { appColors, type AppAppearance } from "../../styles/tokens";
import { RepositoryCommitSubject } from "../repository-workspace/components/repository-commit-subject";

/** Immediate, persistent appearance selection; previews use the same palettes as the app. */
export function AppearanceSettings() {
	const {
		colors,
		tokens,
		commitTypeBadges,
		setCommitTypeBadges,
		smoothTransitions = true,
		setSmoothTransitions,
	} = useAppTheme();

	return (
		<div
			testId="appearance-settings"
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
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
				Appearance
			</text>
			<AppearanceChoices />
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: spacing[2],
					maxWidth: 480,
					marginTop: spacing[2],
				}}
			>
				<Checkbox
					testId="appearance-smooth-transitions"
					label="Smooth transitions"
					aria-description="Slide the active tab surface and blend theme colors when switching tabs or changing appearance."
					checked={smoothTransitions}
					onCheckedChange={(enabled) => setSmoothTransitions?.(enabled)}
					disabled={!setSmoothTransitions}
					tokens={tokens}
				/>
				<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
					Animate tab selection and theme colors. Turn off for instant changes.
				</text>
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: spacing[2],
					maxWidth: 480,
					marginTop: spacing[2],
				}}
			>
				<text
					role="heading"
					aria-level={2}
					style={{
						...typography.md,
						fontWeight: fontWeight.medium,
						color: tokens.colors.text,
					}}
				>
					Commit messages
				</text>
				<Checkbox
					testId="appearance-commit-type-badges"
					label="Show commit type badges"
					aria-description="Replace conventional commit prefixes with small, theme-colored labels. Original messages are unchanged."
					checked={commitTypeBadges}
					onCheckedChange={(enabled) => setCommitTypeBadges?.(enabled)}
					disabled={!setCommitTypeBadges}
					tokens={tokens}
				/>
				<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
					Compact labels for feat, fix, refactor and other conventional
					prefixes.
				</text>
				<div
					aria-label="Commit message preview"
					style={{
						display: "flex",
						flexDirection: "column",
						gap: spacing[2],
						padding: spacing[3],
						borderRadius: 4,
						backgroundColor: colors.editorSunken,
					}}
				>
					<RepositoryCommitSubject
						subject="feat(core): add workspace shortcuts"
						testId="appearance-commit-preview-feat"
					/>
					<RepositoryCommitSubject
						subject="refactor(db): simplify queries"
						testId="appearance-commit-preview-refactor"
					/>
				</div>
			</div>
		</div>
	);
}

/** The same live theme previews for Settings and first-run setup; no defaults change on mount. */
export function AppearanceChoices() {
	const { appearance, tokens, setAppearance } = useAppTheme();

	return (
		<div
			role="group"
			aria-label="Color theme"
			style={{
				display: "flex",
				flexDirection: "row",
				gap: spacing[2],
				width: "100%",
				maxWidth: 480,
			}}
		>
			{(["light", "dark"] as const).map((choice) => (
				<Button
					key={choice}
					tokens={tokens}
					testId={`appearance-${choice}`}
					aria-label={`${choice === "light" ? "Light" : "Dark"} theme`}
					aria-description={appearance === choice ? "Selected" : undefined}
					variant="secondary"
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
						borderWidth: 1,
						borderColor:
							appearance === choice
								? tokens.colors.accentBorder
								: tokens.colors.border,
					}}
				>
					<ThemePreview appearance={choice} />
					<text
						style={{
							...typography.md,
							color: tokens.colors.text,
							pointerEvents: "none",
						}}
					>
						{choice === "light" ? "Light" : "Dark"}
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
					width: 40,
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
						width: 28,
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
