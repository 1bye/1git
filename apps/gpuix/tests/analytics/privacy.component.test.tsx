/**
 * Covers: keyboard-operable default-on preference, restart persistence and failed writes.
 * Real: PrivacySettings, analytics policy, private atomic file and native GPUIX checkbox.
 * Doubles: inactive HTTP transport; no live analytics.
 * Requires: built local native addon and macOS graphics access.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { AnonymousAnalytics } from "@1git/analytics/client";
import { PrivacySettings } from "../../src/feature/analytics/privacy-settings";
import { AnalyticsFileStorage } from "../../src/feature/analytics/desktop-analytics";
import { SettingsSplit } from "../../src/feature/settings/settings-layout";

let directory: string;
let root: TestRoot;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "1git-analytics-"));
	root = createTestRoot({ width: 720, height: 480 });
});

afterEach(() => {
	root.unmount();
	rmSync(directory, { recursive: true, force: true });
});

test("Space toggles analytics off and on, preserving the choice across a new client", () => {
	const storage = new AnalyticsFileStorage(join(directory, "analytics.json"));

	const client = new AnonymousAnalytics({
		source: "desktop",
		active: false,
		storage,
	});

	root.render(<SettingsSplit list={<PrivacySettings analytics={client} />} />);
	root.renderer.flush();
	const checkbox = root.renderer.findByTestId("analytics-enabled");

	if (!checkbox) throw new Error("Missing analytics preference.");

	expect(checkbox.customProps?.["aria-checked"]).toBe(true);
	root.renderer.nativeSimulateKeyDown(checkbox.id, "space");
	root.renderer.nativeSimulateKeyUp(checkbox.id, "space");
	root.renderer.flush();

	expect(
		root.renderer.findByTestId("analytics-enabled")?.customProps?.[
			"aria-checked"
		]
	).toBe(false);
	expect(
		new AnonymousAnalytics({ source: "desktop", active: false, storage })
			.enabled
	).toBe(false);
	expect(readFileSync(storage.path, "utf8")).not.toContain("distinct_id");
	expect(statSync(storage.path).mode & 0o777).toBe(0o600);
	root.renderer.nativeSimulateKeyDown(checkbox.id, "space");
	root.renderer.nativeSimulateKeyUp(checkbox.id, "space");
	root.renderer.flush();

	expect(
		new AnonymousAnalytics({ source: "desktop", active: false, storage })
			.enabled
	).toBe(true);
});

test("failed preference persistence leaves the checkbox off with a visible error", () => {
	const client = new AnonymousAnalytics({
		source: "desktop",
		active: false,
		storage: {
			read: () => null,
			write: () => {
				throw new Error("Read-only");
			},
		},
	});

	root.render(<SettingsSplit list={<PrivacySettings analytics={client} />} />);
	root.renderer.flush();
	const checkbox = root.renderer.findByTestId("analytics-enabled");

	if (!checkbox) throw new Error("Missing analytics preference.");

	root.renderer.nativeSimulateKeyDown(checkbox.id, "space");
	root.renderer.nativeSimulateKeyUp(checkbox.id, "space");
	root.renderer.flush();

	expect(client.enabled).toBe(false);
	expect(
		root.renderer.findByTestId("analytics-preference-error")?.customProps?.role
	).toBe("alert");
	expect(root.renderer.getAllText()).toContain(
		"Could not save your analytics preference. Analytics is off for this session."
	);
});
