import { useMemo, useRef, useState, type RefObject } from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { spacing, typography, fontWeight, radius } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useAppTheme } from "../../styles/theme";
import { RepositoryTheme } from "../../styles/repository-theme";
import { RepositoryColors, repositoryColorPresets } from "./repository-colors";
import {
	repositoryPatternPresets,
	RepositoryPatterns,
	defaultPatternAdjustments,
	type RepositoryAppearanceOptions,
	type RepositoryAppearanceValue,
	type RepositoryAppearanceSection,
} from "./repository-patterns";
import { RepositoryPatternArtwork } from "./pattern-artwork";
import { RepositoryColorPicker } from "./repository-color-picker";
import { RepositoryPatternControls } from "./repository-pattern-controls";

/** Shared color/pattern fields and validation for Settings and the live repository editor. */
export function useRepositoryAppearanceControls({
	color,
	pattern,
	patternSeed = 0,
	patternAdjustments = defaultPatternAdjustments,
	onChange,
	onPatternChange,
	onPreview,
	section,
	onSectionChange,
	scrollContainer,
	disabled = false,
}: RepositoryAppearanceOptions & {
	onPreview: (color: string | undefined) => void;
	section: RepositoryAppearanceSection;
	onSectionChange: (section: RepositoryAppearanceSection) => void;
	scrollContainer: RefObject<PublicInstance | null>;
	disabled?: boolean;
}) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const renderer = useGpuixRequired();
	const customInput = useRef<PublicInstance>(null);
	const [draft, setDraft] = useState<string>();
	const [field, setField] = useState({ source: color, text: color ?? "" });
	const [error, setError] = useState<string>();
	const preview = RepositoryTheme.create(theme, draft ?? color, pattern);
	const pickerColor = color ?? repositoryColorPresets[0].color;
	const { layout, density, size, strength, variation } = patternAdjustments;

	const patternPreviews = useMemo(
		() => [
			{ id: undefined, name: "No pattern", source: undefined },
			...repositoryPatternPresets.map((preset) => ({
				...preset,
				source: RepositoryPatternArtwork.create(preset.id, patternSeed)
					.previewSource,
			})),
		],
		[patternSeed]
	);

	const selectedPreview = useMemo(
		() =>
			pattern
				? RepositoryPatternArtwork.create(pattern, patternSeed, {
						layout,
						density,
						size,
						variation,
						strength: 50,
					}).previewSource
				: undefined,
		[pattern, patternSeed, layout, density, size, variation]
	);

	if (field.source !== color) setField({ source: color, text: color ?? "" });

	const commit = (next: string | undefined): void => {
		setDraft(undefined);
		onPreview(undefined);
		setField({ source: next, text: next ?? "" });
		setError(undefined);
		onChange(next);
	};

	const apply = (): void => {
		const next = RepositoryColors.color(field.text.trim());

		if (!next) {
			setError("Enter a six-digit hex color, such as #a478ef.");

			return;
		}

		commit(next);
	};

	const finish = (
		complete: (value: RepositoryAppearanceValue) => void
	): void => {
		if (field.text === (color ?? "")) {
			complete({ color, pattern, patternSeed, patternAdjustments });

			return;
		}

		const next = RepositoryColors.color(field.text.trim());

		if (!next) {
			setError("Enter a six-digit hex color, such as #a478ef.");
			onSectionChange("color");

			if (customInput.current) renderer.focusElement?.(customInput.current.id);

			return;
		}

		complete({ color: next, pattern, patternSeed, patternAdjustments });
	};

	const fields =
		section === "color" ? (
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					maxWidth: 320,
					gap: spacing[3],
					flexShrink: 0,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
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
						Color
					</text>
					<Button
						testId="repository-color-reset"
						tokens={tokens}
						variant="ghost"
						size="sm"
						disabled={disabled || !color}
						onPress={() => commit(undefined)}
					>
						Reset
					</Button>
				</div>
				<div
					role="group"
					aria-label="Repository color"
					style={{
						display: "flex",
						flexDirection: "row",
						flexWrap: "wrap",
						gap: spacing[1.5],
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
							variant="ghost"
							disabled={disabled}
							onPress={() => commit(preset.color)}
							style={{
								width: 32,
								height: 32,
								paddingLeft: 0,
								paddingRight: 0,
								paddingTop: 0,
								paddingBottom: 0,
								borderRadius: radius.full,
								borderWidth: 1,
								borderColor:
									color === preset.color
										? tokens.colors.focusRing
										: "transparent",
							}}
						>
							<div
								aria-hidden
								style={{
									display: "flex",
									flexDirection: "column",
									width: 20,
									flexShrink: 0,
									height: 20,
									borderRadius: radius.full,
									backgroundColor: preset.color,
									pointerEvents: "none",
								}}
							/>
						</Button>
					))}
				</div>
				<RepositoryColorPicker
					disabled={disabled}
					value={pickerColor}
					onPreview={(next) => {
						setDraft(next);
						onPreview(next);
					}}
					onCommit={commit}
				/>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: spacing[1.5],
					}}
				>
					<text style={{ ...typography.xs, color: tokens.colors.textMuted }}>
						Hex color
					</text>
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							gap: spacing[2],
							alignItems: "center",
							flexWrap: "wrap",
						}}
					>
						<div
							testId="repository-color-current"
							aria-hidden
							style={{
								display: "flex",
								flexDirection: "column",
								width: 24,
								height: 24,
								flexShrink: 0,
								borderRadius: radius.full,
								backgroundColor: draft ?? color ?? theme.colors.brand,
								borderWidth: 1,
								borderColor: tokens.colors.border,
							}}
						/>
						<input
							ref={customInput}
							readOnly={disabled}
							tabIndex={disabled ? -1 : 0}
							testId="repository-color-custom"
							aria-label="Custom repository color"
							aria-invalid={!!error}
							placeholder="#528bff"
							value={draft ?? field.text}
							onChange={(event) => {
								const text = event.value ?? "";
								const next = RepositoryColors.color(text.trim());

								setField({ source: color, text });
								setError(undefined);
								setDraft(next);
								onPreview(next);
							}}
							onSubmit={apply}
							style={{
								flexGrow: 1,
								flexBasis: 80,
								minWidth: 0,
								height: tokens.layout.controlHeight,
								...typography.sm,
								color: tokens.colors.text,
								borderWidth: 1,
								borderColor: error
									? tokens.colors.danger
									: tokens.colors.border,
								borderRadius: radius.md,
								paddingLeft: spacing[2],
								paddingRight: spacing[2],
								backgroundColor: "transparent",
							}}
						/>
						<Button
							testId="repository-color-apply"
							disabled={disabled}
							tokens={tokens}
							size="sm"
							onPress={apply}
						>
							Apply
						</Button>
					</div>
					{error ? (
						<text
							role="alert"
							style={{ ...typography.xs, color: tokens.colors.danger }}
						>
							{error}
						</text>
					) : null}
				</div>
			</div>
		) : (
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					maxWidth: 320,
					gap: spacing[2],
					flexShrink: 0,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
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
						Pattern
					</text>
					<Button
						testId="repository-pattern-shuffle"
						tokens={tokens}
						variant="ghost"
						size="sm"
						disabled={disabled || !pattern}
						onPress={() =>
							onPatternChange(
								pattern,
								RepositoryPatterns.shuffleSeed(patternSeed),
								patternAdjustments
							)
						}
					>
						Shuffle
					</Button>
				</div>
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
					{patternPreviews.map((preset) => {
						const selected = pattern === preset.id;

						return (
							<Button
								key={preset.id ?? "none"}
								testId={
									preset.id
										? `repository-pattern-${preset.id}`
										: "repository-pattern-reset"
								}
								aria-label={preset.name}
								aria-pressed={selected}
								aria-description={selected ? "Selected" : undefined}
								tokens={tokens}
								variant={selected ? "secondary" : "ghost"}
								disabled={disabled}
								onPress={() => onPatternChange(preset.id)}
								style={{
									width: 96,
									height: 100,
									flexDirection: "column",
									gap: spacing[1],
									paddingLeft: 0,
									paddingRight: 0,
									paddingTop: 0,
									paddingBottom: spacing[1.5],
									overflow: "hidden",
									borderColor: selected
										? tokens.colors.accentBorder
										: tokens.colors.border,
								}}
							>
								<div
									aria-hidden
									style={{
										display: "flex",
										flexDirection: "column",
										position: "relative",
										width: "100%",
										height: 64,
										flexShrink: 0,
										overflow: "hidden",
										backgroundColor: preview.colors.editorSunken2,
										pointerEvents: "none",
									}}
								>
									{preset.source ? (
										<svg
											testId={`repository-pattern-preview-${preset.id}`}
											source={selected ? selectedPreview : preset.source}
											style={{
												position: "absolute",
												top: 0,
												left: 0,
												width: 96,
												height: 64,
												color: preview.colors.brand,
												opacity: selected
													? Math.min(1, (0.75 * strength) / 50)
													: 0.75,
												pointerEvents: "none",
											}}
										/>
									) : (
										<text
											style={{
												...typography.lg,
												color: preview.colors.brand,
												textAlign: "center",
												marginTop: spacing[3],
											}}
										>
											∅
										</text>
									)}
									{selected ? (
										<text
											style={{
												position: "absolute",
												top: spacing[1],
												right: spacing[1.5],
												...typography.xs,
												color: preview.colors.brand,
											}}
										>
											✓
										</text>
									) : null}
								</div>
								<text
									style={{
										...typography.xs,
										color: tokens.colors.text,
										pointerEvents: "none",
									}}
								>
									{preset.name}
								</text>
							</Button>
						);
					})}
				</div>
				<RepositoryPatternControls
					scrollContainer={scrollContainer}
					value={patternAdjustments}
					disabled={disabled || !pattern}
					onChange={(adjustments) =>
						onPatternChange(pattern, patternSeed, adjustments)
					}
				/>
			</div>
		);

	return { fields, finish };
}
