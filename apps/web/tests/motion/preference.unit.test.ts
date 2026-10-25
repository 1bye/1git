/**
 * Covers: explicit motion preference persistence and blocked storage.
 * Real: motion preference reader/writer.
 * Doubles: localStorage browser boundary.
 * Requires: none.
 */
import { afterEach, expect, test } from "bun:test";
import {
	readMotionPreference,
	writeMotionPreference,
} from "../../src/scripts/motion-preference";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
	if (original) Object.defineProperty(globalThis, "localStorage", original);
	else Reflect.deleteProperty(globalThis, "localStorage");
});

test("an explicit pause survives another read and can be resumed", () => {
	const values = new Map<string, string>();

	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		},
	});

	expect(readMotionPreference()).toBe(false);
	writeMotionPreference(true);
	expect(readMotionPreference()).toBe(true);
	writeMotionPreference(false);
	expect(readMotionPreference()).toBe(false);
});

test("blocked storage does not prevent using the page", () => {
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		get: () => {
			throw new Error("Storage blocked");
		},
	});

	expect(readMotionPreference()).toBe(false);
	expect(() => writeMotionPreference(true)).not.toThrow();
});
