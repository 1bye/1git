import { useEffect, useMemo, useRef, useState } from "react";
import {
	useGpuixRequired,
	useWindowSize,
	type PublicInstance,
} from "@gpuix/react";
import { spacing, typography, fontWeight, radius } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useAppTheme } from "../../styles/theme";
import { RepositoryTheme } from "../../styles/repository-theme";
import { RepositoryColors, repositoryColorPresets } from "./repository-colors";
import {
	repositoryPatternPresets,
	RepositoryPatterns,
	type RepositoryAppearanceOptions,
	type RepositoryAppearanceValue,
	type RepositoryAppearanceSection,
} from "./repository-patterns";
import { RepositoryPatternArtwork } from "./pattern-artwork";
import { RepositoryColorPicker } from "./repository-color-picker";
import { repositoryAppearanceCancel } from "./repository-appearance-shortcut";

const editorWidth = 344;
const editorTop = 64;

/** Nonmodal appearance controls preview on the mounted repository; only Done persists the draft. */
export function RepositoryAppearanceEditor({
	name,
	color,
	pattern,
	patternSeed = 0,
	onChange,
	onPatternChange,
	onPreview,
	onDone,
	onCancel,
	onBack,
	section,
	onSectionChange,
}: {
	name: string;
	onPreview: (color: string | undefined) => void;
	onDone: (value: RepositoryAppearanceValue) => void;
	onCancel: () => void;
	onBack: () => void;
	section: RepositoryAppearanceSection;
	onSectionChange: (section: RepositoryAppearanceSection) => void;
} & RepositoryAppearanceOptions) {
	const theme = useAppTheme();
	const { tokens } = theme;
	const window = useWindowSize();
	const renderer = useGpuixRequired();
	const panel = useRef<PublicInstance>(null);
	const initialFocus = useRef(renderer.getFocusedElementId?.());
	const customInput = useRef<PublicInstance>(null);
	const cancel = useRef(onCancel);

	cancel.current = onCancel;

	useEffect(() => {
		repositoryAppearanceCancel.set(renderer, () => cancel.current());
		const timer = setTimeout(() => {
			const focused = renderer.getFocusedElementId?.();

			// A user can click a field before the native layer's initial focus is ready.
			if (focused != null && focused !== initialFocus.current) return;

			if (panel.current) {
				renderer.focusElement?.(panel.current.id);
				renderer.focusNextWithin?.(panel.current.id);
			}
		}, 0);

		return () => {
			clearTimeout(timer);
			repositoryAppearanceCancel.delete(renderer);
		};
	}, [renderer]);
	const [draft, setDraft] = useState<string>();
	const [field, setField] = useState({ source: color, text: color ?? "" });
	const [error, setError] = useState<string>();
	const preview = RepositoryTheme.create(theme, draft ?? color, pattern);
	const pickerColor = color ?? repositoryColorPresets[0].color;

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

	const finish = (): void => {
		if (field.text === (color ?? "")) {
			onDone({ color, pattern, patternSeed });

			return;
		}

		const next = RepositoryColors.color(field.text.trim());

		if (!next) {
			setError("Enter a six-digit hex color, such as #a478ef.");
			onSectionChange("color");

			if (customInput.current) renderer.focusElement?.(customInput.current.id);

			return;
		}

		onDone({ color: next, pattern, patternSeed });
	};

	const controls = (
		<div
			testId="repository-appearance-controls"
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				flexShrink: 1,
				minHeight: 0,
				overflowY: "scroll",
				gap: spacing[3],
				padding: spacing[1],
			}}
		>
			{section === "color" ? (
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
							disabled={!color}
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
								aria-description={
									color === preset.color ? "Selected" : undefined
								}
								tokens={tokens}
								variant="ghost"
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
							disabled={!pattern}
							onPress={() =>
								onPatternChange(
									pattern,
									RepositoryPatterns.shuffleSeed(patternSeed)
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
												source={preset.source}
												style={{
													position: "absolute",
													top: 0,
													left: 0,
													width: 96,
													height: 64,
													color: preview.colors.brand,
													opacity: 0.75,
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
				</div>
			)}
		</div>
	);

	return (
		<anchored
			position={{
				x: Math.max(spacing[4], window.width - editorWidth - spacing[4]),
				y: editorTop,
			}}
			anchor="topLeft"
			snapMargin={spacing[4]}
			deferred
			priority={3}
			occlude
			style={{ width: editorWidth, backgroundColor: "rgba(0, 0, 0, 0.001)" }}
		>
			<div
				ref={panel}
				testId="repository-appearance-editor"
				role="dialog"
				aria-label={`Customize ${name}`}
				tabIndex={-1}
				style={{
					display: "flex",
					flexDirection: "column",
					position: "relative",
					width: editorWidth,
					maxHeight: window.height - editorTop - spacing[4],
					padding: spacing[3],
					gap: spacing[3],
					borderWidth: 1,
					borderColor: tokens.colors.border,
					borderRadius: radius.xl,
					backgroundColor: tokens.colors.overlay,
					boxShadow: {
						offsetX: 0,
						offsetY: 8,
						blurRadius: 24,
						spreadRadius: 0,
						color: tokens.colors.shadow,
					},
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: spacing[1],
						flexShrink: 0,
					}}
				>
					<text
						role="heading"
						aria-level={1}
						style={{
							...typography.md,
							fontWeight: fontWeight.medium,
							color: tokens.colors.text,
						}}
					>
						Repository appearance
					</text>
				</div>
				<div
					role="group"
					aria-label="Appearance controls"
					style={{
						display: "flex",
						flexDirection: "row",
						gap: spacing[1],
						flexShrink: 0,
					}}
				>
					{(["color", "pattern"] as const).map((choice) => (
						<Button
							key={choice}
							testId={`repository-appearance-tab-${choice}`}
							aria-pressed={section === choice}
							aria-description={section === choice ? "Selected" : undefined}
							tokens={tokens}
							variant={section === choice ? "secondary" : "ghost"}
							size="sm"
							onPress={() => onSectionChange(choice)}
							style={{ flexGrow: 1 }}
						>
							{choice === "color" ? "Color" : "Pattern"}
						</Button>
					))}
				</div>
				{controls}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						justifyContent: "space-between",
						alignItems: "center",
						gap: spacing[2],
						flexShrink: 0,
						borderTopWidth: 1,
						borderColor: tokens.colors.border,
						paddingTop: spacing[2],
					}}
				>
					<Button
						testId="repository-appearance-back"
						tokens={tokens}
						size="sm"
						variant="ghost"
						onPress={onBack}
					>
						Back to Settings
					</Button>
					<Button
						testId="repository-appearance-done"
						tokens={tokens}
						size="sm"
						onPress={finish}
					>
						Done
					</Button>
				</div>
			</div>
		</anchored>
	);
}
