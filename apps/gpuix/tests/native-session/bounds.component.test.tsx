/**
 * Covers: last-painted bounds and native input frames without redundant redraws.
 * Real: native test renderer, last-painted geometry and frame counters.
 * Doubles: none.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, expect, it, mock } from "bun:test";
import { createTestRoot } from "@gpuix/react/testing";
import { prepareNativeInputFrames } from "../_shared/native-input-frame";

afterEach(() => mock.restore());

it("reads last-painted bounds without drawing and preserves refreshing queries", () => {
	const root = createTestRoot({ width: 300, height: 200 });

	try {
		root.render(<div testId="box" style={{ width: 80, height: 40 }} />);
		const box = root.renderer.findByTestId("box");

		if (!box) throw new Error("Missing bounds fixture.");

		const bounds = root.renderer.getElementBounds(box.id);
		const frames = root.renderer.getDebugFrameOverlayStats().frames;

		expect(bounds).toMatchObject({ width: 80, height: 40 });

		for (let query = 0; query < 10; query++)
			expect(root.renderer.getElementBounds(box.id, false)).toEqual(bounds);

		expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(frames);
		expect(root.renderer.getElementBounds(box.id)).toEqual(bounds);
		expect(root.renderer.getDebugFrameOverlayStats().frames).toBeGreaterThan(
			frames
		);
	} finally {
		root.unmount();
	}
});

it("uses the input paint and redraws again only after framework mutations", () => {
	const root = createTestRoot({ width: 300, height: 200 });

	try {
		root.render(
			<div
				testId="scroll"
				style={{ width: 200, height: 120, overflowY: "scroll" }}
			>
				<div style={{ height: 1000, flexShrink: 0 }}>
					<text>Scroll content</text>
				</div>
			</div>
		);
		const viewport = root.renderer.findByTestId("scroll");

		if (!viewport) throw new Error("Missing scroll fixture.");

		const box = root.renderer.getElementBounds(viewport.id);

		if (!box) throw new Error("Missing scroll bounds.");

		const flushInputChanges = prepareNativeInputFrames(root);
		const frames = root.renderer.getDebugFrameOverlayStats().frames;

		root.renderer.dispatchScrollWheel(box.x + 10, box.y + 10, 0, -40);
		const painted = root.renderer.getDebugFrameOverlayStats().frames;

		expect(painted).toBeGreaterThan(frames);
		flushInputChanges();
		expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(painted);
		expect(root.renderer.getScrollOffset(viewport.id)?.[1]).toBeLessThan(0);
		root.renderer.applyBatch(
			JSON.stringify([
				[
					"setStyle",
					viewport.id,
					{ width: 160, height: 120, overflowY: "scroll" },
				],
			])
		);
		expect(root.renderer.getElementBounds(viewport.id)?.width).toBe(200);
		flushInputChanges();
		expect(root.renderer.getElementBounds(viewport.id)?.width).toBe(160);
		expect(root.renderer.getDebugFrameOverlayStats().frames).toBeGreaterThan(
			painted
		);
	} finally {
		root.unmount();
	}
});
