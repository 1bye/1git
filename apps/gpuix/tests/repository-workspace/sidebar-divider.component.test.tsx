/**
 * Covers: one visible sidebar boundary across the full resize hit area.
 * Real: native GPUIX painting, sidebar layout and screenshot pixels.
 * Doubles: plain white content; no Git or user files.
 * Requires: patched GPUIX renderer and macOS graphics access.
 */
import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createTestRoot } from "@gpuix/react/testing";
import { ResizableSidebar } from "../../src/fixture/resizable-sidebar";

it("paints a single boundary instead of a second line inside the resize handle", async () => {
	const directory = mkdtempSync(join(tmpdir(), "1git-sidebar-divider-"));
	const root = createTestRoot({ width: 640, height: 300 });

	try {
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
				<ResizableSidebar
					testId="sidebar"
					label="Sidebar"
					width={310}
					minWidth={240}
					maxWidth={600}
				>
					<div style={{ flexGrow: 1 }} />
				</ResizableSidebar>
				<div style={{ flexGrow: 1 }} />
			</div>
		);
		const sidebar = root.renderer.findByTestId("sidebar");
		const bounds = sidebar && root.renderer.getElementBounds(sidebar.id);

		if (!bounds) throw new Error("Missing sidebar bounds");

		const path = join(directory, "divider.png");

		root.renderer.captureScreenshot(path);
		const { data, info } = await sharp(path)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		const scale = info.width / 640;
		const right = Math.round((bounds.x + bounds.width) * scale);
		const y = Math.round(100 * scale);
		let paintedColumns = 0;

		for (let x = right - 8 * scale; x < right; x++) {
			const offset = (y * info.width + x) * 4;

			if ([0, 1, 2].some((channel) => (data[offset + channel] ?? 255) < 250))
				paintedColumns++;
		}

		expect(paintedColumns).toBe(scale);
	} finally {
		root.unmount();
		rmSync(directory, { recursive: true, force: true });
	}
});
