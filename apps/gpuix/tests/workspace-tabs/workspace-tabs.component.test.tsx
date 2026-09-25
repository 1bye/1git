/**
 * Covers: native tab clicks, keyboard/focus behavior, empty recovery, and overflow layout.
 * Real: app, UI controls, React, and GPUIX native layout/events/accessibility.
 * Doubles: sample workspace records and focus/blur notifications for inactive offscreen windows.
 * Requires: GPUIX native test renderer with macOS or Windows graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { lightColors, workspaceLayout } from "@1git/design-tokens";
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
	root.render(<App />);
});
afterEach(() => root.unmount());

const element = (testId: string) => {
	const found = root.renderer.findByTestId(testId);
	if (!found) throw new Error(`Missing element: ${testId}`);

	return found;
};
const bounds = (testId: string) => {
	const found = root.renderer.getElementBounds(element(testId).id);
	if (!found) throw new Error(`Missing bounds: ${testId}`);

	return found;
};
const click = (testId: string): void => {
	const box = bounds(testId);
	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
};
const selectedTabs = () =>
	Object.values(root.renderer.getA11yTree().nodes ?? {})
		.filter((node) => node.aria?.role === "Tab" && node.aria.selected)
		.map((node) => node.aria?.label);

it("uses the shared shell geometry and paints only the workspace opaque", () => {
	expect(bounds("workspace-toolbar").height).toBe(
		workspaceLayout.toolbarHeight
	);
	expect(bounds("workspace")).toMatchObject({
		x: 6,
		y: 46,
		width: 968,
		height: 588,
	});
	expect(element("workspace").style.backgroundColor).toBe(
		lightColors.editorSurface
	);
	expect(element("app-shell").style.backgroundColor).toBe(
		lightColors.studioGlassStrong
	);
	expect(selectedTabs()).toEqual(["1git / main"]);
	expect(windowOptions.windowBackground).toBe("blurred");
});

it("adds and activates tabs without closing on activation, and recovers focus after the last close", () => {
	click("add-workspace");
	expect(selectedTabs()).toEqual(["Workspace 2"]);
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-2").id);
	click("workspace-1");
	expect(selectedTabs()).toEqual(["1git / main"]);
	click("close-workspace-2");
	expect(selectedTabs()).toEqual(["1git / main"]);
	click("close-workspace-1");
	expect(selectedTabs()).toEqual([]);
	expect(root.renderer.getFocusedElementId()).toBe(element("add-workspace").id);
	root.renderer.nativeSimulateKeyDown(element("add-workspace").id, "space");
	root.renderer.nativeSimulateKeyUp(element("add-workspace").id, "space");
	expect(selectedTabs()).toEqual(["Workspace 3"]);
});

it("moves selection with arrows and Home/End and closes using Delete", () => {
	click("add-workspace");
	click("add-workspace");
	root.renderer.simulateKeystrokes("right");
	expect(selectedTabs()).toEqual(["1git / main"]);
	root.renderer.simulateKeystrokes("end");
	expect(selectedTabs()).toEqual(["Workspace 3"]);
	root.renderer.simulateKeystrokes("home");
	expect(selectedTabs()).toEqual(["1git / main"]);
	root.renderer.simulateKeystrokes("left");
	expect(selectedTabs()).toEqual(["Workspace 3"]);
	root.renderer.simulateKeystrokes("delete");
	expect(selectedTabs()).toEqual(["Workspace 2"]);
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-2").id);
	root.renderer.simulateKeystrokes("tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("close-workspace-2").id
	);
	root.renderer.simulateKeystrokes("tab");
	expect(root.renderer.getFocusedElementId()).toBe(element("add-workspace").id);
	root.renderer.simulateKeystrokes("shift-tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("close-workspace-2").id
	);
});

it("scrolls overflowing tabs into view while keeping the add action reachable", () => {
	for (let index = 0; index < 8; index += 1) click("add-workspace");
	const strip = bounds("workspace-tabs");
	const viewportLeft = workspaceLayout.desktopTitlebarControlsWidth;
	const active = bounds("workspace-9");
	expect(
		bounds("add-workspace").x + bounds("add-workspace").width
	).toBeLessThan(980);
	expect(active.x).toBeGreaterThanOrEqual(viewportLeft);
	expect(active.x + active.width).toBeLessThanOrEqual(
		viewportLeft + strip.width
	);
	const close = bounds("close-workspace-9");
	expect(close.x + close.width).toBeLessThanOrEqual(viewportLeft + strip.width);
	expect(
		root.renderer.getScrollOffset(element("workspace-tabs").id)?.[0]
	).toBeLessThan(0);
	root.renderer.simulateKeystrokes("home");
	expect(bounds("workspace-1").x).toBeGreaterThanOrEqual(viewportLeft);
	expect(selectedTabs()).toEqual(["1git / main"]);
});

it("shows focus and cancels Space activation after a blur notification", () => {
	click("add-workspace");
	const first = element("workspace-1");
	root.renderer.nativeSimulateKeyDown(first.id, "space");
	// Offscreen windows have focus handles but do not emit active-window focus notifications.
	flushSync(() =>
		handleGpuixEvent({ elementId: first.id, eventType: "focus" }, root.renderer)
	);
	expect(element("workspace-1").style.borderColor).toBe(lightColors.brand);
	flushSync(() =>
		handleGpuixEvent({ elementId: first.id, eventType: "blur" }, root.renderer)
	);
	root.renderer.nativeSimulateKeyUp(first.id, "space");
	expect(selectedTabs()).toEqual(["Workspace 2"]);
	expect(element("workspace-1").style.borderColor).toBe("transparent");
});
