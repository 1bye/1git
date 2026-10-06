/**
 * Covers: native app icons, small NSMenuItem images, cache reuse, and text-only fallback.
 * Real: rebuilt AppKit addon, NSWorkspace, Finder icon and disposable application bundle.
 * Doubles: no visible menu tracking or editor launch; assignment uses the production helper.
 * Requires: Apple Silicon macOS graphics access and built native addon.
 */
import { expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

it.each(["icons", "fallback"])(
	"verifies native menu %s in an isolated process",
	(mode) => {
		const output = execFileSync(
			process.execPath,
			[
				"--preload",
				"./native/preload.ts",
				"tests/_shared/menu-icons-native.ts",
				mode,
			],
			{
				cwd: resolve(import.meta.dir, "../.."),
				timeout: 15000,
				encoding: "utf8",
			}
		);

		expect(output).toContain(`Native menu ${mode} verified`);
	},
	20000
);
