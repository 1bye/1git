/**
 * Covers: scene boundaries, tall readable scenes, and viewport-centre observation.
 * Real: scene-state selection and observer lifecycle.
 * Doubles: browser geometry, animation-frame scheduling, and IntersectionObserver.
 * Requires: none.
 */
import { afterEach, expect, test } from "bun:test";
import {
	initScenes,
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

test("phone reveals stay readable through scrolling and browser-bar resizes", () => {
	const rootAttributes = new Set<string>();
	const entered = new Set<string>();
	const changes = new Map<string, () => void>();

	const observers: {
		callback: IntersectionObserverCallback;
		targets: Element[];
	}[] = [];

	const compact = {
		matches: true,
		addEventListener: (_: string, callback: () => void) =>
			changes.set("compact", callback),
	};

	const reduced = { matches: false, addEventListener: () => {} };

	const actor = {
		offsetHeight: 200,
		setAttribute: (name: string) => entered.add(name),
	};

	let top = 100;
	let resize: (() => void) | undefined;

	const scenes = [0, 1].map(() => ({
		dataset: {} as Record<string, string>,
		getBoundingClientRect: () => ({ top, bottom: top + 500 }),
	}));

	install("innerHeight", 844);
	install("matchMedia", (query: string) =>
		query.includes("prefers-reduced-motion") ? reduced : compact
	);
	install("window", {
		addEventListener: (_: string, callback: () => void) => {
			resize = callback;
		},
	});
	install("document", {
		documentElement: {
			hasAttribute: (name: string) => rootAttributes.has(name),
			toggleAttribute: (name: string, enabled: boolean) =>
				enabled ? rootAttributes.add(name) : rootAttributes.delete(name),
		},
		querySelectorAll: (selector: string) =>
			selector === "[data-scene]" ? scenes : [actor],
		addEventListener: () => {},
	});
	install(
		"IntersectionObserver",
		class {
			readonly state: (typeof observers)[number];
			constructor(callback: IntersectionObserverCallback) {
				this.state = { callback, targets: [] };
				observers.push(this.state);
			}
			observe(target: Element): void {
				this.state.targets.push(target);
			}
			disconnect(): void {}
		}
	);

	initScenes();
	expect(rootAttributes.has("data-scenes-ready")).toBe(false);
	expect(rootAttributes.has("data-flow-ready")).toBe(true);
	const actorObserver = observers.find((observer) =>
		observer.targets.includes(actor as unknown as Element)
	);

	expect(actorObserver).toBeDefined();
	actorObserver?.callback(
		[{ isIntersecting: true } as IntersectionObserverEntry],
		{} as IntersectionObserver
	);
	expect(entered.has("data-scene-entered")).toBe(true);
	// A toolbar resize and scrolling past the section must not hide or restart its content.
	top = -1000;
	resize?.();
	expect(scenes.every((scene) => scene.dataset.sceneState === "active")).toBe(
		true
	);
	expect(entered.has("data-scene-entered")).toBe(true);
	compact.matches = false;
	changes.get("compact")?.();
	expect(rootAttributes.has("data-flow-ready")).toBe(false);
	expect(rootAttributes.has("data-scenes-ready")).toBe(true);
	expect(scenes.every((scene) => scene.dataset.sceneState === "after")).toBe(
		true
	);
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
