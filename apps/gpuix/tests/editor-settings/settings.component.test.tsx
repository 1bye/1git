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

it("opens Editors with a removed Cursor installation and lets the user choose another default", async () => {
	const cursor = await editorApplication(directory, "Cursor.app");

	await editors.save(cursor);
	await rm(cursor, { recursive: true });
	const before = await readFile(preferences, "utf8");

	root.render(
		<AccountsSettings
			accounts={accounts}
			externalEditors={editors}
			initialSection="editor"
			onBack={() => {}}
		/>
	);
	await settle();
	expect(root.renderer.getAllText()).toContain("External editor");
	expect(root.renderer.getAllText()).toContain("Cursor");
	expect(root.renderer.getAllText()).toContain("Unavailable");
	expect(root.renderer.getAllText()).toContain("Zed");
	expect(await readFile(preferences, "utf8")).toBe(before);
	await click("editor-choice-1");
	expect(editors.load()).toBe(cursor);

	if (process.env.GPUIX_EDITOR_MISSING_SCREENSHOT)
		root.renderer.captureScreenshot(
			process.env.GPUIX_EDITOR_MISSING_SCREENSHOT
		);

	await click("editor-choice-0");
	expect(editors.load()).toBeNull();
});

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
	expect(
		node("editor-choice-icon-1").children.map(
			(id) => root.renderer.getElement(id)?.type
		)
	).toContain("img");
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
	expect(node("editor-choice-1").customProps?.["aria-description"]).toBe(
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

async function typePatterns(value: string) {
	await click("editor-rule-patterns");
	root.renderer.simulateKeystrokes("cmd-a");
	root.renderer.simulateKeystrokes([...value].join(" "));
	await settle();
}

it("uses a right-side draft for Add/Edit, saves explicitly, restores focus on Escape and removes just the override", async () => {
	await editors.save(zed);
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
	await click("editor-rule-add");
	await typePatterns(".md, Dockerfile");
	await click("editor-rule-choice-1");
	expect(editors.preferences().rules).toEqual([]);
	await click("editor-rule-save");
	const rule = editors.preferences().rules[0];

	if (!rule) throw new Error("Rule was not saved");

	expect(rule.patterns).toEqual([".md", "Dockerfile"]);
	expect(editors.load()).toBe(zed);
	expect(root.renderer.findByTestId("editor-rule-editor")).toBeUndefined();
	await click(`editor-rule-edit-${rule.id}`);
	await typePatterns(".tsx");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(back).not.toHaveBeenCalled();
	expect(editors.preferences().rules[0]?.patterns).toEqual([
		".md",
		"Dockerfile",
	]);
	expect(root.renderer.getFocusedElementId()).toBe(
		node(`editor-rule-edit-${rule.id}`).id
	);
	await click(`editor-rule-edit-${rule.id}`);
	await typePatterns(".tsx");
	await click("editor-rule-choice-0");
	await click("editor-rule-save");
	expect(editors.menu("file.tsx").selected).toBeNull();
	await click(`editor-rule-remove-${rule.id}`);
	expect(editors.menu("file.tsx").selected).toBe(zed);
	expect(editors.preferences().rules).toEqual([]);
});

it("keeps a custom-app rule draft private until Save and reports duplicate types without losing input", async () => {
	const existing = await editors.saveRule(null, ".ts", zed);

	spyOn(root.renderer, "promptForPaths").mockResolvedValue([custom]);
	root.render(
		<AccountsSettings
			accounts={accounts}
			externalEditors={editors}
			initialSection="editor"
			onBack={() => {}}
		/>
	);
	await settle();
	await click("editor-rule-add");
	await typePatterns(".md");
	const before = await readFile(preferences, "utf8");

	await click("editor-rule-choose-application");
	expect(await readFile(preferences, "utf8")).toBe(before);
	await click("editor-rule-cancel");
	expect(await readFile(preferences, "utf8")).toBe(before);
	await click("editor-rule-add");
	await typePatterns(".TS");
	await click("editor-rule-save");
	expect(root.renderer.getAllText().join(" ")).toContain(
		"default already exists"
	);
	expect(node("editor-rule-patterns").customProps?.value).toBe(".TS");
	expect(editors.preferences().rules).toEqual([existing]);
	await typePatterns(".md");
	await click("editor-rule-choose-application");

	if (process.env.GPUIX_EDITOR_RULE_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_EDITOR_RULE_SCREENSHOT);

	await click("editor-rule-save");
	expect(editors.menu("README.md").selected).toBe(custom);
	expect(editors.load()).toBeNull();
});

it("guards duplicate rule saves and navigation until the save finishes", async () => {
	const pending = Promise.withResolvers<void>();
	const save = editors.saveRule.bind(editors);

	const writes = spyOn(editors, "saveRule").mockImplementation(
		async (...args) => {
			await pending.promise;

			return await save(...args);
		}
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
	await click("editor-rule-add");
	await typePatterns(".tsx");
	await click("editor-rule-save");
	await click("editor-rule-save");
	await click("settings-accounts");
	root.renderer.simulateKeystrokes("escape");
	await settle();
	expect(writes).toHaveBeenCalledTimes(1);
	expect(back).not.toHaveBeenCalled();
	expect(root.renderer.findByTestId("editor-rule-editor")).toBeDefined();
	pending.resolve();
	await settle();
	expect(root.renderer.findByTestId("editor-rule-editor")).toBeUndefined();
	expect(editors.preferences().rules[0]?.patterns).toEqual([".tsx"]);
});

it("scrolls long application lists independently and keeps rule footer actions visible at minimum size", async () => {
	for (let index = 0; index < 14; index++)
		await editors.save(
			await editorApplication(directory, `Editor ${index}.app`)
		);

	root.render(
		<AccountsSettings
			accounts={accounts}
			externalEditors={editors}
			initialSection="editor"
			onBack={() => {}}
		/>
	);
	await settle();
	const scroll = node("editor-settings-scroll");

	root.renderer.scrollTo(scroll.id, 0, -1000);
	await settle();
	await click("editor-rule-add");
	const footer = root.renderer.getElementBounds(node("editor-rule-footer").id);
	const save = root.renderer.getElementBounds(node("editor-rule-save").id);
	const form = root.renderer.getElementBounds(node("editor-rule-editor").id);

	if (!footer || !save || !form) throw new Error("Missing rule form layout");

	expect(save.y).toBeGreaterThanOrEqual(footer.y);
	expect(save.y + save.height).toBeLessThanOrEqual(form.y + form.height);
	const list = node("editor-rule-scroll");

	root.renderer.scrollTo(list.id, 0, -1000);
	await settle();
	expect(root.renderer.getElementBounds(node("editor-rule-footer").id)).toEqual(
		footer
	);

	if (process.env.GPUIX_EDITOR_LONG_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_EDITOR_LONG_SCREENSHOT);

	await click("editor-rule-cancel");
	expect(editors.preferences().rules).toEqual([]);
});
