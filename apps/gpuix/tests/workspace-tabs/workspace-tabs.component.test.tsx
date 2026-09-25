/**
 * Covers: native tab clicks, keyboard/focus behavior, empty recovery, and overflow layout.
 * Real: app, UI controls, React, and GPUIX native layout/events/accessibility.
 * Doubles: sample workspace records and focus/blur notifications for inactive offscreen windows.
 * Requires: GPUIX native test renderer with macOS or Windows graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { lightColors } from "@1git/design-tokens";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";

import { App } from "../../src/app";
import { WorkspaceTabs } from "../../src/feature/workspace-tabs/workspace-tabs";
import { workspaceLayout } from "../../src/styles/workspace-layout";
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

it("uses the native shell geometry and paints only the workspace opaque", () => {
	expect(bounds("workspace-toolbar").height).toBe(
		workspaceLayout.toolbarHeight
	);
	expect(bounds("workspace")).toMatchObject({
		x: 6,
		y: 42,
		width: 968,
		height: 592,
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

it("aligns lightweight labels and icons without shifting when selection changes", () => {
	const avatar = bounds("avatar-workspace-1");
	const label = bounds("label-workspace-1");
	const close = bounds("close-workspace-1");
	const closeIcon = bounds("close-icon-workspace-1");
	const addIcon = bounds("add-workspace-icon");
	const centerY = avatar.y + avatar.height / 2;
	expect(label.x - avatar.x - avatar.width).toBe(workspaceLayout.tabContentGap);
	expect(label.y + label.height / 2).toBe(centerY);
	expect(close.y + close.height / 2).toBe(centerY);
	expect(closeIcon.y + closeIcon.height / 2).toBe(centerY);
	expect(addIcon.y + addIcon.height / 2).toBe(centerY);
	expect(bounds("name-workspace-1").y).toBe(bounds("branch-workspace-1").y);
	expect(element("content-workspace-1").style).toMatchObject({
		paddingLeft: 8,
		paddingRight: 4,
		gap: 8,
	});
	expect(element("close-workspace-1").style).toMatchObject({
		width: 24,
		height: 24,
	});
	expect(closeIcon).toMatchObject({ width: 14, height: 14 });
	expect(element("name-workspace-1").style.fontWeight).toBe(500);
	expect(element("branch-workspace-1").style).toMatchObject({
		fontWeight: 400,
		color: lightColors.editorMuted,
	});

	click("add-workspace");
	expect(element("name-workspace-1").style.fontWeight).toBe(500);
	expect(element("close-workspace-1").style.opacity).toBe(0);
	expect(bounds("label-workspace-1")).toEqual(label);
	expect(bounds("close-workspace-1")).toEqual(close);
});

it("reduces the upper tab inset without shrinking controls or changing bottom spacing", () => {
	expect(bounds("avatar-workspace-1").y).toBe(15);
	expect(bounds("close-icon-workspace-1").y).toBe(15);
	expect(bounds("add-workspace-icon").y).toBe(15);
	expect(bounds("workspace").y).toBe(42);
	expect(element("close-workspace-1").style.height).toBe(24);
	expect(element("add-workspace").style.height).toBe(24);
	expect(element("add-workspace").style.marginBottom).toBe(8);
	expect(windowOptions.trafficLightY).toBe(13);
});

it("gives the close icon equal top and right gaps within the tab surface", () => {
	const surface = bounds("surface-workspace-1");
	const icon = bounds("close-icon-workspace-1");
	const topGap = icon.y - surface.y;
	// The right wall sits inside the connected silhouette's curved shoulder.
	const rightEdge =
		surface.x + surface.width - workspaceLayout.tabContentInsetInlineStart;
	const rightGap = rightEdge - icon.x - icon.width;
	// Equal SVG-box insets also give this symmetric glyph equal visible ink gaps (~12px).
	expect(rightGap).toBe(topGap);
	expect(rightGap).toBe(9);
});

it("shows a focus ring when Tab first enters the window", () => {
	root.renderer.simulateKeystrokes("tab");
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-1").id);
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("workspace-1").id, eventType: "focus" },
			root.renderer
		)
	);
	expect(element("workspace-1").style.borderColor).toBe(lightColors.brand);
});

it("keeps long repository and branch labels on one line clear of the close target", () => {
	const name = "an-extremely-long-repository-name-that-needs-truncation";
	const branch = "feature/this-is-a-long-branch-name";
	root.render(
		<WorkspaceTabs
			state={{
				tabs: [{ id: "long", name, branch }],
				activeId: "long",
				nextId: 2,
			}}
			dispatch={() => {}}
		/>
	);
	const repository = bounds("name-long");
	const branchLabel = bounds("branch-long");
	const close = bounds("close-long");
	expect(repository.y).toBe(branchLabel.y);
	expect(repository.x + repository.width).toBeLessThanOrEqual(branchLabel.x);
	expect(branchLabel.x + branchLabel.width).toBeLessThan(close.x);
	expect(element("name-long").style.textOverflow).toBe("ellipsis");
	expect(element("branch-long").style.textOverflow).toBe("ellipsis");
	expect(selectedTabs()).toEqual([`${name} / ${branch}`]);
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

it("hides pointer focus rings and restores them when navigating with the keyboard", () => {
	click("workspace-1");
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("workspace-1").id, eventType: "focus" },
			root.renderer
		)
	);
	expect(element("workspace-1").style.borderColor).toBe("transparent");

	root.renderer.simulateKeystrokes("tab");
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("close-workspace-1").id, eventType: "focus" },
			root.renderer
		)
	);
	expect(element("close-workspace-1").style.borderColor).toBe(
		lightColors.brand
	);

	click("add-workspace");
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("workspace-2").id, eventType: "focus" },
			root.renderer
		)
	);
	expect(element("workspace-2").style.borderColor).toBe("transparent");
	root.renderer.simulateKeystrokes("left");
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("workspace-1").id, eventType: "focus" },
			root.renderer
		)
	);
	expect(element("workspace-1").style.borderColor).toBe(lightColors.brand);

	click("close-workspace-1");
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("workspace-2").id, eventType: "focus" },
			root.renderer
		)
	);
	expect(element("workspace-2").style.borderColor).toBe("transparent");
	click("close-workspace-2");
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("add-workspace").id, eventType: "focus" },
			root.renderer
		)
	);
	expect(element("add-workspace").style.borderColor).toBe("transparent");
	root.renderer.nativeSimulateKeyDown(element("add-workspace").id, "space");
	expect(element("add-workspace").style.borderColor).toBe(lightColors.brand);
	root.renderer.nativeSimulateKeyUp(element("add-workspace").id, "space");
	expect(selectedTabs()).toEqual(["Workspace 3"]);
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
