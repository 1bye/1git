/**
 * Covers: scene boundaries, tall readable scenes, and viewport-centre observation.
 * Real: scene-state selection and observer lifecycle.
 * Doubles: browser geometry, animation-frame scheduling, and IntersectionObserver.
 * Requires: none.
 */
import { afterEach, expect, test } from "bun:test";
import {
	observeViewportCenter,
	sceneState,
} from "../../src/scripts/scene-motion";

const saved = new Map<string, PropertyDescriptor | undefined>();

function install(name: string, value: unknown): void {
	saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value,
	});
}

afterEach(() => {
	for (const [name, descriptor] of saved) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}

	saved.clear();
});

test("scenes enter at the viewport centre and leave at their bottom edge", () => {
	expect(sceneState(901, 1801, 450)).toBe("before");
	expect(sceneState(450, 1350, 450)).toBe("active");
	expect(sceneState(-450, 450, 450)).toBe("after");
});

test("a scene taller than the screen stays active while reading its middle", () => {
	expect(sceneState(-900, 1500, 400)).toBe("active");
	expect(sceneState(-1700, 700, 400)).toBe("active");
	expect(sceneState(-2000, 400, 400)).toBe("after");
});

test("centre observation uses height-based pixel margins and follows resize", () => {
	const instances: {
		margin: string | undefined;
		targets: Element[];
		disconnected: boolean;
	}[] = [];

	let resize: (() => void) | undefined;
	let listenerRemoved = false;
	let scheduled: FrameRequestCallback | undefined;

	install("innerHeight", 984);
	install("innerWidth", 1440);
	install("window", {
		addEventListener: (_event: string, callback: () => void) => {
			resize = callback;
		},
		removeEventListener: (_event: string, callback: () => void) => {
			listenerRemoved = callback === resize;
		},
	});
	install("requestAnimationFrame", (callback: FrameRequestCallback) => {
		scheduled = callback;

		return 1;
	});
	install("cancelAnimationFrame", () => {});
	install(
		"IntersectionObserver",
		class {
			readonly state: (typeof instances)[number];
			constructor(
				_callback: IntersectionObserverCallback,
				options: IntersectionObserverInit
			) {
				this.state = {
					margin: options.rootMargin,
					targets: [],
					disconnected: false,
				};
				instances.push(this.state);
			}
			observe(target: Element): void {
				this.state.targets.push(target);
			}
			disconnect(): void {
				this.state.disconnected = true;
			}
		}
	);
	const target = {} as Element;

	const dispose = observeViewportCenter([target], () => {});

	expect(instances[0]?.margin).toBe("-491px 0px -491px 0px");
	expect(instances[0]?.targets).toEqual([target]);
	Object.defineProperty(globalThis, "innerHeight", {
		configurable: true,
		value: 812,
	});
	resize?.();
	scheduled?.(0);
	expect(instances[0]?.disconnected).toBe(true);
	expect(instances[1]?.margin).toBe("-405px 0px -405px 0px");

	dispose();

	expect(instances[1]?.disconnected).toBe(true);
	expect(listenerRemoved).toBe(true);
});
