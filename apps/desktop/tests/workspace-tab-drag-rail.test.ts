import { describe, expect, test } from "bun:test";
import type { DragDropManager } from "@dnd-kit/dom";
import {
	createWorkspaceTabDragRailController,
	createWorkspaceTabDragRailFrame,
	refreshWorkspaceTabDragCollisions,
} from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-tab-drag-rail.js";

const RAIL_EDGE_FADE_MASK =
	"linear-gradient(to right, transparent 0, black 32px, black calc(100% - 32px), transparent 100%)";

class FakeAnimationFrames {
	private frameId = 0;
	private readonly frames = new Map<number, FrameRequestCallback>();

	cancel = (frameId: number): void => {
		this.frames.delete(frameId);
	};

	flush(frameTime: number): void {
		const callbacks = [...this.frames.values()];
		this.frames.clear();
		for (const callback of callbacks) {
			callback(frameTime);
		}
	}

	get pendingCount(): number {
		return this.frames.size;
	}

	request = (callback: FrameRequestCallback): number => {
		this.frameId += 1;
		this.frames.set(this.frameId, callback);
		return this.frameId;
	};
}

class FakeStyle {
	private readonly properties = new Map<string, string>();

	getPropertyValue(name: string): string {
		return this.properties.get(name) ?? "";
	}

	removeProperty(name: string): string {
		const previousValue = this.getPropertyValue(name);
		this.properties.delete(name);
		return previousValue;
	}

	setProperty(name: string, value: string): void {
		this.properties.set(name, value);
	}
}

class FakeDragRailElement {
	readonly attributes = new Set<string>();
	clientWidth = 400;
	readonly style = new FakeStyle();
	scrollLeft = 200;
	scrollWidth = 1000;
	private bounds: { readonly left: number; readonly right: number };

	constructor(left: number, right: number) {
		this.bounds = { left, right };
	}

	getBoundingClientRect(): DOMRect {
		const { left, right } = this.bounds;
		return {
			bottom: 40,
			height: 40,
			left,
			right,
			toJSON: () => undefined,
			top: 0,
			width: right - left,
			x: left,
			y: 0,
		};
	}

	hasAttribute(name: string): boolean {
		return this.attributes.has(name);
	}

	setBounds(left: number, right: number): void {
		this.bounds = { left, right };
	}
}

const asHTMLElement = (element: FakeDragRailElement): HTMLElement =>
	element as unknown as HTMLElement;

describe("workspace tab drag rail frame", () => {
	test("clips both overlay edges to the rail", () => {
		const common = {
			elapsedMs: 0,
			pointerX: null,
			railBounds: { left: 100, right: 500 },
			scrollMetrics: {
				clientWidth: 400,
				scrollLeft: 200,
				scrollWidth: 1000,
			},
		};

		expect(
			createWorkspaceTabDragRailFrame({
				...common,
				overlayBounds: { left: 70, right: 280 },
			})
		).toMatchObject({ clipInsetLeft: 30, clipInsetRight: 0 });
		expect(
			createWorkspaceTabDragRailFrame({
				...common,
				overlayBounds: { left: 390, right: 540 },
			})
		).toMatchObject({ clipInsetLeft: 0, clipInsetRight: 40 });
		expect(
			createWorkspaceTabDragRailFrame({
				...common,
				overlayBounds: { left: -120, right: 90 },
			})
		).toMatchObject({ clipInsetLeft: 210, clipInsetRight: 0 });
		expect(
			createWorkspaceTabDragRailFrame({
				...common,
				overlayBounds: { left: 510, right: 720 },
			})
		).toMatchObject({ clipInsetLeft: 0, clipInsetRight: 210 });
		expect(
			createWorkspaceTabDragRailFrame({
				...common,
				overlayBounds: { left: 70, right: 540 },
			})
		).toMatchObject({ clipInsetLeft: 30, clipInsetRight: 40 });
	});

	test("aligns the rail-wide fade mask from either overlay edge", () => {
		const common = {
			elapsedMs: 0,
			pointerX: null,
			railBounds: { left: 100, right: 500 },
			scrollMetrics: {
				clientWidth: 400,
				scrollLeft: 200,
				scrollWidth: 1000,
			},
		};

		expect(
			createWorkspaceTabDragRailFrame({
				...common,
				overlayBounds: { left: 70, right: 280 },
			})
		).toMatchObject({ maskOffsetLeft: 30, maskWidth: 400 });
		expect(
			createWorkspaceTabDragRailFrame({
				...common,
				overlayBounds: { left: 420, right: 540 },
			})
		).toMatchObject({ maskOffsetLeft: -320, maskWidth: 400 });
	});

	test("scrolls by pointer X inside the edge zone and beyond either edge", () => {
		const common = {
			elapsedMs: 16,
			overlayBounds: { left: 180, right: 390 },
			railBounds: { left: 100, right: 500 },
			scrollMetrics: {
				clientWidth: 400,
				scrollLeft: 200,
				scrollWidth: 1000,
			},
		};

		expect(
			createWorkspaceTabDragRailFrame({ ...common, pointerX: 300 }).scrollLeft
		).toBe(200);
		expect(
			createWorkspaceTabDragRailFrame({ ...common, pointerX: 124 }).scrollLeft
		).toBe(192.32);
		expect(
			createWorkspaceTabDragRailFrame({ ...common, pointerX: 40 }).scrollLeft
		).toBe(184.64);
		expect(
			createWorkspaceTabDragRailFrame({ ...common, pointerX: 476 }).scrollLeft
		).toBe(207.68);
		expect(
			createWorkspaceTabDragRailFrame({ ...common, pointerX: 560 }).scrollLeft
		).toBe(215.36);
	});

	test("is time-based, caps long frames, and clamps the scroll range", () => {
		const common = {
			overlayBounds: { left: 180, right: 390 },
			pointerX: 560,
			railBounds: { left: 100, right: 500 },
		};
		const metrics = {
			clientWidth: 400,
			scrollLeft: 200,
			scrollWidth: 1000,
		};
		const shortFrame = createWorkspaceTabDragRailFrame({
			...common,
			elapsedMs: 8,
			scrollMetrics: metrics,
		});
		const doubleFrame = createWorkspaceTabDragRailFrame({
			...common,
			elapsedMs: 16,
			scrollMetrics: metrics,
		});
		const cappedFrame = createWorkspaceTabDragRailFrame({
			...common,
			elapsedMs: 1000,
			scrollMetrics: metrics,
		});

		expect(shortFrame.scrollLeft - metrics.scrollLeft).toBeCloseTo(7.68);
		expect(doubleFrame.scrollLeft - metrics.scrollLeft).toBeCloseTo(15.36);
		expect(cappedFrame.scrollLeft - metrics.scrollLeft).toBeCloseTo(30.72);
		expect(
			createWorkspaceTabDragRailFrame({
				...common,
				elapsedMs: 32,
				pointerX: 40,
				scrollMetrics: { ...metrics, scrollLeft: 5 },
			}).scrollLeft
		).toBe(0);
		expect(
			createWorkspaceTabDragRailFrame({
				...common,
				elapsedMs: 32,
				scrollMetrics: { ...metrics, scrollLeft: 590 },
			}).scrollLeft
		).toBe(600);
	});
});

describe("workspace tab drag rail controller", () => {
	test("uses one frame loop for clipping and pointer-only scrolling", () => {
		const frames = new FakeAnimationFrames();
		const rail = new FakeDragRailElement(100, 500);
		const overlay = new FakeDragRailElement(80, 290);
		const collisionRefreshScrollPositions: number[] = [];
		overlay.attributes.add("data-dnd-dragging");
		const controller = createWorkspaceTabDragRailController({
			cancelFrame: frames.cancel,
			getOverlay: () => asHTMLElement(overlay),
			getRail: () => asHTMLElement(rail),
			getRailMaskImage: () => RAIL_EDGE_FADE_MASK,
			postDragTrackingDurationMs: 240,
			refreshCollisions: () => {
				collisionRefreshScrollPositions.push(rail.scrollLeft);
			},
			requestFrame: frames.request,
		});

		controller.start(124);
		controller.move(120);
		controller.move(124);
		expect(frames.pendingCount).toBe(1);
		frames.flush(0);
		expect(overlay.style.getPropertyValue("clip-path")).toBe(
			"inset(-100vh 0px -100vh 20px)"
		);
		expect(overlay.style.getPropertyValue("mask-image")).toBe(
			RAIL_EDGE_FADE_MASK
		);
		expect(overlay.style.getPropertyValue("mask-clip")).toBe("no-clip");
		expect(overlay.style.getPropertyValue("mask-position")).toBe("20px -100vh");
		expect(overlay.style.getPropertyValue("mask-size")).toBe(
			"400px calc(100% + 200vh)"
		);
		expect(rail.scrollLeft).toBe(200);
		expect(collisionRefreshScrollPositions).toEqual([]);
		expect(frames.pendingCount).toBe(1);

		frames.flush(16);
		expect(rail.scrollLeft).toBe(192.32);
		expect(collisionRefreshScrollPositions).toEqual([192.32]);
		overlay.setBounds(420, 540);
		controller.move(560);
		frames.flush(32);
		expect(overlay.style.getPropertyValue("clip-path")).toBe(
			"inset(-100vh 40px -100vh 0px)"
		);
		expect(overlay.style.getPropertyValue("mask-position")).toBe(
			"-320px -100vh"
		);
		expect(rail.scrollLeft).toBeCloseTo(207.68);
		expect(collisionRefreshScrollPositions).toEqual([192.32, 207.68]);

		controller.disconnect();
		expect(frames.pendingCount).toBe(0);
		expect(overlay.style.getPropertyValue("clip-path")).toBe("");
		expect(overlay.style.getPropertyValue("mask-image")).toBe("");
		expect(overlay.style.getPropertyValue("mask-clip")).toBe("");
		controller.start(560);
		expect(frames.pendingCount).toBe(0);
	});

	test("keeps clipping through drop presence and then cleans up", () => {
		const frames = new FakeAnimationFrames();
		const rail = new FakeDragRailElement(100, 500);
		const overlay = new FakeDragRailElement(70, 280);
		overlay.attributes.add("data-dnd-dragging");
		const controller = createWorkspaceTabDragRailController({
			cancelFrame: frames.cancel,
			getOverlay: () => asHTMLElement(overlay),
			getRail: () => asHTMLElement(rail),
			getRailMaskImage: () => null,
			postDragTrackingDurationMs: 240,
			refreshCollisions: () => undefined,
			requestFrame: frames.request,
		});

		controller.start(40);
		frames.flush(0);
		expect(overlay.style.getPropertyValue("clip-path")).not.toBe("");
		expect(rail.scrollLeft).toBe(200);
		controller.end();
		overlay.attributes.delete("data-dnd-dragging");
		overlay.attributes.add("data-dnd-dropping");
		frames.flush(16);
		expect(overlay.style.getPropertyValue("clip-path")).not.toBe("");
		expect(rail.scrollLeft).toBe(200);
		expect(frames.pendingCount).toBe(1);

		overlay.attributes.delete("data-dnd-dropping");
		frames.flush(32);
		expect(overlay.style.getPropertyValue("clip-path")).toBe("");
		expect(frames.pendingCount).toBe(0);
	});

	test("bounds stale drop presence by the configured animation duration", () => {
		const frames = new FakeAnimationFrames();
		const rail = new FakeDragRailElement(100, 500);
		const overlay = new FakeDragRailElement(70, 280);
		overlay.attributes.add("data-dnd-dragging");
		const controller = createWorkspaceTabDragRailController({
			cancelFrame: frames.cancel,
			getOverlay: () => asHTMLElement(overlay),
			getRail: () => asHTMLElement(rail),
			getRailMaskImage: () => null,
			postDragTrackingDurationMs: 240,
			refreshCollisions: () => undefined,
			requestFrame: frames.request,
		});

		controller.start(40);
		frames.flush(0);
		controller.end();
		overlay.attributes.add("data-dnd-dropping");
		frames.flush(16);
		expect(frames.pendingCount).toBe(1);
		frames.flush(257);

		expect(overlay.style.getPropertyValue("clip-path")).toBe("");
		expect(frames.pendingCount).toBe(0);
	});
});

test("refreshes droppable geometry before forcing a synchronous collision", () => {
	const calls: string[] = [];
	const manager = {
		collisionObserver: {
			forceUpdate: (immediate: boolean) => {
				calls.push(`collision:${immediate}`);
			},
		},
		registry: {
			droppables: [
				{
					refreshShape: () => {
						calls.push("shape:first");
					},
				},
				{
					refreshShape: () => {
						calls.push("shape:second");
					},
				},
			],
		},
	} as unknown as DragDropManager;

	refreshWorkspaceTabDragCollisions(manager);

	expect(calls).toEqual(["shape:first", "shape:second", "collision:true"]);
});
