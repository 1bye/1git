/**
 * Covers: batching live scroll paints until the display loop runs.
 * Real: pinned GPUIX addon, GPUI/AppKit input and frame counters in an isolated process.
 * Doubles: static scroll content; no repositories, accounts or saved session.
 * Requires: Apple Silicon macOS graphics access and built native addon.
 */
import { expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

it("does not redraw live windows for every event in an input burst", () => {
	const output = execFileSync(
		process.execPath,
		[
			"--preload",
			"./native/preload.ts",
			"tests/_shared/frame-pacing-native.tsx",
		],
		{
			cwd: resolve(import.meta.dir, "../.."),
			timeout: 15000,
			encoding: "utf8",
		}
	);

	expect(output).toContain("Live redraw batching verified");
}, 20000);
