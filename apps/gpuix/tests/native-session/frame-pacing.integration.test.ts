/**
 * Covers: batching scroll paints and yielding to JavaScript between tab animation frames.
 * Real: pinned GPUIX addon, GPUI/AppKit input and frame counters in an isolated process.
 * Doubles: static scroll content, commit text and preview workspaces; no saved session.
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

it("keeps prefix and body decorations on the native display-loop scroll path", () => {
	const output = execFileSync(
		process.execPath,
		[
			"--preload",
			"./native/preload.ts",
			"tests/_shared/frame-pacing-native.tsx",
			"--commit-editor",
		],
		{
			cwd: resolve(import.meta.dir, "../.."),
			timeout: 15000,
			encoding: "utf8",
		}
	);

	expect(output).toContain("Decorated commit editor verified");
}, 20000);

it("yields to JavaScript between native tab animation frames", () => {
	const output = execFileSync(
		process.execPath,
		[
			"--preload",
			"./native/preload.ts",
			"--preload",
			"./tests/_shared/machine-isolation.ts",
			"tests/_shared/tab-motion-native.tsx",
		],
		{
			cwd: resolve(import.meta.dir, "../.."),
			timeout: 15000,
			encoding: "utf8",
		}
	);

	expect(output).toContain("Tab motion yields between display frames");
}, 20000);
