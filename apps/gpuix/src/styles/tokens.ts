import { lightColors } from "@1git/design-tokens";
import { densities, palettes, type UiTokens } from "@1git/gpuix-ui/tokens";

/** Explicit, window-local appearance; older sessions keep their existing light theme. */
export type AppAppearance = "light" | "dark";

export const appColors = {
	light: {
		...lightColors,
		chrome: "transparent",
		success: "#1a7f37",
		deletion: "#b2676b",
	},
	dark: {
		brand: "#80a7ff",
		brandForeground: "#101b32",
		editorInk: "#e8eaed",
		editorMuted: "#b3b8c2",
		editorFaint: "#89909c",
		editorSurface: "#202227",
		editorSunken: "#1b1d22",
		editorSunken2: "#2d3038",
		editorCodeBg: "#25282f",
		editorHairline: "rgb(255 255 255 / 0.06)",
		editorHairlineStrong: "rgb(255 255 255 / 0.12)",
		studioGlassSubtle: "rgb(24 26 31 / 0.28)",
		studioGlassSurface: "rgb(24 26 31 / 0.55)",
		studioGlassHover: "rgb(45 48 56 / 0.75)",
		studioGlassStrong: "rgb(24 26 31 / 0.78)",
		studioGlassBorder: "rgb(255 255 255 / 0.12)",
		chrome: "transparent",
		success: "#69ba86",
		deletion: "#e0878e",
	},
} as const;

export type AppColors = {
	readonly [Key in keyof typeof appColors.light]: string;
};

function controlTokens(appearance: AppAppearance): UiTokens {
	const colors = appColors[appearance];

	return {
		focusVisible: false,
		colors: {
			...palettes[appearance],
			background: colors.editorSurface,
			text: colors.editorInk,
			textMuted: colors.editorMuted,
			textControl: colors.editorInk,
			accent: colors.brand,
			accentHover: colors.brand,
			accentPressed: colors.brand,
			accentBorder: colors.brand,
			onAccent: colors.brandForeground,
			border: colors.editorHairlineStrong,
			focusRing: colors.brand,
			surface: colors.editorHairline,
			surfaceHover: colors.editorHairline,
			surfacePressed: colors.editorHairlineStrong,
			field: "transparent",
			fieldHover: "transparent",
			overlay: colors.editorSurface,
			selected: colors.editorSunken2,
			highlighted: colors.editorSunken,
		},
		layout: densities.compact,
	};
}

export const appControlTokens = {
	light: controlTokens("light"),
	dark: controlTokens("dark"),
};

/** Light defaults for isolated controls and backwards-compatible callers. Never mutated. */
export const appTokens = appControlTokens.light;
