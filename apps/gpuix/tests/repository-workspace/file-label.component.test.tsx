/**
 * Covers: delayed overflow-only file/folder reveal, reset, keyboard focus and stationary row controls.
 * Real: file list, shared tab animation, native text measurement, clipping and motion.
 * Doubles: Git records and offscreen-window focus notifications.
 * Requires: patched GPUIX renderer and macOS graphics.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { RepositoryList } from "../../src/feature/repository-workspace/components/repository-list";
import { RepositoryFileViewProvider } from "../../src/feature/repository-workspace/components/repository-file-view";
import type { RepositoryFileLayout } from "../../src/feature/repository-workspace/lib/repository-file-tree";
import type { WorkspaceEntry } from "../../src/feature/repository-workspace/types";

const directory = "src/a-long-directory-name-with-an-important-folder-suffix";
const path = `${directory}/pi-timeline.integration.with-an-important-filename-suffix.test.ts`;

const entries: readonly WorkspaceEntry[] = [
	path,
	`${directory}/a.ts`,
	"short.ts",
].map((title) => ({ id: title, title, status: "M" }));

const noop = (): void => {};
let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 420, height: 300 });
	root.renderer.clockPause();
});
afterEach(() => root.unmount());

function show(layout: RepositoryFileLayout = "tree"): void {
	root.render(
		<RepositoryFileViewProvider initialLayout={layout}>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					width: 320,
					height: 240,
				}}
			>
				<RepositoryList
					entries={entries}
					label="Changed files"
					emptyMessage="Empty"
					state={{ selectedId: null, scrollY: 0 }}
					fileTree={{ scope: "labels", onInclude: noop }}
					inclusion={{ ids: entries.map((entry) => entry.id), onChange: noop }}
					onSelect={noop}
					onScroll={noop}
				/>
			</div>
		</RepositoryFileViewProvider>
	);
}

function element(testId: string) {
	const node = root.renderer.findByTestId(testId);

	if (!node) throw new Error(`Missing ${testId}`);

	return node;
}

function bounds(testId: string) {
	const box = root.renderer.getElementBounds(element(testId).id);

	if (!box) throw new Error(`No bounds for ${testId}`);

	return box;
}

function advance(milliseconds: number): void {
	root.renderer.flush();
	root.renderer.clockFastForward(milliseconds);
	root.renderer.flush();
	root.renderer.dispatchNativeEvents();
	root.renderer.flush();
}

function hover(id: string): void {
	const box = bounds(id);

	root.renderer.nativeSimulateMouseMove(box.x + 10, box.y + box.height / 2);
	root.renderer.flush();
}

function leave(): void {
	root.renderer.nativeSimulateMouseMove(400, 270);
	advance(250);
}

for (const layout of ["tree", "list"] as const) {
	it(`reveals truncated ${layout} file labels after the tab delay without tooltips or moving row controls`, () => {
		show(layout);
		const viewport = bounds(`identity-${path}`);
		const start = bounds(`filename-${path}`).x;
		const icon = bounds(`status-${path}`);
		const checkbox = bounds(`include-${path}`);

		expect(bounds(`filename-${path}`).width).toBeGreaterThan(viewport.width);
		hover(`entry-${path}`);
		advance(300);
		expect(bounds(`filename-${path}`).x).toBe(start);
		advance(400);
		expect(bounds(`filename-${path}`).x).toBeLessThan(start);
		advance(2300);
		const suffix = bounds(
			`${layout === "tree" ? "filename" : "directory"}-${path}`
		);

		expect(
			Math.abs(suffix.x + suffix.width - viewport.x - viewport.width)
		).toBeLessThanOrEqual(1);
		expect(bounds(`status-${path}`)).toEqual(icon);
		expect(bounds(`include-${path}`)).toEqual(checkbox);
		expect(
			root.renderer
				.findByType("div")
				.some((node) => node.customProps?.role === "tooltip")
		).toBe(false);
		leave();
		expect(bounds(`filename-${path}`).x).toBe(start);
	});
}

it("slides truncated folder names while keeping counts and checkboxes fixed", () => {
	show();
	const id = `folder:${directory}/`;
	const viewport = bounds(`folder-label-${id}`);
	const start = bounds(`folder-name-${id}`).x;
	const count = bounds(`folder-count-${id}`);
	const checkbox = bounds(`include-${id}`);

	hover(`entry-${id}`);
	advance(3000);
	const name = bounds(`folder-name-${id}`);

	expect(name.x).toBeLessThan(start);
	expect(
		Math.abs(name.x + name.width - viewport.x - viewport.width)
	).toBeLessThanOrEqual(1);
	expect(bounds(`folder-count-${id}`)).toEqual(count);
	expect(bounds(`include-${id}`)).toEqual(checkbox);
	expect(
		root.renderer
			.findByType("div")
			.some((node) => node.customProps?.role === "tooltip")
	).toBe(false);
	leave();
	expect(bounds(`folder-name-${id}`).x).toBe(start);
});

it("leaves fitting and briefly hovered names still, and reveals overflow with keyboard focus", () => {
	show();
	const shortStart = bounds("filename-short.ts").x;
	const longStart = bounds(`filename-${path}`).x;

	hover("entry-short.ts");
	advance(3000);
	expect(bounds("filename-short.ts").x).toBe(shortStart);
	hover(`entry-${path}`);
	advance(100);
	leave();
	advance(3000);
	expect(bounds(`filename-${path}`).x).toBe(longStart);
	const row = element(`entry-${path}`);

	flushSync(() =>
		handleGpuixEvent({ elementId: row.id, eventType: "focus" }, root.renderer)
	);
	advance(3000);
	expect(bounds(`filename-${path}`).x).toBeLessThan(longStart);
	expect(row.customProps?.["aria-label"]).toContain(path);
	flushSync(() =>
		handleGpuixEvent({ elementId: row.id, eventType: "blur" }, root.renderer)
	);
	advance(250);
	expect(bounds(`filename-${path}`).x).toBe(longStart);
});
