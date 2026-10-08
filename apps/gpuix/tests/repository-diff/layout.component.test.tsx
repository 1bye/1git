/**
 * Covers: fixed/content-sized split layouts, native scrolling, pairing, metadata and overflow clamping.
 * Real: gpuix-ui component, patched GPUIX shaping, virtual list and native input/layout.
 * Doubles: inline patches; no Git or repository I/O.
 * Requires: patched release addon and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { DiffView, type DiffViewProps } from "@1git/gpuix-ui/diff-view";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import { diffPatch } from "../_shared/diff-patch";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 400, height: 240 });
});
afterEach(() => root.unmount());

const element = (testId: string) => {
	const node = root.renderer.findByTestId(testId);

	if (!node) throw new Error(`Missing ${testId}`);

	return node;
};

const width = (): number => {
	const bounds = root.renderer.getElementBounds(element("viewer-content").id);

	if (!bounds) throw new Error("Missing content bounds");

	return bounds.width;
};

const show = (props: Partial<DiffViewProps> = {}): void => {
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
				testId="viewer"
				aria-label="Changes"
				patch={diffPatch()}
				theme={{ appearance: "light", fontMono: "Menlo" }}
				{...props}
			/>
		</div>
	);
};

it("aligns unequal replacement runs, duplicates context and retains newline metadata in split mode", () => {
	const patch =
		"diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1,4 +1,3 @@\n same\n-old one\n-old two\n+new one\n tail\n\\ No newline at end of file\n";

	show({ patch, mode: "unified", showFileHeader: false });
	const unifiedWidth = width();

	show({ patch, mode: "split", showFileHeader: false });
	const text = root.renderer.getPaintedText();

	expect(text.filter((line) => line === "same")).toHaveLength(2);
	expect(text.filter((line) => line === "tail")).toHaveLength(2);
	expect(text).toContain("old one");
	expect(text).toContain("old two");
	expect(text).toContain("new one");
	expect(text.some((line) => line.includes("No newline"))).toBe(true);
	expect(width()).toBeCloseTo(unifiedWidth, 0);
});

it("measures both split columns and clamps overflow when returning to a short unified patch", () => {
	show({ mode: "unified", showFileHeader: false });
	const shortWidth = width();

	show({
		mode: "split",
		splitLayout: "content-sized",
		showFileHeader: false,
		patch: diffPatch("example.ts", `const revised = '${"x".repeat(150)}';`),
	});
	expect(width()).toBeGreaterThan(1000);
	const content = element("viewer-content").id;

	root.renderer.scrollTo(element("viewer").id, -500, 0);
	root.renderer.flush();
	show({ mode: "unified", showFileHeader: false });
	expect(element("viewer-content").id).toBe(content);
	expect(width()).toBeCloseTo(shortWidth, 0);
	expect(root.renderer.getScrollOffset(element("viewer").id)?.[0]).toBeCloseTo(
		0
	);
});

it("defaults split mode to equal panes without widening or scrolling the comparison canvas", () => {
	show({
		mode: "split",
		showFileHeader: false,
		patch: diffPatch("example.ts", `const revised = '${"x".repeat(150)}';`),
	});
	expect(width()).toBeCloseTo(398, 0);
	root.renderer.nativeSimulateScrollWheel(300, 45, -160, 0);
	root.renderer.flush();
	expect(width()).toBeCloseTo(398, 0);
	expect(root.renderer.getScrollOffset(element("viewer").id)?.[0] ?? 0).toBe(0);
	expect(
		root.renderer.getScrollOffset(element("viewer-content").id)?.[0]
	).toBeLessThan(0);
});

it("keeps the divider centered, scrolls panes independently and retains one virtual vertical list", async () => {
	const lines = Array.from(
		{ length: 120 },
		(_, index) => `line_${index}_${"x".repeat(160)}`
	);

	const patch = `diff --git a/long.ts b/long.ts\n--- a/long.ts\n+++ b/long.ts\n@@ -1,120 +1,120 @@\n${lines.map((line) => `-old_${line}`).join("\n")}\n${lines.map((line) => `+new_${line}`).join("\n")}\n`;

	const theme = {
		appearance: "light" as const,
		fontMono: "Menlo",
		border: "#ff00ff",
	};

	const props = { patch, mode: "split" as const, showFileHeader: false, theme };
	const directory = await mkdtemp(join(tmpdir(), "1git-split-"));
	const path = join(directory, "split.png");

	const divider = async (): Promise<number> => {
		root.renderer.captureScreenshot(path);
		const { data, info } = await sharp(path)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		const scale = info.width / 400;
		const y = Math.floor(60 * scale);

		for (let x = 0; x < info.width; x++) {
			const offset = (y * info.width + x) * 4;

			if (
				data[offset] === 255 &&
				data[offset + 1] === 0 &&
				data[offset + 2] === 255
			)
				return x / scale;
		}

		throw new Error("No painted split divider.");
	};

	try {
		show(props);
		const native = element("viewer-content").id;
		const center = await divider();

		expect(Math.abs(center - 200)).toBeLessThan(2);
		expect(root.renderer.getPaintedText().length).toBeLessThan(150);
		root.renderer.nativeSimulateScrollWheel(300, 60, -160, 0);
		root.renderer.flush();
		const rightX = root.renderer.getScrollOffset(native)?.[0];

		expect(rightX).toBeLessThan(0);
		root.renderer.nativeSimulateMouseMove(100, 60);
		expect(root.renderer.getScrollOffset(native)?.[0]).toBe(0);
		root.renderer.nativeSimulateScrollWheel(100, 60, -80, 0);
		root.renderer.flush();
		expect(root.renderer.getScrollOffset(native)?.[0]).toBeLessThan(0);
		root.renderer.nativeSimulateMouseMove(300, 60);
		expect(root.renderer.getScrollOffset(native)?.[0]).toBe(rightX);
		root.renderer.focusElement(element("viewer").id);
		root.renderer.nativeSimulateKeyDown(element("viewer").id, "right");
		root.renderer.flush();
		expect(root.renderer.getScrollOffset(native)?.[0]).toBeLessThan(
			rightX ?? 0
		);
		root.renderer.nativeSimulateScrollWheel(300, 60, 0, -160);
		root.renderer.flush();
		expect(root.renderer.getScrollOffset(native)?.[1]).toBeLessThan(0);
		expect(await divider()).toBe(center);
		expect(width()).toBeCloseTo(398, 0);
		const y = root.renderer.getScrollOffset(native)?.[1];

		show({ ...props, splitLayout: "content-sized" });
		expect(width()).toBeGreaterThan(1000);
		show(props);
		expect(width()).toBeCloseTo(398, 0);
		expect(root.renderer.getScrollOffset(native)?.[0]).toBe(0);
		expect(root.renderer.getScrollOffset(native)?.[1]).toBe(y);
		show({ mode: "split", showFileHeader: false });
		expect(root.renderer.getScrollOffset(native)?.[0]).toBe(0);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it("removes native file headers without hiding hunk headers or the Show more control", () => {
	show();
	expect(root.renderer.getPaintedText()).toContain("example.ts");
	show({ showFileHeader: false, maxLines: 1 });
	expect(root.renderer.getPaintedText()).not.toContain("example.ts");
	expect(root.renderer.getPaintedText()).toContain("@@ -10,2 +10,2 @@");
	expect(root.renderer.getPaintedText()).toContain("Show 2 more lines");
	show({ showFileHeader: true });
	expect(root.renderer.getPaintedText()).toContain("example.ts");
});

it("keeps informative notices for empty, binary and renamed files", () => {
	const added = "diff --git a/new.ts b/new.ts\nnew file mode 100644\n";

	show({ showFileHeader: false, patch: added });
	expect(root.renderer.getPaintedText()).toContain("Empty file");
	expect(root.renderer.getPaintedText()).not.toContain("New file");
	show({
		showFileHeader: false,
		patch: `${added}Binary files /dev/null and b/new.ts differ\n`,
	});
	expect(root.renderer.getPaintedText()).toContain(
		"Binary file — contents not shown"
	);
	expect(root.renderer.getPaintedText()).not.toContain("Empty file");
	show({
		showFileHeader: false,
		patch:
			"diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n",
	});
	expect(root.renderer.getPaintedText()).toContain("Renamed from old.ts");
});

it("remeasures native glyphs for content/font/spacing changes, but colors keep geometry stable", () => {
	const patch = diffPatch("test.txt", "x".repeat(100));
	const metrics = { diffTextSize: 10, diffRowPaddingX: 10 };
	const theme = { appearance: "light" as const, fontMono: "Menlo", metrics };

	show({ patch, theme, showFileHeader: false });
	const narrow = width();

	expect(narrow).toBeGreaterThan(400);
	show({
		patch,
		theme: { ...theme, diffAddBg: "#112233", diffDelWordBg: "#aabbcc80" },
		showFileHeader: false,
	});
	expect(width()).toBe(narrow);
	show({
		patch,
		theme: { ...theme, metrics: { ...metrics, diffTextSize: 20 } },
		showFileHeader: false,
	});
	expect(width()).toBeGreaterThan(narrow + 500);
	show({
		patch,
		theme: { ...theme, metrics: { ...metrics, diffRowPaddingX: 30 } },
		showFileHeader: false,
	});
	expect(width()).toBe(narrow + 40);
	show({
		patch: diffPatch("test.txt", "界".repeat(100)),
		theme,
		showFileHeader: false,
	});
	expect(width()).toBeGreaterThan(narrow);
	show({
		patch,
		theme: { ...theme, fontMono: "Helvetica" },
		showFileHeader: false,
	});
	expect(width()).not.toBe(narrow);
});

it("clamps horizontal overflow after replacing long content with a short patch", () => {
	show({
		patch: diffPatch("test.txt", "x".repeat(200)),
		showFileHeader: false,
	});
	const id = element("viewer").id;

	root.renderer.scrollTo(id, -800, 0);
	root.renderer.flush();
	expect(root.renderer.getScrollOffset(id)?.[0]).toBeLessThan(0);
	show({ showFileHeader: false });
	expect(width()).toBeCloseTo(398, 0);
	expect(root.renderer.getScrollOffset(id)?.[0]).toBeCloseTo(0);
});
