/**
 * Covers: native group/line inclusion in unified/split diffs, keyboard toggles, read-only views and stale/filtered patches.
 * Real: React selection ownership, virtualized GPUIX diff painting and native input.
 * Doubles: repository diff/context reads; no repository mutations.
 * Requires: patched GPUIX native renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { useState } from "react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
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

it("toggles a changed line, the complete group, and the focused control without rereading the patch", async () => {
	root.render(<Preview />);
	await settle();
	expect(viewport().element.customProps?.selectionEnabled).toBe(true);

	if (process.env.GPUIX_INCLUSION_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_INCLUSION_SCREENSHOT);

	gutter(27, 1);
	await settle();
	expect(received).toEqual(["+:11"]);
	expect(root.renderer.getPaintedText()).toContain("−");

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
