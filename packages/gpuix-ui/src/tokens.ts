import { Tokens, type TokenSet } from "@1git/gpuix-stylesheet";

/** Semantic color presets shared by native controls and application surfaces. */
export const palettes = Tokens.create({
	dark: {
		background: "#161618",
		text: "#ededf0",
		textMuted: "#a1a1aa",
		textControl: "#fafafa",
		danger: "#f87171",
		accent: "#6366f1",
		accentHover: "#7375f4",
		accentPressed: "#4f46e5",
		accentBorder: "#818cf8",
		onAccent: "#fafafa",
		border: "#3f3f46",
		focusRing: "#c4b5fd",
		surface: "#27272a",
		surfaceHover: "#343438",
		surfacePressed: "#202023",
		field: "#242427",
		fieldHover: "#2c2c30",
		overlay: "#202023",
		selected: "#30304a",
		highlighted: "#3b3b48",
		shadow: "#00000055",
	},
	light: {
		background: "#ffffff",
		text: "#18181b",
		textMuted: "#52525b",
		textControl: "#18181b",
		danger: "#b91c1c",
		accent: "#4f46e5",
		accentHover: "#4338ca",
		accentPressed: "#3730a3",
		accentBorder: "#6366f1",
		onAccent: "#ffffff",
		border: "#d4d4d8",
		focusRing: "#7c3aed",
		surface: "#f4f4f5",
		surfaceHover: "#e4e4e7",
		surfacePressed: "#d4d4d8",
		field: "#fafafa",
		fieldHover: "#f4f4f5",
		overlay: "#ffffff",
		selected: "#e0e7ff",
		highlighted: "#ede9fe",
		shadow: "#00000022",
	},
});

/** Layout presets independent of palette selection; comfortable preserves the original sizing. */
export const densities = Tokens.create({
	compact: {
		gap: 6,
		controlHeight: 28,
		smallControlHeight: 24,
		controlPadding: 10,
		smallControlPadding: 8,
		fieldPadding: 8,
		itemHeight: 26,
		itemPadding: 6,
		menuPadding: 3,
		menuGap: 2,
		pagePadding: 28,
		sectionGap: 20,
		contentGap: 8,
	},
	comfortable: {
		gap: 8,
		controlHeight: 34,
		smallControlHeight: 28,
		controlPadding: 14,
		smallControlPadding: 10,
		fieldPadding: 10,
		itemHeight: 30,
		itemPadding: 8,
		menuPadding: 4,
		menuGap: 2,
		pagePadding: 40,
		sectionGap: 28,
		contentGap: 12,
	},
});

/** Explicit token selection for a control or app; also accepts custom values with the same shape. */
export interface UiTokens {
	readonly colors: TokenSet<typeof palettes>;
	readonly layout: TokenSet<typeof densities>;
}

/** Default values for controls without a tokens prop; not a mutable global theme. */
export const defaultTokens: UiTokens = {
	colors: palettes.dark,
	layout: densities.comfortable,
};
