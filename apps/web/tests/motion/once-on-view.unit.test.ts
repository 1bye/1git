/**
 * Covers: once-only entry, reduced-motion fallback, and tall-section visibility.
 * Real: onceOnView lifecycle logic.
 * Doubles: IntersectionObserver, matchMedia, and section geometry.
 * Requires: none.
 */
import { afterEach, expect, test } from "bun:test";
import { onceOnView } from "../../src/scripts/motion";

const saved = new Map<string, PropertyDescriptor | undefined>();

function install(name: string, value: unknown): void {
	saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	Object.defineProperty(globalThis, name, { configurable: true, value });
}
afterEach(() => {
	for (const [name, descriptor] of saved) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}

	saved.clear();
});

function browser(reduced = false) {
	let onChange: (() => void) | undefined;
	let onIntersection:
		| ((entries: { isIntersecting: boolean }[]) => void)
		| undefined;
	let threshold: number | number[] | undefined;
	let observed = false;
	let disconnected = false;
	const media = {
		matches: reduced,
		addEventListener: (_event: string, callback: () => void) => {
			onChange = callback;
		},
	};

	install("matchMedia", () => media);
	install("innerHeight", 800);
	install(
		"IntersectionObserver",
		class {
			constructor(
				callback: typeof onIntersection,
				options: IntersectionObserverInit
			) {
				onIntersection = callback;
				threshold = options.threshold;
			}
			observe() {
				observed = true;
			}
			disconnect() {
				disconnected = true;
			}
		}
	);

	return {
		media,
		change: () => onChange?.(),
		intersect: (visible: boolean) =>
			onIntersection?.([{ isIntersecting: visible }]),
		state: () => ({ threshold, observed, disconnected }),
	};
}

test("reduced motion settles readable content without scheduling an observer", () => {
	const env = browser(true);
	let entered = false;
	let settled = false;

	onceOnView(
		{ offsetHeight: 1000 } as HTMLElement,
		() => {
			entered = true;
		},
		() => {
			settled = true;
		}
	);

	expect(settled).toBe(true);
	expect(entered).toBe(false);
	expect(env.state().observed).toBe(false);
});

test("runs entry exactly once, including queued intersection notifications", () => {
	const env = browser();
	let entries = 0;

	onceOnView({ offsetHeight: 500 } as HTMLElement, () => {
		entries++;
	});
	env.intersect(false);
	expect(entries).toBe(0);
	env.intersect(true);
	env.intersect(true);

	expect(entries).toBe(1);
	expect(env.state().disconnected).toBe(true);
});

test("a tall section can enter before its full bounding box fills the viewport", () => {
	const env = browser();

	onceOnView({ offsetHeight: 2400 } as HTMLElement, () => {});

	expect(env.state().threshold).toBeCloseTo((800 / 2400) * 0.35);
});

test("switching to reduced motion cancels pending entry and settles the section", () => {
	const env = browser();
	let settled = false;

	onceOnView(
		{ offsetHeight: 500 } as HTMLElement,
		() => {},
		() => {
			settled = true;
		}
	);
	env.media.matches = true;
	env.change();

	expect(settled).toBe(true);
	expect(env.state().disconnected).toBe(true);
});
