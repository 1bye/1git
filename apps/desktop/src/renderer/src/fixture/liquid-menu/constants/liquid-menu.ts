import type { CSSProperties } from "react";

interface LiquidMenuStyle extends CSSProperties {
	readonly "--liquid-menu-content-delay": string;
	readonly "--liquid-menu-content-duration": string;
	readonly "--liquid-menu-resize-duration": string;
	readonly "--liquid-submenu-content-delay": string;
}

export interface LiquidMenuGeometry {
	readonly blendRadius: number;
	readonly menuRadius: number;
	readonly sampleCellSize: number;
	readonly smoothingPasses: number;
}

export interface LiquidMenuMotion {
	readonly backdropOpacity: number;
	readonly closeDurationMs: number;
	readonly contentDelayMs: number;
	readonly contentDurationMs: number;
	readonly openDurationMs: number;
	readonly resizeDurationMs: number;
	readonly submenuCloseDurationMs: number;
	readonly submenuContentDelayMs: number;
	readonly submenuOpenDurationMs: number;
}

export const LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY = {
	insetBlock: 0,
	insetInline: 0,
	radius: 10,
} as const;

export const LIQUID_MENU_GEOMETRY: LiquidMenuGeometry = {
	blendRadius: 40,
	menuRadius: 16,
	sampleCellSize: 2,
	smoothingPasses: 1,
};

export const LIQUID_MENU_MOTION: LiquidMenuMotion = {
	backdropOpacity: 0.2,
	closeDurationMs: 180,
	contentDelayMs: 120,
	contentDurationMs: 120,
	openDurationMs: 240,
	resizeDurationMs: 260,
	submenuCloseDurationMs: 160,
	submenuContentDelayMs: 90,
	submenuOpenDurationMs: 200,
};

export const LIQUID_SUBMENU_CLOSE_DELAY_MS = 300;

export const getLiquidMenuStyle = (
	motion: LiquidMenuMotion
): LiquidMenuStyle => ({
	"--liquid-menu-content-delay": `${motion.contentDelayMs}ms`,
	"--liquid-menu-content-duration": `${motion.contentDurationMs}ms`,
	"--liquid-menu-resize-duration": `${motion.resizeDurationMs}ms`,
	"--liquid-submenu-content-delay": `${motion.submenuContentDelayMs}ms`,
});
