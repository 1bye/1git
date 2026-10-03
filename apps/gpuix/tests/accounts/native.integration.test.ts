/**
 * Covers: production credential read/write/replace/delete and native Settings action.
 * Real: production GPUI renderer and macOS Keychain, with one random synthetic application-scoped entry.
 * Doubles: static window; no live hosting HTTP, real account metadata or user credentials.
 * Requires: patched native addon, macOS graphics and unlocked Keychain; may request Keychain access.
 */
import { expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

it("round-trips and removes an isolated synthetic OS credential and consumes the Settings action", () => {
	const output = execFileSync(
		process.execPath,
		["--preload", "./native/preload.ts", "tests/_shared/accounts-native.tsx"],
		{
			cwd: resolve(import.meta.dir, "../.."),
			encoding: "utf8",
			timeout: 25_000,
		}
	);

	expect(output).toContain(
		"isolated OS credential round-trip and Settings action verified"
	);
}, 30_000);
