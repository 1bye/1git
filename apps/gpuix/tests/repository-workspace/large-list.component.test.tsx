/**
 * Covers: large file/history list rendering and selection updates.
 * Real: RepositoryList and native GPUIX renderer, including layout.
 * Doubles: generated entries; no repository I/O.
 * Requires: macOS graphics and patched GPUIX.
 */
import { expect, it } from "bun:test";
import { createTestRoot } from "@gpuix/react/testing";
import { RepositoryList } from "../../src/feature/repository-workspace/components/repository-list";
import type { WorkspaceEntry } from "../../src/feature/repository-workspace/types";

for (const history of [false, true]) {
	it(`renders and updates 3000 ${history ? "history" : "file"} rows`, () => {
		const entries: WorkspaceEntry[] = Array.from(
			{ length: 3000 },
			(_, index) => ({
				id: `file-${index}`,
				title: `src/folder/file-${index}.ts`,
				...(history
					? { detail: "Author · commit summary" }
					: { status: "M" as const }),
			})
		);

		const ids = entries.map((entry) => entry.id);
		const root = createTestRoot({ width: 420, height: 700 });

		const render = (selectedId: string) =>
			root.render(
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						width: "100%",
						height: "100%",
					}}
				>
					<RepositoryList
						entries={entries}
						label="Large list"
						emptyMessage="Empty"
						state={{ selectedId, selectedIds: ids, scrollY: 0 }}
						inclusion={history ? undefined : { ids, onChange: () => {} }}
						onSelect={() => {}}
						onScroll={() => {}}
					/>
				</div>
			);

		try {
			const start = performance.now();

			render(ids[0]!);
			const mounted = performance.now();

			render(ids[1]!);
			const updated = performance.now();

			expect(root.renderer.findByTestId("entry-file-2999")).toBeUndefined();
			expect(
				root.renderer.findByTestId("entry-file-1")?.customProps?.[
					"aria-selected"
				]
			).toBe(true);
			process.stdout.write(
				`${history ? "history" : "files"}: mount=${(mounted - start).toFixed(1)}ms update=${(updated - mounted).toFixed(1)}ms\n`
			);
			const first = root.renderer.findByTestId("entry-file-1");

			if (!first) throw new Error("Missing first visible row");

			root.renderer.nativeSimulateKeyDown(first.id, "end");
			root.renderer.flush();
			expect(root.renderer.findByTestId("entry-file-2999")).toBeDefined();
			const last = root.renderer.findByTestId("entry-file-2999");

			if (!last) throw new Error("Missing last row");

			const list = root.renderer.findByTestId("repository-list");

			if (!list) throw new Error("Missing viewport");

			const viewportNode = root.renderer.findByTestId(
				"repository-list-viewport"
			);

			if (!viewportNode) throw new Error("Missing viewport bounds");

			const viewport = root.renderer.getElementBounds(viewportNode.id)!;
			const lastBounds = root.renderer.getElementBounds(last.id)!;

			expect(lastBounds.y).toBeGreaterThanOrEqual(viewport.y);
			expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(
				viewport.y + viewport.height + 1
			);

			root.renderer.nativeSimulateKeyDown(last.id, "home");
			root.renderer.flush();
			expect(root.renderer.findByTestId("entry-file-0")).toBeDefined();
			root.renderer.nativeSimulateScrollWheel(150, 300, 0, -3000);
			root.renderer.flush();
			const offscreen = root.renderer.findByTestId("entry-file-0");

			expect(
				offscreen && root.renderer.getElementBounds(offscreen.id)
			).toBeFalsy();
			expect(root.renderer.getScrollOffset(list.id)?.[1]).toBeLessThan(-1000);
		} finally {
			root.unmount();
		}
	});
}

it("keeps the current row visible when an appended history page crosses the buffering threshold", () => {
	const root = createTestRoot({ width: 420, height: 700 });

	const entries: WorkspaceEntry[] = Array.from({ length: 600 }, (_, index) => ({
		id: `commit-${index}`,
		title: `Commit ${index}`,
		detail: "Author · commit summary",
	}));

	const render = (count: number) =>
		root.render(
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					height: "100%",
					width: "100%",
				}}
			>
				<RepositoryList
					entries={entries.slice(0, count)}
					label="History"
					emptyMessage="Empty"
					state={{ selectedId: null, scrollY: 0 }}
					onSelect={() => {}}
					onScroll={() => {}}
				/>
			</div>
		);

	try {
		render(499);
		const list = root.renderer.findByTestId("repository-list");

		if (!list) throw new Error("Missing history list");

		root.renderer.scrollTo(list.id, 0, -460 * 48);
		root.renderer.flush();
		const before = root.renderer.getListScrollTop(list.id);

		render(600);
		expect(root.renderer.getListScrollTop(list.id)).toEqual(before);
		const visible = root.renderer.findByTestId("entry-commit-460");

		expect(visible).toBeDefined();

		if (!visible) throw new Error("Missing scrolled commit");

		expect(root.renderer.getElementBounds(visible.id)).not.toBeNull();
		expect(root.renderer.findByTestId("entry-commit-0")).toBeUndefined();
	} finally {
		root.unmount();
	}
});
