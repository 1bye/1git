/**
 * Covers: workspace geometry, commit inclusion/drafts, stacked revision/files navigation, splitter resizing, keyboard, independent scrolling, tab isolation and dragging.
 * Real: App, navigation rail, GPUIX layout, hit testing, focus and accessibility.
 * Doubles: sample repository data; focus notification for inactive offscreen windows.
 * Requires: patched GPUIX native test renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { lightColors } from "@1git/design-tokens";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";

import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";
import { sampleEntries } from "../../src/feature/repository-workspace/lib/sample-workspace";
import { RepositoryWorkspaceModel } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { RepositoryNavigation } from "../../src/feature/repository-workspace/components/repository-navigation";
import { RepositoryDiffEmpty } from "../../src/feature/repository-workspace/components/repository-diff-empty";
import { repositorySnapshot } from "../_shared/repository-snapshot";

let root: TestRoot;

it("decorates a clean working tree without disguising refresh errors as an empty list", () => {
	const state = RepositoryWorkspaceModel.reduce(
		RepositoryWorkspaceModel.create(),
		{ type: "loaded", snapshot: repositorySnapshot() }
	);

	const render = (error: string | null) => {
		const workspace = { ...state, error };

		root.render(
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					width: "100%",
					height: "100%",
					backgroundColor: "#ffffff",
				}}
			>
				<RepositoryNavigation
					workspaceId="clean"
					state={workspace}
					onAction={() => {}}
					onRefresh={() => {}}
				/>
				<RepositoryDiffEmpty workspace={workspace} />
			</div>
		);
	};

	render(null);
	expect(element("empty-list-placeholder")).toBeDefined();
	expect(element("comparison-art-empty")).toBeDefined();
	expect(root.renderer.getAllText()).toContain("No uncommitted changes.");
	expect(bounds("comparison-art-empty").width).toBe(160);
	render("Refresh failed");
	expect(root.renderer.findByTestId("empty-list-placeholder")).toBeUndefined();
	expect(root.renderer.findByTestId("comparison-art-empty")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("Could not read repository");
});

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	root.render(<App preview initialTabCount={2} />);
});
afterEach(() => root.unmount());

const element = (testId: string) => {
	const node = root.renderer.findByTestId(testId);

	if (!node) throw new Error(`Missing element: ${testId}`);

	return node;
};

const bounds = (testId: string) => {
	const viewportId =
		testId === "repository-list" || testId === "revision-files"
			? `${testId}-viewport`
			: testId;

	const box = root.renderer.getElementBounds(element(viewportId).id);

	if (!box) throw new Error(`Missing bounds: ${testId}`);

	return box;
};

const click = (testId: string): void => {
	const box = bounds(testId);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
};

const changeView = (view: string): void => {
	click(`view-${view}`);
};

// Inactive native test windows need an explicit focus notification for the list's Tab entry point.
const notifyListFocus = (): void => {
	const id = root.renderer.getFocusedElementId();

	const focused =
		id === undefined || id === null ? undefined : root.renderer.getElement(id);

	if (focused?.testId?.endsWith("-viewport") && id !== undefined && id !== null)
		flushSync(() =>
			handleGpuixEvent({ elementId: id, eventType: "focus" }, root.renderer)
		);

	root.renderer.flush();
};

const key = (testId: string, value: string): void => {
	root.renderer.nativeSimulateKeyDown(element(testId).id, value);
	root.renderer.flush();

	if (value.endsWith("tab")) notifyListFocus();
};

const scrollY = () =>
	root.renderer.getScrollOffset(element("repository-list").id)?.[1] || 0;

const checked = (testId: string) =>
	element(testId).customProps?.["aria-checked"];

it("switches and closes workspaces with Command shortcuts and toggles a focused file with Space", async () => {
	await Bun.sleep(20);
	key("entry-src/app.tsx", "space");
	expect(checked("include-src/app.tsx")).toBe(false);
	key("entry-src/app.tsx", "cmd-2");
	expect(element("workspace-2").customProps?.["aria-selected"]).toBe(true);
	await Bun.sleep(0);
	key("entry-src/app.tsx", "cmd-w");
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
	expect(element("entry-src/app.tsx")).toBeDefined();
	key("commit-message", "cmd-9");
	expect(element("commit-message")).toBeDefined();
});

it("cycles repository tabs with Command arrows, including from Home", async () => {
	root.render(<App key="three-tabs" preview initialTabCount={3} />);
	await Bun.sleep(20);
	key("entry-src/app.tsx", "cmd-left");
	expect(element("workspace-3").customProps?.["aria-selected"]).toBe(true);
	key("view-changes", "cmd-left");
	expect(element("workspace-2").customProps?.["aria-selected"]).toBe(true);
	key("view-changes", "cmd-right");
	expect(element("workspace-3").customProps?.["aria-selected"]).toBe(true);
	key("view-changes", "cmd-right");
	expect(element("workspace-1").customProps?.["aria-selected"]).toBe(true);
	key("workspace-1", "cmd-right");
	expect(element("workspace-2").customProps?.["aria-selected"]).toBe(true);
	key("workspace-2", "cmd-left");
	expect(element("workspace-1").customProps?.["aria-selected"]).toBe(true);
	key("workspace-1", "shift-cmd-left");
	key("workspace-1", "alt-cmd-right");
	expect(element("workspace-1").customProps?.["aria-selected"]).toBe(true);
	click("workspace-home");
	key("workspace-home", "cmd-left");
	expect(element("workspace-3").customProps?.["aria-selected"]).toBe(true);
	click("workspace-home");
	key("workspace-home", "cmd-right");
	expect(element("workspace-1").customProps?.["aria-selected"]).toBe(true);
});

it("keeps Command arrows in native editors instead of switching tabs", async () => {
	await Bun.sleep(20);
	click("commit-message");
	root.renderer.simulateKeystrokes("h e l l o cmd-left x cmd-right y");
	root.renderer.flush();
	expect(element("commit-message").customProps?.value).toBe("xhelloy");
	expect(element("workspace-1").customProps?.["aria-selected"]).toBe(true);
	root.renderer.simulateKeystrokes("shift-cmd-left z");
	root.renderer.flush();
	expect(element("commit-message").customProps?.value).toBe("z");
	click("filter-changes");
	root.renderer.simulateKeystrokes("a p p cmd-left x cmd-right y");
	root.renderer.flush();
	expect(element("changes-filter").customProps?.value).toBe("xappy");
	expect(element("workspace-1").customProps?.["aria-selected"]).toBe(true);
});

it("keeps the window on Home after Command W closes the last repository tab", async () => {
	await Bun.sleep(20);
	key("entry-src/app.tsx", "cmd-w");
	expect(root.renderer.findByTestId("workspace-1")).toBeUndefined();
	expect(element("workspace-2").customProps?.["aria-selected"]).toBe(true);
	key("view-changes", "cmd-right");
	expect(element("workspace-2").customProps?.["aria-selected"]).toBe(true);
	key("commit-message", "cmd-w");
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
	expect(element("repository-welcome")).toBeDefined();
	key("workspace-home", "cmd-left");
	key("workspace-home", "cmd-right");
	key("workspace-home", "cmd-w");
	expect(element("repository-welcome")).toBeDefined();
});

it("keeps rail selection filled and borderless while the search field is transparent", () => {
	expect(element("view-changes").style.backgroundColor).toBe(
		lightColors.editorHairline
	);

	for (const view of ["history", "stashes"]) {
		expect(element(`view-${view}`).style.backgroundColor).toBe("transparent");
	}

	for (const view of ["changes", "history", "stashes"]) {
		expect(element(`view-${view}`).style.borderWidth ?? 0).toBe(0);
	}

	click("filter-changes");
	expect(element("changes-filter").style.backgroundColor).toBe("transparent");
	expect(element("changes-filter").style.borderWidth).toBe(1);
});

it("filters paths with Command F without changing commit inclusion and closes with Escape", async () => {
	await Bun.sleep(20);
	click("include-src/app.tsx");
	key("entry-src/app.tsx", "cmd-f");
	root.renderer.flush();
	expect(element("changes-filter")).toBeDefined();
	root.renderer.simulateKeystrokes("s t y l e s");
	root.renderer.flush();
	expect(root.renderer.findByTestId("entry-src/app.tsx")).toBeUndefined();
	expect(element("entry-src/styles/tokens.ts")).toBeDefined();
	expect(root.renderer.getAllText()).toContain("29 of 30 selected");
	expect(root.renderer.getAllText()).toContain("4 shown");
	click("entry-src/styles/tokens.ts");
	const last = bounds("entry-src/styles/colors.ts");

	root.renderer.nativeSimulateClick(last.x + 30, last.y + 8, 0, "shift");
	root.renderer.flush();
	expect(selected()).toHaveLength(4);
	expect(root.renderer.getAllText()).toContain("29 of 30 selected");
	click("changes-filter");
	root.renderer.simulateKeystrokes("cmd-a z z z");
	root.renderer.flush();
	expect(root.renderer.getAllText()).toContain("No matching files");
	key("changes-filter", "escape");
	expect(root.renderer.findByTestId("changes-filter")).toBeUndefined();
	expect(element("entry-src/app.tsx")).toBeDefined();
	expect(checked("include-src/app.tsx")).toBe(false);
	click("filter-changes");
	expect(element("changes-filter").customProps?.value).toBe("");
});

it("pins the composer below the scrolling Changes list and hides it in revision views", () => {
	const composer = bounds("commit-composer");
	const list = bounds("repository-list");

	expect(list.y + list.height).toBeLessThanOrEqual(composer.y);
	expect(
		bounds("commit-notice").y + bounds("commit-notice").height
	).toBeLessThanOrEqual(
		bounds("repository-navigation").y + bounds("repository-navigation").height
	);
	expect(bounds("commit-message").height).toBeGreaterThanOrEqual(100);
	expect(root.renderer.getPaintedText()).toContain("Commit message…");
	key("entry-src/app.tsx", "end");
	expect(scrollY()).toBeLessThan(0);
	expect(bounds("commit-composer")).toEqual(composer);
	expect(
		bounds("entry-tsconfig.json").y + bounds("entry-tsconfig.json").height
	).toBeLessThanOrEqual(composer.y);
	changeView("history");
	expect(root.renderer.findByTestId("commit-composer")).toBeUndefined();
	changeView("stashes");
	expect(root.renderer.findByTestId("commit-composer")).toBeUndefined();
	changeView("changes");
	expect(bounds("commit-composer")).toEqual(composer);
});

it("edits multiline drafts, previews by shortcut or click, and never clears included files or draft text", () => {
	click("commit-preview");
	expect(root.renderer.getAllText()).toContain(
		"Preview only · no repository connected"
	);
	click("commit-message");
	root.renderer.simulateKeystrokes("h i enter enter b o d y");
	root.renderer.flush();
	expect(element("commit-message").customProps?.value).toBe("hi\n\nbody");
	expect(root.renderer.getAllText()).toContain(
		"Preview only · no repository connected"
	);
	root.renderer.simulateKeystrokes("cmd-enter");
	root.renderer.flush();
	expect(element("commit-message").customProps?.value).toBe("hi\n\nbody");
	expect(root.renderer.getAllText()).toContain(
		"Preview only — no commit created."
	);
	expect(checked("include-all")).toBe(true);
	root.renderer.simulateKeystrokes("x");
	root.renderer.flush();
	click("commit-preview");
	expect(root.renderer.getAllText()).toContain(
		"Preview only — no commit created."
	);
	expect(element("commit-message").customProps?.value).toBe("hi\n\nbodyx");
	click("commit-message");
	root.renderer.simulateKeystrokes("cmd-down x");
	root.renderer.flush();
	click("include-all");
	expect(root.renderer.getAllText()).toContain("Commit 0 files");
	expect(element("commit-preview").customProps?.tabIndex).toBeUndefined();
	key("commit-message", "cmd-enter");
	expect(root.renderer.getAllText()).toContain(
		"Preview only · no repository connected"
	);
	click("commit-message");
	root.renderer.simulateKeystrokes("cmd-a space");
	root.renderer.flush();
	click("include-src/app.tsx");
	expect(root.renderer.getAllText()).toContain("Commit 1 file");
	click("commit-preview");
	expect(root.renderer.getAllText()).toContain(
		"Preview only · no repository connected"
	);
});

it("restores each tab's draft across views, reordering and Home navigation", () => {
	click("commit-message");
	root.renderer.simulateKeystrokes("o n e");
	root.renderer.flush();
	changeView("history");
	changeView("changes");
	expect(element("commit-message").customProps?.value).toBe("one");
	click("workspace-2");
	expect(element("commit-message").customProps?.value).toBe("");
	click("commit-message");
	root.renderer.simulateKeystrokes("t w o");
	root.renderer.flush();
	click("workspace-1");
	key("workspace-1", "shift-right");
	expect(element("commit-message").customProps?.value).toBe("one");
	click("workspace-2");
	expect(element("commit-message").customProps?.value).toBe("two");
	click("close-workspace-2");
	click("workspace-home");
	expect(element("repository-welcome")).toBeDefined();
	click("workspace-1");
	expect(element("commit-message").customProps?.value).toBe("one");
});

it("traverses from file inclusion into the editor and preview action with Tab", () => {
	key("include-src/app.tsx", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("commit-message").id
	);
	root.renderer.simulateKeystrokes("a");
	root.renderer.flush();
	root.renderer.simulateKeystrokes("tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("commit-preview").id
	);
	key("commit-preview", "shift-tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("commit-message").id
	);
});

it("shows one filename-first list with aligned checkboxes instead of groups or line counts", () => {
	expect(root.renderer.findByTestId("group-Staged")).toBeUndefined();
	expect(root.renderer.findByTestId("group-Unstaged")).toBeUndefined();
	expect(root.renderer.findByTestId("changes-summary")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("30 of 30 selected");
	expect(checked("include-all")).toBe(true);
	expect(bounds("include-src/app.tsx").x).toBe(
		bounds("include-src/styles/tokens.ts").x
	);
	expect(bounds("include-all").x).toBe(bounds("include-src/app.tsx").x);
	expect(element("directory-src/app.tsx").style.color).toBe(
		lightColors.editorFaint
	);
	expect(element("status-src/app.tsx").style.color).toBe(lightColors.brand);
	expect(root.renderer.findByTestId("directory-README.md")).toBeUndefined();
	expect(
		element("filename-src/assets/legacy-icon.svg").style.textDecoration
	).toBe("line-through");

	for (const entry of sampleEntries.changes)
		expect(checked(`include-${entry.id}`)).toBe(true);
});

it("toggles inclusion without selecting a file and derives the all/none/mixed header", () => {
	click("include-src/app.tsx");
	expect(selected()).toEqual([]);
	expect(checked("include-src/app.tsx")).toBe(false);
	expect(checked("include-all")).toBe("mixed");
	expect(root.renderer.getAllText()).toContain("29 of 30 selected");
	click("entry-src/styles/tokens.ts");
	expect(selected()).toEqual(["src/styles/tokens.ts, added"]);
	expect(checked("include-src/styles/tokens.ts")).toBe(true);
	click("include-src/app.tsx");
	expect(selected()).toEqual(["src/styles/tokens.ts, added"]);
	expect(checked("include-all")).toBe(true);
	click("include-all");
	expect(root.renderer.getAllText()).toContain("0 of 30 selected");
	click("include-src/app.tsx");
	expect(checked("include-all")).toBe("mixed");
	click("include-all");
	expect(root.renderer.getAllText()).toContain("30 of 30 selected");
	expect(selected()).toEqual(["src/styles/tokens.ts, added"]);
});

it("keeps inclusion through view changes, reorders and Home navigation while isolating tabs", () => {
	click("include-src/app.tsx");
	changeView("history");
	changeView("changes");
	expect(checked("include-src/app.tsx")).toBe(false);
	click("workspace-2");
	expect(checked("include-src/app.tsx")).toBe(true);
	click("workspace-1");
	key("workspace-1", "shift-right");
	expect(checked("include-src/app.tsx")).toBe(false);
	click("close-workspace-1");
	click("workspace-home");
	click("workspace-2");
	expect(checked("include-src/app.tsx")).toBe(true);
});

it("uses Space on the focused checkbox without changing the viewed file", () => {
	click("entry-src/app.tsx");
	key("entry-src/app.tsx", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("include-src/app.tsx").id
	);
	key("include-src/app.tsx", "space");
	expect(checked("include-src/app.tsx")).toBe(true);
	root.renderer.nativeSimulateKeyUp(element("include-src/app.tsx").id, "space");
	root.renderer.flush();
	expect(checked("include-src/app.tsx")).toBe(false);
	expect(selected()).toEqual(["src/app.tsx, modified"]);
	key("include-src/app.tsx", "down");
	expect(selected()).toEqual(["src/styles/tokens.ts, added"]);
	key("entry-src/styles/tokens.ts", "end");
	key("entry-tsconfig.json", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("include-tsconfig.json").id
	);
	expect(scrollY()).toBeLessThan(0);
});

it("leaves the list backwards without trapping focus in its virtual entry point", () => {
	click("entry-src/app.tsx");
	key("entry-src/app.tsx", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("include-src/app.tsx").id
	);
	key("include-src/app.tsx", "shift-tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("entry-src/app.tsx").id
	);
	key("entry-src/app.tsx", "shift-tab");
	expect(root.renderer.getFocusedElementId()).toBe(element("include-all").id);
});

it("exposes checked, unchecked and mixed state through the patched native accessibility bridge", () => {
	const state = () =>
		Object.values(root.renderer.getA11yTree().nodes ?? {}).find(
			(node) => node.aria?.label === "Include all changed files in commit"
		)?.aria;

	expect(state()).toMatchObject({ role: "CheckBox", toggled: "True" });
	click("include-src/app.tsx");
	expect(state()).toMatchObject({ toggled: "Mixed" });
	click("include-all");
	click("include-all");
	expect(state()).toMatchObject({ toggled: "False" });
});

const selected = () =>
	root.renderer
		.findByType("div")
		.filter(
			(node) =>
				["option", "gridcell"].includes(String(node.customProps?.role)) &&
				node.customProps?.["aria-selected"]
		)
		.map((node) => node.customProps?.["aria-label"]);

const selectedView = () =>
	Object.values(root.renderer.getA11yTree().nodes ?? {})
		.filter(
			(node) =>
				node.aria?.role === "Tab" &&
				node.aria.selected &&
				["Changes", "History", "Stashes", "Graph"].includes(
					node.aria.label ?? ""
				)
		)
		.map((node) => node.aria?.label);

it("stacks compact borderless rail tabs outside the white workspace", () => {
	const changes = bounds("view-changes");
	const history = bounds("view-history");
	const stashes = bounds("view-stashes");
	const workspace = bounds("workspace");

	expect(history.x).toBe(changes.x);
	expect(stashes.x).toBe(changes.x);
	expect(history.y).toBe(changes.y + changes.height + 4);
	expect(stashes.y).toBe(history.y + history.height + 4);
	expect(changes.x + changes.width).toBeLessThan(workspace.x);

	for (const view of ["changes", "history", "stashes"]) {
		expect(element(`view-${view}`).style).toMatchObject({
			width: 32,
			height: 32,
			borderRadius: 6,
		});
		expect(element(`view-${view}`).style.borderWidth ?? 0).toBe(0);
	}

	expect(bounds("filter-changes").x).toBeGreaterThan(workspace.x);
	expect(root.renderer.findByTestId("changes-filter")).toBeUndefined();
	expect(selectedView()).toEqual(["Changes"]);
	click("view-stashes");
	expect(selectedView()).toEqual(["Stashes"]);
	expect(element("view-changes").style.backgroundColor).toBe("transparent");
	expect(element("view-stashes").style.backgroundColor).toBe(
		lightColors.editorHairline
	);
});

it("tightens sidebar headers without shrinking rail buttons, file rows or checkbox targets", () => {
	expect(element("row-src/app.tsx").style.height).toBe(28);
	expect(element("include-all").style).toMatchObject({ width: 24, height: 24 });
	expect(element("include-src/app.tsx").style).toMatchObject({
		width: 24,
		height: 24,
	});

	for (const view of ["changes", "history", "stashes"] as const) {
		changeView(view);
		const toolbar = bounds("repository-views");

		expect(toolbar.height).toBe(36);
		expect(element(`view-${view}`).style.height).toBe(32);
		expect(bounds("repository-list").y - toolbar.y - toolbar.height).toBe(
			view === "changes" ? 24 : 0
		);

		if (view !== "changes") {
			expect(bounds("revision-files").y - bounds("revision-files-pane").y).toBe(
				28
			);
		}
	}
});

it("wraps vertical rail arrows, supports Home/End and Enter/Space, and ignores modified navigation", () => {
	key("view-changes", "up");
	expect(selectedView()).toEqual(["Graph"]);
	key("view-graph", "down");
	expect(selectedView()).toEqual(["Changes"]);
	key("view-changes", "end");
	expect(selectedView()).toEqual(["Graph"]);
	key("view-graph", "home");
	expect(selectedView()).toEqual(["Changes"]);
	key("view-changes", "shift-right");
	expect(selectedView()).toEqual(["Changes"]);
	key("view-history", "enter");
	expect(selectedView()).toEqual(["History"]);
	key("view-stashes", "space");
	expect(selectedView()).toEqual(["Stashes"]);
	expect(root.renderer.getFocusedElementId()).toBe(element("view-stashes").id);
});

it("indicates keyboard focus using icon color without adding borders", () => {
	click("view-history");
	const tab = element("view-history");

	flushSync(() =>
		handleGpuixEvent({ elementId: tab.id, eventType: "focus" }, root.renderer)
	);
	expect(element("view-history-icon").style.color).toBe(lightColors.editorInk);
	key("view-history", "enter");
	expect(element("view-history-icon").style.color).toBe(lightColors.brand);
	click("view-stashes");
	const next = element("view-stashes");

	flushSync(() =>
		handleGpuixEvent({ elementId: next.id, eventType: "focus" }, root.renderer)
	);
	expect(element("view-stashes-icon").style.color).toBe(lightColors.editorInk);
	click("entry-stash-1");
	flushSync(() =>
		handleGpuixEvent({ elementId: next.id, eventType: "blur" }, root.renderer)
	);
	key("entry-stash-1", "shift-tab");
	expect(root.renderer.getFocusedElementId()).toBe(element("rail-account").id);
	key("rail-account", "shift-tab");
	expect(root.renderer.getFocusedElementId()).toBe(element("rail-settings").id);
	key("rail-settings", "shift-tab");
	expect(root.renderer.getFocusedElementId()).toBe(next.id);
	flushSync(() =>
		handleGpuixEvent({ elementId: next.id, eventType: "focus" }, root.renderer)
	);
	expect(element("view-stashes-icon").style.color).toBe(lightColors.brand);
});

it("keeps the full-width tab rail above navigation contained in the rounded workspace", () => {
	expect(bounds("repository-navigation")).toMatchObject({
		x: 48,
		y: 42,
		width: 310,
		height: 592,
	});
	expect(bounds("workspace")).toMatchObject({
		x: 48,
		y: 42,
		width: 926,
		height: 592,
	});
	expect(element("repository-navigation").parentId).toBe(
		element("workspace").id
	);
	expect(bounds("view-changes").y).toBeGreaterThanOrEqual(42);
	expect(bounds("view-changes").x).toBeLessThan(96);
	expect(bounds("workspace-toolbar")).toMatchObject({
		x: 0,
		y: 0,
		width: 980,
		height: 42,
	});
	const home = bounds("workspace-home");
	const strip = bounds("workspace-tabs");

	expect(home.x).toBe(86);
	expect(strip.x).toBe(home.x + home.width - 8);
	expect(bounds("hover-workspace-1").x - home.x - home.width).toBe(4);
	expect(bounds("slot-workspace-1").x).toBe(strip.x + 10);
	expect(bounds("surface-workspace-1").x).toBe(strip.x);
	expect(strip.x + strip.width).toBe(974);
	expect(element("workspace").style.backgroundColor).toBe(
		lightColors.editorSurface
	);
	expect(root.renderer.getAllText()).toContain(
		"Preview only · no repository connected"
	);
	expect(root.renderer.getAllText()).toContain("Select an item to inspect");
});

it("selects file rows by pointer and keyboard, exposing selection and a truthful empty diff", () => {
	click("entry-src/app.tsx");
	expect(element("row-src/app.tsx").style.backgroundColor).toBe(
		lightColors.editorSunken2
	);
	expect(selected()).toEqual(["src/app.tsx, modified"]);
	expect(root.renderer.getAllText()).toContain("Diff preview comes next");
	expect(
		element("diff-selection")
			.children.map((id) => root.renderer.getElement(id)?.text)
			.join("")
	).toBe("src/app.tsx");
	key("entry-src/app.tsx", "down");
	expect(selected()).toEqual(["src/styles/tokens.ts, added"]);
	expect(root.renderer.getFocusedElementId()).toBe(
		element("entry-src/styles/tokens.ts").id
	);
	key("entry-src/styles/tokens.ts", "up");
	expect(selected()).toEqual(["src/app.tsx, modified"]);
});

it("keeps sidebar selection highlighted without outlines during arrow navigation", () => {
	for (const view of ["changes", "history", "stashes"] as const) {
		changeView(view);
		const [first, second] = sampleEntries[view];

		if (!first || !second) throw new Error(`Missing sample rows for ${view}`);

		click(`entry-${first.id}`);
		key(`entry-${first.id}`, "down");
		const entry = element(`entry-${second.id}`);

		flushSync(() =>
			handleGpuixEvent(
				{ elementId: entry.id, eventType: "focus" },
				root.renderer
			)
		);
		expect(root.renderer.getFocusedElementId()).toBe(entry.id);
		expect(entry.customProps?.["aria-selected"]).toBe(true);
		expect(element(`row-${second.id}`).style).toMatchObject({
			backgroundColor: lightColors.editorSunken2,
			borderColor: "transparent",
		});
	}
});

it("reveals an overflow tab's whole surface while keeping Home fixed at minimum width", () => {
	root.render(<App preview key="wide-rail" initialTabCount={8} />);
	click("entry-src/app.tsx");
	const strip = bounds("workspace-tabs");
	const fourth = bounds("slot-workspace-4");
	const firstX = bounds("slot-workspace-1").x;
	const home = bounds("workspace-home");

	expect(fourth.x).toBeLessThan(strip.x + strip.width);
	expect(fourth.x + fourth.width).toBeLessThanOrEqual(strip.x + strip.width);
	click("workspace-4");
	const active = bounds("surface-workspace-4");

	expect(active.x + active.width).toBeLessThanOrEqual(strip.x + strip.width);
	expect(active.x).toBeGreaterThanOrEqual(strip.x);
	expect(bounds("workspace-home")).toEqual(home);
	click("workspace-1");
	expect(selected()).toEqual(["src/app.tsx, modified"]);
	expect(bounds("slot-workspace-1").x).toBe(firstX);
});

it("reveals keyboard selections outside the viewport and keeps navigation clamped", () => {
	key("entry-src/app.tsx", "end");
	expect(scrollY()).toBeLessThan(0);
	expect(selected()).toEqual(["tsconfig.json, added"]);
	const last = bounds("entry-tsconfig.json");

	expect(last.y + last.height).toBeLessThanOrEqual(bounds("commit-composer").y);
	expect(last.y).toBeGreaterThanOrEqual(bounds("repository-list").y);
	key("entry-tsconfig.json", "down");
	expect(selected()).toEqual(["tsconfig.json, added"]);
	key("entry-tsconfig.json", "home");
	expect(selected()).toEqual(["src/app.tsx, modified"]);
	expect(bounds("entry-src/app.tsx").y).toBeGreaterThanOrEqual(
		bounds("repository-list").y
	);
	key("entry-src/app.tsx", "pagedown");
	expect(selected()).not.toEqual(["src/app.tsx, modified"]);
});

it("restores per-view scroll and selection after switching through History and Stashes", () => {
	key("entry-src/app.tsx", "end");
	const savedY = scrollY();

	changeView("history");
	expect(scrollY()).toBe(0);
	click("entry-commit-2");
	changeView("stashes");
	click("entry-stash-2");
	expect(selected()).toEqual([
		"Keyboard navigation polish",
		"src/main.tsx, modified",
	]);
	changeView("changes");
	expect(scrollY()).toBe(savedY);
	expect(selected()).toEqual(["tsconfig.json, added"]);
	changeView("history");
	expect(selected()).toEqual([
		"Add smooth tab reordering",
		"src/main.tsx, modified",
	]);
});

it("preserves wheel scrolling without a selection and isolates tab state", () => {
	root.renderer.nativeSimulateScrollWheel(150, 300, 0, -220);
	root.renderer.flush();
	const savedY = scrollY();

	expect(savedY).toBeLessThan(0);
	click("workspace-2");
	expect(scrollY()).toBe(0);
	changeView("history");
	click("entry-commit-3");
	click("workspace-1");
	expect(scrollY()).toBe(savedY);
	expect(selected()).toEqual([]);
	expect(root.renderer.getAllText()).toContain("30 of 30 selected");
	click("workspace-2");
	expect(selected()).toEqual([
		"Keep workspace selection per tab",
		"src/feature/workspace/sidebar.tsx, modified",
	]);
	expect(root.renderer.getAllText()).toContain("History");
	expect(root.renderer.findByTestId("repository-heading")).toBeUndefined();
});

it("supports arrow-key rail selection and entry/exit with Tab", () => {
	key("view-changes", "right");
	expect(root.renderer.getAllText()).toContain("History");
	expect(root.renderer.findByTestId("repository-heading")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(element("view-history").id);
	root.renderer.simulateKeystrokes("tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(element("rail-settings").id);
	key("rail-settings", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(element("rail-account").id);
	key("rail-account", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("filter-history").id
	);
	root.renderer.simulateKeystrokes("tab");
	root.renderer.flush();
	notifyListFocus();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("entry-commit-1").id
	);
	const row = element("entry-commit-1");

	flushSync(() =>
		handleGpuixEvent({ elementId: row.id, eventType: "focus" }, root.renderer)
	);
	expect(element("row-commit-1").style.borderColor).toBe("transparent");
	root.renderer.simulateKeystrokes("tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("revision-divider").id
	);
	root.renderer.simulateKeystrokes("tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("revision-file-layout").id
	);
	key("revision-file-layout", "tab");
	notifyListFocus();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("repository-list-scrollbar-vertical").id
	);
	root.renderer.simulateKeystrokes("tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("workspace-home").id
	);
	root.renderer.simulateKeystrokes("tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-1").id);
});

it("stacks revision files without checkboxes and shows contextual selection and empty placeholders", () => {
	for (const view of ["history", "stashes"] as const) {
		changeView(view);
		const first = sampleEntries[view][0];

		if (!first) throw new Error("Missing sample revision");

		expect(bounds("revision-files-pane").y).toBeGreaterThan(
			bounds("revision-pane").y
		);
		expect(bounds("revision-files-pane").width).toBe(
			bounds("revision-pane").width
		);
		expect(root.renderer.getAllText()).toContain(
			view === "history"
				? "Select a commit to see its files."
				: "Select a stash to see its files."
		);
		click(`entry-${first.id}`);
		expect(root.renderer.findByTestId("revision-header")).toBeUndefined();

		expect(selected()).toEqual([first.title, "src/app.tsx, modified"]);
		expect(root.renderer.findByTestId("diff-header")).toBeDefined();

		expect(root.renderer.findByTestId("include-all")).toBeUndefined();
		expect(root.renderer.findByTestId("include-src/app.tsx")).toBeUndefined();
		click("entry-src/app.tsx");
		expect(selected()).toEqual([first.title, "src/app.tsx, modified"]);
		expect(root.renderer.getAllText()).toContain("Diff preview comes next");
		expect(bounds("diff-header").y).toBe(bounds("workspace").y);
		click(`entry-${sampleEntries[view][1]?.id}`);

		expect(root.renderer.getAllText()).toContain("src/main.tsx");

		expect(root.renderer.findByTestId("entry-src/app.tsx")).toBeUndefined();
		key(`entry-${sampleEntries[view][1]?.id}`, "end");
		expect(root.renderer.getAllText()).toContain(
			"No file changes in this revision."
		);
		expect(root.renderer.getAllText()).toContain("No file changes");
	}
});

it("navigates revision files by keyboard and scrolls each pane independently, preserving them across views and tabs", () => {
	changeView("history");
	click("entry-commit-1");
	key("entry-commit-1", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("revision-divider").id
	);
	key("revision-divider", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("revision-file-layout").id
	);
	key("revision-file-layout", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("entry-src/app.tsx").id
	);
	key("entry-src/app.tsx", "end");
	const filesY = root.renderer.getScrollOffset(
		element("revision-files").id
	)?.[1];

	expect(filesY).toBeLessThan(0);
	expect(scrollY()).toBe(0);
	expect(selected()).toEqual([
		"Refine workspace tab spacing",
		"src/assets/file.svg, added",
	]);
	const filesPane = bounds("revision-files-pane");
	const last = bounds("entry-src/assets/file.svg");

	expect(last.y + last.height).toBeLessThanOrEqual(
		filesPane.y + filesPane.height
	);
	const top = bounds("revision-pane");

	root.renderer.nativeSimulateScrollWheel(top.x + 80, top.y + 50, 0, -150);
	root.renderer.flush();
	const revisionsY = scrollY();

	expect(revisionsY).toBeLessThan(0);
	expect(root.renderer.getScrollOffset(element("revision-files").id)?.[1]).toBe(
		filesY
	);
	changeView("stashes");
	click("entry-stash-1");
	click("entry-src/styles/tokens.ts");
	changeView("history");
	expect(scrollY()).toBe(revisionsY);
	expect(root.renderer.getScrollOffset(element("revision-files").id)?.[1]).toBe(
		filesY
	);
	expect(selected()).toEqual([
		"Refine workspace tab spacing",
		"src/assets/file.svg, added",
	]);
	click("workspace-2");
	changeView("history");
	expect(selected()).toEqual([]);
	click("workspace-1");
	expect(selected()).toEqual([
		"Refine workspace tab spacing",
		"src/assets/file.svg, added",
	]);
	changeView("stashes");
	expect(selected()).toEqual([
		"Sidebar layout exploration",
		"src/styles/tokens.ts, added",
	]);
});

it("resizes with captured dragging and keyboard limits, cancels with Escape, and remembers the split per view and tab", () => {
	changeView("history");
	const divider = bounds("revision-divider");
	const x = divider.x + 100;
	const y = divider.y + divider.height / 2;

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(700, y + 60, 0);
	root.renderer.flush();
	expect(bounds("revision-divider").y).toBeCloseTo(divider.y + 60, 0);
	root.renderer.nativeSimulateMouseUp(700, y + 60);
	root.renderer.flush();
	const movedY = bounds("revision-divider").y;

	root.renderer.nativeSimulateMouseDown(x, movedY + 4);
	root.renderer.nativeSimulateMouseMove(x, movedY - 70, 0);
	root.renderer.flush();
	key("revision-divider", "escape");
	root.renderer.nativeSimulateMouseUp(x, movedY - 70);
	root.renderer.flush();
	expect(bounds("revision-divider").y).toBeCloseTo(movedY, 0);
	key("revision-divider", "home");
	expect(element("revision-divider").customProps?.["aria-valuetext"]).toBe(
		"25% for revisions"
	);
	key("revision-divider", "up");
	expect(element("revision-divider").customProps?.["aria-valuetext"]).toBe(
		"25% for revisions"
	);
	key("revision-divider", "end");
	key("revision-divider", "down");
	expect(element("revision-divider").customProps?.["aria-valuetext"]).toBe(
		"75% for revisions"
	);
	key("revision-divider", "up");
	expect(element("revision-divider").customProps?.["aria-valuetext"]).toBe(
		"70% for revisions"
	);
	changeView("stashes");
	expect(element("revision-divider").customProps?.["aria-valuetext"]).toBe(
		"50% for revisions"
	);
	changeView("history");
	expect(element("revision-divider").customProps?.["aria-valuetext"]).toBe(
		"70% for revisions"
	);
	click("workspace-2");
	changeView("history");
	expect(element("revision-divider").customProps?.["aria-valuetext"]).toBe(
		"50% for revisions"
	);
	click("workspace-1");
	expect(element("revision-divider").customProps?.["aria-valuetext"]).toBe(
		"70% for revisions"
	);
});

it("reveals the remembered row when keyboard focus returns after scrolling it offscreen", () => {
	key("entry-src/app.tsx", "end");
	root.renderer.nativeSimulateScrollWheel(150, 300, 0, 1000);
	root.renderer.flush();
	expect(scrollY()).toBe(0);
	key("view-changes", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(element("rail-settings").id);
	key("rail-settings", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(element("rail-account").id);
	key("rail-account", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("changes-file-layout").id
	);
	key("changes-file-layout", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("filter-changes").id
	);
	key("filter-changes", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("repository-heading").id
	);
	key("repository-heading", "tab");
	expect(root.renderer.getFocusedElementId()).toBe(element("include-all").id);
	key("include-all", "tab");
	const row = element("entry-tsconfig.json");

	expect(root.renderer.getFocusedElementId()).toBe(row.id);
	flushSync(() =>
		handleGpuixEvent({ elementId: row.id, eventType: "focus" }, root.renderer)
	);
	root.renderer.flush();
	expect(scrollY()).toBeLessThan(0);
	expect(
		bounds("entry-tsconfig.json").y + bounds("entry-tsconfig.json").height
	).toBeLessThanOrEqual(bounds("commit-composer").y);
});

it("keeps tab dragging across the full-width strip and preserves the workspace selection", () => {
	click("entry-src/app.tsx");
	const first = bounds("slot-workspace-1");
	const second = bounds("slot-workspace-2");
	const x = first.x + 50;
	const y = first.y + 14;

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 150, y, 0);
	expect(bounds("slot-workspace-1").x).toBe(first.x + 150);
	root.renderer.nativeSimulateMouseUp(x + 150, y);
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	root.renderer.dispatchNativeEvents();
	root.renderer.flush();
	expect(bounds("slot-workspace-1").x).toBe(second.x);
	expect(selected()).toEqual(["src/app.tsx, modified"]);
});

it("returns to the shared Home screen after closing all tabs", () => {
	click("entry-src/app.tsx");
	click("close-workspace-1");
	click("close-workspace-2");
	expect(root.renderer.findByTestId("repository-navigation")).toBeUndefined();
	expect(element("workspace").customProps?.["aria-label"]).toBe("Home");
	click("workspace-home");
	expect(element("repository-welcome")).toBeDefined();
	expect(root.renderer.findByTestId("repository-navigation")).toBeUndefined();
	expect(root.renderer.findByTestId("workspace-3")).toBeUndefined();
});
