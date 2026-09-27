import { lightColors } from "@1git/design-tokens";
import { densities, palettes, type UiTokens } from "@1git/gpuix-ui/tokens";

/** Adapts the desktop's light surfaces to native UI controls without a theme provider. */
export const appTokens: UiTokens = {
	colors: {
		...palettes.light,
		background: lightColors.editorSurface,
		text: lightColors.editorInk,
		textMuted: lightColors.editorMuted,
		textControl: lightColors.editorInk,
		accent: lightColors.brand,
		accentHover: lightColors.brand,
		accentPressed: lightColors.brand,
		accentBorder: lightColors.brand,
		onAccent: lightColors.brandForeground,
		border: lightColors.editorHairlineStrong,
		focusRing: lightColors.brand,
		surface: lightColors.editorHairline,
		surfaceHover: lightColors.editorHairline,
		surfacePressed: lightColors.editorHairlineStrong,
		field: "transparent",
		fieldHover: "transparent",
		overlay: lightColors.editorSurface,
		selected: lightColors.editorSunken2,
		highlighted: lightColors.editorSunken,
	},
	layout: densities.compact,
};
