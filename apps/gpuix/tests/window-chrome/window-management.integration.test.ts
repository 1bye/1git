/**
 * Covers: standard window accessibility role, writable position/size and compact tile resizing.
 * Real: app window options, NSWindow accessibility setters and GPUI resize notifications.
 * Doubles: none; no repositories, credentials or user sessions.
 * Requires: patched native addon and macOS graphics access. Does not launch Raycast or Tinycast.
 */
import { expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

it("honors native accessibility move and small-tile resize requests", () => {
	const output = execFileSync(
		process.execPath,
		[
			"--preload",
			"./native/preload.ts",
			"tests/_shared/window-management-native.ts",
		],
		{ cwd: resolve(import.meta.dir, "../.."), timeout: 15000, encoding: "utf8" }
	);

	expect(output).toContain(
		"Native accessibility move and compact resize verified"
	);
}, 20000);
