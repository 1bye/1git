/**
 * Covers: production updater bridge preserves GPUI veto and synchronously calls Bun before quit.
 * Real: built framework/bridge, GPUI AppKit delegate, Bun FFI and native termination.
 * Doubles: static UI/save marker instead of a repository write; no network/feed.
 * Requires: Apple Silicon macOS graphics access and root test:updates:macos.
 */
import { expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { appDirectory } from "../../native/config";

it("flushes through Bun FFI only after GPUI releases protected termination", () => {
	const output = execFileSync(
		process.execPath,
		[
			"--preload",
			"./native/preload.ts",
			"tests/_shared/close-native.tsx",
			"quit",
			resolve(
				appDirectory,
				"build/macos/1git.app/Contents/Frameworks/1git-updater.dylib"
			),
		],
		{ cwd: appDirectory, encoding: "utf8", timeout: 15000 }
	);

	expect(output).toContain("protected close and quit verified");
	expect(output).toContain("updater draft prepared before quit");
	expect(output.indexOf("updater draft prepared")).toBeGreaterThan(
		output.indexOf("protected close and quit verified")
	);
}, 20000);
