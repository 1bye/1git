export const LATEST_BRANCH_LIMIT = 3;

export const WORKSPACE_BRANCH_COMMIT_AGE_UNITS = [
	{ milliseconds: 31_536_000_000, unit: "year" },
	{ milliseconds: 2_592_000_000, unit: "month" },
	{ milliseconds: 86_400_000, unit: "day" },
	{ milliseconds: 3_600_000, unit: "hour" },
	{ milliseconds: 60_000, unit: "minute" },
] as const;

export const WORKSPACE_BRANCH_TOOLTIP_DELAY_MS = 400;
export const WORKSPACE_SUBMENU_CLOSE_DELAY_MS = 300;

export const WORKSPACE_ACTIONS_LIQUID_GEOMETRY = {
	blendRadius: 40,
	menuRadius: 12,
	sampleCellSize: 2,
	smoothingPasses: 1,
} as const;

export const WORKSPACE_ACTIONS_LIQUID_MOTION = {
	backdropOpacity: 0.2,
	closeDurationMs: 180,
	contentDelayMs: 120,
	contentDurationMs: 120,
	openDurationMs: 240,
	positionTrackingDurationMs: 300,
	resizeDurationMs: 220,
	submenuCloseDurationMs: 160,
	submenuContentDelayMs: 90,
	submenuOpenDurationMs: 200,
} as const;
