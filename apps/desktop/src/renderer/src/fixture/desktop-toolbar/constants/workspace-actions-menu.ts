export const LATEST_BRANCH_LIMIT = 3;

export const WORKSPACE_BRANCH_COMMIT_AGE_UNITS = [
	{ milliseconds: 31_536_000_000, unit: "year" },
	{ milliseconds: 2_592_000_000, unit: "month" },
	{ milliseconds: 86_400_000, unit: "day" },
	{ milliseconds: 3_600_000, unit: "hour" },
	{ milliseconds: 60_000, unit: "minute" },
] as const;

export const WORKSPACE_BRANCH_TOOLTIP_DELAY_MS = 400;
