import { describe, expect, test } from "bun:test";
import {
	type ReducedMotionMediaQuery,
	readReducedMotionPreference,
	subscribeReducedMotionPreference,
} from "../src/renderer/src/fixture/liquid-surface/hooks/use-reduced-motion.js";

const createMediaQuery = (): {
	readonly mediaQuery: ReducedMotionMediaQuery & { matches: boolean };
	readonly notify: () => void;
	readonly removedListeners: () => number;
} => {
	let listener: (() => void) | null = null;
	let removeCount = 0;
	const mediaQuery: ReducedMotionMediaQuery & { matches: boolean } = {
		addEventListener: (_type, nextListener) => {
			listener = nextListener;
		},
		matches: false,
		removeEventListener: (_type, removedListener) => {
			if (listener === removedListener) {
				listener = null;
			}
			removeCount += 1;
		},
	};
	return {
		mediaQuery,
		notify: () => listener?.(),
		removedListeners: () => removeCount,
	};
};

describe("liquid reduced motion", () => {
	test("uses a safe server fallback without a media query", () => {
		expect(readReducedMotionPreference(null)).toBeFalse();
	});

	test("tracks live preference changes and removes its listener", () => {
		const source = createMediaQuery();
		const values: boolean[] = [];
		const unsubscribe = subscribeReducedMotionPreference(
			(matches) => values.push(matches),
			source.mediaQuery
		);

		source.mediaQuery.matches = true;
		source.notify();
		unsubscribe();
		source.mediaQuery.matches = false;
		source.notify();

		expect(values).toEqual([false, true]);
		expect(source.removedListeners()).toBe(1);
	});
});
