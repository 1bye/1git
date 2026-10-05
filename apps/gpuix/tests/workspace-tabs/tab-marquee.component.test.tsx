/**
 * Covers: full fixed-width tab labels, delayed overflow-only hover/focus reveal, and reset/suppression.
 * Real: workspace tab, avatar, native text measurement, clipping, motion, and pointer events.
 * Doubles: preview repository record and focus notifications for the offscreen window.
 * Requires: GPUIX native test renderer with macOS or Windows graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { Profiler } from "react";

import { WorkspaceTab } from "../../src/feature/workspace-tabs/components/workspace-tab";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import { workspaceLayout } from "../../src/styles/workspace-layout";

let root: TestRoot;
let commits = 0;
const name = "05-linked-worktree-with-a-long-repository-name";
const branch = "feature/a-long-branch-name-with-an-important-suffix";
const noop = (): void => {};

function App({
	repositoryName = name,
	branchName = branch,
	dragging = false,
	menuOpen = false,
}: {
	repositoryName?: string;
	branchName?: string;
	dragging?: boolean;
	menuOpen?: boolean;
}) {
	const sample = WorkspaceTabsModel.create(1, true).tabs[0];

	if (!sample) throw new Error("Missing preview tab");

	return (
		<Profiler
			id="tab-marquee"
			onRender={() => {
				commits += 1;
			}}
		>
			<div style={{ position: "relative", width: 700, height: 300 }}>
				<WorkspaceTab
					tab={{ ...sample, name: repositoryName, branch: branchName }}
					active
					left={20}
					dragging={dragging}
					menuOpen={menuOpen}
					tabRef={null}
					onPointerDown={noop}
					onTabMouseDown={noop}
					onTabMouseMove={noop}
					onTabMouseUp={noop}
					onCancelDrag={noop}
					onMotionComplete={noop}
					onKeyboardInput={noop}
					onActivate={noop}
					onClose={noop}
					onNavigate={noop}
					onReorder={noop}
				/>
			</div>
		</Profiler>
	);
}

beforeEach(() => {
	root = createTestRoot({ width: 700, height: 300 });
	root.renderer.clockPause();
	commits = 0;
	root.render(<App />);
});
afterEach(() => root.unmount());

function element(testId: string) {
	const found = root.renderer.findByTestId(`${testId}-workspace-1`);

	if (!found) throw new Error(`Missing ${testId}`);

	return found;
}

function bounds(testId: string) {
	const found = root.renderer.getElementBounds(element(testId).id);

	if (!found) throw new Error(`Missing bounds for ${testId}`);

	return found;
}

function advance(milliseconds: number): void {
	root.renderer.flush();
	root.renderer.clockFastForward(milliseconds);
	root.renderer.flush();
	root.renderer.dispatchNativeEvents();
	root.renderer.flush();
}

function hover(): void {
	const box = bounds("label");

	root.renderer.nativeSimulateMouseMove(box.x + 10, box.y + box.height / 2);
}

it("keeps the complete repository and branch on one clipped, fixed-width track", () => {
	expect(bounds("slot").width).toBe(workspaceLayout.tabWidth);
	expect(root.renderer.getAllText()).toContain(name);
	expect(root.renderer.getAllText()).toContain(` / ${branch}`);
	expect(element("name").style.textOverflow).toBeUndefined();
	expect(element("branch").style.textOverflow).toBeUndefined();
	expect(bounds("name").width).toBeGreaterThan(bounds("label").width);
	expect(bounds("branch").x).toBe(bounds("name").x + bounds("name").width);
	expect(bounds("name").y).toBe(bounds("branch").y);
	const screenshot = process.env.GPUIX_TAB_MARQUEE_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(`${screenshot}-rest.png`);
});

it("waits before revealing the suffix natively without moving the avatar or close button", () => {
	const viewport = bounds("label");
	const avatar = bounds("avatar");
	const close = bounds("close");
	const start = bounds("name").x;

	hover();
	advance(300);
	expect(bounds("name").x).toBe(start);
	const beforeAnimation = commits;

	advance(400);
	expect(bounds("name").x).toBeLessThan(start);
	advance(2300);
	const suffix = bounds("branch");

	expect(
		Math.abs(suffix.x + suffix.width - viewport.x - viewport.width)
	).toBeLessThanOrEqual(1);
	expect(bounds("label")).toEqual(viewport);
	expect(bounds("avatar")).toEqual(avatar);
	expect(bounds("close")).toEqual(close);
	expect(commits).toBe(beforeAnimation);
	const screenshot = process.env.GPUIX_TAB_MARQUEE_SCREENSHOT;

	if (screenshot) root.renderer.captureScreenshot(`${screenshot}-hover.png`);

	root.renderer.nativeSimulateMouseMove(600, 200);
	advance(250);
	expect(bounds("name").x).toBe(start);
});

it("does not animate labels that already fit or briefly hovered labels", () => {
	const start = bounds("name").x;

	hover();
	advance(100);
	root.renderer.nativeSimulateMouseMove(600, 200);
	advance(3000);
	expect(bounds("name").x).toBe(start);
	root.render(<App repositoryName="1git" branchName="main" />);
	hover();
	advance(3000);
	expect(bounds("name").x).toBe(bounds("label").x);
});

it("reveals with keyboard focus and returns while dragging or showing the branch menu", () => {
	const tab = root.renderer.findByTestId("workspace-1");

	if (!tab) throw new Error("Missing tab trigger");

	flushSync(() =>
		handleGpuixEvent({ elementId: tab.id, eventType: "focus" }, root.renderer)
	);
	advance(3000);
	expect(bounds("name").x).toBeLessThan(bounds("label").x);
	root.render(<App dragging />);
	advance(250);
	expect(bounds("name").x).toBe(bounds("label").x);
	root.render(<App menuOpen />);
	advance(3000);
	expect(bounds("name").x).toBe(bounds("label").x);
	root.render(<App />);
	advance(3000);
	expect(bounds("name").x).toBeLessThan(bounds("label").x);
	flushSync(() =>
		handleGpuixEvent({ elementId: tab.id, eventType: "blur" }, root.renderer)
	);
	advance(250);
	expect(bounds("name").x).toBe(bounds("label").x);
});

it("remeasures when the branch changes while the pointer stays over the tab", () => {
	hover();
	advance(3000);
	root.render(<App repositoryName="1git" branchName="main" />);
	advance(3000);
	expect(bounds("name").x).toBe(bounds("label").x);
	root.render(<App />);
	advance(3000);
	expect(bounds("name").x).toBeLessThan(bounds("label").x);
});
