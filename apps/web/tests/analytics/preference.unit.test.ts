/**
 * Covers: default-on browser preference, durable opt-out, quota persistence, blocked storage and private page paths.
 * Real: browser storage adapter and analytics policy.
 * Doubles: localStorage and inactive HTTP transport; no PostHog traffic.
 * Requires: none.
 */
import { afterEach, expect, test } from "bun:test";
import { AnonymousAnalytics } from "@1git/analytics/client";
import {
	analyticsPage,
	BrowserAnalyticsStorage,
} from "../../src/scripts/analytics";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
	if (original) Object.defineProperty(globalThis, "localStorage", original);
	else Reflect.deleteProperty(globalThis, "localStorage");
});

test("browser analytics defaults on, and explicit disable and enable survive a page reload", () => {
	const values = new Map<string, string>();

	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		},
	});
	const create = () =>
		new AnonymousAnalytics({
			source: "website",
			active: false,
			storage: new BrowserAnalyticsStorage(),
		});

	const client = create();

	expect(client.enabled).toBe(true);
	client.setEnabled(false);
	expect(create().enabled).toBe(false);
	client.setEnabled(true);
	expect(create().enabled).toBe(true);
	expect([...values.values()].join()).not.toContain("distinct_id");
});

test("blocked localStorage keeps collection off without breaking the page", () => {
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		get: () => {
			throw new Error("Blocked");
		},
	});
	const client = new AnonymousAnalytics({
		source: "website",
		active: false,
		storage: new BrowserAnalyticsStorage(),
	});

	expect(client.enabled).toBe(false);
	expect(() => client.setEnabled(true)).toThrow(
		"Could not save your analytics preference"
	);
	expect(client.enabled).toBe(false);
});

test("only known page categories are reported, including private or unknown URLs", () => {
	expect(analyticsPage("/")).toBe("home");
	expect(analyticsPage("/faq/")).toBe("faq");
	expect(analyticsPage("/faq")).toBe("faq");
	expect(analyticsPage("/private/customer@example.com")).toBe("not_found");
});
