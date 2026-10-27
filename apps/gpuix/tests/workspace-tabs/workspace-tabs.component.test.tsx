/**
 * Covers: tab geometry, clicks, animated captured reordering, keyboard/focus, and overflow.
 * Real: isolated tab shell, UI controls, React, and GPUIX native layout/events/accessibility.
 * Doubles: sample workspace records and focus/blur notifications for inactive offscreen windows.
 * Requires: GPUIX native test renderer with macOS or Windows graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import {
	controlSize,
	iconSize,
	lightColors,
	spacing,
} from "@1git/design-tokens";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";

import { useEffect, useReducer } from "react";

import { AppShell } from "../../src/fixture/app-shell";
import { RepositoryWorkspaceModel } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import { WorkspaceTabs } from "../../src/feature/workspace-tabs/workspace-tabs";
import { workspaceLayout } from "../../src/styles/workspace-layout";
import { windowOptions } from "../../src/window-options";
import { AppThemeContext, appThemes } from "../../src/styles/theme";

let root: TestRoot;
let seedWorkspace: () => void;

// Keep the tab strip's full-width geometry regressions independent of workspace content.
// The integrated navigation + tab layout is exercised in repository-workspace tests.
function App({
	initialTabCount = 1,
	smoothTransitions = false,
}: {
	initialTabCount?: number;
	smoothTransitions?: boolean;
}) {
	const [state, dispatch] = useReducer(
		WorkspaceTabsModel.reduce,
		initialTabCount,
		(count) => WorkspaceTabsModel.create(count, true)
	);

	useEffect(() => {
		seedWorkspace = () => {
			const id = `workspace-${state.nextId}`;

			flushSync(() => dispatch({ type: "add" }));
			const tab = root.renderer.findByTestId(id);

			if (tab) root.renderer.focusElement(tab.id);
		};
	}, [state.nextId, dispatch]);

	const active = state.tabs.find((tab) => tab.id === state.activeId);

	return (
		<AppThemeContext
			value={{ ...appThemes.light, commitTypeBadges: true, smoothTransitions }}
		>
			<AppShell
				toolbar={<WorkspaceTabs state={state} dispatch={dispatch} />}
				workspaceLabel={
					active ? `${active.name} workspace` : "No workspace open"
				}
			/>
		</AppThemeContext>
	);
}

function KindJourneyApp() {
	const [state, dispatch] = useReducer(
		WorkspaceTabsModel.reduce,
		WorkspaceTabsModel.create(0, true)
	);

	useEffect(() => {
		flushSync(() => {
			dispatch({ type: "add", kind: "empty" });
			dispatch({ type: "open-settings" });
		});
	}, []);

	return (
		<AppThemeContext
			value={{
				...appThemes.light,
				commitTypeBadges: true,
				smoothTransitions: false,
			}}
		>
			<AppShell
				toolbar={<WorkspaceTabs state={state} dispatch={dispatch} />}
				workspaceLabel="Workspace tabs"
			/>
		</AppThemeContext>
	);
}

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
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

// Native bounds describe the viewport, independently of its content scroll offset.
const tabViewport = () => bounds("workspace-tabs");

const click = (testId: string): void => {
	const box = bounds(testId);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
};

const advanceMotion = (milliseconds = 240): void => {
	root.renderer.flush();
	root.renderer.clockFastForward(milliseconds);
	root.renderer.flush();
	root.renderer.dispatchNativeEvents();
	root.renderer.flush();
};

const selectedTabs = () =>
	Object.values(root.renderer.getA11yTree().nodes ?? {})
		.filter((node) => node.aria?.role === "Tab" && node.aria.selected)
		.map((node) => node.aria?.label);

it("slides selection while clicks and keyboard activation take effect immediately", () => {
	root.render(<App key="smooth-tabs" initialTabCount={3} smoothTransitions />);
	const start = bounds("surface-workspace-1").x;
	const first = element("workspace-1").id;

	click("workspace-3");
	root.renderer.flush();
	expect(selectedTabs()).toEqual(["Workspace 3"]);
	expect(bounds("surface-workspace-3").x).toBe(start);
	advanceMotion(80);
	expect(bounds("surface-workspace-3").x).toBeGreaterThan(start);
	expect(bounds("surface-workspace-3").x).toBeLessThan(
		start + workspaceLayout.tabWidth * 2
	);
	root.renderer.nativeSimulateKeyDown(element("workspace-3").id, "left");
	root.renderer.flush();
	expect(selectedTabs()).toEqual(["Workspace 2"]);
	advanceMotion(250);
	expect(bounds("surface-workspace-2").x).toBeCloseTo(
		start + workspaceLayout.tabWidth
	);
	expect(element("workspace-1").id).toBe(first);
	click("workspace-home");
	root.renderer.flush();
	expect(selectedTabs()).toEqual([]);
	expect(root.renderer.findByTestId("surface-workspace-2")).toBeUndefined();
});

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
	expect(element("app-shell").style.backgroundColor).toBe("transparent");
	expect(selectedTabs()).toEqual(["1git / main"]);
	expect(windowOptions.windowBackground).toBe("blurred");
});

it("leaves 10px after the traffic lights and a compact 4px gap before the first tab", () => {
	const home = bounds("workspace-home");

	expect(home.x).toBe(workspaceLayout.desktopTitlebarControlsWidth);
	// Native traffic lights occupy 60px starting at the configured 16px inset.
	expect(home.x - (16 + 60)).toBe(10);
	expect(bounds("hover-workspace-1").x - home.x - home.width).toBe(spacing[1]);
	expect(bounds("hover-workspace-1").x - tabViewport().x).toBe(
		workspaceLayout.tabContentInsetInlineStart
	);
	expect(bounds("slot-workspace-1").x).toBe(
		tabViewport().x + workspaceLayout.tabSurfaceOutset
	);
	expect(windowOptions.trafficLightX).toBe(16);
	expect(windowOptions.trafficLightY).toBe(13);
	expect(bounds("workspace").x).toBe(6);
});

it("protects Home while scrolling without widening the resting gap or shifting tabs", () => {
	root.render(<App key="home-overflow-gap" initialTabCount={8} />);
	click("workspace-home");
	const home = bounds("workspace-home");
	const viewport = tabViewport();
	const initialTabX = bounds("slot-workspace-1").x;

	expect(bounds("hover-workspace-1").x - home.x - home.width).toBe(spacing[1]);

	root.renderer.nativeSimulateScrollWheel(
		viewport.x + 120,
		home.y + home.height / 2,
		-70,
		0
	);
	root.renderer.flush();
	expect(
		root.renderer.getScrollOffset(element("workspace-tabs").id)?.[0]
	).toBeLessThan(0);
	expect(bounds("workspace-tabs-clip").x - home.x - home.width).toBe(
		spacing[1]
	);
	const offset =
		root.renderer.getScrollOffset(element("workspace-tabs").id)?.[0] ?? 0;

	expect(bounds("slot-workspace-1").x).toBe(initialTabX + offset);
	expect(tabViewport()).toEqual(viewport);
	root.renderer.nativeSimulateClick(
		home.x + home.width - 2,
		home.y + home.height / 2
	);
	expect(selectedTabs()).toEqual([]);

	root.renderer.nativeSimulateScrollWheel(
		viewport.x + 120,
		home.y + home.height / 2,
		70,
		0
	);
	root.renderer.flush();
	expect(root.renderer.getScrollOffset(element("workspace-tabs").id)?.[0]).toBe(
		0
	);
	expect(bounds("hover-workspace-1").x - home.x - home.width).toBe(spacing[1]);
	expect(bounds("slot-workspace-1").x).toBe(initialTabX);
	expect(tabViewport()).toEqual(viewport);
});

it("gives unused titlebar space a native drag target separate from tab controls", () => {
	const empty = bounds("empty-titlebar");
	const slot = bounds("slot-workspace-1");
	const home = bounds("workspace-home");

	expect(element("empty-titlebar").customProps?.windowDrag).toBe(true);
	expect(empty.width).toBeGreaterThan(0);
	expect(empty.height).toBe(workspaceLayout.toolbarHeight);
	expect(empty.x).toBeGreaterThanOrEqual(slot.x + slot.width);
	expect(empty.x + empty.width).toBeLessThanOrEqual(
		980 - workspaceLayout.workspaceSurfaceInset
	);
	expect(home.x + home.width).toBeLessThan(slot.x);
	expect(element("workspace-home").customProps?.windowDrag).not.toBe(true);
	expect(element("close-workspace-1").customProps?.windowDrag).not.toBe(true);
});

it("aligns lightweight labels and icons without shifting when selection changes", () => {
	const avatar = bounds("avatar-workspace-1");
	const label = bounds("label-workspace-1");
	const close = bounds("close-workspace-1");
	const closeIcon = bounds("close-icon-workspace-1");
	const addIcon = bounds("workspace-home-icon");
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

	seedWorkspace();
	expect(element("name-workspace-1").style.fontWeight).toBe(500);
	expect(element("close-workspace-1").style.opacity).toBe(0);
	expect(bounds("label-workspace-1")).toEqual(label);
	expect(bounds("close-workspace-1")).toEqual(close);
});

it("reduces the upper tab inset without shrinking controls or changing bottom spacing", () => {
	expect(bounds("avatar-workspace-1").y).toBe(15);
	expect(bounds("close-icon-workspace-1").y).toBe(15);
	expect(bounds("workspace-home-icon").y).toBe(22 - iconSize.lg / 2);
	expect(bounds("workspace").y).toBe(42);
	expect(element("close-workspace-1").style.height).toBe(24);
	expect(element("workspace-home").style.height).toBe(controlSize.rail);
	const home = bounds("workspace-home");

	expect(bounds("workspace").y - home.y - home.height).toBe(spacing[1]);
	expect(windowOptions.trafficLightY).toBe(13);
});

it("matches the 4px bottom gap between neighboring tab surfaces without changing slot width", () => {
	root.render(<App key="adjacent-tabs" initialTabCount={3} />);
	const first = bounds("slot-workspace-1");
	const second = bounds("slot-workspace-2");
	const hover = bounds("hover-workspace-1");
	const nextHover = bounds("hover-workspace-2");
	const nextAvatar = bounds("avatar-workspace-2");

	expect(nextHover.x - hover.x - hover.width).toBe(4);
	expect(bounds("workspace").y - nextHover.y - nextHover.height).toBe(4);
	expect(second.x - first.x).toBe(210);
	expect(first.width).toBe(210);
	expect(hover.x - first.x).toBe(2);
	expect(hover.width).toBe(206);
	expect(nextAvatar.x - hover.x - hover.width).toBe(16);
	expect(bounds("avatar-workspace-1").x - hover.x).toBe(12);

	click("workspace-2");
	const active = bounds("surface-workspace-2");
	const thirdHover = bounds("hover-workspace-3");
	const shoulder = workspaceLayout.tabContentInsetInlineStart;

	expect(active.x + shoulder - hover.x - hover.width).toBe(4);
	expect(thirdHover.x - (active.x + active.width - shoulder)).toBe(4);
});

it("keeps the first active tab's entire curved surface inside the scroll viewport", () => {
	root.render(<App key="first-tab-curve" initialTabCount={8} />);
	const viewport = tabViewport();
	const surface = bounds("surface-workspace-1");

	expect(surface.x).toBeGreaterThanOrEqual(viewport.x);
	expect(surface.x).toBeLessThan(bounds("slot-workspace-1").x);
	expect(surface.y + surface.height).toBe(bounds("workspace").y);
});

it("reveals both curved shoulders when selecting overflow tabs at either edge", () => {
	root.render(<App key="overflow-tab-curves" initialTabCount={8} />);
	const viewport = tabViewport();

	root.renderer.nativeSimulateKeyDown(element("workspace-1").id, "end");
	root.renderer.flush();
	const last = bounds("surface-workspace-8");

	expect(last.x + last.width).toBeLessThanOrEqual(viewport.x + viewport.width);
	root.renderer.scrollTo(element("workspace-tabs").id, -430, 0);
	click("workspace-3");
	advanceMotion();
	expect(selectedTabs()).toEqual(["Workspace 3"]);
	expect(bounds("surface-workspace-3").x).toBeGreaterThanOrEqual(viewport.x);
	root.renderer.simulateKeystrokes("home");
	root.renderer.flush();
	expect(bounds("surface-workspace-1").x).toBeGreaterThanOrEqual(viewport.x);
	expect(bounds("slot-workspace-1").x).toBe(
		viewport.x + workspaceLayout.tabSurfaceOutset
	);
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

it("focuses Home then the first tab without outlines when Tab enters the window", () => {
	root.renderer.simulateKeystrokes("tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("workspace-home").id
	);
	expect(element("workspace-home").style.borderColor).toBe("transparent");
	root.renderer.simulateKeystrokes("tab");
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-1").id);
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("workspace-1").id, eventType: "focus" },
			root.renderer
		)
	);
	expect(element("workspace-1").style.borderColor).toBe("transparent");
});

it("clips the full repository and branch track clear of the close target", () => {
	const name = "an-extremely-long-repository-name-that-needs-truncation";
	const branch = "feature/this-is-a-long-branch-name";

	root.render(
		<WorkspaceTabs
			state={{
				preview: true,
				tabs: [
					{
						kind: "repository",
						id: "long",
						name,
						branch,
						workspace: RepositoryWorkspaceModel.create(),
					},
				],
				activeId: "long",
				nextId: 2,
			}}
			dispatch={() => {}}
		/>
	);
	const repository = bounds("name-long");
	const branchLabel = bounds("branch-long");
	const viewport = bounds("label-long");
	const close = bounds("close-long");

	expect(repository.y).toBe(branchLabel.y);
	expect(repository.x + repository.width).toBeLessThanOrEqual(branchLabel.x);
	expect(viewport.x + viewport.width).toBeLessThan(close.x);
	expect(repository.width + branchLabel.width).toBeGreaterThan(viewport.width);
	expect(element("label-long").style.overflow).toBe("hidden");
	expect(element("name-long").style.textOverflow).toBeUndefined();
	expect(element("branch-long").style.textOverflow).toBeUndefined();
	expect(selectedTabs()).toEqual([`${name} / ${branch}`]);
});

it("activates opened tabs without closing them and focuses Home after the last close", () => {
	seedWorkspace();
	expect(selectedTabs()).toEqual(["Workspace 2"]);
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-2").id);
	click("workspace-1");
	expect(selectedTabs()).toEqual(["1git / main"]);
	click("close-workspace-2");
	expect(selectedTabs()).toEqual(["1git / main"]);
	click("close-workspace-1");
	expect(selectedTabs()).toEqual([]);
	expect(root.renderer.getFocusedElementId()).toBe(
		element("workspace-home").id
	);
	root.renderer.nativeSimulateKeyDown(element("workspace-home").id, "space");
	root.renderer.nativeSimulateKeyUp(element("workspace-home").id, "space");
	expect(selectedTabs()).toEqual([]);
	expect(root.renderer.findByTestId("workspace-3")).toBeUndefined();
});

it("moves selection with arrows and Home/End and closes using Delete", () => {
	seedWorkspace();
	seedWorkspace();
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
	expect(root.renderer.getFocusedElementId()).toBe(
		element("workspace-home").id
	);
	root.renderer.simulateKeystrokes("shift-tab");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("close-workspace-2").id
	);
});

it("keeps outlines hidden for pointer and keyboard tab navigation", () => {
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
	expect(element("close-workspace-1").style.borderColor).toBe("transparent");
	expect(root.renderer.getFocusedElementId()).toBe(
		element("close-workspace-1").id
	);

	seedWorkspace();
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
	expect(element("workspace-1").style.borderColor).toBe("transparent");
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-1").id);

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
			{ elementId: element("workspace-home").id, eventType: "focus" },
			root.renderer
		)
	);
	expect(element("workspace-home").style.borderColor).toBe("transparent");
	root.renderer.nativeSimulateKeyDown(element("workspace-home").id, "space");
	expect(element("workspace-home").style.borderColor).toBe("transparent");
	root.renderer.nativeSimulateKeyUp(element("workspace-home").id, "space");
	expect(selectedTabs()).toEqual([]);
	expect(root.renderer.findByTestId("workspace-3")).toBeUndefined();
});

it("scrolls overflowing tabs into view while keeping Home fixed and reachable", () => {
	const home = bounds("workspace-home");

	for (let index = 0; index < 8; index += 1) seedWorkspace();

	const strip = bounds("workspace-tabs");
	const viewportLeft = tabViewport().x;
	const active = bounds("workspace-9");

	expect(bounds("workspace-home")).toEqual(home);
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

it("reveals newly opened tabs in an overflowing preview strip", () => {
	root.render(<App key="multi-tab-preview" initialTabCount={8} />);
	const strip = bounds("workspace-tabs");

	expect(element("workspace-8")).toBeDefined();
	expect(bounds("workspace-8").x).toBeGreaterThan(strip.x + strip.width);
	expect(selectedTabs()).toEqual(["1git / main"]);

	seedWorkspace();
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
	seedWorkspace();
	seedWorkspace();
	const first = bounds("workspace-1");
	const x = first.x + 20;
	const y = first.y + first.height / 2;
	const id = element("workspace-1").id;

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 2, y, 0);
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);
	root.renderer.nativeSimulateMouseMove(x + 420, y, 0);
	advanceMotion();
	expect(order()).toEqual(["workspace-2", "workspace-3", "workspace-1"]);
	expect(element("workspace-1").id).toBe(id);
	expect(selectedTabs()).toEqual(["1git / main"]);
	root.renderer.nativeSimulateMouseUp(x + 420, 300);
	expect(order()).toEqual(["workspace-2", "workspace-3", "workspace-1"]);
	advanceMotion();

	click("workspace-2");
	expect(selectedTabs()).toEqual(["Workspace 2"]);
});

it("cancels the preview on Escape and keeps close/Home controls out of a tab drag", () => {
	seedWorkspace();
	seedWorkspace();
	const first = bounds("workspace-1");
	const x = first.x + 20;
	const y = first.y + first.height / 2;

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 420, y, 0);
	root.renderer.nativeSimulateKeyDown(element("workspace-1").id, "escape");
	advanceMotion();
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);
	const close = bounds("close-workspace-3");

	root.renderer.nativeSimulateMouseUp(close.x + 12, close.y + 12);
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 420, y, 0);
	const add = bounds("workspace-home");

	root.renderer.nativeSimulateMouseUp(add.x + 12, add.y + 12);
	advanceMotion();
	expect(root.renderer.findByTestId("workspace-4")).toBeUndefined();
	click("close-workspace-2");
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
});

it("does not reorder when a drag starts on close or with a non-primary button", () => {
	seedWorkspace();
	seedWorkspace();
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
	seedWorkspace();
	seedWorkspace();
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
	advanceMotion();
	expect(order()).toEqual(["workspace-2", "workspace-3", "workspace-1"]);
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("workspace-1").id, eventType: "blur" },
			root.renderer
		)
	);
	root.renderer.nativeSimulateMouseUp(x + 420, 300);
	advanceMotion();
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);
});

it("reorders from the padded tab surface and with Shift+Arrow, keeping focus", () => {
	seedWorkspace();
	seedWorkspace();
	const slot = bounds("slot-workspace-1");

	root.renderer.nativeSimulateMouseDown(slot.x + 40, slot.y + 2);
	root.renderer.nativeSimulateMouseMove(slot.x + 250, slot.y + 2, 0);
	root.renderer.nativeSimulateMouseUp(slot.x + 250, 300);
	advanceMotion();
	expect(order()).toEqual(["workspace-2", "workspace-1", "workspace-3"]);
	root.renderer.simulateKeystrokes("shift-right");
	advanceMotion();
	expect(order()).toEqual(["workspace-2", "workspace-3", "workspace-1"]);
	expect(root.renderer.getFocusedElementId()).toBe(element("workspace-1").id);
	root.renderer.simulateKeystrokes("shift-right");
	advanceMotion();
	expect(order()).toEqual(["workspace-2", "workspace-3", "workspace-1"]);
	root.renderer.simulateKeystrokes("shift-left");
	advanceMotion();
	expect(order()).toEqual(["workspace-2", "workspace-1", "workspace-3"]);
});

it("keeps clicks and small pointer movements stationary before a tab drag starts", () => {
	root.render(<App key="click-without-drag" initialTabCount={3} />);
	const first = bounds("slot-workspace-1");
	const x = first.x + 40;
	const y = first.y + 12;

	root.renderer.nativeSimulateMouseDown(x, y);
	expect(bounds("slot-workspace-1")).toEqual(first);

	for (const distance of [2, -3, 7]) {
		root.renderer.nativeSimulateMouseMove(x + distance, y, 0);
		advanceMotion();
		expect(bounds("slot-workspace-1")).toEqual(first);
		expect(element("workspace-1").style.cursor).toBe("grab");
	}

	root.renderer.nativeSimulateMouseUp(x + 7, y);
	advanceMotion();
	expect(bounds("slot-workspace-1")).toEqual(first);
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 8, y, 0);
	expect(bounds("slot-workspace-1").x).toBe(first.x + 8);
	expect(element("workspace-1").style.cursor).toBe("grabbing");
	root.renderer.nativeSimulateMouseUp(x + 8, 300);
	advanceMotion();
	expect(bounds("slot-workspace-1")).toEqual(first);
});

it("follows the pointer immediately, slides neighbors, and settles on release", () => {
	root.render(<App key="animated-drag" initialTabCount={3} />);
	const first = bounds("slot-workspace-1");
	const second = bounds("slot-workspace-2");
	const x = first.x + 40;
	const y = first.y + 12;
	const id = element("workspace-1").id;

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 2, y, 0);
	expect(bounds("slot-workspace-1").x).toBe(first.x);
	root.renderer.nativeSimulateMouseMove(x + 40, y, 0);
	expect(bounds("slot-workspace-1").x).toBe(first.x + 40);
	expect(bounds("slot-workspace-2").x).toBe(second.x);
	root.renderer.nativeSimulateMouseMove(x + 150, y, 0);
	expect(bounds("slot-workspace-1").x).toBe(first.x + 150);
	expect(bounds("slot-workspace-2").x).toBe(second.x);
	advanceMotion(60);
	expect(bounds("slot-workspace-2").x).toBeGreaterThan(first.x);
	expect(bounds("slot-workspace-2").x).toBeLessThan(second.x);
	expect(bounds("slot-workspace-1").x).toBe(first.x + 150);
	advanceMotion(180);
	expect(bounds("slot-workspace-2").x).toBe(first.x);

	root.renderer.nativeSimulateMouseUp(x + 150, y);
	expect(bounds("slot-workspace-1").x).toBe(first.x + 150);
	advanceMotion(60);
	expect(bounds("slot-workspace-1").x).toBeGreaterThan(first.x + 150);
	expect(bounds("slot-workspace-1").x).toBeLessThan(second.x);
	advanceMotion(180);
	expect(bounds("slot-workspace-1").x).toBe(second.x);
	expect(order()).toEqual(["workspace-2", "workspace-1", "workspace-3"]);
	expect(element("workspace-1").id).toBe(id);
	expect(selectedTabs()).toEqual(["1git / main"]);
});

it("retargets sliding neighbors from their visible positions and animates Escape home", () => {
	root.render(<App key="animated-cancel" initialTabCount={3} />);
	const first = bounds("slot-workspace-1");
	const second = bounds("slot-workspace-2");
	const x = first.x + 40;
	const y = first.y + 12;

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 150, y, 0);
	advanceMotion(60);
	const neighborDuringSlide = bounds("slot-workspace-2").x;

	root.renderer.nativeSimulateMouseMove(x + 40, y, 0);
	expect(bounds("slot-workspace-2").x).toBe(neighborDuringSlide);
	advanceMotion(60);
	expect(bounds("slot-workspace-2").x).toBeGreaterThan(neighborDuringSlide);
	expect(bounds("slot-workspace-2").x).toBeLessThan(second.x);
	root.renderer.nativeSimulateKeyDown(element("workspace-1").id, "escape");
	expect(bounds("slot-workspace-1").x).toBe(first.x + 40);
	advanceMotion(60);
	expect(bounds("slot-workspace-1").x).toBeGreaterThan(first.x);
	expect(bounds("slot-workspace-1").x).toBeLessThan(first.x + 40);
	advanceMotion(180);
	expect(bounds("slot-workspace-1").x).toBe(first.x);
	expect(bounds("slot-workspace-2").x).toBe(second.x);
	root.renderer.nativeSimulateMouseUp(x + 40, y);
	expect(order()).toEqual(["workspace-1", "workspace-2", "workspace-3"]);
});

it("grabs a settling tab at its visible position without jumping to the destination", () => {
	root.render(<App key="interrupt-settle" initialTabCount={3} />);
	const first = bounds("slot-workspace-1");
	const x = first.x + 40;
	const y = first.y + 12;

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x + 150, y, 0);
	root.renderer.nativeSimulateMouseUp(x + 150, y);
	advanceMotion(60);
	const duringSettle = bounds("slot-workspace-1").x;

	root.renderer.nativeSimulateMouseDown(duringSettle + 40, y);
	advanceMotion();
	expect(bounds("slot-workspace-1").x).toBe(duringSettle);
	root.renderer.nativeSimulateMouseMove(duringSettle + 42, y, 0);
	expect(bounds("slot-workspace-1").x).toBe(duringSettle);
	root.renderer.nativeSimulateMouseMove(duringSettle + 60, y, 0);
	expect(bounds("slot-workspace-1").x).toBe(duringSettle + 20);
	root.renderer.nativeSimulateMouseUp(duringSettle + 60, 300);
	advanceMotion();
	expect(bounds("slot-workspace-1").x).toBe(first.x + workspaceLayout.tabWidth);
	expect(order()).toEqual(["workspace-2", "workspace-1", "workspace-3"]);
});

it("keeps scrolled drag coordinates stable and reveals the whole tab after settling", () => {
	root.render(<App key="scrolled-drag" initialTabCount={8} />);
	root.renderer.nativeSimulateKeyDown(element("workspace-1").id, "end");
	root.renderer.flush();
	const last = bounds("slot-workspace-8");
	const stripId = element("workspace-tabs").id;
	const offset = root.renderer.getScrollOffset(stripId)?.[0];
	const x = last.x + 40;
	const y = last.y + 12;

	expect(offset).toBeLessThan(0);

	root.renderer.nativeSimulateMouseDown(x, y);
	root.renderer.nativeSimulateMouseMove(x - 150, y, 0);
	expect(bounds("slot-workspace-8").x).toBe(last.x - 150);
	root.renderer.nativeSimulateMouseUp(x - 150, 300);
	expect(bounds("slot-workspace-8").x).toBe(last.x - 150);
	expect(root.renderer.getScrollOffset(stripId)?.[0]).toBe(offset);
	advanceMotion();
	expect(bounds("slot-workspace-8").x).toBe(last.x - workspaceLayout.tabWidth);
	expect(bounds("slot-workspace-7").x).toBe(last.x);
	expect(selectedTabs()).toEqual(["Workspace 8"]);
	const viewportLeft = tabViewport().x;

	expect(bounds("slot-workspace-8").x).toBeGreaterThanOrEqual(viewportLeft);
	const close = bounds("close-workspace-8");

	expect(close.x + close.width).toBeLessThanOrEqual(
		viewportLeft + bounds("workspace-tabs").width
	);
});

it("autoscrolls during an overflow drag and stops after release", async () => {
	for (let index = 0; index < 8; index += 1) seedWorkspace();

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
	advanceMotion();
	const viewportLeft = tabViewport().x;

	expect(bounds("slot-workspace-9").x).toBeGreaterThanOrEqual(viewportLeft);
	const close = bounds("close-workspace-9");

	expect(close.x + close.width).toBeLessThanOrEqual(
		viewportLeft + bounds("workspace-tabs").width
	);
});

it("keeps the outline hidden and cancels Space activation after blur", () => {
	seedWorkspace();
	const first = element("workspace-1");

	root.renderer.nativeSimulateKeyDown(first.id, "space");
	// Offscreen windows have focus handles but do not emit active-window focus notifications.
	flushSync(() =>
		handleGpuixEvent({ elementId: first.id, eventType: "focus" }, root.renderer)
	);
	expect(element("workspace-1").style.borderColor).toBe("transparent");
	flushSync(() =>
		handleGpuixEvent({ elementId: first.id, eventType: "blur" }, root.renderer)
	);
	root.renderer.nativeSimulateKeyUp(first.id, "space");
	expect(selectedTabs()).toEqual(["Workspace 2"]);
	expect(element("workspace-1").style.borderColor).toBe("transparent");
});

it("renders empty and Settings tabs, then closes the Settings singleton", () => {
	root.render(<KindJourneyApp />);
	root.renderer.flush();

	expect(element("avatar-workspace-1")).toBeDefined();
	expect(element("avatar-workspace-2")).toBeDefined();
	expect(element("workspace-2").customProps?.["aria-label"]).toBe("Settings");
	expect(selectedTabs()).toEqual(["Settings"]);

	click("close-workspace-2");
	root.renderer.flush();

	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
	expect(selectedTabs()).toEqual(["Welcome"]);
});
