/**
 * Covers: immediate preferences, private drafts, validation errors, picker boundaries and busy guards.
 * Real: native settings cards, panels and keyboard input. Doubles: history persistence and OS picker.
 * Requires: built native addon and macOS graphics access; no repository files or credentials are read.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { createRef } from "react";
import {
	IgnoredHistorySettings,
	type IgnoredHistorySettingsHandle,
} from "../../src/feature/ignored-history/ignored-history-settings";
import {
	IgnoredHistory,
	defaultIgnoredPreferences,
	type IgnoredHistoryState,
} from "../../src/feature/ignored-history/ignored-history";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 1000, height: 720 });
});
afterEach(() => root.unmount());
async function settle() {
	for (let n = 0; n < 8; n++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}
}
function node(id: string) {
	const item = root.renderer.findByTestId(id);

	if (!item) throw new Error(`Missing ${id}`);

	return item;
}
async function press(id: string) {
	root.renderer.nativeSimulateKeyDown(node(id).id, "enter");
	await settle();
}
function fixture(disabled = false) {
	let data: IgnoredHistoryState = {
		preferences: { ...defaultIgnoredPreferences, paths: [".env"] },
		files: [],
		bytes: 0,
		skipped: [],
	};

	const history = new IgnoredHistory(
		{ read: async () => null, write: async () => {}, delete: async () => {} },
		"/unused/history"
	);

	const save = spyOn(history, "configure").mockImplementation(
		async (_repository, preferences) => {
			data = { ...data, preferences };

			return data;
		}
	);

	const busy = mock((_value: boolean) => {});
	const open = mock(() => {});
	const ref = createRef<IgnoredHistorySettingsHandle>();

	root.render(
		<IgnoredHistorySettings
			ref={ref}
			repository={{
				root: "/test/project",
				commonDirectory: "/test/project/.git",
				gitDirectory: "/test/project/.git",
			}}
			history={history}
			status={{ data, busy: false }}
			disabled={disabled}
			onRefresh={async () => {}}
			onBusy={busy}
			onOpen={open}
		/>
	);

	return {
		save,
		busy,
		ref,
		open,
		get data() {
			return data;
		},
	};
}
it("keeps drafts private, returns focus and validates failed limits before retry", async () => {
	const f = fixture();

	await settle();
	root.renderer.focusElement(node("ignored-history-add-path").id);
	await press("ignored-history-add-path");
	root.renderer.nativeSimulateKeystrokes(
		node("ignored-history-paths").id,
		"d r a f t"
	);
	expect(f.ref.current?.cancelEditor()).toBe(true);
	await settle();
	expect(f.save).not.toHaveBeenCalled();
	expect(root.renderer.getFocusedElementId()).toBe(
		node("ignored-history-add-path").id
	);
	await press("ignored-history-edit-limits");
	f.save.mockRejectedValueOnce(
		new Error("Invalid ignored-history preferences.")
	);
	root.renderer.nativeSimulateKeystrokes(
		node("ignored-history-versions").id,
		"cmd-a 1"
	);
	await press("ignored-history-save-limits");
	expect(node("ignored-history-editor")).toBeDefined();
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Invalid ignored-history preferences."
	);
	root.renderer.nativeSimulateKeystrokes(
		node("ignored-history-versions").id,
		"cmd-a 1 0"
	);
	await press("ignored-history-save-limits");
	expect(f.data.preferences.maxVersions).toBe(10);
	expect(root.renderer.findByTestId("ignored-history-editor")).toBeUndefined();
	await press("ignored-history-open");
	expect(f.open).toHaveBeenCalledTimes(1);
	f.save.mockRestore();
});
it("keeps picker selections in the draft and rejects paths outside the repository", async () => {
	const f = fixture();

	await settle();
	const picker = spyOn(root.renderer, "promptForPaths")
		.mockResolvedValueOnce(["/outside/.env"])
		.mockResolvedValueOnce(["/test/project/private-config"]);

	await press("ignored-history-add-path");
	await press("ignored-history-browse");
	expect(root.renderer.getAllText().join(" ")).toContain(
		"inside this repository"
	);
	expect(f.save).not.toHaveBeenCalled();
	await press("ignored-history-browse");
	expect(f.save).not.toHaveBeenCalled();
	await press("ignored-history-add");
	expect(f.data.preferences.paths).toEqual([".env", "private-config"]);
	expect(f.busy.mock.calls.map((call) => call[0])).toEqual([
		true,
		false,
		true,
		false,
		true,
		false,
	]);
	picker.mockRestore();
	f.save.mockRestore();
});
it("blocks duplicate writes and back navigation while an immediate change is pending", async () => {
	const f = fixture();

	await settle();
	const pending = Promise.withResolvers<IgnoredHistoryState>();

	f.save.mockImplementationOnce(() => pending.promise);
	root.renderer.nativeSimulateKeyDown(
		node("ignored-history-enabled").id,
		"space"
	);
	root.renderer.nativeSimulateKeyUp(
		node("ignored-history-enabled").id,
		"space"
	);
	await settle();
	expect(f.busy).toHaveBeenLastCalledWith(true);
	await press("ignored-history-add-path");
	expect(root.renderer.findByTestId("ignored-history-editor")).toBeUndefined();
	expect(f.save).toHaveBeenCalledTimes(1);
	pending.resolve({
		...f.data,
		preferences: { ...f.data.preferences, enabled: true },
	});
	await settle();
	expect(f.busy).toHaveBeenLastCalledWith(false);
	f.save.mockRestore();
});
it("blocks all writes for a disabled repository", async () => {
	const f = fixture(true);

	await settle();
	await press("ignored-history-add-path");
	await press("ignored-history-edit-limits");
	await press("ignored-history-remove-.env");
	root.renderer.nativeSimulateKeyDown(
		node("ignored-history-enabled").id,
		"space"
	);
	root.renderer.nativeSimulateKeyUp(
		node("ignored-history-enabled").id,
		"space"
	);
	await settle();
	expect(f.save).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("ignored-history-editor")).toBeUndefined();
	f.save.mockRestore();
});
