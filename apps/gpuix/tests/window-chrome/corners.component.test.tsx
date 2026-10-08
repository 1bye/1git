/**
 * Covers: rounded workspace clipping of colored children and native diff rows.
 * Real: AppShell, DiffView, native painting and screenshot pixels.
 * Doubles: inline patches. Requires: patched GPUIX and macOS graphics.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { DiffView } from "@1git/gpuix-ui/diff-view";
import { AppShell } from "../../src/fixture/app-shell";

let root: TestRoot;
let directory: string;

beforeEach(async () => {
	root = createTestRoot({ width: 400, height: 240 });
	directory = await mkdtemp(join(tmpdir(), "1git-corners-"));
});

afterEach(async () => {
	root.unmount();
	await rm(directory, { recursive: true, force: true });
});

async function pixels() {
	const path = join(directory, "workspace.png");

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
