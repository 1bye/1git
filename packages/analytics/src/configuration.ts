/** Public ingestion configuration shared by the website and packaged app; grants no account access. */
export const posthogConfiguration = {
	token: "phc_BstgmU2tGMJJZ3fzmEXrcATxvnNyN3RQ6f8KfziwMpSd",
	host: "https://eu.i.posthog.com",
} as const;

/** Local safeguards, independent of the organization-wide free allowance and billing cap. */
export const analyticsLimits = {
	daily: 100,
	timeoutMs: 2500,
} as const;
