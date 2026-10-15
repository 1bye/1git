/**
 * Covers: Close Window leaves Command W to tab handling; native close/AppKit termination veto and explicit close after release.
 * Real: pinned native addon, macOS AppKit/GPUI lifecycle in isolated Bun child processes.
 * Doubles: static UI; no Git operations or user session files.
 * Requires: macOS graphics access and built local native addon.
 */
import { expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

it("vetoes native close and quit until released without replaying blocked requests", () => {
	for (const mode of ["close", "quit"]) {
		const output = execFileSync(
			process.execPath,
			[
				"--preload",
				"./native/preload.ts",
				"tests/_shared/close-native.tsx",
				mode,
			],
			{
				cwd: resolve(import.meta.dir, "../.."),
				timeout: 15000,
				encoding: "utf8",
			}
		);

		expect(output).toContain(
			"protected close and quit verified; explicit exit next"
		);
		// AppKit may exit the process directly after release; execFileSync also
		// requires a successful exit within the timeout, not another JS callback.
	}
}, 35000);
