/**
 * Covers: native group/line inclusion, Desktop-style diff painting, keyboard toggles, read-only views and stale/filtered patches.
 * Real: React selection ownership, virtualized GPUIX diff painting and native input.
 * Doubles: repository diff/context reads; no repository mutations.
 * Requires: patched GPUIX native renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { useState } from "react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { EventPayload } from "@gpuix/react";
import { RepositoryDiff } from "../../src/feature/repository-workspace/components/repository-diff";
import { changedFile } from "../_shared/repository-snapshot";
import { diffPatch, diffSection } from "../_shared/diff-patch";
import { windowOptions } from "../../src/window-options";
import { DiffView } from "@1git/gpuix-ui/diff-view";
import type {
	DiffSettings,
	RepositoryDiff as DiffReader,
} from "../../src/feature/repository-workspace/lib/repository-diff";

let root: TestRoot;

beforeEach(() => {
	received = [];
	reader.mockClear();
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
	root.renderer.clockPause();
});
afterEach(() => root.unmount());
const patch = diffPatch();

const reader = mock<typeof DiffReader.read>(async () => ({
	ok: true as const,
	value: [diffSection("working", patch)],
}));

let received: readonly string[] = [];

function Preview({
	mode = "unified",
	blocked = false,
	readOnly = false,
	ignoreWhitespace = false,
	stale = false,
}: {
	mode?: "unified" | "split";
	blocked?: boolean;
	readOnly?: boolean;
	ignoreWhitespace?: boolean;
	stale?: boolean;
}) {
	const [settings, setSettings] = useState<DiffSettings>({
		mode,
		splitLayout: "fixed",
		ignoreWhitespace,
	});

	const [selection, setSelection] = useState({
		expectedPatch: stale ? "old patch" : patch,
		includedLines: ["-:11", "+:11"],
	});

	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
			}}
		>
			<RepositoryDiff
				root="/test/project"
				change={changedFile("example.ts")}
				refreshing={blocked}
				statusError={null}
				settings={settings}
				onSettingsChange={setSettings}
				readDiff={reader}
				inclusion={
					readOnly
						? undefined
						: {
								included: true,
								selection,
								onChange: (expectedPatch, includedLines) => {
									received = includedLines;
									setSelection({
										expectedPatch,
										includedLines: [...includedLines],
									});
								},
							}
				}
			/>
			<text testId="readout">{selection.includedLines.join(",")}</text>
		</div>
	);
}

async function settle() {
	for (let i = 0; i < 4; i++) {
		await Bun.sleep(0);
		root.renderer.flush();
	}
}

async function finishPrompt() {
	await settle();
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	await Bun.sleep(120);
	await settle();
}
function viewport() {
	const element = root.renderer.findByTestId("diff-viewport-content");

	if (!element) throw new Error("Missing diff content");

	const bounds = root.renderer.getElementBounds(element.id);

	if (!bounds) throw new Error("Missing diff bounds");

	return { element, bounds };
}
function gutter(x: number, row: number) {
	const { bounds } = viewport();

	root.renderer.nativeSimulateClick(
		bounds.x + x,
		bounds.y + 26 + row * 21 + 10
	);
	root.renderer.flush();
}

function click(id: string) {
	const element = root.renderer.findByTestId(id);
	const bounds = element && root.renderer.getElementBounds(element.id);

	if (!bounds) throw new Error(`Missing ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
}

it("paints visible white vector marks on borderless blue gutters, with quiet aligned hunk headers", async () => {
	const directory = await mkdtemp(join(tmpdir(), "1git-inclusion-palette-"));

	try {
		for (const mode of ["unified", "split"] as const) {
			root.render(<Preview key={mode} mode={mode} />);
			await settle();
			expect(root.renderer.getPaintedText()).not.toContain("✓");
			const { bounds } = viewport();
			const path = join(directory, `${mode}.png`);

			root.renderer.nativeSimulateMouseMove(bounds.x + 200, bounds.y + 150);

			const sample = async () => {
				root.renderer.captureScreenshot(path);
				const { data, info } = await sharp(path)
					.ensureAlpha()
					.raw()
					.toBuffer({ resolveWithObject: true });

				const scale = info.width / 980;

				return (x: number, y: number) => {
					const offset =
						(Math.floor((bounds.y + y) * scale) * info.width +
							Math.floor((bounds.x + x) * scale)) *
						4;

					return [...data.subarray(offset, offset + 3)];
				};
			};

			const hasWhiteMark = (
				color: (x: number, y: number) => readonly number[],
				column: number
			) => {
				const [fillRed = 255, , fillBlue = 0] = color(column + 9, 49);

				if (fillBlue - fillRed < 100) return false;

				for (let x = 4; x < 16; x++) {
					for (let y = 52; y < 64; y++) {
						const [red = 0, green = 0, blue = 0] = color(column + x, y);

						if (red > 225 && green > 225 && blue > 225) return true;
					}
				}

				return false;
			};

			const color = await sample();
			const fill = color(27, 49);
			const numbers = color(42, 49);
			const group = color(9, 49);

			expect(fill).toEqual([33, 139, 255]);
			expect(numbers).toEqual(fill);
			expect(color(35, 49)).toEqual(fill);
			expect(color(67, 49)).toEqual(fill);
			expect(group[2]).toBeLessThan(fill[2] ?? 0);
			expect(hasWhiteMark(color, 0)).toBe(true);
			expect(hasWhiteMark(color, 18)).toBe(true);
			expect(color(200, 3)).toEqual([248, 250, 252]);
			expect(color(42, 3)).toEqual(color(200, 3));
			expect(color(42, 28)).toEqual([255, 255, 255]);
			expect(color(9, 28)).toEqual([225, 228, 232]);
			expect(color(350, 49)).toEqual([255, 238, 240]);
			expect(
				color(
					mode === "split" ? bounds.width / 2 + 350 : 350,
					mode === "split" ? 49 : 70
				)
			).toEqual([230, 255, 237]);

			if (process.env.GPUIX_INCLUSION_PALETTE_SCREENSHOT)
				root.renderer.captureScreenshot(
					`${process.env.GPUIX_INCLUSION_PALETTE_SCREENSHOT}-${mode}.png`
				);

			root.renderer.nativeSimulateMouseMove(bounds.x + 27, bounds.y + 57);
			const hovered = await sample();

			expect(hovered(27, 49)).not.toEqual(fill);
			expect(hovered(42, 49)).toEqual(numbers);
			root.renderer.nativeSimulateMouseMove(bounds.x + 200, bounds.y + 150);

			gutter(27, 1);
			await settle();
			const mixed = await sample();

			expect(hasWhiteMark(mixed, 0)).toBe(true);
			expect(hasWhiteMark(mixed, 18)).toBe(false);
			expect(mixed(42, 49)).toEqual([255, 255, 255]);
			expect(
				root.renderer.getPaintedText().filter((text) => text === "−")
			).toHaveLength(1);

			if (process.env.GPUIX_INCLUSION_PALETTE_SCREENSHOT)
				root.renderer.captureScreenshot(
					`${process.env.GPUIX_INCLUSION_PALETTE_SCREENSHOT}-${mode}-mixed.png`
				);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it("toggles a changed line, the complete group, and the focused control without rereading the patch", async () => {
	root.render(<Preview />);
	await settle();
	expect(viewport().element.customProps?.selectionEnabled).toBe(true);

	if (process.env.GPUIX_INCLUSION_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_INCLUSION_SCREENSHOT);

	gutter(27, 1);
	await settle();
	expect(received).toEqual(["+:11"]);

	if (process.env.GPUIX_INCLUSION_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_INCLUSION_SCREENSHOT);

	gutter(9, 1);
	await settle();
	expect(new Set(received)).toEqual(new Set(["-:11", "+:11"]));
	gutter(9, 1);
	await settle();
	expect(received).toEqual([]);
	root.renderer.simulateKeystrokes("space");
	await settle();
	expect(new Set(received)).toEqual(new Set(["-:11", "+:11"]));
	expect(reader).toHaveBeenCalledTimes(1);
});

it("selects the split sides independently and toggles the shared change group", async () => {
	root.render(<Preview mode="split" />);
	await settle();
	gutter(27, 1);
	await settle();
	expect(received).toEqual(["+:11"]);
	const { bounds } = viewport();

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2 + 27,
		bounds.y + 26 + 21 + 10
	);
	await settle();
	expect(received).toEqual([]);
	gutter(9, 1);
	await settle();
	expect(new Set(received)).toEqual(new Set(["-:11", "+:11"]));
});

it("keeps read-only previews free of inclusion controls", async () => {
	root.render(<Preview readOnly />);
	await settle();
	expect(viewport().element.customProps?.selectionEnabled).toBe(false);
	expect(root.renderer.findByTestId("diff-whitespace-prompt")).toBeUndefined();
});

it("keeps the filtered gutter visible and shows whitespace only after explicit confirmation", async () => {
	root.render(<Preview ignoreWhitespace />);
	await settle();
	expect(viewport().element.customProps?.selectionEnabled).toBe(true);
	const included = viewport().element.customProps?.includedLines;

	gutter(27, 1);
	await finishPrompt();
	expect(root.renderer.getAllText()).toContain("Show whitespace changes?");
	expect(received).toEqual([]);
	expect(viewport().element.customProps?.includedLines).toEqual(included);
	expect(reader).toHaveBeenCalledTimes(1);

	if (process.env.GPUIX_WHITESPACE_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_WHITESPACE_SCREENSHOT);

	click("diff-whitespace-cancel");
	await finishPrompt();
	expect(root.renderer.findByTestId("diff-whitespace-prompt")).toBeUndefined();
	expect(received).toEqual([]);
	expect(reader).toHaveBeenCalledTimes(1);

	gutter(9, 1);
	await finishPrompt();
	expect(root.renderer.getAllText()).toContain("Show whitespace changes?");
	root.renderer.simulateKeystrokes("escape");
	await finishPrompt();
	expect(root.renderer.findByTestId("diff-whitespace-prompt")).toBeUndefined();
	expect(received).toEqual([]);

	gutter(27, 1);
	await finishPrompt();
	click("diff-whitespace-confirm");
	await finishPrompt();
	expect(reader).toHaveBeenCalledTimes(2);
	expect(reader.mock.calls.at(-1)?.[3]).toBe(false);
	expect(viewport().element.customProps?.includedLines).toEqual(included);
	expect(received).toEqual([]);
	gutter(27, 1);
	await settle();
	expect(received).toEqual(["+:11"]);
});

it("supports the filtered prompt in split view and does not call an existing selection stale", async () => {
	root.render(<Preview ignoreWhitespace stale mode="split" />);
	await settle();
	expect(viewport().element.customProps?.selectionEnabled).toBe(true);
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"Review its line selection again"
	);
	gutter(9, 1);
	await settle();
	expect(root.renderer.getAllText()).toContain("Show whitespace changes?");
	expect(received).toEqual([]);
});

it("shows stale selection as excluded and requires explicit review", async () => {
	root.render(<Preview stale />);
	await settle();
	expect(viewport().element.customProps?.includedLines).toEqual([]);
	expect(root.renderer.getAllText().join(" ")).toContain(
		"Review its line selection again"
	);
	gutter(27, 1);
	await settle();
	expect(received).toEqual(["-:11"]);
	expect(root.renderer.getAllText().join(" ")).not.toContain(
		"Review its line selection again"
	);
});

it("keeps group click and keyboard payloads current across selection, layout and patch updates", async () => {
	const toggles = mock((event: EventPayload) => event.value);
	const keys = ["-:11", "+:11"];

	const render = (
		currentPatch: string,
		mode: "unified" | "split",
		includedLines: readonly string[]
	) =>
		root.render(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
				}}
			>
				<DiffView
					testId="diff-viewport"
					aria-label="Test cached inclusion"
					patch={currentPatch}
					mode={mode}
					theme={{ appearance: "light", metrics: { diffMarkerWidth: 18 } }}
					showFileHeader={false}
					selectionEnabled
					includedLines={includedLines}
					onToggleChange={toggles}
				/>
			</div>
		);

	render(patch, "unified", keys);
	await settle();
	const nativeId = viewport().element.id;

	gutter(9, 1);
	await settle();
	expect(toggles.mock.lastCall?.[0].value).toBe(JSON.stringify(keys));
	render(patch, "split", []);
	await settle();
	gutter(9, 1);
	await settle();
	root.renderer.simulateKeystrokes("enter");
	await settle();
	expect(toggles).toHaveBeenCalledTimes(3);
	expect(toggles.mock.lastCall?.[0].value).toBe(JSON.stringify(keys));

	const updated = patch.replace("@@ -10,2 +10,2 @@", "@@ -20,2 +30,2 @@");
	const updatedKeys = ["-:21", "+:31"];

	render(updated, "unified", updatedKeys.slice(1));
	await settle();
	expect(viewport().element.id).toBe(nativeId);
	gutter(9, 1);
	await settle();
	expect(toggles.mock.lastCall?.[0].value).toBe(JSON.stringify(updatedKeys));
	root.renderer.simulateKeystrokes("space");
	await settle();
	expect(toggles).toHaveBeenCalledTimes(5);
	expect(toggles.mock.lastCall?.[0].value).toBe(JSON.stringify(updatedKeys));
});

it("preserves the native scroll anchor when inclusion changes and disables controls during writes", async () => {
	const lines = Array.from({ length: 160 }, (_, i) => `+line ${i + 1}`);
	const keys = Array.from({ length: 160 }, (_, i) => `+:${i + 1}`);

	const longPatch = `diff --git a/file b/file\nnew file mode 100644\n--- /dev/null\n+++ b/file\n@@ -0,0 +1,160 @@\n${lines.join("\n")}\n`;
	const toggles = mock();

	const render = (includedLines: readonly string[], disabled = false) =>
		root.render(
			<div
				style={{
					height: "100%",
					width: "100%",
					display: "flex",
					flexDirection: "column",
				}}
			>
				<DiffView
					testId="diff-viewport"
					aria-label="Test inclusion"
					patch={longPatch}
					theme={{ appearance: "light", metrics: { diffMarkerWidth: 18 } }}
					showFileHeader={false}
					selectionEnabled
					selectionDisabled={disabled}
					includedLines={includedLines}
					onToggleChange={toggles}
				/>
			</div>
		);

	render(keys);
	await settle();
	const { element, bounds } = viewport();

	root.renderer.scrollTo(element.id, 0, -400);
	await settle();
	const offset = root.renderer.getScrollOffset(element.id);

	expect(offset?.[1]).toBeLessThan(0);
	render(keys.slice(1));
	await settle();
	expect(root.renderer.getScrollOffset(element.id)).toEqual(offset);
	root.renderer.nativeSimulateClick(bounds.x + 27, bounds.y + 40);
	await settle();
	expect(toggles).toHaveBeenCalledTimes(1);
	render(keys, true);
	await settle();
	root.renderer.nativeSimulateClick(bounds.x + 27, bounds.y + 40);
	await settle();
	expect(toggles).toHaveBeenCalledTimes(1);
});
