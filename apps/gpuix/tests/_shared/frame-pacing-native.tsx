import assert from "node:assert/strict";
import { GpuixRenderer } from "@gpuix/native";
import { render } from "@gpuix/react";

const renderer = new GpuixRenderer();

renderer.init({
	title: "1git frame pacing regression",
	width: 600,
	height: 400,
	focus: true,
});

let scrollId: number | undefined;
const commitEditor = process.argv.includes("--commit-editor");
const message = `feat(ui): ${"Wrapped native commit subject ".repeat(180)}\n\n`;

const root = render(
	<div
		ref={(instance) => {
			scrollId = instance?.id;
		}}
		style={{ width: "100%", height: "100%", overflow: "scroll" }}
	>
		{commitEditor ? (
			<textarea
				aria-label="Commit message"
				value={message}
				textColorRanges={[
					{ start: 0, end: 4, color: "#38664a" },
					{ start: 4, end: 5, color: "#888888" },
					{ start: 7, end: 8, color: "#888888" },
				]}
				linePlaceholder={{
					offset: message.length,
					text: "Description (optional)",
					color: "#888888",
				}}
				scrollPaddingBottom={34}
				style={{
					width: "100%",
					height: "100%",
					padding: 8,
					fontSize: 11,
					lineHeight: 16,
				}}
			/>
		) : (
			<div style={{ height: 2400, flexShrink: 0 }}>
				<text>Scrollable native regression content</text>
			</div>
		)}
	</div>,
	{ renderer }
);

const pump = async (): Promise<void> => {
	for (let frame = 0; frame < 20; frame++) {
		assert.ok(renderer.tick(), "native test window must remain alive");
		await Bun.sleep(10);
	}
};

try {
	await pump();
	renderer.activateWindow();
	await pump();
	assert.ok(scrollId, "scroll surface must be mounted");

	const bounds = renderer.getElementBounds(scrollId);

	assert.ok(bounds, "scroll surface must have painted bounds");

	const initialFrames = renderer.getDebugFrameOverlayStats().frames;

	// No event-loop yield: input updates offsets, but must not paint once per event.
	for (let event = 0; event < 40; event++) {
		renderer.simulateScrollWheel(
			bounds.x + 100,
			bounds.y + 80,
			0,
			commitEditor && event % 2 === 0 ? 8 : -8
		);
	}

	const immediateFrames =
		renderer.getDebugFrameOverlayStats().frames - initialFrames;

	assert.equal(immediateFrames, 0, "live input must wait for a display frame");

	if (!commitEditor)
		assert.ok((renderer.getScrollOffset(scrollId)?.[1] ?? 0) < -100);

	await pump();
	assert.ok(
		renderer.getDebugFrameOverlayStats().frames > initialFrames,
		"the display loop must still paint pending input"
	);

	// Keep checking after initial exposure: one activation paint is not a frame loop.
	for (let burst = 0; burst < 4; burst++) {
		const frames = renderer.getDebugFrameOverlayStats().frames;

		// A textarea can start at either scroll boundary after following its caret.
		for (const delta of commitEditor ? [8, -8] : [-8])
			renderer.simulateScrollWheel(bounds.x + 100, bounds.y + 80, 0, delta);

		await pump();
		assert.ok(
			renderer.getDebugFrameOverlayStats().frames > frames,
			"the display loop must repaint subsequent input"
		);
	}

	process.stdout.write("Live redraw batching verified\n");

	if (commitEditor) process.stdout.write("Decorated commit editor verified\n");
} finally {
	root.unmount();
}

process.exit(0);
