/**
 * Covers: diff settings/tooltip appearance, file headers, images, SVG source switching, scrolling and stale reads.
 * Real: app lifecycle, GPUIX patch parsing/layout, text painting and input events.
 * Doubles: repository status, diff reader and native folder selection.
 * Requires: patched GPUIX native renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import sharp from "sharp";
import { App } from "../../src/app";
import { DiffView } from "@1git/gpuix-ui/diff-view";
import type { RepositoryDiff as Reader } from "../../src/feature/repository-workspace/lib/repository-diff";
import { RepositoryDiff } from "../../src/feature/repository-workspace/components/repository-diff";
import { RepositoryImagePreview } from "../../src/feature/repository-workspace/components/repository-image-preview";
import { windowOptions } from "../../src/window-options";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { diffPatch, diffSection } from "../_shared/diff-patch";
import { contextPatch } from "../_shared/context-patch";
import { RepositoryDiff as DiffReader } from "../../src/feature/repository-workspace/lib/repository-diff";
import { ImagePreviewDecoder } from "../../src/feature/repository-workspace/lib/image-preview";
import { rasterContent, svgContent } from "../_shared/image-content";
import { emptyHistory } from "../_shared/history-page";
import { appTokens } from "../../src/styles/tokens";
import { lightColors } from "@1git/design-tokens";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({
		width: 980,
		height: 640,
		onKeyDown: windowOptions.onKeyDown,
	});
});
afterEach(() => {
	mock.restore();
	root.unmount();
});
const element = (id: string) => {
	const node = root.renderer.findByTestId(id);

	if (!node) throw new Error(`Missing element: ${id}`);

	return node;
};

const bounds = (id: string) => {
	const value = root.renderer.getElementBounds(element(id).id);

	if (!value) throw new Error(`Missing bounds: ${id}`);

	return value;
};

const click = (id: string): void => {
	const box = bounds(id);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
};

const key = (id: string, key: string): void => {
	root.renderer.nativeSimulateKeyDown(element(id).id, key);
	root.renderer.flush();
};

const settle = async (): Promise<void> => {
	await Bun.sleep(0);
	root.renderer.flush();
};

const waitFor = async (ready: () => boolean): Promise<void> => {
	const deadline = performance.now() + 3000;

	while (!ready()) {
		if (performance.now() > deadline)
			throw new Error("Timed out waiting for preview pixels.");

		await Bun.sleep(25);
		root.renderer.flush();
	}
};

const imageSource = (): string => {
	const src = element("image-after-pixels").customProps?.src;

	if (typeof src !== "string") throw new Error("Missing preview pixels.");

	return src;
};

const showDiff = (
	readDiff: typeof Reader.read,
	path = "example.ts",
	width = 980,
	mode?: "unified" | "split"
): void => {
	root.render(
		<div
			style={{
				width,
				height: "100%",
				display: "flex",
				flexDirection: "column",
			}}
		>
			<RepositoryDiff
				root="/test/project"
				change={changedFile(path, { indexStatus: "modified" })}
				refreshing={false}
				statusError={null}
				readDiff={readDiff}
				settings={
					mode
						? { mode, splitLayout: "fixed", ignoreWhitespace: false }
						: undefined
				}
			/>
		</div>
	);
};

const settlePanel = async (): Promise<void> => {
	root.renderer.clockFastForward(220);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	await Bun.sleep(120);
	root.renderer.flush();
};

it("uses the app's translucent tooltip palette and an outlined toolbar icon for diff settings", async () => {
	root.render(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				backgroundColor: lightColors.editorSurface,
			}}
		>
			<RepositoryDiff
				root="/test/project"
				change={changedFile("example.ts", { indexStatus: "modified" })}
				refreshing={false}
				statusError={null}
				readDiff={async () => ({ ok: true, value: [diffSection("working")] })}
			/>
		</div>
	);
	await settle();
	const trigger = bounds("diff-settings");

	root.renderer.nativeSimulateMouseMove(
		trigger.x + trigger.width / 2,
		trigger.y + trigger.height / 2
	);
	await Bun.sleep(400);
	await settle();
	expect(element("diff-settings-tooltip").customProps?.role).toBe("tooltip");
	expect(element("diff-settings-tooltip").style).toMatchObject({
		backgroundColor: appTokens.tooltip?.background,
		color: appTokens.tooltip?.text,
		borderWidth: 1,
		pointerEvents: "none",
		borderRadius: 4,
	});
	expect(element("diff-settings-icon").style).toMatchObject({
		width: 16,
		height: 16,
		color: lightColors.editorMuted,
	});
	const source = element("diff-settings-icon").customProps?.source;

	expect(source).toContain('fill="none"');
	expect(source).toContain('stroke-width="1.25"');
	expect(source).not.toContain('fill="white"');

	if (process.env.GPUIX_DIFF_TOOLTIP_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_DIFF_TOOLTIP_SCREENSHOT);

	root.renderer.nativeSimulateMouseMove(50, 400);
	await Bun.sleep(100);
	await settle();
	expect(root.renderer.findByTestId("diff-settings-tooltip")).toBeUndefined();
});

it("opens accessible diff settings, switches native layout without rereading Git and restores focus", async () => {
	const reader = mock<typeof Reader.read>(async () => ({
		ok: true,
		value: [diffSection("working")],
	}));

	showDiff(reader);
	await settle();
	const content = element("diff-viewport-content").id;

	click("diff-settings");
	await settlePanel();
	expect(element("diff-settings-panel").style.borderRadius).toBe(8);
	expect(element("diff-mode-unified").style.borderRadius).toBe(4);
	expect(element("diff-settings").customProps?.["aria-expanded"]).toBe(true);
	expect(element("diff-mode-unified").customProps?.["aria-label"]).toBe(
		"Unified, selected"
	);
	expect(root.renderer.findByTestId("diff-split-fixed")).toBeUndefined();
	click("diff-mode-split");
	await settle();
	expect(element("diff-viewport-content").id).toBe(content);
	expect(element("diff-viewport-content").customProps?.mode).toBe("split");
	expect(element("diff-mode-split").customProps?.["aria-label"]).toBe(
		"Split, selected"
	);
	expect(element("diff-split-fixed").customProps?.["aria-label"]).toBe(
		"Fixed 50/50, selected"
	);
	click("diff-split-content-sized");
	expect(element("diff-viewport-content").customProps?.autoWidth).toBe(true);
	click("diff-split-fixed");
	expect(element("diff-viewport-content").customProps?.autoWidth).toBe(false);
	expect(reader).toHaveBeenCalledTimes(1);
	expect(
		root.renderer
			.getPaintedText()
			.filter((text) => text === "const context = true;")
	).toHaveLength(2);

	if (process.env.GPUIX_DIFF_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_DIFF_SCREENSHOT);

	root.renderer.simulateKeystrokes("escape");
	await settlePanel();
	expect(root.renderer.findByTestId("diff-settings-panel")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(element("diff-settings").id);

	click("diff-settings");
	await settlePanel();
	click("diff-mode-unified");
	expect(root.renderer.findByTestId("diff-split-fixed")).toBeUndefined();
	expect(element("diff-viewport-content").customProps?.mode).toBe("unified");
	expect(
		root.renderer
			.getPaintedText()
			.filter((text) => text === "const context = true;")
	).toHaveLength(1);
	expect(reader).toHaveBeenCalledTimes(1);
});

it("cancels stale whitespace reads, restores cached unfiltered content and expands with the displayed filter", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof Reader.read>>>();

	const reader = mock<typeof Reader.read>(
		(_root, _change, _signal, ignoreWhitespace) =>
			ignoreWhitespace
				? pending.promise
				: Promise.resolve({
						ok: true,
						value: [diffSection("working", contextPatch())],
					})
	);

	spyOn(DiffReader, "readContext").mockImplementation(
		async (_root, _change, context) => contextPatch(context)
	);
	showDiff(reader);
	await settle();
	click("diff-settings");
	await settlePanel();
	click("diff-hide-whitespace");
	await settle();
	expect(reader.mock.calls[1]?.[3]).toBe(true);
	expect(root.renderer.getPaintedText()).toContain("changed 40");
	click("diff-hide-whitespace");
	await settle();
	expect(reader.mock.calls[1]?.[2].aborted).toBe(true);
	pending.resolve({
		ok: true,
		value: [diffSection("working", diffPatch("example.ts", "stale filtered"))],
	});
	await settle();
	expect(root.renderer.getPaintedText()).not.toContain("stale filtered");
	expect(reader).toHaveBeenCalledTimes(2);

	reader.mockResolvedValue({
		ok: true,
		value: [diffSection("working", contextPatch())],
	});
	click("diff-hide-whitespace");
	await settle();
	root.renderer.simulateKeystrokes("escape");
	await settlePanel();
	click("diff-viewport");
	key("diff-viewport", "e");
	await settle();
	expect(DiffReader.readContext).toHaveBeenCalledWith(
		"/test/project",
		expect.anything(),
		expect.any(Number),
		expect.any(AbortSignal),
		true
	);

	reader.mockResolvedValue({
		ok: true,
		value: [
			{
				target: "working",
				patch: "",
				stats: [{ path: "other.ts", addedLines: 1, deletedLines: 1 }],
				message: "No textual changes with whitespace changes hidden.",
			},
		],
	});
	showDiff(reader, "other.ts");
	await settle();
	expect(reader.mock.calls.at(-1)?.[3]).toBe(true);
	expect(root.renderer.getAllText()).toContain(
		"No textual changes with whitespace changes hidden."
	);
	expect(root.renderer.findByTestId("diff-settings")).toBeDefined();
	expect(root.renderer.findByTestId("diff-stats")).toBeDefined();
});

it("retains window diff preferences when leaving the preview for another repository view", async () => {
	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	const reader = mock<typeof Reader.read>(async (_root, change) => ({
		ok: true,
		value: [diffSection("working", diffPatch(change.path))],
	}));

	root.render(
		<App
			readRepository={async () => ({
				ok: true,
				value: repositorySnapshot([changedFile("a.ts"), changedFile("b.ts")]),
			})}
			readDiff={reader}
			readHistory={emptyHistory}
		/>
	);
	click("open-repository");
	await settle();
	click("entry-a.ts");
	await settle();
	click("diff-settings");
	await settlePanel();
	click("diff-mode-split");
	click("diff-split-content-sized");
	click("diff-hide-whitespace");
	await settle();
	root.renderer.simulateKeystrokes("escape");
	await settlePanel();
	click("view-history");
	await settle();
	click("view-changes");
	await settle();
	click("entry-b.ts");
	await settle();
	expect(element("diff-viewport-content").customProps?.mode).toBe("split");
	expect(element("diff-viewport-content").customProps?.autoWidth).toBe(true);
	expect(
		reader.mock.calls.filter((call) => call[1].path === "b.ts").at(-1)?.[3]
	).toBe(true);
	click("diff-settings");
	await settlePanel();
	expect(element("diff-hide-whitespace").customProps?.["aria-checked"]).toBe(
		true
	);
});

it("restores diff settings from a previous session and saves a layout change on unmount", async () => {
	const save = mock();

	root.render(
		<App
			initialSession={{
				version: 1,
				tabs: [{ id: "workspace-1", path: "/test/project", draft: "" }],
				activeId: "workspace-1",
				diffSettings: {
					mode: "split",
					splitLayout: "content-sized",
					ignoreWhitespace: false,
				},
			}}
			saveSession={save}
			readRepository={async () => ({
				ok: true,
				value: repositorySnapshot([changedFile("a.ts")]),
			})}
			readDiff={async () => ({ ok: true, value: [diffSection("working")] })}
		/>
	);
	await settle();
	click("entry-a.ts");
	await settle();
	expect(element("diff-viewport-content").customProps?.mode).toBe("split");
	expect(element("diff-viewport-content").customProps?.autoWidth).toBe(true);
	click("diff-settings");
	await settlePanel();
	click("diff-split-fixed");
	expect(element("diff-viewport-content").customProps?.autoWidth).toBe(false);
	root.unmount();
	expect(save.mock.calls.at(-1)?.[0].diffSettings).toEqual({
		mode: "split",
		splitLayout: "fixed",
		ignoreWhitespace: false,
	});
});

it("paints one complete file diff without staging modes or hunk actions", async () => {
	const reader = mock<typeof Reader.read>(async () => ({
		ok: true,
		value: [
			diffSection("working", diffPatch(), [
				{ path: "example.ts", addedLines: 1, deletedLines: 1 },
			]),
		],
	}));

	showDiff(reader);
	expect(root.renderer.getAllText()).not.toContain("Loading diff…");
	expect(root.renderer.findByTestId("state-art-loading")).toBeUndefined();
	expect(root.renderer.findByTestId("diff-stats")).toBeUndefined();
	await settle();
	const text = root.renderer.getPaintedText();

	expect(text).toContain("const value = 1;");
	expect(text).toContain("const value = 2;");
	expect(text).toContain("10");
	expect(text).toContain("11");
	expect(text).toContain("+");
	expect(text).toContain("−");
	expect(text).toContain("@@ -10,2 +10,2 @@");
	expect(root.renderer.getAllText()).not.toContain("Index → working tree");
	expect(root.renderer.getAllText()).not.toContain("Read-only");
	expect(text.filter((value) => value === "example.ts")).toHaveLength(1);
	expect(root.renderer.findByTestId("diff-directory")).toBeUndefined();
	expect(element("diff-stats").customProps?.["aria-label"]).toBe(
		"1 added line, 1 deleted line"
	);
	expect(element("diff-viewport").customProps?.["aria-label"]).toBe(
		"File diff"
	);
	expect(root.renderer.findByTestId("diff-staged")).toBeUndefined();
	expect(root.renderer.findByTestId("diff-working")).toBeUndefined();
	expect(root.renderer.findByTestId("hunk-apply")).toBeUndefined();
	expect(reader).toHaveBeenCalledTimes(1);
});

it("native hunk clicks reveal twenty lines repeatedly, keep other gaps and do not reset scrolling", async () => {
	root.unmount();
	root = createTestRoot({
		width: 980,
		height: 240,
		onKeyDown: windowOptions.onKeyDown,
	});
	spyOn(DiffReader, "readContext").mockImplementation(
		async (_root, _change, context) => contextPatch(context)
	);
	showDiff(async () => ({
		ok: true,
		value: [diffSection("working", contextPatch())],
	}));
	await settle();
	const content = element("diff-viewport-content").id;

	expect(root.renderer.getPaintedText()).toContain("@@ -37,7 +37,7 @@ example");
	expect(
		root.renderer.getPaintedText().some((text) => text.includes("Expand"))
	).toBe(false);
	root.renderer.scrollTo(content, 0, -100);
	root.renderer.flush();
	expect(root.renderer.getPaintedText()).toContain("@@ -97,7 +97,7 @@ example");
	const viewport = bounds("diff-viewport-content");

	const clickGap = () => {
		// First hunk: 26px header + eight 20px code rows; the second header is the gap action.
		root.renderer.nativeSimulateClick(
			viewport.x + 24,
			viewport.y + 26 + 8 * 20 - 100 + 13
		);
		root.renderer.flush();
	};

	for (const [start, count] of [
		[77, 27],
		[57, 47],
	]) {
		clickGap();
		await settle();
		const patch = element("diff-viewport-content").customProps?.patch;

		expect(patch).toContain(`@@ -${start},${count} +${start},${count} @@`);
		expect(patch).toContain("@@ -37,7 +37,7 @@");
		expect(root.renderer.getScrollOffset(content)?.[1]).toBeLessThan(-50);
		expect(root.renderer.findByTestId("state-art-loading")).toBeUndefined();
	}

	clickGap();
	await settle();
	expect(element("diff-viewport-content").customProps?.patch).toContain(
		"@@ -37,67 +37,67 @@"
	);
	expect(element("diff-viewport-content").customProps?.patch).not.toContain(
		"@@ -97,7 +97,7 @@"
	);
});

it("keeps native headers unchanged when a caller does not enable context expansion", async () => {
	root.render(
		<div
			style={{
				width: 980,
				height: "100%",
				display: "flex",
				flexDirection: "column",
			}}
		>
			<DiffView
				patch={contextPatch()}
				aria-label="Opt-out diff"
				testId="plain-diff"
				showFileHeader={false}
			/>
		</div>
	);
	await settle();
	expect(root.renderer.getPaintedText()).toContain("@@ -37,7 +37,7 @@ example");
	expect(
		root.renderer.getPaintedText().some((text) => text.includes("Expand"))
	).toBe(false);
});

for (const mode of ["unified", "split"] as const) {
	it(`reveals code below the last hunk through EOF in ${mode} view`, async () => {
		const read = spyOn(DiffReader, "readContext").mockImplementation(
			async (_root, _change, context) => contextPatch(context)
		);

		showDiff(
			async () => ({
				ok: true,
				value: [
					{
						...diffSection("working", contextPatch()),
						syntaxPatch: contextPatch(150),
					},
				],
			}),
			"example.ts",
			980,
			mode
		);
		await settle();
		const content = element("diff-viewport-content").id;
		const viewport = bounds("diff-viewport-content");
		const rowCount = mode === "unified" ? 16 : 14;

		for (const [step, end] of [123, 143, 150].entries()) {
			root.renderer.scrollTo(content, 0, -Number.MAX_SAFE_INTEGER);
			root.renderer.flush();
			expect(root.renderer.getPaintedText()).toContain(
				"↓ Expand 20 lines below"
			);
			const offset = root.renderer.getScrollOffset(content)?.[1] ?? 0;

			root.renderer.nativeSimulateClick(
				viewport.x + 100,
				viewport.y + 2 * 26 + (rowCount + step * 20) * 20 + offset + 13
			);
			root.renderer.flush();
			await settle();
			const patch = element("diff-viewport-content").customProps?.patch;

			expect(patch).toEndWith(` line ${end}\n`);
			expect(patch).toContain("@@ -37,7 +37,7 @@");
			expect(element("diff-viewport-content").id).toBe(content);
		}

		expect(read).toHaveBeenCalledTimes(3);
		expect(element("diff-viewport-content").customProps?.expandAfter).toBe(
			false
		);
		root.renderer.scrollTo(content, 0, -Number.MAX_SAFE_INTEGER);
		root.renderer.flush();
		expect(root.renderer.getPaintedText()).not.toContain(
			"↓ Expand 20 lines below"
		);
	});
}

it("continues below the final hunk with keyboard E when no earlier gap remains", async () => {
	const header =
		"diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n";

	const initial = `${header}@@ -1,4 +1,4 @@\n-before\n+after\n line 2\n line 3\n line 4\n`;
	const full = `${header}@@ -1,24 +1,24 @@\n-before\n+after\n${Array.from({ length: 23 }, (_, index) => ` line ${index + 2}\n`).join("")}`;
	const read = spyOn(DiffReader, "readContext").mockResolvedValue(full);

	showDiff(async () => ({
		ok: true,
		value: [{ ...diffSection("working", initial), syntaxPatch: full }],
	}));
	await settle();
	click("diff-viewport");
	key("diff-viewport", "e");
	await settle();
	expect(element("diff-viewport-content").customProps?.patch).toBe(full);
	expect(element("diff-viewport-content").customProps?.expandAfter).toBe(false);
	key("diff-viewport", "e");
	await settle();
	expect(read).toHaveBeenCalledTimes(1);
});

it("resets context on a new snapshot without remounting the native diff viewport", async () => {
	spyOn(DiffReader, "readContext").mockImplementation(
		async (_root, _change, context) => contextPatch(context)
	);
	showDiff(async () => ({
		ok: true,
		value: [diffSection("working", contextPatch())],
	}));
	await settle();
	const content = element("diff-viewport-content").id;

	click("diff-viewport");
	key("diff-viewport", "e");
	await settle();
	expect(element("diff-viewport-content").customProps?.patch).toContain(
		" line 17\n"
	);
	showDiff(async () => ({
		ok: true,
		value: [
			diffSection(
				"working",
				contextPatch().replace("+changed 100", "+new content")
			),
		],
	}));
	await settle();
	expect(element("diff-viewport-content").id).toBe(content);
	expect(element("diff-viewport-content").customProps?.patch).not.toContain(
		" line 17\n"
	);
	expect(element("diff-viewport-content").customProps?.patch).toContain(
		"+new content"
	);
});

it("keeps the existing diff during a slow expansion, deduplicates clicks and supports keyboard E", async () => {
	const deferred = Promise.withResolvers<string>();

	const read = spyOn(DiffReader, "readContext").mockImplementation(
		async () => await deferred.promise
	);

	showDiff(async () => ({
		ok: true,
		value: [diffSection("working", contextPatch())],
	}));
	await settle();
	click("diff-viewport");
	key("diff-viewport", "e");
	key("diff-viewport", "e");
	expect(read).toHaveBeenCalledTimes(1);
	expect(element("diff-viewport-content").customProps?.patch).toBe(
		contextPatch()
	);
	expect(root.renderer.getPaintedText()).toContain("changed 40");
	deferred.resolve(contextPatch(23));
	await settle();
	expect(element("diff-viewport-content").customProps?.patch).toContain(
		"@@ -17,27 +17,27 @@"
	);
});

it("keeps context errors inline and cancels late expansion when the selected file changes", async () => {
	spyOn(DiffReader, "readContext").mockImplementation(async () =>
		contextPatch(23).replace("+changed 100", "+outside edit")
	);
	const reader: typeof Reader.read = async (_root, file) => ({
		ok: true,
		value: [
			diffSection(
				"working",
				contextPatch().replaceAll("example.ts", file.path)
			),
		],
	});

	showDiff(reader);
	await settle();
	click("diff-viewport");
	key("diff-viewport", "e");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"This file changed outside the app. Refresh the diff before expanding it."
	);
	expect(element("diff-viewport-content").customProps?.patch).toBe(
		contextPatch()
	);
	const deferred = Promise.withResolvers<string>();
	let signal: AbortSignal | undefined;

	spyOn(DiffReader, "readContext").mockImplementation(
		async (_root, _file, _context, abort) => {
			signal = abort;

			return await deferred.promise;
		}
	);
	key("diff-viewport", "e");
	showDiff(reader, "next.ts");
	await settle();
	expect(signal?.aborted).toBe(true);
	deferred.resolve(contextPatch(23));
	await settle();
	expect(element("diff-viewport-content").customProps?.patch).not.toContain(
		" line 17\n"
	);
	expect(root.renderer.getAllText()).toContain("next.ts");
});

it("preserves the filename and totals before truncating a long folder in the compact header", async () => {
	const directory = `apps/web/${"nested/".repeat(20)}components`;
	const path = `${directory}/work-collection.tsx`;

	showDiff(
		async () => ({
			ok: true,
			value: [
				diffSection("working", diffPatch(path), [
					{ path, addedLines: 1, deletedLines: 1 },
				]),
			],
		}),
		path,
		360
	);
	await settle();

	expect(root.renderer.getAllText()).toContain("work-collection.tsx");
	expect(root.renderer.getAllText()).toContain(directory);
	expect(root.renderer.getPaintedText()).toContain("work-collection.tsx");
	expect(element("diff-identity").customProps?.["aria-label"]).toBe(path);
	expect(element("diff-header").style.height).toBe(36);
	expect(bounds("diff-directory").x).toBeGreaterThanOrEqual(
		bounds("diff-filename").x + bounds("diff-filename").width
	);
	expect(
		bounds("diff-directory").x + bounds("diff-directory").width
	).toBeLessThanOrEqual(bounds("diff-stats").x);
	expect(
		bounds("diff-stats").x + bounds("diff-stats").width
	).toBeLessThanOrEqual(348);
});

it("scrolls vertically and horizontally by keyboard and trackpad with the comparison toolbar pinned", async () => {
	const lines = Array.from(
		{ length: 1800 },
		(_, index) => `+line_${index}_${"x".repeat(160)}`
	).join("\n");

	const patch = `diff --git a/long.ts b/long.ts\nnew file mode 100644\n--- /dev/null\n+++ b/long.ts\n@@ -0,0 +1,1800 @@\n${lines}\n`;

	showDiff(async () => ({ ok: true, value: [diffSection("working", patch)] }));
	await settle();
	const header = bounds("diff-header");
	const viewport = element("diff-viewport").id;
	const native = element("diff-viewport-content").id;

	// Offscreen focus handles need the active-window notification delivered explicitly.
	root.renderer.focusElement(viewport);
	flushSync(() =>
		handleGpuixEvent({ elementId: viewport, eventType: "focus" }, root.renderer)
	);

	// A regression to flow layout builds/paints all 1,800 rows, even below the clip.
	expect(root.renderer.getPaintedText().length).toBeLessThan(300);
	expect(bounds("diff-viewport-content").height).toBeLessThanOrEqual(
		bounds("diff-viewport").height
	);
	expect(root.renderer.findByTestId("diff-working")).toBeUndefined();
	expect(root.renderer.findByTestId("diff-staged")).toBeUndefined();
	key("diff-viewport", "pagedown");
	expect(element("diff-viewport").style.borderColor).toBe("transparent");
	expect(root.renderer.getScrollOffset(native)?.[1]).toBeLessThan(0);
	key("diff-viewport", "right");
	expect(root.renderer.getScrollOffset(viewport)?.[0]).toBeLessThan(0);
	key("diff-viewport", "end");
	expect(bounds("diff-header")).toEqual(header);
	expect(
		root.renderer
			.getPaintedText()
			.some((value) => value.startsWith("line_1799_"))
	).toBe(true);
	key("diff-viewport", "home");
	expect(root.renderer.getScrollOffset(native)?.[1]).toBeCloseTo(0);
	const box = bounds("diff-viewport");
	const beforeX = root.renderer.getScrollOffset(viewport)?.[0];

	root.renderer.nativeSimulateScrollWheel(box.x + 80, box.y + 100, 0, -160);
	root.renderer.flush();
	expect(root.renderer.getScrollOffset(native)?.[1]).toBeLessThan(0);
	expect(root.renderer.getScrollOffset(viewport)?.[0]).toBe(beforeX);
	const beforeY = root.renderer.getScrollOffset(native)?.[1];

	root.renderer.nativeSimulateScrollWheel(box.x + 80, box.y + 100, -160, 0);
	root.renderer.flush();
	expect(root.renderer.getScrollOffset(viewport)?.[0]).toBeLessThan(
		beforeX ?? 0
	);
	expect(root.renderer.getScrollOffset(native)?.[1]).toBe(beforeY);
});

it("selects code without copying gutters in the virtualized view", async () => {
	showDiff(async () => ({ ok: true, value: [diffSection("working")] }));
	await settle();
	const box = bounds("diff-viewport-content");

	expect(box.width).toBeCloseTo(bounds("diff-viewport").width, 0);
	const selected = root.renderer.dragSelect(
		box.x + 100,
		box.y + 76,
		box.x + 420,
		box.y + 76
	);

	expect(selected).toContain("value = 2;");
	expect(selected).not.toContain("11");
	expect(selected).not.toContain("+");
});

it("keeps multiline split selections within the chosen column, without gutters or duplicate context", async () => {
	showDiff(async () => ({ ok: true, value: [diffSection("working")] }));
	await settle();
	click("diff-settings");
	await settlePanel();
	click("diff-mode-split");
	root.renderer.simulateKeystrokes("escape");
	await settlePanel();
	const box = bounds("diff-viewport-content");

	const left = root.renderer.dragSelect(
		box.x + 63,
		box.y + 36,
		box.x + 400,
		box.y + 56
	);

	expect(left).toContain("const context = true;");
	expect(left).toContain("const value = 1;");
	expect(left).not.toContain("const value = 2;");
	expect(left?.split("const context = true;")).toHaveLength(2);
	const right = root.renderer.dragSelect(
		box.x + box.width / 2 + 63,
		box.y + 36,
		box.x + box.width - 20,
		box.y + 56
	);

	expect(right).toContain("const context = true;");
	expect(right).toContain("const value = 2;");
	expect(right).not.toContain("const value = 1;");
	expect(right).not.toContain("11");
});

it("shows new-file code without a redundant status row or a pointer focus ring", async () => {
	const patch =
		"diff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+const added = true;\n";

	showDiff(async () => ({ ok: true, value: [diffSection("working", patch)] }));
	await settle();
	expect(root.renderer.getPaintedText()).not.toContain("New file");
	expect(root.renderer.getPaintedText()).toContain("@@ -0,0 +1,1 @@");
	expect(root.renderer.getPaintedText()).toContain("const added = true;");
	click("diff-viewport");
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: element("diff-viewport").id, eventType: "focus" },
			root.renderer
		)
	);
	expect(element("diff-viewport").style.borderColor).toBe("transparent");
});

it("fits short code to the viewport regardless of hidden patch metadata", async () => {
	const path = `${"nested/".repeat(50)}short.ts`;

	showDiff(async () => ({
		ok: true,
		value: [diffSection("working", diffPatch(path))],
	}));
	await settle();
	expect(bounds("diff-viewport-content").width).toBeCloseTo(
		bounds("diff-viewport").width,
		0
	);
	key("diff-viewport", "right");
	expect(
		root.renderer.getScrollOffset(element("diff-viewport").id)?.[0]
	).toBeCloseTo(0);
	expect(root.renderer.getPaintedText()).not.toContain(path);
});

it("releases the native scroll state for empty, flow-layout and unmounted diffs", () => {
	root.render(
		<diff
			testId="standalone-diff"
			scroll
			patch={diffPatch()}
			style={{ height: 40 }}
		/>
	);
	const id = element("standalone-diff").id;

	root.renderer.scrollTo(id, 0, -100);
	root.renderer.flush();
	expect(root.renderer.getScrollOffset(id)?.[1]).toBeLessThan(0);
	expect(root.renderer.getListScrollTop(id)?.[0]).toBeGreaterThan(0);
	root.render(
		<diff testId="standalone-diff" scroll patch="" style={{ height: 40 }} />
	);
	expect(root.renderer.getScrollOffset(id)).toBeNull();
	root.render(
		<diff testId="standalone-diff" patch={diffPatch()} style={{ height: 40 }} />
	);
	expect(root.renderer.getScrollOffset(id)).toBeNull();
	root.render(<text>Another view</text>);
	expect(root.renderer.getScrollOffset(id)).toBeNull();
});

it("shows errors with retry and explanatory notices instead of fake or partial diff content", async () => {
	const reader = mock<typeof Reader.read>(async () => {
		throw new Error("Repository disappeared");
	});

	showDiff(reader);
	await settle();
	expect(root.renderer.getAllText()).toContain("Repository disappeared");
	expect(root.renderer.findByTestId("state-art-error")).toBeDefined();
	expect(root.renderer.findByTestId("diff-stats")).toBeUndefined();
	expect(root.renderer.findByTestId("diff-viewport-content")).toBeUndefined();
	reader.mockResolvedValue({
		ok: true,
		value: [
			{
				target: "working",
				patch: "",
				stats: [{ path: "example.ts", addedLines: null, deletedLines: null }],
				message: "Binary file — text diff unavailable.",
			},
		],
	});
	click("retry-diff");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Binary file — text diff unavailable."
	);
	expect(root.renderer.findByTestId("state-art-unavailable")).toBeDefined();
	expect(root.renderer.findByTestId("diff-viewport-content")).toBeUndefined();
	expect(root.renderer.findByTestId("diff-stats")).toBeUndefined();
});

it("keeps matching header and pixels until the next file is ready, then revisits it without another read", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof Reader.read>>>();

	const reader = mock<typeof Reader.read>((_root, change) =>
		change.path === "b.ts"
			? pending.promise
			: Promise.resolve({
					ok: true,
					value: [
						diffSection("working", diffPatch(change.path, "first ready file")),
					],
				})
	);

	showDiff(reader, "a.ts");
	await settle();
	const viewport = element("diff-viewport").id;

	showDiff(reader, "b.ts");
	await settle();
	expect(element("diff-identity").customProps?.["aria-label"]).toBe("a.ts");
	expect(element("diff-viewport").id).toBe(viewport);
	expect(root.renderer.getPaintedText()).toContain("first ready file");
	expect(root.renderer.getAllText()).not.toContain("Loading diff…");
	pending.resolve({
		ok: true,
		value: [diffSection("working", diffPatch("b.ts", "second ready file"))],
	});
	await settle();
	expect(element("diff-identity").customProps?.["aria-label"]).toBe("b.ts");
	expect(root.renderer.getPaintedText()).toContain("second ready file");
	showDiff(reader, "a.ts");
	expect(element("diff-identity").customProps?.["aria-label"]).toBe("a.ts");
	expect(root.renderer.getPaintedText()).toContain("first ready file");
	expect(root.renderer.getAllText()).not.toContain("Loading diff…");
	await settle();
	expect(reader).toHaveBeenCalledTimes(2);
});

it("shows delayed progress for genuinely slow reads without hiding a ready preview", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof Reader.read>>>();

	const reader = mock<typeof Reader.read>(() => pending.promise);

	showDiff(reader);
	await settle();
	expect(root.renderer.findByTestId("diff-notice")).toBeUndefined();
	await Bun.sleep(250);
	root.renderer.flush();
	expect(root.renderer.getAllText()).toContain("Loading diff…");
	pending.resolve({ ok: true, value: [diffSection("working")] });
	await settle();
	expect(root.renderer.findByTestId("diff-notice")).toBeUndefined();
});

it("retains the last painted cache hit when the next uncached selection arrives before its effect settles", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof Reader.read>>>();

	const reader = mock<typeof Reader.read>((_root, change) =>
		change.path === "c.ts"
			? pending.promise
			: Promise.resolve({
					ok: true,
					value: [diffSection("working", diffPatch(change.path, change.path))],
				})
	);

	showDiff(reader, "a.ts");
	await settle();
	showDiff(reader, "b.ts");
	await settle();
	showDiff(reader, "a.ts");
	showDiff(reader, "c.ts");

	expect(element("diff-identity").customProps?.["aria-label"]).toBe("a.ts");
	await settle();
	expect(element("diff-identity").customProps?.["aria-label"]).toBe("a.ts");
	pending.resolve({
		ok: true,
		value: [diffSection("working", diffPatch("c.ts"))],
	});
	await settle();
	expect(element("diff-identity").customProps?.["aria-label"]).toBe("c.ts");
});

it("adopts a preloaded neighbour in the app, preserves ready content on slow reads and reuses files across views", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof Reader.read>>>();

	const reader = mock<typeof Reader.read>((_root, change) =>
		change.path === "b.ts"
			? pending.promise
			: Promise.resolve({
					ok: true,
					value: [
						diffSection("working", diffPatch(change.path, "ready first file")),
					],
				})
	);

	const snapshot = repositorySnapshot([
		changedFile("a.ts"),
		changedFile("b.ts"),
	]);

	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	root.render(
		<App
			readRepository={async () => ({ ok: true, value: snapshot })}
			readDiff={reader}
			readHistory={emptyHistory}
		/>
	);
	click("open-repository");
	await settle();
	click("entry-a.ts");
	await settle();
	await waitFor(() =>
		reader.mock.calls.some((call) => call[1].path === "b.ts")
	);
	const viewport = element("diff-viewport").id;

	click("entry-b.ts");
	await settle();
	expect(reader).toHaveBeenCalledTimes(2);
	expect(element("diff-viewport").id).toBe(viewport);
	await Bun.sleep(250);
	root.renderer.flush();
	expect(root.renderer.findByTestId("diff-progress")).toBeDefined();
	expect(root.renderer.getPaintedText()).toContain("ready first file");
	expect(element("diff-identity").customProps?.["aria-label"]).toBe("a.ts");
	expect(root.renderer.getAllText()).not.toContain("Loading diff…");
	pending.resolve({
		ok: true,
		value: [diffSection("working", diffPatch("b.ts", "ready second file"))],
	});
	await settle();
	expect(element("diff-identity").customProps?.["aria-label"]).toBe("b.ts");
	expect(root.renderer.getPaintedText()).toContain("ready second file");
	click("entry-a.ts");
	expect(root.renderer.getPaintedText()).toContain("ready first file");
	click("view-history");
	await settle();
	click("view-changes");
	expect(root.renderer.getPaintedText()).toContain("ready first file");
	await settle();
	expect(reader).toHaveBeenCalledTimes(2);
});

it("invalidates cached working pixels when a refresh changes content but not status letters", async () => {
	let content = "before refresh";

	const status = mock(async () => ({
		ok: true as const,
		value: repositorySnapshot([changedFile("a.ts")]),
	}));

	const reader = mock<typeof Reader.read>(async () => ({
		ok: true,
		value: [diffSection("working", diffPatch("a.ts", content))],
	}));

	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	root.render(
		<App readRepository={status} readDiff={reader} readHistory={emptyHistory} />
	);
	click("open-repository");
	await settle();
	click("entry-a.ts");
	await settle();
	expect(root.renderer.getPaintedText()).toContain("before refresh");
	content = "after refresh";
	click("refresh-repository");
	await settle();
	await settle();

	expect(root.renderer.getPaintedText()).toContain("after refresh");
	expect(root.renderer.getPaintedText()).not.toContain("before refresh");
	expect(reader).toHaveBeenCalledTimes(2);
});

it("reuses opaque image previews synchronously when revisiting a file", async () => {
	const image = await ImagePreviewDecoder.prepare(
		await rasterContent("jpeg"),
		new AbortController().signal
	);

	const reader = mock<typeof Reader.read>(async (_root, change) => ({
		ok: true,
		value: [
			{
				...diffSection("working"),
				image: { before: null, after: { image, error: null }, svg: false },
				stats: [{ path: change.path, addedLines: null, deletedLines: null }],
			},
		],
	}));

	showDiff(reader, "a.jpg");
	await settle();
	const pixels = imageSource();

	showDiff(reader, "b.jpg");
	await settle();
	showDiff(reader, "a.jpg");

	expect(imageSource()).toBe(pixels);
	expect(element("image-after-pixels").customProps?.alt).toBe(
		"Added version of a.jpg"
	);
	expect(root.renderer.findByTestId("diff-notice")).toBeUndefined();
	await settle();
	expect(reader).toHaveBeenCalledTimes(2);
});

it("disables retained conflict actions while another file is pending and never resolves the wrong path", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof Reader.read>>>();

	const reader = mock<typeof Reader.read>((_root, change) =>
		change.path === "b.txt"
			? pending.promise
			: Promise.resolve({
					ok: true,
					value: [
						{
							target: "working",
							patch: "",
							stats: [],
							message: null,
							conflict: {
								hash: "a hash",
								text: "a content",
								ours: {
									text: "original",
									label: "Current · main",
									revision: "ours-blob",
								},
							},
						},
					],
				})
	);

	const resolve = mock(async (_path: string, _hash: string) => null);

	const render = (path: string) =>
		root.render(
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
					change={changedFile(path, { recordType: "unmerged" })}
					refreshing={false}
					statusError={null}
					readDiff={reader}
					onResolve={(hash) => resolve(path, hash)}
				/>
			</div>
		);

	render("a.txt");
	await settle();
	render("b.txt");
	await settle();
	expect(element("conflict-content-content").customProps?.patch).toContain(
		"+a content"
	);
	click("conflict-resolve");
	expect(resolve).not.toHaveBeenCalled();
	pending.resolve({
		ok: true,
		value: [
			{
				target: "working",
				patch: "",
				stats: [],
				message: null,
				conflict: { hash: "b hash", text: "b content" },
			},
		],
	});
	await settle();
	click("conflict-resolve");
	await settle();

	expect(resolve).toHaveBeenCalledWith("b.txt", "b hash");
	expect(resolve).toHaveBeenCalledTimes(1);
});

it("cancels stale selection reads, refreshes the selected path and never reloads for draft/checkbox changes", async () => {
	const pending =
		Promise.withResolvers<Awaited<ReturnType<typeof Reader.read>>>();

	const snapshot = repositorySnapshot([
		changedFile("a.ts"),
		changedFile("b.ts"),
	]);

	const status = mock(async () => ({ ok: true as const, value: snapshot }));

	const reader = mock<typeof Reader.read>((_root, change) =>
		change.path === "a.ts"
			? pending.promise
			: Promise.resolve({
					ok: true,
					value: [diffSection("working", diffPatch("b.ts", "second file"))],
				})
	);

	spyOn(root.renderer, "promptForPaths").mockResolvedValue(["/test/project"]);
	root.render(
		<App readRepository={status} readDiff={reader} readHistory={emptyHistory} />
	);
	click("open-repository");
	await settle();
	expect(reader).not.toHaveBeenCalled();
	click("entry-a.ts");
	await settle();
	click("entry-b.ts");
	await settle();
	expect(reader.mock.calls[0]?.[2].aborted).toBe(true);
	pending.resolve({
		ok: true,
		value: [diffSection("working", diffPatch("a.ts", "stale first file"))],
	});
	await settle();
	expect(root.renderer.getPaintedText()).toContain("second file");
	expect(root.renderer.getPaintedText()).not.toContain("stale first file");
	click("include-a.ts");
	click("commit-message");
	root.renderer.simulateKeystrokes("d r a f t");
	root.renderer.flush();
	await settle();
	expect(reader).toHaveBeenCalledTimes(2);
	status.mockResolvedValue({
		ok: true,
		value: repositorySnapshot([changedFile("b.ts")]),
	});
	click("refresh-repository");
	await settle();
	await settle();
	expect(reader).toHaveBeenCalledTimes(3);
	expect(element("include-b.ts").customProps?.["aria-checked"]).toBe(false);
	expect(element("commit-message").customProps?.value).toBe("draft");
	click("view-history");
	await settle();
	expect(reader).toHaveBeenCalledTimes(3);
	expect(root.renderer.findByTestId("diff-viewport-content")).toBeUndefined();
});

it("shows image comparisons with metadata and keyboard-operable SVG source switching", async () => {
	const path = "assets/art.svg";

	const image = await ImagePreviewDecoder.prepare(
		svgContent(),
		new AbortController().signal
	);

	const before = { image, error: null };
	const after = { image: { ...image, width: 64 }, error: null };

	const reader = mock<typeof Reader.read>(async () => ({
		ok: true,
		value: [
			{
				...diffSection("working", diffPatch(path), [
					{ path, addedLines: 1, deletedLines: 1 },
				]),
				image: { before, after, svg: true },
			},
		],
	}));

	showDiff(reader, path, 500);
	await settle();
	expect(root.renderer.findByTestId("diff-stats")).toBeUndefined();
	expect(root.renderer.findByTestId("diff-viewport")).toBeUndefined();
	expect(element("image-metadata").customProps?.["aria-label"]).toBe(
		`Before: 32 × 16 · ${image.sizeBytes} B → After: 64 × 16 · ${image.sizeBytes} B`
	);
	expect(bounds("image-metadata").y).toBeLessThan(bounds("diff-header").height);
	expect(
		bounds("image-metadata").x + bounds("image-metadata").width
	).toBeLessThanOrEqual(500);
	expect(root.renderer.getAllText()).toContain("Before");
	expect(root.renderer.getAllText()).toContain("After");
	expect(element("image-after-pixels").customProps?.alt).toBe(
		`After version of ${path}`
	);
	expect(element("image-after-pixels").customProps?.objectFit).toBe("contain");
	expect(bounds("image-before").width).toBeCloseTo(bounds("image-after").width);
	expect(bounds("image-before").x + bounds("image-before").width).toBeLessThan(
		bounds("image-after").x
	);
	key("image-mode-source", "enter");
	expect(root.renderer.findByTestId("image-preview")).toBeUndefined();
	expect(root.renderer.findByTestId("image-metadata")).toBeUndefined();
	expect(root.renderer.findByTestId("diff-viewport")).toBeDefined();
	expect(root.renderer.findByTestId("diff-stats")).toBeDefined();
	key("image-mode-preview", "enter");
	expect(root.renderer.findByTestId("image-before")).toBeDefined();
	expect(root.renderer.getAllText()).toContain("Before");
	expect(root.renderer.getAllText()).toContain("After");
	expect(element("image-metadata").customProps?.["aria-label"]).toBe(
		`Before: 32 × 16 · ${image.sizeBytes} B → After: 64 × 16 · ${image.sizeBytes} B`
	);
	expect(reader).toHaveBeenCalledTimes(1);
});

it("shows failures per image side without inventing missing versions or text counts", async () => {
	const image = await ImagePreviewDecoder.prepare(
		await rasterContent(),
		new AbortController().signal
	);

	showDiff(
		async () => ({
			ok: true,
			value: [
				{
					...diffSection("working"),
					image: {
						before: { image, error: null },
						after: { image: null, error: "Image is too large to preview." },
						svg: false,
					},
				},
			],
		}),
		"image.png"
	);
	await settle();
	expect(root.renderer.findByTestId("image-before-pixels")).toBeDefined();
	expect(root.renderer.findByTestId("image-after-pixels")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain(
		"Image is too large to preview."
	);
	expect(root.renderer.findByTestId("state-art-error")).toBeDefined();
	expect(root.renderer.findByTestId("image-mode-source")).toBeUndefined();
	expect(root.renderer.findByTestId("diff-stats")).toBeUndefined();
	expect(root.renderer.getAllText()).toContain("Before");
	expect(root.renderer.getAllText()).not.toContain("Deleted");
});

it("rerasterizes SVGs at fitted Retina size after resize without rereading Git or rerendering while idle", async () => {
	const image = await ImagePreviewDecoder.prepare(
		svgContent(),
		new AbortController().signal
	);

	const path = "assets/image.svg";
	const change = changedFile(path);
	const decoder = spyOn(ImagePreviewDecoder, "prepare");

	const reader = mock<typeof Reader.read>(async () => ({
		ok: true,
		value: [
			{
				...diffSection("working", diffPatch(path)),
				image: { before: null, after: { image, error: null }, svg: true },
			},
		],
	}));

	const render = (width: number) =>
		root.render(
			<div
				style={{
					width,
					height: "100%",
					display: "flex",
					flexDirection: "column",
				}}
			>
				<RepositoryDiff
					root="/test/project"
					change={change}
					refreshing={false}
					statusError={null}
					readDiff={reader}
				/>
			</div>
		);

	render(600);
	await settle();
	await waitFor(() => imageSource() !== image.src);
	const firstSrc = imageSource();

	const first = await sharp(
		Buffer.from(firstSrc.split(",")[1] ?? "", "base64")
	).metadata();

	expect(first.width).toBe(Math.ceil(bounds("image-after-viewport").width) * 2);
	expect(first.height).toBe(Math.round((first.width ?? 0) / 2));
	expect(root.renderer.getAllText()).toContain(
		`32 × 16 · ${image.sizeBytes} B`
	);
	expect(decoder).toHaveBeenCalledTimes(1);

	render(400);
	await waitFor(() => imageSource() !== firstSrc);
	const resized = await sharp(
		Buffer.from(imageSource().split(",")[1] ?? "", "base64")
	).metadata();

	expect(resized.width).toBe(
		Math.ceil(bounds("image-after-viewport").width) * 2
	);
	expect(reader).toHaveBeenCalledTimes(1);
	expect(decoder).toHaveBeenCalledTimes(2);
	await Bun.sleep(350);
	root.renderer.flush();
	expect(decoder).toHaveBeenCalledTimes(2);
	key("image-mode-source", "enter");
	await Bun.sleep(350);
	expect(decoder).toHaveBeenCalledTimes(2);
});

it("serializes resize decoding, ignores obsolete pixels and cancels after the preview unmounts", async () => {
	const image = await ImagePreviewDecoder.prepare(
		svgContent(),
		new AbortController().signal
	);

	const pending: {
		signal: AbortSignal;
		resolve: (value: typeof image) => void;
	}[] = [];

	const decoder = spyOn(ImagePreviewDecoder, "prepare").mockImplementation(
		(_content, signal) =>
			new Promise((resolve) => {
				pending.push({ signal, resolve });
			})
	);

	const comparison = { before: null, after: { image, error: null }, svg: true };

	const render = (width: number) =>
		root.render(
			<div
				style={{
					width,
					height: "100%",
					display: "flex",
					flexDirection: "column",
				}}
			>
				<RepositoryImagePreview comparison={comparison} path="art.svg" />
			</div>
		);

	render(600);
	await waitFor(() => pending.length === 1);
	render(400);
	await waitFor(() => pending[0]?.signal.aborted === true);
	await Bun.sleep(250);
	expect(decoder).toHaveBeenCalledTimes(1);
	pending[0]?.resolve({ ...image, src: "obsolete-pixels" });
	await waitFor(() => pending.length === 2);
	expect(imageSource()).toBe(image.src);
	pending[1]?.resolve({ ...image, src: "current-pixels" });
	await waitFor(() => imageSource() === "current-pixels");

	render(500);
	await waitFor(() => pending.length === 3);
	root.render(<text>Source view</text>);
	expect(pending[2]?.signal.aborted).toBe(true);
	pending[2]?.resolve({ ...image, src: "late-pixels" });
	await Bun.sleep(250);
	root.renderer.flush();
	expect(root.renderer.findByTestId("image-preview")).toBeUndefined();
	expect(decoder).toHaveBeenCalledTimes(3);
});

it.each(["added", "deleted"] as const)(
	"labels %s images and puts their metadata in the file header",
	async (status) => {
		const image = await ImagePreviewDecoder.prepare(
			await rasterContent(),
			new AbortController().signal
		);

		const side = { image, error: null };
		const added = status === "added";

		showDiff(
			async () => ({
				ok: true,
				value: [
					{
						...diffSection("working"),
						image: {
							before: added ? null : side,
							after: added ? side : null,
							svg: false,
						},
					},
				],
			}),
			"assets/image.png"
		);
		await settle();

		const metadata = `${image.width} × ${image.height} · ${image.sizeBytes} B`;
		const header = bounds("diff-header");
		const details = bounds("image-metadata");
		const label = bounds(`image-${added ? "after" : "before"}-label`);
		const preview = bounds(`image-${added ? "after" : "before"}-viewport`);

		expect(root.renderer.getAllText()).toContain(added ? "Added" : "Deleted");
		expect(root.renderer.getAllText()).not.toContain(
			added ? "After" : "Before"
		);
		expect(
			root.renderer.getAllText().filter((text) => text === metadata)
		).toHaveLength(1);
		expect(details.x + details.width).toBeCloseTo(header.width - 12);
		expect(details.y + details.height).toBeLessThanOrEqual(header.height);
		expect(label.x + label.width / 2).toBeCloseTo(
			preview.x + preview.width / 2
		);
		expect(root.renderer.findByTestId("diff-stats")).toBeUndefined();
	}
);
