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

/** Shared shell measurements in logical pixels; no renderer or theme runtime. */
export const workspaceLayout = {
	desktopTitlebarControlsWidth: 80,
	workspaceSurfaceInset: 6,
	workspaceSurfaceRadius: 14,
	tabAvatarSize: 14,
	tabCloseSize: 24,
	tabContentGap: 8,
	tabContentInsetBlock: 8,
	tabContentInsetInlineStart: 12,
	tabHeight: 40,
	tabRadius: 10,
	tabWidth: 210,
	toolbarHeight: 46,
} as const;
