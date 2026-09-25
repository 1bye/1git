import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createLiquidGeometryTracker } from "@/fixture/liquid-surface/lib/track-liquid-geometry.js";

class FakeElement extends EventTarget {
	assignedSlot: FakeElement | null = null;
	ownerDocument: { readonly defaultView: FakeWindow };
	parentNode: FakeElement | null;
	readonly overflow: string;

	constructor(
		view: FakeWindow,
		overflow = "visible",
		parentNode: FakeElement | null = null
	) {
		super();
		this.ownerDocument = { defaultView: view };
		this.overflow = overflow;
		this.parentNode = parentNode;
	}
}

class FakeShadowRoot {
	readonly host: FakeElement;

	constructor(host: FakeElement) {
		this.host = host;
	}
}

class FakeWindow extends EventTarget {
	readonly visualViewport = new EventTarget();
	computedStyleReadCount = 0;
	private animationFrameId = 0;
	private readonly animationFrames = new Map<number, FrameRequestCallback>();

	cancelAnimationFrame = (frameId: number): void => {
		this.animationFrames.delete(frameId);
	};

	flushAnimationFrames(): void {
		const frames = [...this.animationFrames.values()];
		this.animationFrames.clear();
		for (const frame of frames) {
			frame(0);
		}
	}

	getComputedStyle = (element: Element): CSSStyleDeclaration => {
		this.computedStyleReadCount += 1;
		const { overflow } = element as unknown as FakeElement;
		return {
			overflow,
			overflowX: overflow,
			overflowY: overflow,
		} as CSSStyleDeclaration;
	};

	get pendingAnimationFrameCount(): number {
		return this.animationFrames.size;
	}

	requestAnimationFrame = (callback: FrameRequestCallback): number => {
		this.animationFrameId += 1;
		this.animationFrames.set(this.animationFrameId, callback);
		return this.animationFrameId;
	};
}

class FakeResizeObserver {
	static latest: FakeResizeObserver | null = null;

	readonly observedElements = new Set<Element>();
	private readonly callback: ResizeObserverCallback;
	isDisconnected = false;

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		FakeResizeObserver.latest = this;
	}

	disconnect(): void {
		this.isDisconnected = true;
		this.observedElements.clear();
	}

	emit(): void {
		this.callback([], this as unknown as ResizeObserver);
	}

	observe(element: Element): void {
		this.isDisconnected = false;
		this.observedElements.add(element);
	}

	unobserve(element: Element): void {
		this.observedElements.delete(element);
	}
}

class FakeMutationObserver {
	static latest: FakeMutationObserver | null = null;

	readonly observedElements = new Set<Node>();
	private readonly callback: MutationCallback;
	isDisconnected = false;

	constructor(callback: MutationCallback) {
		this.callback = callback;
		FakeMutationObserver.latest = this;
	}

	disconnect(): void {
		this.isDisconnected = true;
		this.observedElements.clear();
	}

	emit(): void {
		this.callback([], this as unknown as MutationObserver);
	}

	observe(element: Node): void {
		this.isDisconnected = false;
		this.observedElements.add(element);
	}

	takeRecords(): MutationRecord[] {
		return [];
	}
}

const GLOBAL_NAMES = [
	"Element",
	"MutationObserver",
	"ResizeObserver",
	"ShadowRoot",
	"window",
] as const;
const originalDescriptors = new Map<
	(typeof GLOBAL_NAMES)[number],
	PropertyDescriptor | undefined
>();
let fakeWindow: FakeWindow;

const getLatestResizeObserver = (): FakeResizeObserver => {
	const observer = FakeResizeObserver.latest;
	if (!observer) {
		throw new Error(
			"Expected the liquid geometry tracker to create an observer."
		);
	}
	return observer;
};

beforeEach(() => {
	for (const name of GLOBAL_NAMES) {
		originalDescriptors.set(
			name,
			Object.getOwnPropertyDescriptor(globalThis, name)
		);
	}
	fakeWindow = new FakeWindow();
	Object.defineProperties(globalThis, {
		Element: { configurable: true, value: FakeElement },
		MutationObserver: { configurable: true, value: FakeMutationObserver },
		ResizeObserver: { configurable: true, value: FakeResizeObserver },
		ShadowRoot: { configurable: true, value: FakeShadowRoot },
		window: { configurable: true, value: fakeWindow },
	});
});

afterEach(() => {
	for (const name of GLOBAL_NAMES) {
		const descriptor = originalDescriptors.get(name);
		if (descriptor) {
			Object.defineProperty(globalThis, name, descriptor);
		} else {
			Reflect.deleteProperty(globalThis, name);
		}
	}
	originalDescriptors.clear();
	FakeResizeObserver.latest = null;
	FakeMutationObserver.latest = null;
});

describe("liquid geometry tracker", () => {
	test("coalesces scroll, resize, viewport, and observer changes", () => {
		let measurementCount = 0;
		const scrollAncestor = new FakeElement(fakeWindow, "auto");
		const anchor = new FakeElement(fakeWindow, "visible", scrollAncestor);
		const menu = new FakeElement(fakeWindow, "visible", scrollAncestor);
		const tracker = createLiquidGeometryTracker(() => {
			measurementCount += 1;
		});

		tracker.setElements([
			anchor as unknown as Element,
			menu as unknown as Element,
			anchor as unknown as Element,
		]);
		expect(getLatestResizeObserver().observedElements.size).toBe(2);
		expect(fakeWindow.pendingAnimationFrameCount).toBe(1);
		fakeWindow.flushAnimationFrames();
		expect(measurementCount).toBe(1);

		scrollAncestor.dispatchEvent(new Event("scroll"));
		scrollAncestor.dispatchEvent(new Event("scroll"));
		fakeWindow.dispatchEvent(new Event("resize"));
		fakeWindow.visualViewport.dispatchEvent(new Event("scroll"));
		getLatestResizeObserver().emit();
		FakeMutationObserver.latest?.emit();
		expect(fakeWindow.pendingAnimationFrameCount).toBe(1);
		fakeWindow.flushAnimationFrames();
		expect(measurementCount).toBe(2);

		tracker.disconnect();
	});

	test("reads shared scroll ancestor styles once per subscription update", () => {
		const scrollAncestor = new FakeElement(fakeWindow, "auto");
		const sharedParent = new FakeElement(fakeWindow, "visible", scrollAncestor);
		const anchor = new FakeElement(fakeWindow, "visible", sharedParent);
		const menu = new FakeElement(fakeWindow, "visible", sharedParent);
		const tracker = createLiquidGeometryTracker(() => undefined);

		tracker.setElements([
			anchor as unknown as Element,
			menu as unknown as Element,
		]);

		expect(fakeWindow.computedStyleReadCount).toBe(2);
		tracker.disconnect();
	});

	test("moves subscriptions and completely disconnects", () => {
		let measurementCount = 0;
		const firstScroller = new FakeElement(fakeWindow, "auto");
		const secondScroller = new FakeElement(fakeWindow, "scroll");
		const anchor = new FakeElement(fakeWindow, "visible", firstScroller);
		const tracker = createLiquidGeometryTracker(() => {
			measurementCount += 1;
		});

		tracker.setElements([anchor as unknown as Element]);
		fakeWindow.flushAnimationFrames();
		anchor.parentNode = secondScroller;
		tracker.setElements([anchor as unknown as Element]);

		firstScroller.dispatchEvent(new Event("scroll"));
		expect(fakeWindow.pendingAnimationFrameCount).toBe(0);
		secondScroller.dispatchEvent(new Event("scroll"));
		expect(fakeWindow.pendingAnimationFrameCount).toBe(1);

		tracker.disconnect();
		tracker.disconnect();
		expect(fakeWindow.pendingAnimationFrameCount).toBe(0);
		expect(getLatestResizeObserver().isDisconnected).toBe(true);
		expect(FakeMutationObserver.latest?.isDisconnected).toBe(true);
		secondScroller.dispatchEvent(new Event("scroll"));
		fakeWindow.dispatchEvent(new Event("resize"));
		fakeWindow.visualViewport.dispatchEvent(new Event("resize"));
		expect(fakeWindow.pendingAnimationFrameCount).toBe(0);
		expect(measurementCount).toBe(1);
	});

	test("replaces a scheduled frame with one immediate measurement", () => {
		let measurementCount = 0;
		const tracker = createLiquidGeometryTracker(() => {
			measurementCount += 1;
		});
		const anchor = new FakeElement(fakeWindow);

		tracker.setElements([anchor as unknown as Element]);
		expect(fakeWindow.pendingAnimationFrameCount).toBe(1);

		tracker.measureNow();
		expect(measurementCount).toBe(1);
		expect(fakeWindow.pendingAnimationFrameCount).toBe(0);
		fakeWindow.flushAnimationFrames();
		expect(measurementCount).toBe(1);

		tracker.setContinuousTracking(true);
		tracker.measureNow();
		expect(measurementCount).toBe(2);
		expect(fakeWindow.pendingAnimationFrameCount).toBe(1);

		tracker.disconnect();
		tracker.measureNow();
		expect(measurementCount).toBe(2);
		expect(fakeWindow.pendingAnimationFrameCount).toBe(0);
	});

	test("remeasures when tracked children are inserted or removed", () => {
		let measurementCount = 0;
		const tracker = createLiquidGeometryTracker(() => {
			measurementCount += 1;
		});
		const tabList = new FakeElement(fakeWindow);

		tracker.setElements([tabList as unknown as Element]);
		fakeWindow.flushAnimationFrames();
		expect(measurementCount).toBe(1);

		FakeMutationObserver.latest?.emit();
		FakeMutationObserver.latest?.emit();
		expect(fakeWindow.pendingAnimationFrameCount).toBe(1);
		fakeWindow.flushAnimationFrames();
		expect(measurementCount).toBe(2);

		tracker.disconnect();
		FakeMutationObserver.latest?.emit();
		expect(fakeWindow.pendingAnimationFrameCount).toBe(0);
	});

	test("shares one frame between continuous tracking and events", () => {
		let measurementCount = 0;
		const tracker = createLiquidGeometryTracker(() => {
			measurementCount += 1;
		});

		tracker.setContinuousTracking(true);
		fakeWindow.dispatchEvent(new Event("scroll"));
		expect(fakeWindow.pendingAnimationFrameCount).toBe(1);
		fakeWindow.flushAnimationFrames();
		expect(measurementCount).toBe(1);
		expect(fakeWindow.pendingAnimationFrameCount).toBe(1);

		tracker.setContinuousTracking(false);
		fakeWindow.flushAnimationFrames();
		expect(measurementCount).toBe(2);
		expect(fakeWindow.pendingAnimationFrameCount).toBe(0);
		tracker.disconnect();
	});
});
