/**
 * Covers: settings navigation, keyboard selection, custom apps, cancellation and pending/error states.
 * Real: native layout/input, settings components and disposable preference persistence.
 * Doubles: application metadata command, accounts vault and path picker; never launches an editor.
 * Requires: built native addon and graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountsSettings } from "../../src/feature/accounts/accounts-settings";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { ExternalEditors } from "../../src/feature/editor-settings/external-editors";
import { windowOptions } from "../../src/window-options";
import { editorApplication } from "../_shared/editor-application";

let root: TestRoot;
let directory: string;
let preferences: string;
let zed: string;
let custom: string;
let editors: ExternalEditors;
let accounts: Accounts;

beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "1git-editor-ui-")));
	preferences = join(directory, "editor.json");
	zed = await editorApplication(directory, "Zed.app");
	custom = await editorApplication(directory, "Custom Editor.app");
	editors = new ExternalEditors(
		preferences,
		async (command) => {
			if (command !== "/usr/bin/plutil")
				throw new Error("Settings must not launch an app.");

			return JSON.stringify({
				CFBundlePackageType: "APPL",
				CFBundleIdentifier: "dev.1git.editor-fixture",
			});
		},
		[directory]
	);
	accounts = new Accounts(new AccountStore(join(directory, "accounts.json")), {
		read: async () => null,
		write: async () => {},
		delete: async () => {},
	});
	root = createTestRoot({
		width: 1000,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});
afterEach(async () => {
	root.unmount();
	mock.restore();
	await rm(directory, { recursive: true, force: true });
});

async function settle() {
	root.renderer.flush();
	await Bun.sleep(100);
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	root.renderer.dispatchNativeEvents();
	await Bun.sleep(0);
	root.renderer.flush();
}
function node(id: string) {
	const result = root.renderer.findByTestId(id);

	if (!result) throw new Error(`Missing ${id}`);

	return result;
}
async function click(id: string) {
	const bounds = root.renderer.getElementBounds(node(id).id);

	if (!bounds) throw new Error(`Missing bounds ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	await settle();
}

it("opens from Application settings, persists the choice and supports keyboard selection after reopening", async () => {
	root.render(
		<AccountsSettings
			accounts={accounts}
			externalEditors={editors}
			onBack={() => {}}
		/>
	);
	await settle();
	await click("settings-editor");
	expect(root.renderer.getAllText()).toContain("External editor");
	expect(root.renderer.getAllText()).toContain("System default");
	expect(root.renderer.getAllText()).toContain("Zed");
	await click("editor-choice-1");
	expect(editors.load()).toBe(zed);

	root.render(
		<AccountsSettings
			key="reopened"
			accounts={accounts}
			externalEditors={editors}
			initialSection="editor"
			onBack={() => {}}
		/>
	);
	await settle();
	expect(node("editor-choice-1").customProps?.["aria-description"]).toBe(
		"Selected editor"
	);
	root.renderer.focusElement(node("editor-choice-0").id);
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(editors.load()).toBeNull();
	expect(node("editor-choice-0").customProps?.["aria-description"]).toBe(
		"Selected editor"
	);
});

it("adds and selects an application from the native picker without launching it", async () => {
	const picker = spyOn(root.renderer, "promptForPaths").mockResolvedValue([
		custom,
	]);

	root.render(
		<AccountsSettings
			accounts={accounts}
			externalEditors={editors}
			initialSection="editor"
			onBack={() => {}}
		/>
	);
	await settle();
	await click("editor-choose-application");
	expect(picker).toHaveBeenCalledWith({
		files: true,
		directories: false,
		multiple: false,
		prompt: "Choose editor application",
	});
	expect(editors.load()).toBe(custom);
	expect(root.renderer.getAllText()).toContain("Custom Editor");
	expect(node("editor-choice-2").customProps?.["aria-description"]).toBe(
		"Selected editor"
	);

	if (process.env.GPUIX_EDITOR_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_EDITOR_SCREENSHOT);
});

it("keeps the previous selection on picker cancellation or an invalid app", async () => {
	await editors.save(zed);
	const picker = spyOn(root.renderer, "promptForPaths").mockResolvedValue(null);

	root.render(
		<AccountsSettings
			accounts={accounts}
			externalEditors={editors}
			initialSection="editor"
			onBack={() => {}}
		/>
	);
	await settle();
	await click("editor-choose-application");
	expect(editors.load()).toBe(zed);
	expect(root.renderer.findByTestId("editor-settings-error")).toBeUndefined();
	picker.mockResolvedValue([directory]);
	await click("editor-choose-application");
	expect(editors.load()).toBe(zed);
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Choose a macOS application"
	);
	expect(node("editor-choice-1").customProps?.["aria-description"]).toBe(
		"Selected editor"
	);
});

it("repairs an unavailable selection when its application is reinstalled and explicitly chosen", async () => {
	await editors.save(zed);
	await rm(zed, { recursive: true });
	root.render(
		<AccountsSettings
			accounts={accounts}
			externalEditors={editors}
			initialSection="editor"
			onBack={() => {}}
		/>
	);
	await settle();
	expect(root.renderer.getAllText()).toContain("Unavailable");
	await editorApplication(directory, "Zed.app");
	spyOn(root.renderer, "promptForPaths").mockResolvedValue([zed]);
	await click("editor-choose-application");
	expect(root.renderer.getAllText()).not.toContain("Unavailable");
	expect(editors.load()).toBe(zed);
	expect(node("editor-choice-1").customProps?.["aria-description"]).toBe(
		"Selected editor"
	);
});

it("guards navigation while the picker is pending and does not claim success after a persistence failure", async () => {
	const pending = Promise.withResolvers<string[] | null>();

	spyOn(root.renderer, "promptForPaths").mockImplementation(
		() => pending.promise
	);
	const back = mock(() => {});

	root.render(
		<AccountsSettings
			accounts={accounts}
			externalEditors={editors}
			initialSection="editor"
			onBack={back}
		/>
	);
	await settle();
	await click("editor-choose-application");
	await click("settings-accounts");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(back).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("editor-settings")).toBeDefined();
	pending.resolve(null);
	await settle();
	await writeFile(preferences, "{broken");
	await click("editor-choice-1");
	expect(root.renderer.getAllText().join(" ")).toContain(
		"saved file was left unchanged"
	);
	expect(await readFile(preferences, "utf8")).toBe("{broken");
	expect(node("editor-choice-0").customProps?.["aria-description"]).toBe(
		"Selected editor"
	);
});
