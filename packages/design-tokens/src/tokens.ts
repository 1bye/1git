/** Renderer-neutral light surfaces shared by the Electron and GPUIX shells. */
export const lightColors = {
	brand: "#406bde",
	brandForeground: "#ffffff",
	editorInk: "#111111",
	editorMuted: "#5a5a5a",
	editorFaint: "#7f7f7f",
	editorSurface: "#ffffff",
	editorSunken: "#f7f7f8",
	editorSunken2: "#f2f2f2",
	editorCodeBg: "#f4f4f5",
	editorHairline: "rgb(0 0 0 / 0.06)",
	editorHairlineStrong: "rgb(0 0 0 / 0.1)",
	studioGlassSubtle: "rgb(255 255 255 / 0.28)",
	studioGlassSurface: "rgb(255 255 255 / 0.55)",
	studioGlassHover: "rgb(255 255 255 / 0.75)",
	studioGlassStrong: "rgb(255 255 255 / 0.78)",
	studioGlassBorder: "rgb(255 255 255 / 0.55)",
} as const;

/** Compact desktop typography. Sizes and leading are logical pixels, not CSS ratios. */
export const typography = {
	"2xs": { fontSize: 9, lineHeight: 12 },
	xs: { fontSize: 10, lineHeight: 14 },
	sm: { fontSize: 11, lineHeight: 16 },
	md: { fontSize: 12, lineHeight: 18 },
	lg: { fontSize: 14, lineHeight: 20 },
	xl: { fontSize: 18, lineHeight: 24 },
	"2xl": { fontSize: 20, lineHeight: 28 },
} as const;

/** Supported text-size names, shared by styles and component props. */
export type TextSize = keyof typeof typography;

/** Text emphasis independent of size or palette. */
export const fontWeight = {
	regular: 400,
	medium: 500,
	semibold: 600,
	bold: 700,
} as const;

/** Spacing in logical pixels; numeric keys follow a four-pixel scale with half steps. */
export const spacing = {
	0: 0,
	0.25: 1,
	0.5: 2,
	0.75: 3,
	1: 4,
	1.5: 6,
	2: 8,
	2.5: 10,
	3: 12,
	3.5: 14,
	4: 16,
	4.5: 18,
	5: 20,
	6: 24,
	7: 28,
	8: 32,
	9: 36,
	10: 40,
	12: 48,
	14: 56,
	16: 64,
	20: 80,
} as const;

/** Surface rounding; use full for pills and circles, not a one-off half-height value. */
export const radius = {
	none: 0,
	xs: 2,
	sm: 4,
	md: 6,
	lg: 8,
	xl: 12,
	"2xl": 14,
	full: 9999,
} as const;

/** Common icon dimensions; illustrations and custom artwork retain their own geometry. */
export const iconSize = {
	xs: 12,
	sm: 14,
	md: 16,
	lg: 18,
	xl: 20,
	"2xl": 24,
} as const;

/** Common native control dimensions, independent of typography and palette. */
export const controlSize = {
	checkbox: 12,
	sm: 24,
	md: 28,
	lg: 34,
	itemSm: 26,
	itemMd: 30,
	rail: 32,
} as const;

/** Code leading is deliberately looser than body copy for readable diffs. */
export const codeTypography = {
	fontSize: typography.sm.fontSize,
	lineHeight: spacing[5],
	fontFamily: "Menlo",
} as const;

/** Density presets shared by native controls; custom layouts remain supported. */
export const controlLayout = {
	compact: {
		gap: spacing[1.5],
		controlHeight: controlSize.md,
		smallControlHeight: controlSize.sm,
		controlPadding: spacing[2.5],
		smallControlPadding: spacing[2],
		fieldPadding: spacing[2],
		itemHeight: controlSize.itemSm,
		itemPadding: spacing[1.5],
		menuPadding: spacing[0.75],
		menuGap: spacing[0.5],
		pagePadding: spacing[7],
		sectionGap: spacing[5],
		contentGap: spacing[2],
	},
	comfortable: {
		gap: spacing[2],
		controlHeight: controlSize.lg,
		smallControlHeight: controlSize.md,
		controlPadding: spacing[3.5],
		smallControlPadding: spacing[2.5],
		fieldPadding: spacing[2.5],
		itemHeight: controlSize.itemMd,
		itemPadding: spacing[2],
		menuPadding: spacing[1],
		menuGap: spacing[0.5],
		pagePadding: spacing[10],
		sectionGap: spacing[7],
		contentGap: spacing[3],
	},
} as const;

/** Shared shell measurements in logical pixels; shell geometry is separate from UI defaults. */
export const workspaceLayout = {
	desktopTitlebarControlsWidth: 80,
	workspaceSurfaceInset: spacing[1.5],
	workspaceSurfaceRadius: radius["2xl"],
	tabAvatarSize: 14,
	tabCloseSize: controlSize.sm,
	tabContentGap: spacing[2],
	tabContentInsetBlock: spacing[2],
	tabContentInsetInlineStart: spacing[3],
	tabHeight: 40,
	tabRadius: 10,
	tabWidth: 210,
	toolbarHeight: 46,
} as const;
