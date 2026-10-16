import type { GpuixTheme } from "@gpuix/react";
import { codeTypography, spacing } from "@1git/design-tokens";
import { createThemedStyles } from "../../../styles/theme";
import { darkDiffTheme } from "../../../styles/dark-diff-theme";

/** Shared native diff palette for Git changes and encrypted local history. */
export const repositoryDiffTheme = createThemedStyles((theme) => {
	const { colors: appColors, appearance, tokens, repositoryColor } = theme;

	const diffTheme: GpuixTheme & { diffAddRail: string; diffDelRail: string } = {
		appearance: "light",
		bg: appColors.editorSurface,
		border: "#e1e4e8",
		text: "#24292e",
		textMuted: "#586069",
		textFaint: "#6a737d",
		accent: "#218bff",
		diffAdd: "#24292e",
		diffDel: "#24292e",
		diffAddBg: "#e6ffed",
		diffDelBg: "#ffeef0",
		diffAddRail: "#92c9a4",
		diffDelRail: "#d5a0a7",
		diffAddWordBg: "#acf2bd",
		diffDelWordBg: "#fdb8c0",
		diffHunkBg: "#f8fafc",
		fontMono: codeTypography.fontFamily,
		syntax: {
			comment: "#6a737d",
			keyword: "#d73a49",
			string: "#032f62",
			stringSpecial: "#032f62",
			escape: "#005cc5",
			number: "#005cc5",
			boolean: "#005cc5",
			typeName: "#6f42c1",
			typeBuiltin: "#6f42c1",
			constructor: "#6f42c1",
			function: "#6f42c1",
			functionBuiltin: "#6f42c1",
			macroName: "#d73a49",
			property: "#24292e",
			constant: "#005cc5",
			variable: "#24292e",
			variableSpecial: "#005cc5",
			parameter: "#24292e",
			operator: "#d73a49",
			punctuation: "#24292e",
			tag: "#22863a",
			attribute: "#6f42c1",
			label: "#24292e",
			invalid: "#b31d28",
		},
		metrics: {
			diffTextSize: codeTypography.fontSize,
			diffLineHeight: codeTypography.lineHeight,
			diffHunkHeaderHeight: 26,
			diffRowPaddingX: spacing[3.5],
			diffGutterWidth: 30,
			diffMarkerWidth: 18,
			diffAccentBarWidth: 2,
		},
		...(appearance === "dark" ? darkDiffTheme : {}),
		...(repositoryColor
			? {
					accent: tokens.colors.accent,
					diffInclusionText: tokens.colors.onAccent,
				}
			: {}),
	};

	return diffTheme;
});
