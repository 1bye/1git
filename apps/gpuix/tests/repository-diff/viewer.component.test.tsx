/**
 * Covers: virtualized diff painting, selection, staged/unstaged switching, scrolling, loading/errors and stale reads.
 * Real: app lifecycle, GPUIX patch parsing/layout, text painting and input events.
 * Doubles: repository status, diff reader and native folder selection.
 * Requires: patched GPUIX native renderer with macOS graphics access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { App } from "../../src/app";
import type { RepositoryDiff as Reader } from "../../src/feature/repository-workspace/lib/repository-diff";
import { RepositoryDiff } from "../../src/feature/repository-workspace/components/repository-diff";
import { windowOptions } from "../../src/window-options";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";
import { diffPatch, diffSection } from "../_shared/diff-patch";

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

const showDiff = (readDiff: typeof Reader.read): void => {
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
				change={changedFile("example.ts", { indexStatus: "modified" })}
				refreshing={false}
				statusError={null}
				readDiff={readDiff}
			/>
		</div>
	);
};

it("paints real line numbers and separate comparisons with keyboard-operable controls", async () => {
	const reader = mock<typeof Reader.read>(async () => ({
		ok: true,
		value: [
			diffSection("working"),
			diffSection("staged", diffPatch("example.ts", "const staged = 2;")),
		],
	}));

	showDiff(reader);
	expect(root.renderer.getAllText()).toContain("Loading diff…");
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
	expect(element("diff-viewport").customProps?.["aria-label"]).toBe(
		"Unstaged file diff"
	);
	key("diff-staged", "enter");
	expect(root.renderer.getAllText()).not.toContain("HEAD → index");
	expect(element("diff-viewport").customProps?.["aria-label"]).toBe(
		"Staged file diff"
	);
	expect(root.renderer.getPaintedText()).toContain("const staged = 2;");
	expect(root.renderer.getPaintedText()).not.toContain("const value = 2;");
	click("diff-working");
	expect(root.renderer.getPaintedText()).toContain("const value = 2;");
	expect(reader).toHaveBeenCalledTimes(1);
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
	expect(root.renderer.findByTestId("diff-viewport-content")).toBeUndefined();
	reader.mockResolvedValue({
		ok: true,
		value: [
			{
				target: "working",
				patch: "",
				message: "Binary file — text diff unavailable.",
			},
		],
	});
	click("retry-diff");
	await settle();
	expect(root.renderer.getAllText()).toContain(
		"Binary file — text diff unavailable."
	);
	expect(root.renderer.findByTestId("diff-viewport-content")).toBeUndefined();
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
	root.render(<App readRepository={status} readDiff={reader} />);
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
	expect(reader.mock.calls[2]?.[2].aborted).toBe(true);
	expect(root.renderer.findByTestId("diff-viewport-content")).toBeUndefined();
});
