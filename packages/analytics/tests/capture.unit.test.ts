/**
 * Covers: default-on capture, payload privacy, persisted quotas, identity rotation, opt-out, cancellation and failures.
 * Real: analytics policy, serialization, AbortController and timeout.
 * Doubles: storage and HTTP transport; no PostHog traffic.
 * Requires: none.
 */
import { expect, test } from "bun:test";
import {
	AnonymousAnalytics,
	type AnalyticsFetch,
	type AnalyticsStorage,
} from "../src/client";
import { analyticsLimits } from "../src/configuration";

function fixture() {
	let stored: unknown = null;
	let date = new Date("2026-10-01T12:00:00Z");
	const requests: { url: string; init: RequestInit }[] = [];

	const storage: AnalyticsStorage = {
		read: () => structuredClone(stored),
		write: (state) => {
			stored = structuredClone(state);
		},
	};

	const http: AnalyticsFetch = async (url, init) => {
		requests.push({ url, init });

		return { ok: true };
	};

	const create = (
		options: {
			source?: "desktop" | "website";
			active?: boolean;
			http?: AnalyticsFetch;
			storage?: AnalyticsStorage;
		} = {}
	) =>
		new AnonymousAnalytics({
			source: options.source ?? "desktop",
			active: options.active ?? true,
			storage: options.storage ?? storage,
			http: options.http ?? http,
			version: "1.2.3",
			now: () => date,
		});

	return {
		create,
		requests,
		storage,
		setDate: (value: string) => {
			date = new Date(value);
		},
	};
}

function payload(init: RequestInit | undefined): Record<string, unknown> {
	return JSON.parse(String(init?.body));
}

test("defaults on and sends only approved anonymous properties to EU ingestion", async () => {
	const { create, requests, storage } = fixture();
	const client = create();

	const event = {
		name: "feature_used",
		feature: "history",
		email: "secret@example.com",
		repository: "/private/work",
	} as const;

	expect(client.enabled).toBe(true);
	expect(await client.capture(event)).toBe(true);
	expect(requests).toHaveLength(1);
	expect(requests[0]?.url).toBe("https://eu.i.posthog.com/i/v0/e/");
	expect(requests[0]?.init).toMatchObject({
		method: "POST",
		credentials: "omit",
		referrerPolicy: "no-referrer",
	});
	expect(payload(requests[0]?.init)).toEqual({
		api_key: expect.stringMatching(/^phc_/u),
		event: "feature_used",
		distinct_id: expect.stringMatching(
			/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
		),
		timestamp: "2026-10-01T12:00:00.000Z",
		properties: {
			source: "desktop",
			feature: "history",
			app_version: "1.2.3",
			$process_person_profile: false,
			$geoip_disable: true,
			$ip: "0.0.0.0",
			$session_id: expect.any(String),
		},
	});
	expect(JSON.stringify(storage.read())).not.toContain(
		String(payload(requests[0]?.init).distinct_id)
	);
	expect(JSON.stringify(requests)).not.toContain("secret@example.com");
	expect(JSON.stringify(requests)).not.toContain("/private/work");
});

test("website capture has canonical page URLs and rejects desktop events", async () => {
	const { create, requests } = fixture();
	const client = create({ source: "website" });

	expect(await client.capture({ name: "$pageview", page: "faq" })).toBe(true);
	expect(await client.capture({ name: "app_started" })).toBe(false);
	expect(payload(requests[0]?.init)).toMatchObject({
		event: "$pageview",
		properties: {
			$current_url: "https://git.1bye.dev/faq/",
			$pathname: "/faq/",
			$host: "git.1bye.dev",
			source: "website",
		},
	});
});

test("opt-out survives restart and re-enabling does not erase quotas", async () => {
	const { create, requests, storage } = fixture();
	const first = create();

	await first.capture({ name: "app_started" });
	first.setEnabled(false);
	const restored = create();

	expect(restored.enabled).toBe(false);
	expect(await restored.capture({ name: "app_started" })).toBe(false);
	restored.setEnabled(true);
	expect(await restored.capture({ name: "app_started" })).toBe(true);
	expect(requests).toHaveLength(2);
	expect(storage.read()).toMatchObject({ dailyCount: 2 });
});

test("deduplicates events within a session and rotates the identity after 30 minutes", async () => {
	const { create, requests, setDate } = fixture();
	const client = create();

	await client.capture({ name: "app_started" });
	expect(await client.capture({ name: "app_started" })).toBe(false);
	await client.capture({ name: "feature_used", feature: "history" });
	expect(payload(requests[0]?.init).distinct_id).toBe(
		payload(requests[1]?.init).distinct_id
	);
	setDate("2026-10-01T12:30:00Z");
	await client.capture({ name: "app_started" });
	expect(payload(requests[2]?.init).distinct_id).not.toBe(
		payload(requests[0]?.init).distinct_id
	);
});

test("persists the daily cap across clients and concurrent capture calls", async () => {
	const { create, requests, storage } = fixture();

	await Promise.all(
		Array.from(
			{ length: analyticsLimits.daily + 5 },
			async () => await create().capture({ name: "app_started" })
		)
	);

	expect(requests).toHaveLength(analyticsLimits.daily);
	expect(storage.read()).toMatchObject({ dailyCount: analyticsLimits.daily });
});

test("daily limit is 100 events and survives clock rollback and opt-out, then resets the next UTC day", async () => {
	const { create, requests, setDate } = fixture();

	expect(analyticsLimits.daily).toBe(100);
	await Promise.all(
		Array.from(
			{ length: analyticsLimits.daily },
			async () => await create().capture({ name: "app_started" })
		)
	);

	expect(requests).toHaveLength(analyticsLimits.daily);
	setDate("2026-09-30T12:00:00Z");
	const client = create();

	client.setEnabled(false);
	client.setEnabled(true);
	expect(await client.capture({ name: "app_started" })).toBe(false);
	setDate("2026-10-02T00:00:00Z");
	expect(await client.capture({ name: "app_started" })).toBe(true);
	expect(requests).toHaveLength(analyticsLimits.daily + 1);
});

test("legacy monthly quota does not block events or change saved consent and daily usage", async () => {
	const { create, requests, storage } = fixture();

	let saved: unknown = {
		version: 1,
		enabled: false,
		day: "2026-10-01",
		month: "2026-10",
		dailyCount: 5,
		monthlyCount: 100,
	};

	const client = create({
		storage: {
			read: () => saved,
			write: (state) => {
				saved = state;
				storage.write(state);
			},
		},
	});

	expect(client.enabled).toBe(false);
	expect(await client.capture({ name: "app_started" })).toBe(false);
	client.setEnabled(true);
	expect(await client.capture({ name: "app_started" })).toBe(true);
	expect(requests).toHaveLength(1);
	expect(storage.read()).toEqual({
		version: 1,
		enabled: true,
		day: "2026-10-01",
		dailyCount: 6,
	});
});

test("capture continues beyond 100 events in the same month", async () => {
	const { create, requests, setDate } = fixture();

	for (const day of [1, 2]) {
		setDate(`2026-10-0${day}T12:00:00Z`);
		await Promise.all(
			Array.from(
				{ length: 100 },
				async () => await create().capture({ name: "app_started" })
			)
		);
	}

	expect(requests).toHaveLength(200);
});

test("disabled production gate never sends or reserves quota", async () => {
	const { create, requests, storage } = fixture();

	expect(await create({ active: false }).capture({ name: "app_started" })).toBe(
		false
	);
	expect(requests).toHaveLength(0);
	expect(storage.read()).toBeNull();
});

test("invalid preferences, denied storage and failed quota writes stop collection", async () => {
	const { create, requests } = fixture();

	const cases: AnalyticsStorage[] = [
		{ read: () => ({ enabled: true }), write: () => {} },
		{
			read: () => {
				throw new Error("Blocked");
			},
			write: () => {},
		},
		{
			read: () => null,
			write: () => {
				throw new Error("Disk full");
			},
		},
		{
			read: () => ({
				version: 1,
				enabled: true,
				day: "2026-10-01",
				month: "2026-10",
				dailyCount: -1,
				monthlyCount: 0,
			}),
			write: () => {},
		},
	];

	for (const storage of cases) {
		const client = create({ storage });

		expect(await client.capture({ name: "app_started" })).toBe(false);
		expect(client.enabled).toBe(false);
	}

	expect(requests).toHaveLength(0);
});

test("failed preference writes keep analytics off and report the unsaved choice", () => {
	const { create } = fixture();

	const client = create({
		storage: {
			read: () => null,
			write: () => {
				throw new Error("Blocked");
			},
		},
	});

	expect(() => client.setEnabled(false)).toThrow(
		"Analytics is off for this session"
	);
	expect(client.enabled).toBe(false);
});

test("a failed opt-out save stays off for the session even when storage recovers", async () => {
	const { create, requests, storage } = fixture();

	create().setEnabled(true);
	let blocked = true;

	const client = create({
		storage: {
			read: () => storage.read(),
			write: (state) => {
				if (blocked) throw new Error("Read-only");

				storage.write(state);
			},
		},
	});

	expect(() => client.setEnabled(false)).toThrow("Could not save");
	blocked = false;

	expect(await client.capture({ name: "app_started" })).toBe(false);
	expect(requests).toHaveLength(0);
	client.setEnabled(true);
	expect(await client.capture({ name: "app_started" })).toBe(true);
});

test("opt-out from another client cancels in-flight requests", async () => {
	const { create } = fixture();

	const client = create({
		http: async (_url, init) =>
			await new Promise((_resolve, reject) => {
				init.signal?.addEventListener(
					"abort",
					() => reject(new Error("Aborted")),
					{ once: true }
				);
			}),
	});

	const pending = client.capture({ name: "app_started" });

	create().setEnabled(false);
	client.refresh();

	expect(await pending).toBe(false);
	expect(client.enabled).toBe(false);
});

test("network errors and quota responses do not retry or reclaim quota", async () => {
	const { create, storage } = fixture();
	let attempts = 0;

	const client = create({
		http: async () => {
			attempts += 1;

			return { ok: false };
		},
	});

	expect(await client.capture({ name: "app_started" })).toBe(false);
	expect(await client.capture({ name: "app_started" })).toBe(false);
	expect(attempts).toBe(1);
	expect(storage.read()).toMatchObject({ dailyCount: 1 });
});

test("hanging requests are cancelled at the configured timeout", async () => {
	const { create } = fixture();
	let aborted = false;

	const client = create({
		http: async (_url, init) =>
			await new Promise((_resolve, reject) => {
				init.signal?.addEventListener(
					"abort",
					() => {
						aborted = true;
						reject(new Error("Timeout"));
					},
					{ once: true }
				);
			}),
	});

	expect(await client.capture({ name: "app_started" })).toBe(false);
	expect(aborted).toBe(true);
});
