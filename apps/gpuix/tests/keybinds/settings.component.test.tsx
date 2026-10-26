/**
 * Covers: Keybinds settings, recording/conflict/cancel/reset, saved shortcuts, live routing and contextual commands.
 * Real: App, session persistence callbacks and native keyboard/layout/focus events.
 * Doubles: empty accounts, repository discovery and path picker; no user files, credentials or network.
 * Requires: patched GPUIX renderer and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { App } from "../../src/app";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import {
	WorkspaceSession,
	type WorkspaceSessionDocument,
} from "../../src/feature/workspace-tabs/lib/workspace-session";
import {
	Keybinds,
	keybindRecordings,
} from "../../src/feature/keybinds/keybinds";
import { windowOptions } from "../../src/window-options";

let root: TestRoot;
let accounts: Accounts;
const save = mock<(document: WorkspaceSessionDocument) => void>();

const scan = async () => ({
	paths: [],
	scanned: 0,
	skipped: 0,
	limited: false,
});

beforeEach(() => {
	root = createTestRoot({
		width: 1100,
		height: 800,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	accounts = new Accounts(new AccountStore("/unused/keybinds-accounts.json"), {
		read: async () => null,
		write: async () => {},
		delete: async () => {},
	});
	spyOn(accounts, "load").mockReturnValue([]);
	save.mockClear();
});

afterEach(() => {
	root.unmount();
	mock.restore();
});

function node(id: string) {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
}

async function settle() {
	await Bun.sleep(230);
	root.renderer.clockFastForward(250);
	root.renderer.advanceTime(1);
	root.renderer.dispatchNativeEvents();
	root.renderer.flush();
}

async function key(keys: string) {
	root.renderer.simulateKeystrokes(keys);
	root.renderer.flush();
	await settle();
}

async function click(id: string) {
	const box = root.renderer.getElementBounds(node(id).id);

	if (!box) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
	await settle();
}

async function search(text: string) {
	await click("keybinds-search");
	await key(
		`cmd-a ${[...text].map((character) => (character === " " ? "space" : character)).join(" ")}`
	);
	expect(node("keybinds-search").customProps?.value).toBe(text);
}

async function showSettings(
	document: WorkspaceSessionDocument = { version: 1, tabs: [], activeId: null }
) {
	root.render(
		<App
			accounts={accounts}
			initialSession={document}
			saveSession={save}
			discoverRepositories={scan}
		/>
	);
	await settle();
	await key("cmd-,");
	await click("settings-keybinds");
}

function latest() {
	const document = save.mock.calls.at(-1)?.[0];

	if (!document) throw new Error("Session not saved");

	return WorkspaceSession.parse(JSON.stringify(document));
}

it("lists and searches app shortcuts without standard navigation or editing reference sections", async () => {
	root.unmount();
	root = createTestRoot({
		width: 640,
		height: 420,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	await showSettings({
		version: 1,
		tabs: [],
		activeId: null,
		appearance: "dark",
	});

	if (process.env.GPUIX_KEYBINDS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_KEYBINDS_SCREENSHOT}.dark.png`
		);

	expect(node("keybinds-settings")).toBeDefined();
	expect(root.renderer.getAllText()).toContain("Find repository");

	for (const heading of ["Navigation", "Text editing", "macOS"])
		expect(root.renderer.getAllText()).not.toContain(heading);

	expect(root.renderer.findByTestId("keybind-edit-settings")).toBeUndefined();
	await search("commit");
	expect(node("keybind-edit-commit")).toBeDefined();
	expect(root.renderer.findByTestId("keybind-edit-open")).toBeUndefined();
	await search("space");
	expect(node("keybind-edit-previous-space")).toBeDefined();
	expect(node("keybind-edit-next-space")).toBeDefined();
	await search("copy");
	expect(root.renderer.getAllText()).toContain("No matching keybinds.");
});

it("captures without running commands, validates conflicts, cancels, saves and restores a custom binding", async () => {
	const picker = spyOn(root.renderer, "promptForPaths").mockResolvedValue([]);

	await showSettings();
	await click("keybind-edit-quick-open");
	await key("cmd-o");
	expect(root.renderer.getAllText()).toContain(
		"Already used by Open repository."
	);

	if (process.env.GPUIX_KEYBINDS_SCREENSHOT)
		root.renderer.captureScreenshot(
			`${process.env.GPUIX_KEYBINDS_SCREENSHOT}.recording.png`
		);

	await click("keybind-save");
	expect(node("keybind-recorder")).toBeDefined();
	expect(latest().keybinds).toBeUndefined();
	expect(picker).not.toHaveBeenCalled();
	await key("escape");
	expect(root.renderer.findByTestId("keybind-recorder")).toBeUndefined();
	expect(node("settings-view")).toBeDefined();
	expect(keybindRecordings.has(root.renderer)).toBe(false);
	expect(latest().keybinds).toBeUndefined();
	await click("keybind-edit-quick-open");
	await key("shift-cmd-k");
	await click("keybind-save");
	expect(latest().keybinds).toEqual({ "quick-open": "shift-cmd-k" });
	const document = latest();

	root.unmount();
	root = createTestRoot({
		width: 1100,
		height: 800,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	root.render(
		<App
			accounts={accounts}
			initialSession={document}
			saveSession={save}
			discoverRepositories={scan}
		/>
	);
	await settle();
	await key("cmd-p");
	expect(root.renderer.findByTestId("quick-switcher")).toBeUndefined();
	await key("shift-cmd-k");
	expect(node("quick-switcher")).toBeDefined();
	await key("escape");
	await key("cmd-,");
	await click("settings-keybinds");

	if (process.env.GPUIX_KEYBINDS_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_KEYBINDS_SCREENSHOT);

	await click("keybind-reset-quick-open");
	expect(latest().keybinds).toBeUndefined();
	await key("escape");
	await key("cmd-p");
	expect(node("quick-switcher")).toBeDefined();
}, 15000);

it("restores all defaults and releases a recording when its Settings page unmounts", async () => {
	await showSettings({
		version: 1,
		tabs: [],
		activeId: null,
		keybinds: { "quick-open": "cmd-k", open: "cmd-b" },
	});
	await click("keybinds-reset-all");
	expect(latest().keybinds).toBeUndefined();
	await click("keybind-edit-open");
	expect(keybindRecordings.has(root.renderer)).toBe(true);
	root.unmount();
	expect(keybindRecordings.has(root.renderer)).toBe(false);
	expect(
		Keybinds.matches(
			{
				elementId: 0,
				eventType: "keyDown",
				key: "p",
				modifiers: { cmd: true, alt: false, ctrl: false, shift: false },
			},
			"quick-open",
			root.renderer
		)
	).toBe(true);
});

it("uses customized tab, filter and commit shortcuts while preserving native text editing", async () => {
	root.render(
		<App
			accounts={accounts}
			preview
			initialTabCount={2}
			initialSession={{
				version: 1,
				tabs: [],
				activeId: null,
				keybinds: {
					"next-tab": "alt-cmd-right",
					find: "shift-cmd-f",
					commit: "shift-cmd-enter",
				},
			}}
		/>
	);
	await settle();
	await click("view-changes");
	await key("cmd-right");
	expect(node("workspace-1").customProps?.["aria-selected"]).toBe(true);
	await key("alt-cmd-right");
	expect(node("workspace-2").customProps?.["aria-selected"]).toBe(true);
	await key("cmd-f");
	expect(root.renderer.findByTestId("changes-filter")).toBeUndefined();
	await key("shift-cmd-f");
	expect(node("changes-filter")).toBeDefined();
	await key("escape");
	await click("commit-message");
	await key("h e l l o cmd-left x cmd-right y");
	expect(node("commit-message").customProps?.value).toBe("xhelloy");
	await key("cmd-enter");
	expect(root.renderer.getAllText()).not.toContain(
		"Preview only — no commit created."
	);
	await key("shift-cmd-enter");
	expect(root.renderer.getAllText()).toContain(
		"Preview only — no commit created."
	);
}, 10000);
