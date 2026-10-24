import { fontWeight, radius, spacing, typography } from "@1git/design-tokens";
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
	const { tokens, colors } = useAppTheme();

	const patternName =
		repositoryPatternPresets.find((preset) => preset.id === pattern)?.name ??
		"No pattern";

	return (
		<div
			testId="repository-appearance"
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				overflowY: "scroll",
				padding: spacing[5],
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
				Repository appearance
			</text>
			<text
				style={{ ...typography.sm, color: tokens.colors.textMuted }}
			>{`Customize ${name} while looking at your actual workspace.`}</text>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-start",
					gap: spacing[4],
					marginTop: spacing[2],
					maxWidth: 480,
				}}
			>
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
						style={{ ...typography.sm, color: tokens.colors.text }}
					>{`${color ?? "Default color"} · ${patternName}`}</text>
				</div>
				<Button
					testId="repository-appearance-customize"
					tokens={tokens}
					onPress={onCustomize}
					disabled={!onCustomize}
				>
					Customize on repository
				</Button>
				<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
					Settings steps aside while you choose a color or pattern. Done saves
					your changes; Escape cancels. Saved on this device and shared by this
					repository’s worktrees.
				</text>
			</div>
		</div>
	);
}
