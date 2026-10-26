/**
 * Covers: header visibility when leaving and returning to the hero, including edge contact.
 * Real: the header controller and IntersectionObserver callback.
 * Doubles: DOM attributes and viewport intersection entries.
 * Requires: none.
 */
import { expect, test } from "bun:test";

test("header hides at the hero boundary when scrolling back", async () => {
	const attributes = new Set<string>();
	const hero = { getBoundingClientRect: () => ({ bottom: 800 }) };

	const header = {
		inert: true,
		toggleAttribute: (name: string, enabled: boolean) =>
			enabled ? attributes.add(name) : attributes.delete(name),
	};

	let notify: IntersectionObserverCallback | undefined;

	const originalDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		"document"
	);

	const originalObserver = Object.getOwnPropertyDescriptor(
		globalThis,
		"IntersectionObserver"
	);

	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {
			querySelector: (selector: string) =>
				selector === ".hero" ? hero : header,
		},
	});
	Object.defineProperty(globalThis, "IntersectionObserver", {
		configurable: true,
		value: class {
			constructor(callback: IntersectionObserverCallback) {
				notify = callback;
			}
			observe(): void {}
		},
	});

	const intersect = (isIntersecting: boolean, bottom: number) => {
		notify?.(
			[
				{
					isIntersecting,
					boundingClientRect: { bottom },
				} as IntersectionObserverEntry,
			],
			{} as IntersectionObserver
		);
	};

	try {
		await import("../../src/scripts/site-header");
		expect(header.inert).toBe(true);
		intersect(false, -1);
		expect(attributes.has("data-floating")).toBe(true);
		expect(header.inert).toBe(false);
		// IntersectionObserver considers edge contact an intersection even at zero area.
		intersect(true, 0);
		expect(attributes.has("data-floating")).toBe(false);
		expect(header.inert).toBe(true);
		intersect(true, 400);
		expect(attributes.has("data-floating")).toBe(false);
		intersect(false, 2000);
		expect(attributes.has("data-floating")).toBe(false);
	} finally {
		if (originalDocument)
			Object.defineProperty(globalThis, "document", originalDocument);
		else Reflect.deleteProperty(globalThis, "document");

		if (originalObserver)
			Object.defineProperty(
				globalThis,
				"IntersectionObserver",
				originalObserver
			);
		else Reflect.deleteProperty(globalThis, "IntersectionObserver");
	}
});
