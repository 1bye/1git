import { useState } from "react";
import { spacing, typography, fontWeight, radius } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useAppTheme } from "../../styles/theme";
import { RepositoryTheme } from "../../styles/repository-theme";
import { RepositoryColors, repositoryColorPresets } from "./repository-colors";
import {
	repositoryPatternPresets,
	type RepositoryAppearanceOptions,
} from "./repository-patterns";
import { repositoryPatternSources } from "./pattern-artwork";

/** Immediate local repo appearance choices; Settings and tabs keep their normal palette. */
export function RepositoryAppearance({
	name,
	color,
	pattern,
	onChange,
	onPatternChange,
}: {
	name: string;
} & RepositoryAppearanceOptions) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const [custom, setCustom] = useState(color ?? "");
	const [error, setError] = useState<string>();
	const preview = RepositoryTheme.create(theme, color);

	return (
		<div
			testId="repository-appearance"
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				overflowY: "scroll",
				padding: spacing[4],
				gap: spacing[4],
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
			<text style={{ ...typography.md, color: tokens.colors.textMuted }}>
				{`Give ${name} its own color and illustrated pattern. Saved on this device and shared by its worktrees. Tabs stay unchanged.`}
			</text>
			<div
				role="group"
				aria-label="Repository color"
				style={{
					display: "flex",
					flexDirection: "row",
					flexWrap: "wrap",
					flexShrink: 0,
					gap: spacing[2],
					maxWidth: 480,
				}}
			>
				{repositoryColorPresets.map((preset) => (
					<Button
						key={preset.name}
						testId={`repository-color-${preset.name.toLowerCase()}`}
						aria-label={preset.name}
						aria-pressed={color === preset.color}
						aria-description={color === preset.color ? "Selected" : undefined}
						tokens={tokens}
						variant={color === preset.color ? "secondary" : "ghost"}
						onPress={() => {
							onChange(preset.color);
							setCustom(preset.color);
							setError(undefined);
						}}
						style={{
							width: 100,
							height: 40,
							gap: spacing[2],
							justifyContent: "flex-start",
							borderColor:
								color === preset.color
									? tokens.colors.accentBorder
									: "transparent",
						}}
					>
						<div
							aria-hidden
							style={{
								width: 16,
								height: 16,
								flexShrink: 0,
								borderRadius: radius.full,
								backgroundColor: preset.color,
								pointerEvents: "none",
							}}
						/>
						{preset.name}
					</Button>
				))}
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: spacing[2],
					maxWidth: 440,
					flexShrink: 0,
				}}
			>
				<text style={{ ...typography.md, color: tokens.colors.textMuted }}>
					Custom color
				</text>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						gap: spacing[2],
						alignItems: "center",
					}}
				>
					<input
						testId="repository-color-custom"
						aria-label="Custom repository color"
						aria-invalid={!!error}
						placeholder="#a478ef"
						value={custom}
						onChange={(event) => {
							setCustom(event.value ?? "");
							setError(undefined);
						}}
						style={{
							flexGrow: 1,
							minWidth: 0,
							height: tokens.layout.controlHeight,
							...typography.md,
							color: tokens.colors.text,
							borderWidth: 1,
							borderColor: error ? tokens.colors.danger : tokens.colors.border,
							borderRadius: radius.md,
							paddingLeft: spacing[2.5],
							paddingRight: spacing[2.5],
							backgroundColor: "transparent",
						}}
					/>
					<Button
						testId="repository-color-apply"
						tokens={tokens}
						onPress={() => {
							const next = RepositoryColors.color(custom.trim());

							if (!next) {
								setError("Enter a six-digit hex color, such as #a478ef.");

								return;
							}

							onChange(next);
							setCustom(next);
						}}
					>
						Apply
					</Button>
					<Button
						testId="repository-color-reset"
						tokens={tokens}
						variant="ghost"
						disabled={!color}
						onPress={() => {
							onChange(undefined);
							setCustom("");
							setError(undefined);
						}}
					>
						Reset
					</Button>
				</div>
				{error ? (
					<text
						role="alert"
						style={{ ...typography.sm, color: tokens.colors.danger }}
					>
						{error}
					</text>
				) : null}
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: spacing[2],
					maxWidth: 440,
					flexShrink: 0,
				}}
			>
				<text
					role="heading"
					aria-level={2}
					style={{ ...typography.md, color: tokens.colors.textMuted }}
				>
					Pattern
				</text>
				<div
					role="group"
					aria-label="Repository pattern"
					style={{
						display: "flex",
						flexDirection: "row",
						flexWrap: "wrap",
						gap: spacing[2],
					}}
				>
					{repositoryPatternPresets.map((preset) => {
						const selected = pattern === preset.id;
						const palette = RepositoryTheme.create(theme, preset.color);

						return (
							<Button
								key={preset.id}
								testId={`repository-pattern-${preset.id}`}
								aria-label={preset.name}
								aria-pressed={selected}
								aria-description={selected ? "Selected" : undefined}
								tokens={tokens}
								variant={selected ? "secondary" : "ghost"}
								onPress={() => onPatternChange(preset.id)}
								style={{
									width: 200,
									height: 108,
									flexDirection: "column",
									gap: spacing[2],
									paddingLeft: 0,
									paddingRight: 0,
									paddingTop: 0,
									paddingBottom: spacing[2],
									overflowX: "hidden",
									overflowY: "hidden",
									borderColor: selected
										? tokens.colors.accentBorder
										: tokens.colors.border,
								}}
							>
								<div
									aria-hidden
									style={{
										position: "relative",
										width: "100%",
										height: 72,
										flexShrink: 0,
										overflowX: "hidden",
										overflowY: "hidden",
										backgroundColor: palette.colors.editorSunken2,
										pointerEvents: "none",
									}}
								>
									<svg
										source={repositoryPatternSources[preset.id]}
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											width: 256,
											height: 256,
											color: palette.colors.brand,
											opacity: 0.5,
											pointerEvents: "none",
										}}
									/>
								</div>
								<text
									style={{
										...typography.md,
										color: tokens.colors.text,
										pointerEvents: "none",
									}}
								>{`${selected ? "✓ " : ""}${preset.name}`}</text>
							</Button>
						);
					})}
				</div>
				<Button
					testId="repository-pattern-reset"
					aria-pressed={pattern === undefined}
					tokens={tokens}
					variant="ghost"
					onPress={() => onPatternChange(undefined)}
					style={{ alignSelf: "flex-start" }}
				>
					No pattern
				</Button>
				<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
					Patterns use your repository color. Changing the pattern keeps your
					color unchanged.
				</text>
			</div>
			<div
				testId="repository-color-preview"
				aria-label="Workspace color preview"
				style={{
					position: "relative",
					display: "flex",
					flexDirection: "column",
					flexShrink: 0,
					gap: spacing[3],
					maxWidth: 440,
					padding: spacing[4],
					borderRadius: radius.xl,
					backgroundColor: preview.colors.editorSurface,
					borderWidth: 1,
					borderColor: tokens.colors.border,
					overflowX: "hidden",
					overflowY: "hidden",
				}}
			>
				{pattern ? (
					<svg
						aria-hidden
						source={repositoryPatternSources[pattern]}
						style={{
							position: "absolute",
							top: 0,
							left: 0,
							width: 256,
							height: 256,
							color: preview.colors.brand,
							opacity: 0.12,
							pointerEvents: "none",
						}}
					/>
				) : null}
				<text style={{ ...typography.md, color: preview.colors.editorInk }}>
					Workspace preview
				</text>
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
							display: "flex",
							alignItems: "center",
							height: tokens.layout.controlHeight,
							paddingLeft: spacing[2.5],
							paddingRight: spacing[2.5],
							justifyContent: "center",
							borderRadius: radius.md,
							backgroundColor: preview.tokens.colors.accent,
						}}
					>
						<text
							style={{
								...typography.md,
								fontWeight: fontWeight.medium,
								color: preview.tokens.colors.onAccent,
							}}
						>
							Commit changes
						</text>
					</div>
					<text style={{ ...typography.sm, color: preview.colors.brand }}>
						Selected repository accent
					</text>
				</div>
			</div>
			<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
				Diff colors, syntax highlighting, errors and warnings keep their
				original meanings. Reset restores the default color; No pattern removes
				the artwork.
			</text>
		</div>
	);
}
