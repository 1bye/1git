/**
 * Covers: HTTPS/public-key configuration and synchronous save-before-quit veto.
 * Real: build configuration and application termination owner.
 * Doubles: save callbacks; no native app, HTTP service, or credentials.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { updateConfiguration } from "../../native/sparkle";
import { bundleInfoPlist } from "../../native/package-resources";
import { AppTermination } from "../../src/app-termination";

it("makes no checks when publishing is unconfigured and rejects insecure feeds", () => {
	const key = Buffer.alloc(32, 1).toString("base64");

	expect(updateConfiguration()).toBeUndefined();
	expect(bundleInfoPlist("0.0.1")).not.toContain("SUFeedURL");
	expect(() =>
		updateConfiguration("http://updates.example.com/appcast.xml", key)
	).toThrow("HTTPS");
	expect(() =>
		updateConfiguration("https://secret@updates.example.com/appcast.xml", key)
	).toThrow("credentials");
	expect(() =>
		updateConfiguration("https://updates.example.com/appcast.xml", "bad")
	).toThrow("Ed25519");
	expect(() => updateConfiguration(undefined, key)).toThrow("both");
	const config = updateConfiguration(
		"https://updates.example.com/appcast.xml",
		key
	);

	const plist = bundleInfoPlist("0.0.1", config);

	expect(plist).toContain("<key>SUEnableAutomaticChecks</key><true/>");
	expect(plist).toContain("<key>SUAutomaticallyUpdate</key><false/>");
	expect(plist).toContain("<key>SURequireSignedFeed</key><true/>");
	expect(plist).not.toContain("PRIVATE_KEY");
});

it("vetoes a failed draft save and releases only its own registered handler", () => {
	expect(AppTermination.canQuit()).toBe(true);
	const removeFirst = AppTermination.register(() => false);

	expect(AppTermination.canQuit()).toBe(false);
	let flushed = false;

	const removeSecond = AppTermination.register(() => {
		flushed = true;

		return true;
	});

	removeFirst();
	expect(AppTermination.canQuit()).toBe(true);
	expect(flushed).toBe(true);
	removeSecond();
	expect(AppTermination.canQuit()).toBe(true);
});
