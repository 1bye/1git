/**
 * Covers: integrated workspace geometry, view/row selection, keyboard, scrolling, tab isolation and dragging.
 * Real: App, view pills, GPUIX layout, hit testing, focus and accessibility.
 * Doubles: sample repository data; focus notification for inactive offscreen windows.
 * Requires: patched GPUIX native test renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { lightColors } from "@1git/design-tokens";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";

import { App } from "../../src/app";
import { windowOptions } from "../../src/window-options";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
	root.render(<App initialTabCount={2} />);
});
afterEach(() => root.unmount());

const element = (testId: string) => {
	const node = root.renderer.findByTestId(testId);

	if (!node) throw new Error(`Missing element: ${testId}`);

	return node;
};

const bounds = (testId: string) => {
	const box = root.renderer.getElementBounds(element(testId).id);

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

const key = (testId: string, value: string): void => {
	root.renderer.nativeSimulateKeyDown(element(testId).id, value);
	root.renderer.flush();
};

const scrollY = () =>
	root.renderer.getScrollOffset(element("repository-list").id)?.[1] ?? 0;

const selected = () =>
	Object.values(root.renderer.getA11yTree().nodes ?? {})
		.filter((node) => node.aria?.role === "ListBoxOption" && node.aria.selected)
		.map((node) => node.aria?.label);

const selectedView = () =>
	Object.values(root.renderer.getA11yTree().nodes ?? {})
		.filter(
			(node) =>
				node.aria?.role === "Tab" &&
				node.aria.selected &&
				["Changes", "History", "Stashes"].includes(node.aria.label ?? "")
		)
		.map((node) => node.aria?.label);

it("shows three separate compact pills on one row with one selected view", () => {
	const changes = bounds("view-changes");
	const history = bounds("view-history");
	const stashes = bounds("view-stashes");
	const navigation = bounds("repository-navigation");

	expect(root.renderer.findByTestId("repository-view")).toBeUndefined();
	expect(history.y).toBe(changes.y);
	expect(stashes.y).toBe(changes.y);
	expect(history.x).toBeGreaterThan(changes.x + changes.width);
	expect(stashes.x).toBeGreaterThan(history.x + history.width);
	expect(stashes.x + stashes.width).toBeLessThan(
		navigation.x + navigation.width
	);

	for (const view of ["changes", "history", "stashes"]) {
		expect(element(`view-${view}`).style).toMatchObject({
			height: 26,
			borderRadius: 13,
		});
	}

	expect(selectedView()).toEqual(["Changes"]);
	expect(element("view-changes").style.backgroundColor).toBe(
		lightColors.editorHairlineStrong
	);
	click("view-stashes");
	expect(selectedView()).toEqual(["Stashes"]);
	expect(element("view-changes").style.backgroundColor).toBe(
		lightColors.editorSunken
	);
	expect(element("view-stashes").style.backgroundColor).toBe(
		lightColors.editorHairlineStrong
	);
});

it("wraps pill arrows, supports Home/End and Enter/Space, and ignores modified navigation", () => {
	key("view-changes", "left");
	expect(selectedView()).toEqual(["Stashes"]);
	key("view-stashes", "right");
	expect(selectedView()).toEqual(["Changes"]);
	key("view-changes", "end");
	expect(selectedView()).toEqual(["Stashes"]);
	key("view-stashes", "home");
	expect(selectedView()).toEqual(["Changes"]);
	key("view-changes", "shift-right");
	expect(selectedView()).toEqual(["Changes"]);
	key("view-history", "enter");
	expect(selectedView()).toEqual(["History"]);
	key("view-stashes", "space");
	expect(selectedView()).toEqual(["Stashes"]);
	expect(root.renderer.getFocusedElementId()).toBe(element("view-stashes").id);
});

it("shows pill focus outlines for the keyboard without outlining pointer selection", () => {
	click("view-history");
	const pill = element("view-history");

	flushSync(() =>
		handleGpuixEvent({ elementId: pill.id, eventType: "focus" }, root.renderer)
	);
	expect(element("view-history").style.borderColor).toBe("transparent");
	key("view-history", "enter");
	expect(element("view-history").style.borderColor).toBe(lightColors.brand);
	click("view-stashes");
	const next = element("view-stashes");

	flushSync(() =>
		handleGpuixEvent({ elementId: next.id, eventType: "focus" }, root.renderer)
	);
	expect(element("view-stashes").style.borderColor).toBe("transparent");
	click("entry-stash-1");
	flushSync(() =>
		handleGpuixEvent({ elementId: next.id, eventType: "blur" }, root.renderer)
	);
	key("entry-stash-1", "shift-tab");
	expect(root.renderer.getFocusedElementId()).toBe(next.id);
	flushSync(() =>
		handleGpuixEvent({ elementId: next.id, eventType: "focus" }, root.renderer)
	);
	expect(element("view-stashes").style.borderColor).toBe(lightColors.brand);
});

it("keeps the full-width tab rail above navigation contained in the rounded workspace", () => {
	expect(bounds("repository-navigation")).toMatchObject({
		x: 6,
		y: 42,
		// GPUIX reports content width, excluding the 1px divider.
		width: 309,
		height: 592,
	});
	expect(bounds("workspace")).toMatchObject({
		x: 6,
		y: 42,
		width: 968,
		height: 592,
	});
	expect(element("repository-navigation").parentId).toBe(
		element("workspace").id
	);
	expect(bounds("view-changes").y).toBeGreaterThanOrEqual(42);
	expect(bounds("view-changes").x).toBeLessThan(96);
	expect(bounds("workspace-toolbar")).toMatchObject({
		// Native bounds include the toolbar's left padding in the reported origin.
		x: 86,
		y: 0,
		width: 980,
		height: 42,
	});
	expect(bounds("slot-workspace-1").x).toBe(96);
	expect(bounds("surface-workspace-1").x).toBe(86);
	expect(bounds("workspace-tabs").width).toBe(856);
	expect(element("workspace").style.backgroundColor).toBe(
		lightColors.editorSurface
	);
	expect(root.renderer.getAllText()).toContain("Sample data");
	expect(root.renderer.getAllText()).toContain("Select an item to inspect");
});

it("selects file rows by pointer and keyboard, exposing selection and a truthful empty diff", () => {
	click("entry-src/app.tsx");
	expect(element("entry-src/app.tsx").style.backgroundColor).toBe(
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

it("fits four tab bodies at minimum width and reveals the selected tab's shoulders", () => {
	root.render(<App key="wide-rail" initialTabCount={8} />);
	click("entry-src/app.tsx");
	const strip = bounds("workspace-tabs");
	const fourth = bounds("slot-workspace-4");
	const firstX = bounds("slot-workspace-1").x;

	expect(fourth.x + fourth.width).toBeLessThanOrEqual(
		strip.x + strip.width - 10
	);
	click("workspace-4");
	const active = bounds("surface-workspace-4");

	expect(active.x + active.width).toBeLessThanOrEqual(
		strip.x + strip.width - 10
	);
	click("workspace-1");
	expect(selected()).toEqual(["src/app.tsx, modified"]);
	expect(bounds("slot-workspace-1").x).toBe(firstX);
});

it("reveals keyboard selections outside the viewport and keeps navigation clamped", () => {
	key("entry-src/app.tsx", "end");
	expect(scrollY()).toBeLessThan(0);
	expect(selected()).toEqual(["tsconfig.json, added"]);
	const last = bounds("entry-tsconfig.json");

	expect(last.y + last.height).toBeLessThanOrEqual(602);
	expect(last.y).toBeGreaterThanOrEqual(118);
	key("entry-tsconfig.json", "down");
	expect(selected()).toEqual(["tsconfig.json, added"]);
	key("entry-tsconfig.json", "home");
	expect(selected()).toEqual(["src/app.tsx, modified"]);
	expect(bounds("entry-src/app.tsx").y).toBeGreaterThanOrEqual(118);
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
	expect(selected()).toEqual(["Keyboard navigation polish"]);
	changeView("changes");
	expect(scrollY()).toBe(savedY);
	expect(selected()).toEqual(["tsconfig.json, added"]);
	changeView("history");
	expect(selected()).toEqual(["Add smooth tab reordering"]);
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
	expect(root.renderer.getAllText()).toContain("Working tree");
	click("workspace-2");
	expect(selected()).toEqual(["Keep workspace selection per tab"]);
	expect(root.renderer.getAllText()).toContain("Recent commits");
});

it("supports arrow-key pill selection and entry/exit with Tab", () => {
	key("view-changes", "right");
	expect(root.renderer.getAllText()).toContain("Recent commits");
	expect(root.renderer.getFocusedElementId()).toBe(element("view-history").id);
	root.renderer.simulateKeystrokes("tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(
		element("entry-commit-1").id
	);
	const row = element("entry-commit-1");

	flushSync(() =>
		handleGpuixEvent({ elementId: row.id, eventType: "focus" }, root.renderer)
	);
	expect(element("entry-commit-1").style.borderColor).toBe(lightColors.brand);
	root.renderer.simulateKeystrokes("tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-1").id);
});

it("reveals the remembered row when keyboard focus returns after scrolling it offscreen", () => {
	key("entry-src/app.tsx", "end");
	root.renderer.nativeSimulateScrollWheel(150, 300, 0, 1000);
	root.renderer.flush();
	expect(scrollY()).toBe(0);
	key("view-changes", "tab");
	const row = element("entry-tsconfig.json");

	expect(root.renderer.getFocusedElementId()).toBe(row.id);
	flushSync(() =>
		handleGpuixEvent({ elementId: row.id, eventType: "focus" }, root.renderer)
	);
	root.renderer.flush();
	expect(scrollY()).toBeLessThan(0);
	expect(
		bounds("entry-tsconfig.json").y + bounds("entry-tsconfig.json").height
	).toBeLessThanOrEqual(602);
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

it("clears navigation after closing all tabs and starts a fresh workspace from +", () => {
	click("entry-src/app.tsx");
	click("close-workspace-1");
	click("close-workspace-2");
	expect(root.renderer.findByTestId("repository-navigation")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("No workspace open");
	click("add-workspace");
	expect(root.renderer.findByTestId("repository-navigation")).toBeDefined();
	expect(selected()).toEqual([]);
	expect(scrollY()).toBe(0);
	expect(root.renderer.getAllText()).toContain("Select an item to inspect");
});
