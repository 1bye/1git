/**
 * Covers: tab surface/hover geometry, clicks, captured drag reordering, keyboard/focus, and overflow.
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
		paddingLeft: 11,
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

it("keeps neighboring tab surfaces close without changing slot width", () => {
	root.render(<App key="adjacent-tabs" initialTabCount={3} />);
	const first = bounds("slot-workspace-1");
	const second = bounds("slot-workspace-2");
	const hover = bounds("hover-workspace-1");
	const nextAvatar = bounds("avatar-workspace-2");

	expect(second.x - first.x).toBe(210);
	expect(first.width).toBe(210);
	expect(hover.x - first.x).toBe(4);
	expect(hover.width).toBe(202);
	expect(nextAvatar.x - hover.x - hover.width).toBe(20);
	expect(bounds("avatar-workspace-1").x - hover.x).toBe(12);
});

it("highlights the whole inactive tab across its padding, label, and close target", () => {
	root.render(<App key="hover-tabs" initialTabCount={3} />);
	const hover = bounds("hover-workspace-2");
	const close = bounds("close-workspace-2");
	const label = bounds("label-workspace-2");
	const avatar = bounds("avatar-workspace-2");
	expect(hover.height).toBe(32);
	expect(hover.x + hover.width).toBeGreaterThan(close.x + close.width);
	expect(element("hover-workspace-2").style.opacity).toBe(0);

	for (const [x, y] of [
		[hover.x + 2, hover.y + 2],
		[avatar.x + 7, avatar.y + 7],
		[label.x + 10, label.y + label.height / 2],
		[close.x - 2, close.y + 12],
		[close.x + 12, close.y + 12],
		[hover.x + hover.width - 2, hover.y + 2],
	] as const) {
		root.renderer.nativeSimulateMouseMove(x, y);
		expect(
			element("hover-workspace-2").style.opacity,
			`hover at ${x}, ${y}`
		).toBe(1);
		expect(element("close-workspace-2").style.opacity).toBe(1);
		expect(bounds("label-workspace-2")).toEqual(label);
		expect(bounds("close-workspace-2")).toEqual(close);
	}

	root.renderer.nativeSimulateMouseMove(500, 300);
	expect(element("hover-workspace-2").style.opacity).toBe(0);
	expect(element("close-workspace-2").style.opacity).toBe(0);
	const active = bounds("workspace-1");
	root.renderer.nativeSimulateMouseMove(active.x + 20, active.y + 12);
	expect(element("hover-workspace-1").style.opacity).toBe(0);
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

it("starts the preview overflowing and lets + add and reveal more tabs", () => {
	root.render(<App key="multi-tab-preview" initialTabCount={8} />);
	const strip = bounds("workspace-tabs");
	expect(element("workspace-8")).toBeDefined();
	expect(bounds("workspace-8").x).toBeGreaterThan(strip.x + strip.width);
	expect(selectedTabs()).toEqual(["1git / main"]);

	click("add-workspace");
	expect(selectedTabs()).toEqual(["Workspace 9"]);
	const added = bounds("workspace-9");
	expect(added.x).toBeGreaterThanOrEqual(
		workspaceLayout.desktopTitlebarControlsWidth
	);
	expect(added.x + added.width).toBeLessThanOrEqual(strip.x + strip.width);
	click("close-workspace-9");
	expect(selectedTabs()).toEqual(["Workspace 8"]);
});

const order = (): string[] =>
	["workspace-1", "workspace-2", "workspace-3"].sort(
		(a, b) => bounds(`slot-${a}`).x - bounds(`slot-${b}`).x
	);

it("previews reordering with captured moves and commits on release outside the strip", () => {
	click("add-workspace");
	click("add-workspace");
	const first = bounds("workspace-1");
	const x = first.x + 20;
	const y = first.y + first.height / 2;
	const id = element("workspace-1").id;

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 2, y, 0);
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);
	root.renderer.nativeSimulateMouseMove(x + 420, y, 0);
	expect(order()).toEqual(["workspace-2", "workspace-3", "workspace-1"]);
	expect(element("workspace-1").id).toBe(id);
	expect(selectedTabs()).toEqual(["1git / main"]);
	root.renderer.nativeSimulateMouseUp(x + 420, 300);
	expect(order()).toEqual(["workspace-2", "workspace-3", "workspace-1"]);
	expect(element("slot-workspace-1").style.opacity).not.toBe(0.8);

	click("workspace-2");
	expect(selectedTabs()).toEqual(["Workspace 2"]);
});

it("cancels the preview on Escape and keeps close/add controls out of a tab drag", () => {
	click("add-workspace");
	click("add-workspace");
	const first = bounds("workspace-1");
	const x = first.x + 20;
	const y = first.y + first.height / 2;
	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 420, y, 0);
	root.renderer.nativeSimulateKeyDown(element("workspace-1").id, "escape");
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);
	const close = bounds("close-workspace-3");
	root.renderer.nativeSimulateMouseUp(close.x + 12, close.y + 12);
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 420, y, 0);
	const add = bounds("add-workspace");
	root.renderer.nativeSimulateMouseUp(add.x + 12, add.y + 12);
	expect(root.renderer.findByTestId("workspace-4")).toBeUndefined();
	click("close-workspace-2");
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
});

it("does not reorder when a drag starts on close or with a non-primary button", () => {
	click("add-workspace");
	click("add-workspace");
	const first = bounds("workspace-1");
	const x = first.x + 20;
	const y = first.y + first.height / 2;
	root.renderer.nativeSimulateMouseDown(x, y, 2);
	root.renderer.nativeSimulateMouseMove(x + 420, y, 2);
	root.renderer.nativeSimulateMouseUp(x + 420, y, 2);
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);
	const close = bounds("close-workspace-1");
	root.renderer.nativeSimulateMouseDown(close.x + 12, close.y + 12);
	root.renderer.nativeSimulateMouseMove(x + 420, 300, 0);
	root.renderer.nativeSimulateMouseUp(x + 420, 300);
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);
});

it("ignores the old tab's blur when grabbing another tab, but cancels on the grabbed tab's blur", () => {
	click("add-workspace");
	click("add-workspace");
	const first = bounds("workspace-1");
	const x = first.x + 20;
	const y = first.y + first.height / 2;
	root.renderer.nativeSimulateMouseDown(x, y);
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("workspace-3").id, eventType: "blur" },
			root.renderer
		)
	);
	root.renderer.nativeSimulateMouseMove(x + 420, y, 0);
	expect(order()).toEqual(["workspace-2", "workspace-3", "workspace-1"]);
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("workspace-1").id, eventType: "blur" },
			root.renderer
		)
	);
	root.renderer.nativeSimulateMouseUp(x + 420, 300);
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);
});

it("reorders from the padded tab surface and with Shift+Arrow, keeping focus", () => {
	click("add-workspace");
	click("add-workspace");
	const slot = bounds("slot-workspace-1");
	root.renderer.nativeSimulateMouseDown(slot.x + 40, slot.y + 2);
	root.renderer.nativeSimulateMouseMove(slot.x + 250, slot.y + 2, 0);
	root.renderer.nativeSimulateMouseUp(slot.x + 250, 300);
	expect(order()).toEqual(["workspace-2", "workspace-1", "workspace-3"]);
	root.renderer.simulateKeystrokes("shift-right");
	expect(order()).toEqual(["workspace-2", "workspace-3", "workspace-1"]);
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-1").id);
	root.renderer.simulateKeystrokes("shift-right");
	expect(order()).toEqual(["workspace-2", "workspace-3", "workspace-1"]);
	root.renderer.simulateKeystrokes("shift-left");
	expect(order()).toEqual(["workspace-2", "workspace-1", "workspace-3"]);
});

it("autoscrolls during an overflow drag and stops after release", async () => {
	for (let index = 0; index < 8; index += 1) click("add-workspace");
	const tab = bounds("workspace-9");
	const stripId = element("workspace-tabs").id;
	const before = root.renderer.getScrollOffset(stripId)?.[0] ?? 0;
	root.renderer.nativeSimulateMouseDown(tab.x + 20, tab.y + 12);
	root.renderer.nativeSimulateMouseMove(85, tab.y + 12, 0);
	await Bun.sleep(120);
	root.renderer.flush();
	expect(root.renderer.getScrollOffset(stripId)?.[0] ?? 0).toBeGreaterThan(
		before
	);
	root.renderer.nativeSimulateMouseUp(85, 300);
	const after = root.renderer.getScrollOffset(stripId);
	await Bun.sleep(60);
	root.renderer.flush();
	expect(root.renderer.getScrollOffset(stripId)).toEqual(after);
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
