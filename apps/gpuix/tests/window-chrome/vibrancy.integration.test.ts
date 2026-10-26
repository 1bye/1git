/**
 * Covers: real macOS sidebar vibrancy with default/repo chrome, live window-local light/dark switching, behind-window blending and unmodified AppKit tinting.
 * Real: pinned GPUIX addon, NSWindow and NSVisualEffectView in an isolated Bun process.
 * Doubles: static shell content; no accounts, Git repositories or session data.
 * Requires: Apple Silicon macOS graphics access and built local native addon.
 */
import { expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

it.each([
	["light", undefined],
	["dark", undefined],
	["light", "#a478ef"],
	["dark", "#a478ef"],
] as const)(
	"keeps native blur over %s window appearance with repo color %s",
	(appearance, color) => {
		const output = execFileSync(
			process.execPath,
			[
				"--preload",
				"./native/preload.ts",
				"tests/_shared/vibrancy-native.tsx",
				appearance,
				...(color ? [color] : []),
			],
			{
				cwd: resolve(import.meta.dir, "../.."),
				timeout: 15000,
				encoding: "utf8",
			}
		);

		expect(output).toContain("Native sidebar vibrancy verified");
	},
	20000
);
