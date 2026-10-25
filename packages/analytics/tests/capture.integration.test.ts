/**
 * Covers: real fetch delivery of both application payloads to the Postman capture stand-in.
 * Real: analytics client, serialization, fetch and local HTTP.
 * Doubles: PostHog ingestion (Postman mock built from the official capture contract).
 * Requires: POSTHOG_SIMULATION_URL from the running analytics.sim.yaml; never uses the production endpoint.
 */
import { expect, test } from "bun:test";
import { AnonymousAnalytics, type AnalyticsState } from "../src/client";

test("desktop and website captures traverse real HTTP without production traffic", async () => {
	const base = process.env.POSTHOG_SIMULATION_URL;

	if (!base || new URL(base).hostname !== "127.0.0.1")
		throw new Error(
			"Set POSTHOG_SIMULATION_URL to the local simulation's /posthog URL."
		);

	for (const source of ["desktop", "website"] as const) {
		let stored: AnalyticsState | null = null;

		const client = new AnonymousAnalytics({
			source,
			active: true,
			storage: {
				read: () => stored,
				write: (state) => {
					stored = state;
				},
			},
			http: async (_url, init) => await fetch(`${base}/i/v0/e/`, init),
		});

		expect(
			await client.capture(
				source === "desktop"
					? { name: "app_started" }
					: { name: "$pageview", page: "home" }
			)
		).toBe(true);
		client.setEnabled(false);
		expect(
			await client.capture(
				source === "desktop"
					? { name: "app_started" }
					: { name: "$pageview", page: "home" }
			)
		).toBe(false);
	}
});
