/**
 * Covers: open-bottom progress gauges, readable percentages and parse-free diff scrolling while busy.
 * Real: React gauge, native SVG masks, syntax cache, virtual diff layout and wheel input.
 * Doubles: inline progress and patches; no repository, credentials or remote writes.
 * Requires: built GPUIX addon and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { DiffView } from "@1git/gpuix-ui/diff-view";
import { appThemes } from "../../src/styles/theme";
import { RepositorySyncProgress } from "../../src/feature/repository-workspace/components/repository-sync-progress";
import type { GitTransferProgress } from "@1git/git";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 640, height: 300 });
});
afterEach(() => {
	root.unmount();
});

it.each(["light", "dark"] as const)(
	"shows a percentage in the bottom opening and unknown work without a fabricated count (%s)",
	(appearance) => {
		const { colors } = appThemes[appearance];

		const show = (progress: GitTransferProgress): void => {
			root.render(
				<div
					style={{
						width: "100%",
						height: "100%",
						backgroundColor: colors.editorSurface,
					}}
				>
					<RepositorySyncProgress progress={progress} color={colors.brand} />
				</div>
			);
		};

		for (const percent of [0, 45, 100]) {
			show({ phase: "sending", percent });
			expect(root.renderer.getPaintedText()).toContain(`${percent}%`);
			const gauge = root.renderer.findByTestId("rail-sync-progress-gauge");
			const label = root.renderer.findByTestId("rail-sync-progress-label");
			const control = root.renderer.findByTestId("rail-sync-progress");

			if (!gauge || !label || !control)
				throw new Error("Missing gauge or percentage");

			const gaugeBounds = root.renderer.getElementBounds(gauge.id);
			const labelBounds = root.renderer.getElementBounds(label.id);

			expect(gaugeBounds?.width).toBe(32);
			expect(labelBounds?.y).toBeGreaterThanOrEqual((gaugeBounds?.y ?? 0) + 20);
			expect(
				(labelBounds?.y ?? 0) + (labelBounds?.height ?? 0)
			).toBeLessThanOrEqual((gaugeBounds?.y ?? 0) + (gaugeBounds?.height ?? 0));
			expect(gauge.customProps?.source).not.toContain("<circle");
			expect(control.customProps?.role).toBe("progressbar");
			expect(control.customProps?.["aria-valuetext"]).toBe(
				percent === 100
					? "Waiting for remote confirmation…"
					: `Sending objects — ${percent}%`
			);
			const screenshot = process.env.GPUIX_SYNC_GAUGE_SCREENSHOT;

			if (screenshot && percent === 45)
				root.renderer.captureScreenshot(`${screenshot}-${appearance}.png`);
		}

		show({ phase: "connecting", percent: null });
		expect(root.renderer.getPaintedText()).toContain("…");
		expect(
			root.renderer.findByTestId("rail-sync-progress")?.customProps?.[
				"aria-valuetext"
			]
		).toBe("Connecting…");
	}
);

it.each(["light", "dark"] as const)(
	"animates locally and reuses parsed syntax during %s scrolling",
	async (appearance) => {
		const { colors } = appThemes[appearance];
		const count = 2000;

		const body = Array.from(
			{ length: count },
			(_, index) => `+const value${index} = ${index};\n`
		).join("");

		const patch = `diff --git a/scroll.ts b/scroll.ts\n--- a/scroll.ts\n+++ b/scroll.ts\n@@ -0,0 +1,${count} @@\n${body}`;
		let diffRenders = 0;

		function DiffProbe() {
			diffRenders++;

			return (
				<DiffView
					testId="progress-diff"
					aria-label="Changes"
					patch={patch}
					syntaxPatch={patch}
					showFileHeader={false}
					theme={{ appearance }}
				/>
			);
		}

		const show = (progress: GitTransferProgress): void => {
			root.render(
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						flexDirection: "column",
						backgroundColor: colors.editorSurface,
					}}
				>
					<RepositorySyncProgress progress={progress} color={colors.brand} />
					<DiffProbe />
				</div>
			);
		};

		const source = () =>
			root.renderer.findByTestId("rail-sync-progress-gauge")?.customProps
				?.source;

		show({ phase: "connecting", percent: null });
		const initial = source();
		const renders = diffRenders;
		const parsed = root.renderer.getSyntaxCacheStats().slice(0, 2);
		const native = root.renderer.findByTestId("progress-diff-content");

		if (!native) throw new Error("Missing native diff");

		for (let frame = 0; frame < 30; frame++) {
			root.renderer.nativeSimulateScrollWheel(400, 120, 0, -16);
			root.renderer.flush();
			await Bun.sleep(2);
		}

		expect(source()).not.toBe(initial);
		expect(diffRenders).toBe(renders);
		expect(root.renderer.getScrollOffset(native.id)?.[1]).toBeLessThan(-300);
		expect(root.renderer.getSyntaxCacheStats().slice(0, 2)).toEqual(parsed);
		expect(root.renderer.getPaintedText().length).toBeLessThan(300);
		show({ phase: "sending", percent: 45 });
		const filled = source();

		await Bun.sleep(40);
		root.renderer.flush();
		expect(source()).toBe(filled);
		show({ phase: "sending", percent: 100 });
		expect(
			root.renderer.findByTestId("rail-sync-progress")?.customProps?.[
				"aria-valuetext"
			]
		).toBe("Waiting for remote confirmation…");
		expect(root.renderer.getSyntaxCacheStats().slice(0, 2)).toEqual(parsed);
	}
);
