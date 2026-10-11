/**
 * Covers: omitted syntax context, separate old/new languages, stale context and parse-free virtual scrolling.
 * Real: DiffView, native syntax parser/cache, input, virtual layout and screenshot pixels.
 * Doubles: inline Git patches; no repository or network access.
 * Requires: patched release addon, Sharp and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { DiffView, type DiffViewProps } from "@1git/gpuix-ui/diff-view";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

let root: TestRoot;
let directory: string;

beforeEach(async () => {
	root = createTestRoot({ width: 640, height: 240 });
	directory = await mkdtemp("/private/tmp/1git-diff-syntax-");
});
afterEach(async () => {
	root.unmount();
	await rm(directory, { recursive: true, force: true });
});

const show = (props: DiffViewProps): void => {
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
				testId="syntax"
				showFileHeader={false}
				theme={{
					appearance: "dark",
					fontMono: "Menlo",
					bg: "#000000",
					codeText: "#ffffff",
					syntax: {
						keyword: "#ff0000",
						comment: "#00ff00",
						string: "#0000ff",
						stringSpecial: "#0000ff",
						property: "#ff00ff",
						constructor: "#ffffff",
					},
					metrics: { diffLineHeight: 24, diffHunkHeaderHeight: 24 },
				}}
				{...props}
			/>
		</div>
	);
};

const coloredPixels = async (
	color: readonly [number, number, number],
	fromY = 0,
	toY = 240
): Promise<number> => {
	const path = join(directory, "syntax.png");

	root.renderer.captureScreenshot(path);
	const { data, info } = await sharp(path)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const scale = info.height / 240;
	let count = 0;

	for (let y = Math.ceil(fromY * scale); y < Math.floor(toY * scale); y++) {
		for (let x = 0; x < info.width; x++) {
			const offset = (y * info.width + x) * 4;

			if (color.every((value, channel) => data[offset + channel] === value))
				count++;
		}
	}

	return count;
};

const header = (path: string): string =>
	`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;

const importPatch =
	header("context.ts") +
	"@@ -1 +1 @@\n-import { oldName,\n+import { newName,\n@@ -12 +12 @@\n-const removed = 1;\n+const revised = 2;\n";

const importSource =
	header("context.ts") +
	"@@ -1,12 +1,12 @@\n-import { oldName,\n+import { newName,\n } from 'module';\n" +
	Array.from({ length: 9 }, (_, index) => ` // hidden ${index}\n`).join("") +
	"-const removed = 1;\n+const revised = 2;\n";

it.each(["unified", "split"] as const)(
	"uses omitted import context in %s without displaying it",
	async (mode) => {
		show({
			"aria-label": "Changes",
			patch: importPatch,
			syntaxPatch: importSource,
			mode,
		});
		const painted = root.renderer.getPaintedText();

		expect(painted.some((text) => text.includes("hidden"))).toBe(false);
		expect(painted.some((text) => text.includes("revised"))).toBe(true);
		// Only the second hunk: the first import's keyword must not satisfy this assertion.
		expect(
			await coloredPixels([255, 0, 0], mode === "split" ? 72 : 96, 144)
		).toBeGreaterThan(5);
	}
);

it.each(["context.ts", "context.rs"])(
	"restores comments opened above the hunk in %s",
	async (path) => {
		const patch =
			header(path) + "@@ -6 +6 @@\n-const old = 1;\n+const revised = 2;\n";

		const syntaxPatch =
			header(path) +
			"@@ -1,8 +1,8 @@\n const keep = 0;\n /*\n hidden\n hidden\n hidden\n-const old = 1;\n+const revised = 2;\n */\n const after = 3;\n";

		show({ "aria-label": "Changes", patch, syntaxPatch });
		expect(await coloredPixels([0, 255, 0], 24, 72)).toBeGreaterThan(5);
		expect(await coloredPixels([255, 0, 0], 24, 72)).toBe(0);
		expect(
			root.renderer.getPaintedText().some((text) => text.includes("hidden"))
		).toBe(false);
	}
);

it("rejects mismatched context and resets parser state across gaps when context is unavailable", async () => {
	show({
		"aria-label": "Changes",
		patch: importPatch,
		syntaxPatch: importSource.replace(
			"const revised = 2;",
			"/* different edit"
		),
	});
	expect(await coloredPixels([255, 0, 0], 96, 144)).toBeGreaterThan(5);
	show({ "aria-label": "Changes", patch: importPatch });
	expect(await coloredPixels([255, 0, 0], 96, 144)).toBeGreaterThan(5);
});

it("restores a Python string opened in hidden context", async () => {
	const patch =
		header("context.py") + "@@ -5 +5 @@\n-return old\n+return revised\n";

	const syntaxPatch =
		header("context.py") +
		'@@ -1,6 +1,6 @@\n text = """\n hidden\n hidden\n hidden\n-return old\n+return revised\n """\n';

	show({ "aria-label": "Changes", patch, syntaxPatch });
	expect(await coloredPixels([0, 0, 255], 24, 72)).toBeGreaterThan(5);
	expect(await coloredPixels([255, 0, 0], 24, 72)).toBe(0);
});

it("detects each side's language when a rename changes the file extension", async () => {
	const patch =
		'diff --git a/before.json b/after.ts\n--- a/before.json\n+++ b/after.ts\n@@ -1 +1 @@\n-{"value": true}\n+const value = true;\n';

	show({ "aria-label": "Changes", patch, syntaxPatch: patch });
	expect(await coloredPixels([255, 0, 255], 24, 48)).toBeGreaterThan(5);
	expect(await coloredPixels([255, 0, 0], 24, 48)).toBe(0);
	expect(await coloredPixels([255, 0, 0], 48, 72)).toBeGreaterThan(5);
});

it("uses the matching side for context whose whitespace was filtered", async () => {
	const patch =
		header("filtered.ts") +
		"@@ -5,3 +5,3 @@\n hidden\n-const old = 1;\n+const revised = 2;\n */\n";

	const syntaxPatch =
		header("filtered.ts") +
		"@@ -1,8 +1,8 @@\n const keep = 0;\n /*\n hidden\n hidden\n-hidden\n+  hidden\n-const old = 1;\n+const revised = 2;\n */\n const after = 3;\n";

	show({ "aria-label": "Changes", patch, syntaxPatch });
	expect(await coloredPixels([0, 255, 0], 24, 48)).toBeGreaterThan(5);
	expect(await coloredPixels([255, 0, 0], 48, 96)).toBe(0);
});

it("reuses full syntax when expanding visible context", () => {
	show({
		"aria-label": "Changes",
		patch: importPatch,
		syntaxPatch: importSource,
	});
	const before = root.renderer.getSyntaxCacheStats();

	show({
		"aria-label": "Changes",
		patch: importSource,
		syntaxPatch: importSource,
	});
	expect(root.renderer.getSyntaxCacheStats()[1]).toBe(before[1]);
	expect(
		root.renderer.getPaintedText().some((text) => text.includes("hidden"))
	).toBe(true);
});

it("bounds sparse line tables even for out-of-order or extreme hunk coordinates", () => {
	for (const line of [50, 4_000_000_000]) {
		const patch =
			header("bounds.ts") +
			`@@ -${line} +${line} @@\n-old\n+const revised = 2;\n@@ -2 +2 @@\n-old\n+const small = 1;\n`;

		show({ "aria-label": "Changes", patch, syntaxPatch: importSource });
		expect(
			root.renderer.getPaintedText().some((text) => text.includes("small"))
		).toBe(true);
	}
});

it.each(["unified", "split"] as const)(
	"reuses parsed syntax during %s wheel frames, inclusion and theme changes",
	(mode) => {
		const count = 1000;

		const body = Array.from(
			{ length: count },
			(_, index) => `+const value${index} = ${index};\n`
		).join("");

		const patch = header("scroll.ts") + `@@ -0,0 +1,${count} @@\n${body}`;

		const props = {
			"aria-label": "Changes",
			patch,
			mode,
			syntaxPatch: patch,
			selectionEnabled: true,
			includedLines: ["+:1"],
		};

		show(props);
		const native = root.renderer.findByTestId("syntax-content");

		if (!native) throw new Error("Missing native diff");

		const before = root.renderer.getSyntaxCacheStats();

		for (let frame = 0; frame < 60; frame++) {
			root.renderer.nativeSimulateScrollWheel(400, 120, 0, -16);
			root.renderer.flush();
		}

		expect(root.renderer.getScrollOffset(native.id)?.[1]).toBeLessThan(-500);
		show({ ...props, includedLines: ["+:2"] });
		show({ ...props, theme: { appearance: "light" } });
		expect(root.renderer.getSyntaxCacheStats().slice(0, 2)).toEqual(
			before.slice(0, 2)
		);
		expect(root.renderer.getPaintedText().length).toBeLessThan(300);
		expect(root.renderer.getScrollOffset(native.id)?.[1]).toBeLessThan(-500);
	}
);
