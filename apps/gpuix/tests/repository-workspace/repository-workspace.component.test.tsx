/**
 * Covers: integrated workspace geometry, view/row selection, keyboard, scrolling, tab isolation and dragging.
 * Real: App, native Select, GPUIX layout, hit testing, focus and accessibility.
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
	click("repository-view");
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

it("places the translucent rail beside the tabs and opaque rounded diff surface", () => {
	expect(bounds("repository-sidebar")).toMatchObject({
		x: 0,
		y: 0,
		width: 310,
		height: 640,
	});
	expect(bounds("workspace")).toMatchObject({
		x: 316,
		y: 42,
		width: 658,
		height: 592,
	});
	expect(bounds("repository-view").x).toBeGreaterThanOrEqual(96);
	expect(bounds("slot-workspace-1").x).toBe(326);
	expect(bounds("surface-workspace-1").x).toBe(316);
	expect(element("workspace").style.backgroundColor).toBe(
		lightColors.editorSurface
	);
	expect(root.renderer.getAllText()).toContain("Sample data");
	expect(root.renderer.getAllText()).toContain("Select an item to inspect");
});

it("selects file rows by pointer and keyboard, exposing selection and a truthful empty diff", () => {
	click("entry-src/app.tsx");
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

it("reveals keyboard selections outside the viewport and keeps navigation clamped", () => {
	key("entry-src/app.tsx", "end");
	expect(scrollY()).toBeLessThan(0);
	expect(selected()).toEqual(["tsconfig.json, added"]);
	const last = bounds("entry-tsconfig.json");

	expect(last.y + last.height).toBeLessThanOrEqual(608);
	expect(last.y).toBeGreaterThanOrEqual(78);
	key("entry-tsconfig.json", "down");
	expect(selected()).toEqual(["tsconfig.json, added"]);
	key("entry-tsconfig.json", "home");
	expect(selected()).toEqual(["src/app.tsx, modified"]);
	expect(bounds("entry-src/app.tsx").y).toBeGreaterThanOrEqual(78);
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

it("supports keyboard view selection, focus restoration, and entry/exit with Tab", () => {
	key("repository-view", "enter");
	root.renderer.simulateKeystrokes("down enter");
	root.renderer.flush();
	expect(root.renderer.getAllText()).toContain("Recent commits");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("repository-view").id
	);
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
	key("repository-view", "tab");
	const row = element("entry-tsconfig.json");

	expect(root.renderer.getFocusedElementId()).toBe(row.id);
	flushSync(() =>
		handleGpuixEvent({ elementId: row.id, eventType: "focus" }, root.renderer)
	);
	root.renderer.flush();
	expect(scrollY()).toBeLessThan(0);
	expect(
		bounds("entry-tsconfig.json").y + bounds("entry-tsconfig.json").height
	).toBeLessThanOrEqual(608);
});

it("keeps tab dragging relative to the moved strip and preserves the workspace selection", () => {
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

it("clears the sidebar after closing all tabs and starts a fresh workspace from +", () => {
	click("entry-src/app.tsx");
	click("close-workspace-1");
	click("close-workspace-2");
	expect(root.renderer.findByTestId("repository-sidebar")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("No workspace open");
	click("add-workspace");
	expect(root.renderer.findByTestId("repository-sidebar")).toBeDefined();
	expect(selected()).toEqual([]);
	expect(scrollY()).toBe(0);
	expect(root.renderer.getAllText()).toContain("Select an item to inspect");
});
