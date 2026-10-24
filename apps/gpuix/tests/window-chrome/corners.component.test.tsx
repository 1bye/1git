/**
 * Covers: animated tab-edge connection and rounded clipping of children and native diff rows.
 * Real: AppShell, WorkspaceTabs, DiffView, native animation, painting and screenshot pixels.
 * Doubles: sample workspace records and inline patches; decorative grain hidden for exact clip colors.
 * Requires: patched GPUIX and macOS graphics.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { DiffView } from "@1git/gpuix-ui/diff-view";
import { workspaceLayout } from "@1git/design-tokens";
import { useReducer } from "react";
import { AppShell } from "../../src/fixture/app-shell";
import { WorkspaceTabs } from "../../src/feature/workspace-tabs/workspace-tabs";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import { workspaceLayout as nativeLayout } from "../../src/styles/workspace-layout";

let root: TestRoot;
let directory: string;

beforeEach(async () => {
	root = createTestRoot({ width: 400, height: 240 });
	root.renderer.clockPause();
	directory = await mkdtemp(join(tmpdir(), "1git-corners-"));
});

function TabbedShell({ tabCount = 2 }: { tabCount?: number }) {
	const [state, dispatch] = useReducer(
		WorkspaceTabsModel.reduce,
		tabCount,
		(count) => WorkspaceTabsModel.create(count, true)
	);

	return (
		<div style={{ width: "100%", height: "100%", backgroundColor: "#223344" }}>
			<AppShell
				toolbar={<WorkspaceTabs state={state} dispatch={dispatch} />}
				workspaceLabel="Test"
			>
				<div style={{ flexGrow: 1, backgroundColor: "#ff0000" }} />
			</AppShell>
		</div>
	);
}

it("joins the rightmost active tab to the workspace and restores rounding on Home", async () => {
	root.render(<TabbedShell />);
	const rounded = await rightCornerPaintedPixels();
	const first = root.renderer.findByTestId("workspace-1");

	if (!first) throw new Error("Missing first tab");

	root.renderer.nativeSimulateKeyDown(first.id, "end");
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	expect(await rightCornerPaintedPixels()).toBe(rounded);
	root.renderer.clockFastForward(30);
	root.renderer.flush();
	const blending = await rightCornerPaintedPixels();

	root.renderer.clockFastForward(210);
	root.renderer.flush();
	const joined = await rightCornerPaintedPixels();

	expect(blending).toBeGreaterThan(rounded);
	expect(blending).toBeLessThan(joined);
	let sample = await pixels();

	expect(
		sample.color(sample.bounds.x + sample.bounds.width - 2, sample.bounds.y + 1)
	).toEqual([255, 0, 0]);
	expect(
		sample.color(
			sample.bounds.x + sample.bounds.width - 2,
			sample.bounds.y + sample.bounds.height - 2
		)
	).toEqual([34, 51, 68]);

	const home = root.renderer.findByTestId("workspace-home");
	const box = home && root.renderer.getElementBounds(home.id);

	if (!box) throw new Error("Missing Home button");

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	sample = await pixels();
	expect(
		sample.color(sample.bounds.x + sample.bounds.width - 2, sample.bounds.y + 1)
	).toEqual([34, 51, 68]);
	expect(await rightCornerPaintedPixels()).toBe(rounded);
});

it("keeps the corner joined when the active tab is clipped at the right edge", async () => {
	root.render(<TabbedShell />);
	const first = root.renderer.findByTestId("workspace-1");

	if (!first) throw new Error("Missing first tab");

	root.renderer.nativeSimulateKeyDown(first.id, "end");
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	const joined = await rightCornerPaintedPixels();

	root.renderer.nativeSimulateScrollWheel(250, 20, 60, 0);
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	const tab = root.renderer.findByTestId("surface-workspace-2");
	const tabBounds = tab && root.renderer.getElementBounds(tab.id);
	const { bounds } = await pixels();

	if (!tabBounds) throw new Error("Missing active tab surface");

	expect(tabBounds.x).toBeLessThan(bounds.x + bounds.width);
	expect(tabBounds.x + tabBounds.width).toBeGreaterThan(
		bounds.x + bounds.width
	);
	expect(await rightCornerPaintedPixels()).toBe(joined);
});

it("clips the tab strip's outer top-right corner without reopening the workspace seam", async () => {
	root.render(<TabbedShell />);
	const first = root.renderer.findByTestId("workspace-1");

	if (!first) throw new Error("Missing first tab");

	root.renderer.nativeSimulateKeyDown(first.id, "end");
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	root.renderer.nativeSimulateScrollWheel(250, 20, 60, 0);
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	const { bounds, color } = await pixels();
	const right = bounds.x + bounds.width;
	const top = bounds.y - nativeLayout.tabHeight;

	expect(color(right - 2, top + 1)).toEqual([34, 51, 68]);
	expect(color(right - 20, top + 10)).toEqual([255, 255, 255]);
	expect(color(right - 2, bounds.y + 1)).toEqual([255, 0, 0]);
});

it("restores the corner when the active tab moves left of the right edge", async () => {
	root.render(<TabbedShell tabCount={3} />);
	const rounded = await rightCornerPaintedPixels();
	const first = root.renderer.findByTestId("workspace-1");

	if (!first) throw new Error("Missing first tab");

	root.renderer.nativeSimulateKeyDown(first.id, "right");
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	const joined = await rightCornerPaintedPixels();

	expect(root.renderer.findByTestId("surface-workspace-2")).toBeDefined();
	expect(joined).toBeGreaterThan(rounded);

	root.renderer.nativeSimulateScrollWheel(250, 20, -60, 0);
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	expect(await rightCornerPaintedPixels()).toBeLessThan(joined);
});

it("does not join a tab that has scrolled entirely beyond the right edge", async () => {
	root.render(<TabbedShell tabCount={3} />);
	const rounded = await rightCornerPaintedPixels();
	const first = root.renderer.findByTestId("workspace-1");

	if (!first) throw new Error("Missing first tab");

	root.renderer.nativeSimulateKeyDown(first.id, "end");
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	expect(await rightCornerPaintedPixels()).toBeGreaterThan(rounded);

	root.renderer.nativeSimulateScrollWheel(250, 20, 600, 0);
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	expect(await rightCornerPaintedPixels()).toBe(rounded);
});

it("restores the corner after closing the last tab at the window edge", async () => {
	root.render(<TabbedShell />);
	const rounded = await rightCornerPaintedPixels();
	const first = root.renderer.findByTestId("workspace-1");

	if (!first) throw new Error("Missing first tab");

	root.renderer.nativeSimulateKeyDown(first.id, "end");
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	expect(await rightCornerPaintedPixels()).toBeGreaterThan(rounded);

	const last = root.renderer.findByTestId("workspace-2");

	if (!last) throw new Error("Missing last tab");

	root.renderer.nativeSimulateKeyDown(last.id, "delete");
	await new Promise<void>((resolve) => setImmediate(resolve));
	root.renderer.flush();
	root.renderer.clockFastForward(240);
	root.renderer.flush();
	expect(root.renderer.findByTestId("workspace-2")).toBeUndefined();
	expect(await rightCornerPaintedPixels()).toBe(rounded);
});

afterEach(async () => {
	root.unmount();
	await rm(directory, { recursive: true, force: true });
});

async function pixels() {
	const path = join(directory, "workspace.png");
	const grain = root.renderer.findByTestId("repository-chrome-grain");

	// Check clip colors independently of the decorative noise behind the corners.
	if (grain)
		root.renderer.applyBatch(
			JSON.stringify([["setStyle", grain.id, { ...grain.style, opacity: 0 }]])
		);

	root.renderer.captureScreenshot(path);
	const { data, info } = await sharp(path)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const node = root.renderer.findByTestId("workspace");
	const bounds = node && root.renderer.getElementBounds(node.id);

	if (!bounds) throw new Error("Missing workspace bounds");

	const scale = info.width / 400;

	const color = (x: number, y: number) => {
		const offset =
			(Math.floor(y * scale) * info.width + Math.floor(x * scale)) * 4;

		return [...data.subarray(offset, offset + 3)];
	};

	return { bounds, color };
}

async function rightCornerPaintedPixels(): Promise<number> {
	const { bounds, color } = await pixels();
	let count = 0;

	for (let x = 1; x <= workspaceLayout.workspaceSurfaceRadius; x += 1) {
		for (let y = 1; y <= workspaceLayout.workspaceSurfaceRadius; y += 1) {
			const pixel = color(bounds.x + bounds.width - x - 1, bounds.y + y);

			if (pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 0) count += 1;
		}
	}

	return count;
}

function show(diff: boolean) {
	const lines = Array.from(
		{ length: 60 },
		(_, index) => `+line ${index} ${"x".repeat(100)}`
	).join("\n");

	root.render(
		<div style={{ width: "100%", height: "100%", backgroundColor: "#223344" }}>
			<AppShell
				toolbar={<div style={{ height: 30, flexShrink: 0 }} />}
				workspaceLabel="Test"
			>
				{diff ? (
					<DiffView
						testId="corner-diff"
						aria-label="Changes"
						showFileHeader={false}
						patch={`diff --git a/test.txt b/test.txt\n--- /dev/null\n+++ b/test.txt\n@@ -0,0 +1,60 @@\n${lines}\n`}
						theme={{
							appearance: "light",
							fontMono: "Menlo",
							diffAddBg: "#ff0000",
						}}
					/>
				) : (
					<div style={{ flexGrow: 1, backgroundColor: "#ff0000" }} />
				)}
			</AppShell>
		</div>
	);
}

it("clips child painting at all four workspace corners without hiding its interior", async () => {
	show(false);
	const { bounds, color } = await pixels();

	for (const x of [bounds.x + 1, bounds.x + bounds.width - 2]) {
		for (const y of [bounds.y + 1, bounds.y + bounds.height - 2]) {
			expect(color(x, y)).toEqual([34, 51, 68]);
		}
	}

	expect(
		color(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
	).toEqual([255, 0, 0]);
});

it("keeps native diff rows inside the rounded corner after vertical and horizontal scrolling", async () => {
	show(true);
	const viewport = root.renderer.findByTestId("corner-diff");

	if (!viewport) throw new Error("Missing diff viewport");

	root.renderer.scrollTo(viewport.id, -300, 0);
	root.renderer.nativeSimulateScrollWheel(200, 160, 0, -650);
	root.renderer.flush();
	const { bounds, color } = await pixels();

	expect(
		color(bounds.x + bounds.width - 2, bounds.y + bounds.height - 2)
	).toEqual([34, 51, 68]);
	expect(
		color(bounds.x + bounds.width - 30, bounds.y + bounds.height - 20)
	).toEqual([255, 0, 0]);
});

it("updates clips when rounding changes and leaves visible overflow unclipped", async () => {
	for (const [radius, hidden, expected] of [
		[40, true, [34, 51, 68]],
		[8, true, [255, 0, 0]],
		[40, false, [255, 0, 0]],
	] as const) {
		root.render(
			<div
				style={{ width: "100%", height: "100%", backgroundColor: "#223344" }}
			>
				<div
					testId="workspace"
					style={{
						width: 300,
						height: 180,
						margin: 20,
						display: "flex",
						backgroundColor: "#ffffff",
						borderRadius: radius,
						overflow: hidden ? "hidden" : "visible",
					}}
				>
					<div style={{ flexGrow: 1, backgroundColor: "#ff0000" }} />
				</div>
			</div>
		);
		const { bounds, color } = await pixels();

		expect(color(bounds.x + 11, bounds.y + 11)).toEqual([...expected]);
	}
});
