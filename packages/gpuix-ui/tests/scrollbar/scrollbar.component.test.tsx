/**
 * Covers: opt-in scrollbars, native ordinary/virtual ranges, keyboard and pointer scrolling.
 * Real: Scrollbars, GPUI layout, native scroll handles and virtual lists.
 * Doubles: none.
 * Requires: app native preload and macOS graphics access.
 */
import { afterEach, expect, it } from "bun:test";
import { Profiler, useRef } from "react";
import { type PublicInstance } from "@gpuix/react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { DiffView } from "../../src/diff-view";
import { Scrollbars } from "../../src/scrollbar";
import { defaultTokens } from "../../src/tokens";
import { elementByTestId } from "../_shared/native-elements";

const roots = new Set<TestRoot>();

afterEach(() => {
	for (const root of roots) root.unmount();

	roots.clear();
});

function Fixture({
	enabled,
	virtual = false,
	count = 100,
}: {
	enabled: boolean;
	virtual?: boolean;
	count?: number;
}) {
	const target = useRef<PublicInstance>(null);

	const children = Array.from({ length: count }, (_, index) => (
		<div key={index} style={{ height: 30, flexShrink: 0 }}>
			Row {index}
		</div>
	));

	return (
		<div style={{ width: 300, height: 200 }}>
			{virtual ? (
				<virtual-list
					ref={target}
					testId="scroller"
					estimatedItemHeight={30}
					style={{ width: 300, height: 200 }}
				>
					{children}
				</virtual-list>
			) : (
				<div
					ref={target}
					testId="scroller"
					style={{ width: 300, height: 200, overflowY: "scroll" }}
				>
					{children}
				</div>
			)}
			<Scrollbars
				vertical={target}
				tokens={{ ...defaultTokens, showScrollbars: enabled }}
			/>
		</div>
	);
}

async function settle(root: TestRoot) {
	await Bun.sleep(70);
	root.renderer.advanceTime(1);
	root.renderer.flush();
}

it("leaves scrollbars disabled by default and hides them when content fits", async () => {
	const root = createTestRoot({ width: 400, height: 300 });

	roots.add(root);
	root.render(<Fixture enabled={false} />);
	await settle(root);
	expect(root.renderer.findByTestId("scrollbar-vertical")).toBeUndefined();
	root.render(<Fixture enabled count={1} />);
	await settle(root);
	const bar = root.renderer.findByTestId("scrollbar-vertical")!;

	expect(root.renderer.getElementBounds(bar.id)?.height ?? 0).toBe(0);
});

it.each([false, true])(
	"scrolls a native pane with virtual=%s from its scrollbar",
	async (virtual) => {
		const root = createTestRoot({ width: 400, height: 300 });

		roots.add(root);
		root.render(<Fixture enabled virtual={virtual} />);
		await settle(root);
		const bar = elementByTestId(root.renderer, "scrollbar-vertical");
		const scroller = elementByTestId(root.renderer, "scroller");

		expect(root.renderer.getScrollMetrics(scroller.id, false)?.[1]).toBe(2800);
		expect(
			Object.values(root.renderer.getA11yTree().nodes ?? {}).some(
				(node) =>
					node.aria?.role === "ScrollBar" &&
					node.aria.label === "Vertical scroll"
			)
		).toBe(true);
		root.renderer.nativeSimulateKeyDown(bar.id, "end");
		root.renderer.advanceTime(1);
		expect(root.renderer.getScrollOffset(scroller.id)?.[1]).toBe(-2800);
		const bounds = root.renderer.getElementBounds(bar.id)!;
		const x = bounds.x + bounds.width / 2;

		root.renderer.nativeSimulateMouseDown(x, bounds.y + 8);
		root.renderer.advanceTime(1);
		expect(root.renderer.getScrollOffset(scroller.id)?.[1]).toBeGreaterThan(
			-200
		);
		root.renderer.nativeSimulateMouseMove(x, bounds.y + 100, 0);
		root.renderer.advanceTime(1);
		expect(root.renderer.getScrollOffset(scroller.id)?.[1]).toBeLessThan(-1000);
		root.renderer.nativeSimulateMouseUp(x, bounds.y + 100);
		const released = root.renderer.getScrollOffset(scroller.id)?.[1];

		root.renderer.nativeSimulateMouseMove(x, bounds.y + 150);
		root.renderer.advanceTime(1);
		expect(root.renderer.getScrollOffset(scroller.id)?.[1]).toBe(released);
	}
);

it("anchors a split diff's horizontal scrollbar to the pane viewport", async () => {
	const root = createTestRoot({ width: 500, height: 300 });

	roots.add(root);
	const lines = Array.from(
		{ length: 100 },
		(_, index) => `${index} ${"long text ".repeat(50)}`
	);

	const patch = `diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1,100 +1,100 @@\n${lines.map((line) => `-${line}`).join("\n")}\n${lines.map((line) => `+new ${line}`).join("\n")}\n`;

	root.render(
		<div
			style={{
				width: 500,
				height: 300,
				display: "flex",
				flexDirection: "column",
			}}
		>
			<DiffView
				testId="diff"
				patch={patch}
				mode="split"
				aria-label="Diff"
				tokens={{ ...defaultTokens, showScrollbars: true }}
			/>
		</div>
	);
	await settle(root);
	const viewport = root.renderer.getElementBounds(
		elementByTestId(root.renderer, "diff").id
	)!;

	const content = elementByTestId(root.renderer, "diff-content");
	const metrics = root.renderer.getScrollMetrics(content.id, true)!;

	expect(metrics[5]).toBeGreaterThanOrEqual(viewport.height - 2);
	const horizontal = elementByTestId(
		root.renderer,
		"diff-scrollbar-horizontal"
	);

	const bounds = root.renderer.getElementBounds(horizontal.id)!;

	// The diff viewport includes a one-pixel border; the scrollbar stays inside it.
	expect(
		Math.abs(bounds.y - (viewport.y + viewport.height - 9))
	).toBeLessThanOrEqual(2);
	root.renderer.nativeSimulateKeyDown(horizontal.id, "end");
	expect(root.renderer.getScrollOffset(content.id)?.[0]).toBeLessThan(-100);
});

it("keeps the thumb synchronized with native wheel frames without React commits", async () => {
	const root = createTestRoot({ width: 400, height: 300 });
	const commits: number[] = [];

	roots.add(root);
	root.render(
		<Profiler
			id="scrollbars"
			onRender={(_id, _phase, duration) => commits.push(duration)}
		>
			<Fixture enabled virtual />
		</Profiler>
	);
	await settle(root);
	commits.length = 0;
	const frames: number[] = [];

	for (let frame = 0; frame < 24; frame++) {
		const start = performance.now();

		root.renderer.dispatchScrollWheel(100, 80, 0, -9);
		root.renderer.flush();
		frames.push(performance.now() - start);
		await Bun.sleep(16);
	}

	const p90 = frames.toSorted((a, b) => a - b)[
		Math.floor(frames.length * 0.9)
	]!;

	process.stdout.write(
		`Scrollbar wheel: React commits=${commits.length}, p90=${p90.toFixed(2)}ms\n`
	);
	expect(commits).toHaveLength(0);
	expect(p90).toBeLessThan(16.7);
});
