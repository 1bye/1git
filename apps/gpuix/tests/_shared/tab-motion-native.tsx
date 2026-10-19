import assert from "node:assert/strict";
import { createRenderer, render } from "@gpuix/react";

import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";

const renderer = createRenderer();

renderer.init({
	...windowOptions,
	focus: true,
	title: "1git tab motion regression",
});

const root = render(<App preview initialTabCount={7} />, { renderer });

function findTab(value: unknown): number | undefined {
	if (!value || typeof value !== "object") return;

	if ("testId" in value && value.testId === "workspace-4" && "id" in value) {
		assert.ok(typeof value.id === "number");

		return value.id;
	}

	for (const child of Object.values(value)) {
		const id = findTab(child);

		if (id !== undefined) return id;
	}
}

let failure: unknown;

try {
	for (let turn = 0; turn < 40; turn++) {
		assert.ok(renderer.tick());
		await Bun.sleep(10);
	}

	const tab = findTab(JSON.parse(renderer.getAutomationTree()));

	assert.ok(tab, "the tab strip must be mounted");
	renderer.activateWindow();
	renderer.focusElement(tab);

	let animatedFrames = 0;

	for (let turn = 0; turn < 240; turn++) {
		if (turn % 16 === 0) {
			renderer.simulateKeystrokes(
				turn % 32 === 0 ? "shift-left" : "shift-right"
			);
		}

		await Bun.sleep(8);

		const before = renderer.getDebugFrameOverlayStats().frames;

		assert.ok(renderer.tick());

		const frames = renderer.getDebugFrameOverlayStats().frames - before;

		assert.ok(
			frames <= 1,
			`native pump painted ${frames} frames without yielding`
		);
		animatedFrames += frames;
	}

	assert.ok(
		animatedFrames > 30,
		"tab animations must continue across host turns"
	);
	process.stdout.write("Tab motion yields between display frames\n");
} catch (error) {
	failure = error;
} finally {
	root.unmount();
}

if (failure) {
	console.error(failure);
	process.exit(1);
}

process.exit(0);
