import type { CSSProperties } from "react";

interface LiquidMenuStyle extends CSSProperties {
  readonly "--liquid-menu-content-delay": string;
  readonly "--liquid-menu-content-duration": string;
  readonly "--liquid-menu-resize-duration": string;
  readonly "--liquid-submenu-content-delay": string;
}

export const LIQUID_MENU_GEOMETRY = {
  blendRadius: 40,
  menuRadius: 16,
  sampleCellSize: 2,
  smoothingPasses: 1,
} as const;

export const LIQUID_MENU_MOTION = {
  backdropOpacity: 0.2,
  closeDurationMs: 180,
  contentDelayMs: 120,
  contentDurationMs: 120,
  openDurationMs: 240,
  positionTrackingDurationMs: 300,
  resizeDurationMs: 260,
  submenuCloseDurationMs: 160,
  submenuContentDelayMs: 90,
  submenuOpenDurationMs: 200,
} as const;

export const LIQUID_SUBMENU_CLOSE_DELAY_MS = 300;

export const LIQUID_MENU_STYLE: LiquidMenuStyle = {
  "--liquid-menu-content-delay": `${LIQUID_MENU_MOTION.contentDelayMs}ms`,
  "--liquid-menu-content-duration": `${LIQUID_MENU_MOTION.contentDurationMs}ms`,
  "--liquid-menu-resize-duration": `${LIQUID_MENU_MOTION.resizeDurationMs}ms`,
  "--liquid-submenu-content-delay": `${LIQUID_MENU_MOTION.submenuContentDelayMs}ms`,
};
