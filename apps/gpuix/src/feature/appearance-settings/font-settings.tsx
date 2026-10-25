import { useState } from "react";
import { spacing, typography, fontWeight } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useAppTheme } from "../../styles/theme";
import { defaultTypography, TypographyPreferences } from "./app-typography";

/** Live text-size selection and installed interface/code font names. */
export function FontSettings() {
	const {
		tokens,
		typography: preferences = defaultTypography,
		setTypography,
	} = useAppTheme();

	const [fontFamily, setFontFamily] = useState(preferences.fontFamily);

	const [codeFontFamily, setCodeFontFamily] = useState(
		preferences.codeFontFamily
	);

	const fieldStyle = {
		...typography.md,
		height: 32,
		width: 280,
		paddingLeft: spacing[2],
		paddingRight: spacing[2],
		borderWidth: 1,
		borderColor: tokens.colors.border,
		borderRadius: 4,
		color: tokens.colors.text,
		backgroundColor: tokens.colors.field,
	};

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[2],
				maxWidth: 480,
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
				Text
			</text>
			<div
				role="group"
				aria-label="Interface text size"
				style={{ display: "flex", flexDirection: "row", gap: spacing[2] }}
			>
				{([12, 14, 16] as const).map((fontSize) => (
					<Button
						key={fontSize}
						testId={`appearance-font-size-${fontSize}`}
						tokens={tokens}
						variant={
							preferences.fontSize === fontSize ? "primary" : "secondary"
						}
						aria-label={`${fontSize} point text`}
						aria-description={
							preferences.fontSize === fontSize ? "Selected" : undefined
						}
						disabled={!setTypography}
						onPress={() => setTypography?.({ ...preferences, fontSize })}
					>
						{fontSize === 12 ? "Default" : fontSize === 14 ? "Large" : "Larger"}
					</Button>
				))}
			</div>
			<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
				Installed font family names. Leave blank to use the default. Unavailable
				fonts use the native fallback.
			</text>
			<text style={{ ...typography.sm, color: tokens.colors.text }}>
				Interface font
			</text>
			<input
				testId="appearance-ui-font"
				aria-label="Interface font"
				value={fontFamily}
				placeholder="System font"
				onChange={(event) => setFontFamily(event.value ?? "")}
				style={fieldStyle}
			/>
			<text style={{ ...typography.sm, color: tokens.colors.text }}>
				Code font
			</text>
			<input
				testId="appearance-code-font"
				aria-label="Code font"
				value={codeFontFamily}
				placeholder="Menlo"
				onChange={(event) => setCodeFontFamily(event.value ?? "")}
				style={fieldStyle}
			/>
			<div style={{ display: "flex", flexDirection: "row", gap: spacing[2] }}>
				<Button
					testId="appearance-apply-fonts"
					tokens={tokens}
					variant="secondary"
					disabled={!setTypography}
					onPress={() => {
						const next = TypographyPreferences.parse({
							...preferences,
							fontFamily,
							codeFontFamily,
						});

						setFontFamily(next.fontFamily);
						setCodeFontFamily(next.codeFontFamily);
						setTypography?.(next);
					}}
				>
					Apply fonts
				</Button>
				<Button
					testId="appearance-reset-fonts"
					tokens={tokens}
					variant="ghost"
					disabled={!setTypography}
					onPress={() => {
						setFontFamily(defaultTypography.fontFamily);
						setCodeFontFamily(defaultTypography.codeFontFamily);
						setTypography?.(defaultTypography);
					}}
				>
					Reset text settings
				</Button>
			</div>
		</div>
	);
}
