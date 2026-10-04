/**
 * Covers: file headers, native image comparisons, SVG source switching, virtualized diff painting, scrolling and stale reads.
 * Real: app lifecycle, GPUIX patch parsing/layout, text painting and input events.
 * Doubles: repository status, diff reader and native folder selection.
 * Requires: patched GPUIX native renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import sharp from "sharp";
import { App } from "../../src/app";
import type { RepositoryDiff as Reader } from "../../src/feature/repository-workspace/lib/repository-diff";
import { RepositoryDiff } from "../../src/feature/repository-workspace/components/repository-diff";
import { RepositoryImagePreview } from "../../src/feature/repository-workspace/components/repository-image-preview";
import { windowOptions } from "../../src/window-options";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { diffPatch, diffSection } from "../_shared/diff-patch";
import { ImagePreviewDecoder } from "../../src/feature/repository-workspace/lib/image-preview";
import { rasterContent, svgContent } from "../_shared/image-content";
import { emptyHistory } from "../_shared/history-page";

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
	width = 980
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
			/>
		</div>
	);
};

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

it("reuses prepared image previews synchronously when revisiting a file", async () => {
	const image = await ImagePreviewDecoder.prepare(
		await rasterContent(),
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

	showDiff(reader, "a.png");
	await settle();
	const pixels = imageSource();

	showDiff(reader, "b.png");
	await settle();
	showDiff(reader, "a.png");

	expect(imageSource()).toBe(pixels);
	expect(element("image-after-pixels").customProps?.alt).toBe(
		"Added version of a.png"
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
							conflict: { hash: "a hash", text: "a content" },
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
	expect(element("conflict-content").customProps?.value).toBe("a content");
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
	click("include-b.ts");
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
