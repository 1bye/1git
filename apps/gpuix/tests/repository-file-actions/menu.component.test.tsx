/**
 * Covers: file menu pointer/keyboard entry, copy action and explicit discard confirmation.
 * Real: native GPUIX input routing and file list.
 * Doubles: AppKit menu/confirmation bridge, operating-system actions and Git writes.
 * Requires: patched GPUIX/macOS graphics.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { RepositoryList } from "../../src/feature/repository-workspace/components/repository-list";
import { windowOptions } from "../../src/window-options";
import { changedFile } from "../_shared/repository-snapshot";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import { App } from "../../src/app";
import { RepositoryFileActions } from "../../src/feature/repository-workspace/lib/repository-file-actions";
import type { FileMenuActions } from "../../src/feature/repository-workspace/components/repository-file-menu";
import { ExternalEditors } from "../../src/feature/editor-settings/external-editors";
import { editorApplication } from "../_shared/editor-application";

let root: TestRoot;
let choice: string;
let confirmed: boolean;
let enabledItems: boolean[];
let menuLabels: string[];
let menuParents: number[];
let menuIcons: string[];
let editorDirectory: string | undefined;

beforeEach(() => {
	root = createTestRoot({
		width: 800,
		height: 600,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	choice = "Copy Relative Path";
	confirmed = false;
	enabledItems = [];
	menuLabels = [];
	menuParents = [];
	menuIcons = [];
	Object.assign(root.renderer, {
		showContextMenuItems(
			labels: string[],
			enabled: boolean[],
			parents: number[],
			_x: number,
			_y: number,
			icons: string[]
		) {
			enabledItems = enabled;
			menuLabels = labels;
			menuParents = parents;
			menuIcons = icons;

			return choice === "discard"
				? labels.findIndex((label) => label.toLowerCase().startsWith("discard"))
				: labels.indexOf(choice);
		},
		confirmFileDiscard() {
			return confirmed;
		},
		confirmIgnoreRule() {
			return confirmed;
		},
	});
});
afterEach(async () => {
	root.unmount();
	mock.restore();

	if (editorDirectory) {
		await rm(editorDirectory, { recursive: true, force: true });
		editorDirectory = undefined;
	}
});
const settle = async () => {
	await Bun.sleep(150);
	root.renderer.flush();
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	root.renderer.flush();
};

const click = async (id: string, button = 0, modifiers = "") => {
	const element = root.renderer.findByTestId(id);
	const box = element && root.renderer.getElementBounds(element.id);

	if (!box) throw new Error(`Missing ${id}`);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2,
		button,
		modifiers
	);
	await settle();
};

const render = (actions: FileMenuActions, path = "a.txt") =>
	root.render(
		<div style={{ backgroundColor: "#ffffff", width: "100%", height: "100%" }}>
			<div style={{ width: 310, height: 400 }}>
				<RepositoryList
					entries={[
						{
							id: path,
							title: path,
							status: "M",
							change: changedFile(path),
						},
					]}
					label="Changes"
					emptyMessage="Empty"
					state={{ selectedId: path, scrollY: 0 }}
					onSelect={() => {}}
					onScroll={() => {}}
					fileActions={actions}
				/>
			</div>
		</div>
	);

async function editorChoices() {
	editorDirectory = await realpath(
		await mkdtemp(join(tmpdir(), "1git-editor-menu-"))
	);
	const zed = await editorApplication(editorDirectory, "Zed.app");
	const cursor = await editorApplication(editorDirectory, "Cursor.app");
	const preferences = join(editorDirectory, "editor.json");

	const editors = new ExternalEditors(
		preferences,
		async () =>
			JSON.stringify({
				CFBundlePackageType: "APPL",
				CFBundleIdentifier: "dev.1git.fixture",
			}),
		[editorDirectory]
	);

	await editors.saveRule(null, ".tsx", zed);
	await editors.options();

	return { editors, zed, cursor, preferences };
}

it("labels the file-type default and routes Open With as a one-time choice without changing preferences", async () => {
	const { editors, zed, cursor, preferences } = await editorChoices();
	const before = await readFile(preferences, "utf8");
	const open = mock(async () => {});

	render(
		{
			root: "/test",
			head: "head",
			branch: "main",
			disabled: false,
			canDiscard: true,
			discard: async () => null,
			editors,
			open,
		},
		"src/file.tsx"
	);
	await settle();
	choice = "Cursor";
	await click("entry-src/file.tsx", 2);
	expect(menuLabels).toContain("Open in Zed");
	expect(menuLabels).toContain("Zed (Default)");
	expect(menuIcons[menuLabels.indexOf("Reveal in Finder")]).toBe(
		"/System/Library/CoreServices/Finder.app"
	);
	expect(menuIcons[menuLabels.indexOf("Open in Zed")]).toBe(zed);
	expect(menuIcons[menuLabels.indexOf("Zed (Default)")]).toBe(zed);
	expect(menuIcons[menuLabels.indexOf("Cursor")]).toBe(cursor);
	expect(menuIcons.filter(Boolean)).toHaveLength(4);
	expect(menuParents[menuLabels.indexOf("Cursor")]).toBe(
		menuLabels.indexOf("Open With")
	);
	expect(open).toHaveBeenCalledWith("/test", "src/file.tsx", "editor", cursor);
	choice = "Open in Zed";
	await click("entry-src/file.tsx", 2);
	expect(open).toHaveBeenLastCalledWith("/test", "src/file.tsx", "editor");
	expect(editors.menu("src/file.tsx").selected).toBe(zed);
	expect(await readFile(preferences, "utf8")).toBe(before);
});

it("shares live rules between window settings and file menus without remounting the workspace", async () => {
	const { editors, cursor } = await editorChoices();
	const open = mock<typeof RepositoryFileActions.open>(async () => {});
	const rule = editors.preferences().rules[0];

	if (!rule) throw new Error("Missing fixture rule");

	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [{ id: "workspace-1", path: "/test", draft: "Keep draft" }],
			}}
			readRepository={async () => ({
				ok: true,
				value: repositorySnapshot([changedFile("src/file.tsx")]),
			})}
			externalEditors={editors}
			openFile={open}
		/>
	);
	await settle();
	choice = "Open in Zed";
	await click("entry-src/file.tsx", 2);
	expect(open).toHaveBeenLastCalledWith(
		"/test/project",
		"src/file.tsx",
		"editor"
	);
	root.renderer.simulateKeystrokes("cmd-,");
	await settle();
	await click("settings-editor");
	await click(`editor-rule-edit-${rule.id}`);
	await click("editor-rule-choice-1");
	await click("editor-rule-save");
	expect(editors.menu("src/file.tsx").selected).toBe(cursor);
	root.renderer.simulateKeystrokes("escape");
	await settle();
	choice = "Open in Cursor";
	await click("entry-src/file.tsx", 2);
	expect(menuLabels).toContain("Cursor (Default)");
	expect(open).toHaveBeenCalledTimes(2);
	expect(root.renderer.findByTestId("commit-message")?.customProps?.value).toBe(
		"Keep draft"
	);
});

it("keeps other file actions available when editor preferences are damaged", async () => {
	const { editors, preferences } = await editorChoices();
	const open = mock(async () => {});

	await writeFile(preferences, "{broken");
	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: false,
		canDiscard: true,
		discard: async () => null,
		editors,
		open,
	});
	await settle();
	choice = "Copy Relative Path";
	await click("entry-a.txt", 2);
	expect(open).toHaveBeenCalledWith("/test", "a.txt", "copy");
	expect(root.renderer.getAllText().join(" ")).toContain(
		"saved file was left unchanged"
	);
	expect(await readFile(preferences, "utf8")).toBe("{broken");
});

it("uses Other application only for this opening and does nothing on picker cancellation", async () => {
	const { editors, cursor, preferences } = await editorChoices();
	const before = await readFile(preferences, "utf8");
	const picker = spyOn(root.renderer, "promptForPaths").mockResolvedValue(null);
	const open = mock(async () => {});

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: false,
		canDiscard: true,
		discard: async () => null,
		editors,
		open,
	});
	await settle();
	choice = "Other application…";
	await click("entry-a.txt", 2);
	expect(open).not.toHaveBeenCalled();
	picker.mockResolvedValue([cursor]);
	await click("entry-a.txt", 2);
	expect(open).toHaveBeenCalledWith("/test", "a.txt", "editor", cursor);
	expect(await readFile(preferences, "utf8")).toBe(before);
});

it("does not dispatch an Open With child while file actions are disabled", async () => {
	const { editors } = await editorChoices();
	const open = mock(async () => {});

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: true,
		canDiscard: true,
		discard: async () => null,
		editors,
		open,
	});
	await settle();
	choice = "Cursor";
	await click("entry-a.txt", 2);
	expect(enabledItems[menuLabels.indexOf("Cursor")]).toBe(false);
	expect(open).not.toHaveBeenCalled();
});

it("opens by right click and copies the relative path without Git writes", async () => {
	const open = mock(async () => {});
	const discard = mock(async () => null);

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: false,
		canDiscard: true,
		open,
		discard,
	});
	await settle();
	await click("entry-a.txt", 2);
	expect(root.renderer.findByTestId("file-menu-a.txt")).toBeUndefined();
	expect(open).toHaveBeenCalledWith("/test", "a.txt", "copy");
	expect(discard).not.toHaveBeenCalled();
});

it("keeps multi-selection separate from inclusion and targets the right-clicked group", async () => {
	const discard = mock<typeof RepositoryFileActions.discard>(async () => {
		throw new Error("Test only");
	});

	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [{ id: "workspace-1", path: "/test", draft: "" }],
			}}
			readRepository={async () => ({
				ok: true,
				value: repositorySnapshot([
					changedFile("a.txt"),
					changedFile("b.txt"),
					changedFile("c.txt"),
				]),
			})}
			discardFile={discard}
		/>
	);
	await settle();
	await click("entry-a.txt");
	await click("entry-c.txt", 0, "shift");
	choice = "discard";
	confirmed = true;
	await click("entry-b.txt", 2);
	expect(discard.mock.calls[0]?.[1].paths).toEqual(["a.txt", "b.txt", "c.txt"]);
	await click("entry-b.txt", 0, "cmd");
	await click("entry-a.txt", 2);
	expect(discard.mock.calls[1]?.[1].paths).toEqual(["a.txt", "c.txt"]);
	await click("entry-b.txt", 2);
	expect(discard.mock.calls[2]?.[1].paths).toEqual(["b.txt"]);
});

it("requires a separate confirmation and captures the reviewed branch", async () => {
	choice = "discard";
	const discard = mock(async () => null);

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: false,
		canDiscard: true,
		discard,
	});
	await settle();
	await click("entry-a.txt", 2);
	expect(discard).not.toHaveBeenCalled();
	confirmed = true;
	await click("entry-a.txt", 2);
	expect(discard).toHaveBeenCalledWith({
		kind: "discard",
		paths: ["a.txt"],
		expectedHead: "head",
		expectedBranch: "main",
	});
});

it("supports Control-click and does nothing when the native menu is dismissed", async () => {
	const open = mock(async () => {});
	const discard = mock(async () => null);

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: false,
		canDiscard: true,
		open,
		discard,
	});
	await settle();
	const row = root.renderer.findByTestId("entry-a.txt");
	const bounds = row && root.renderer.getElementBounds(row.id);

	if (!bounds) throw new Error("Missing row");

	root.renderer.nativeSimulateClick(bounds.x + 8, bounds.y + 8, 0, "ctrl");
	await settle();
	expect(open).toHaveBeenCalledTimes(1);
	choice = "dismiss";
	await click("entry-a.txt", 2);
	expect(open).toHaveBeenCalledTimes(1);
	expect(discard).not.toHaveBeenCalled();
});

it("opens from the keyboard and keeps discard disabled during Git operations", async () => {
	choice = "discard";
	confirmed = true;
	const discard = mock(async () => null);

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: false,
		canDiscard: false,
		discard,
	});
	await settle();
	const row = root.renderer.findByTestId("entry-a.txt");

	if (!row) throw new Error("Missing row");

	root.renderer.focusElement(row.id);
	root.renderer.nativeSimulateKeyDown(row.id, "shift-f10");
	await settle();
	expect(enabledItems[menuLabels.indexOf("Discard Changes…")]).toBe(false);
	expect(enabledItems[menuLabels.indexOf("Copy Relative Path")]).toBe(true);
	expect(enabledItems[menuLabels.indexOf("Include File in Commit")]).toBe(
		false
	);
	expect(discard).not.toHaveBeenCalled();
});

it("groups actions and routes native ancestor-folder choices through explicit ignore confirmation", async () => {
	const ignore = mock(async () => null);
	const patterns: string[] = [];

	Object.assign(root.renderer, {
		confirmIgnoreRule(pattern: string) {
			patterns.push(pattern);

			return confirmed;
		},
	});
	render(
		{
			root: "/test",
			head: "head",
			branch: "main",
			disabled: false,
			canDiscard: true,
			discard: async () => null,
			ignore,
		},
		"src/cache/a.tsx"
	);
	choice = "/src/cache";
	await settle();
	await click("entry-src/cache/a.tsx", 2);

	expect(menuLabels.filter((label) => label === "")).toHaveLength(4);
	expect(menuLabels).toContain("Ignore All .tsx Files (Add to .gitignore)");
	const parent = menuLabels.indexOf("Ignore Folder (Add to .gitignore)");

	expect(menuParents[menuLabels.indexOf("/src/cache")]).toBe(parent);
	expect(menuParents[menuLabels.indexOf("/src")]).toBe(parent);
	expect(patterns).toEqual(["/src/cache/"]);
	expect(ignore).not.toHaveBeenCalled();
	confirmed = true;
	await click("entry-src/cache/a.tsx", 2);
	expect(ignore).toHaveBeenCalledWith({
		kind: "ignore",
		path: "src/cache/a.tsx",
		rule: { kind: "folder", path: "src/cache" },
		expectedHead: "head",
		expectedBranch: "main",
	});
});

it("routes full-path and default-app actions without changing the index", async () => {
	const open = mock<typeof RepositoryFileActions.open>(async () => {});
	const discard = mock(async () => null);

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: false,
		canDiscard: true,
		discard,
		open,
	});
	await settle();
	choice = "Copy Full Path";
	await click("entry-a.txt", 2);
	choice = "Open with Default App";
	await click("entry-a.txt", 2);

	expect(open.mock.calls).toEqual([
		["/test", "a.txt", "copy-full"],
		["/test", "a.txt", "default"],
	]);
	expect(discard).not.toHaveBeenCalled();
	expect(menuIcons.filter(Boolean)).toEqual([
		"/System/Library/CoreServices/Finder.app",
	]);
});

it("does not dispatch disabled ignore choices even if a bridge returns their index", async () => {
	const ignore = mock(async () => null);

	render({
		root: "/test",
		head: "head",
		branch: "main",
		disabled: true,
		canDiscard: true,
		discard: async () => null,
		ignore,
	});
	await settle();
	choice = "Ignore File (Add to .gitignore)";
	confirmed = true;
	await click("entry-a.txt", 2);

	expect(ignore).not.toHaveBeenCalled();
});

it("protects close until ignore refresh completes and preserves the commit draft", async () => {
	choice = "Ignore File (Add to .gitignore)";
	confirmed = true;
	let blocked = false;
	let finished = false;

	Object.assign(root.renderer, {
		setCloseBlocked(value: boolean) {
			blocked = value;
		},
		takeCloseRequested() {
			return false;
		},
	});
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryFileActions.ignore>>
		>();

	const refresh = Promise.withResolvers<{
		ok: true;
		value: ReturnType<typeof repositorySnapshot>;
	}>();

	const ignore = mock<typeof RepositoryFileActions.ignore>(
		() => pending.promise
	);

	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [{ id: "workspace-1", path: "/test", draft: "Keep draft" }],
			}}
			readRepository={async () =>
				finished
					? await refresh.promise
					: { ok: true, value: repositorySnapshot([changedFile("a.txt")]) }
			}
			ignoreFile={ignore}
		/>
	);
	await settle();
	await click("entry-a.txt", 2);

	expect(blocked).toBe(true);
	expect(ignore).toHaveBeenCalledTimes(1);
	finished = true;
	pending.resolve({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(blocked).toBe(true);
	refresh.resolve({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(blocked).toBe(false);
	expect(root.renderer.findByTestId("commit-message")?.customProps?.value).toBe(
		"Keep draft"
	);
});

it("protects close until discard refresh completes and retains the draft", async () => {
	choice = "discard";
	confirmed = true;
	let blocked = false;
	let finished = false;

	Object.assign(root.renderer, {
		setCloseBlocked(value: boolean) {
			blocked = value;
		},
		takeCloseRequested() {
			return false;
		},
	});
	const pending =
		Promise.withResolvers<
			Awaited<ReturnType<typeof RepositoryFileActions.discard>>
		>();

	const refresh = Promise.withResolvers<{
		ok: true;
		value: ReturnType<typeof repositorySnapshot>;
	}>();

	const discard = mock<typeof RepositoryFileActions.discard>(
		() => pending.promise
	);

	root.render(
		<App
			initialSession={{
				version: 1,
				activeId: "workspace-1",
				tabs: [{ id: "workspace-1", path: "/test", draft: "Keep draft" }],
			}}
			readRepository={async () =>
				finished
					? await refresh.promise
					: { ok: true, value: repositorySnapshot([changedFile("a.txt")]) }
			}
			discardFile={discard}
		/>
	);
	await settle();
	// Locate the real Changes row; its id is owned by the workspace model.
	const row = root.renderer.findByTestId("entry-a.txt");

	if (!row) throw new Error("Missing file action trigger");

	const bounds = root.renderer.getElementBounds(row.id);

	if (!bounds) throw new Error("Missing file action bounds");

	root.renderer.nativeSimulateClick(bounds.x + 5, bounds.y + 5, 2);
	await settle();
	expect(blocked).toBe(true);
	expect(discard).toHaveBeenCalledTimes(1);
	finished = true;
	pending.resolve({
		ok: true,
		value: repositorySnapshot(),
		recoveryDirectory: "/test/backup",
	});
	await settle();
	expect(blocked).toBe(true);
	refresh.resolve({ ok: true, value: repositorySnapshot() });
	await settle();
	expect(blocked).toBe(false);
	expect(root.renderer.findByTestId("operation-result")).toBeDefined();
	expect(root.renderer.findByTestId("commit-message")?.customProps?.value).toBe(
		"Keep draft"
	);
});
