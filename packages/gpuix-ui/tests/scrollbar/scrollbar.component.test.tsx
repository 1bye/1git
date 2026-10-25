/**
 * Covers: opt-in scrollbars, native ordinary/virtual ranges, keyboard and pointer scrolling.
 * Real: Scrollbars, GPUI layout, native scroll handles and virtual lists.
 * Doubles: none.
 * Requires: app native preload and macOS graphics access.
 */
import { afterEach, expect, it } from "bun:test";
import { useRef } from "react";
import { flushSync, handleGpuixEvent, type PublicInstance } from "@gpuix/react";
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
	expect(root.renderer.findByTestId("scrollbar-vertical")).toBeUndefined();
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

		expect(bar.customProps?.["aria-valuemax"]).toBe(2800);
		flushSync(() =>
			handleGpuixEvent(
				{
					elementId: bar.id,
					eventType: "keyDown",
					key: "end",
				},
				root.renderer
			)
		);
		root.renderer.advanceTime(1);
		expect(root.renderer.getScrollOffset(scroller.id)?.[1]).toBe(-2800);
		await settle(root);
		flushSync(() =>
			handleGpuixEvent(
				{
					elementId: bar.id,
					eventType: "mouseDown",
					x: 295,
					y: 10,
				},
				root.renderer
			)
		);
		root.renderer.advanceTime(1);
		expect(root.renderer.getScrollOffset(scroller.id)?.[1]).toBeGreaterThan(
			-200
		);
		flushSync(() =>
			handleGpuixEvent(
				{
					elementId: bar.id,
					eventType: "mouseMove",
					x: 295,
					y: 100,
				},
				root.renderer
			)
		);
		root.renderer.advanceTime(1);
		expect(root.renderer.getScrollOffset(scroller.id)?.[1]).toBeLessThan(-1000);
		flushSync(() =>
			handleGpuixEvent(
				{
					elementId: bar.id,
					eventType: "mouseUp",
					x: 295,
					y: 100,
				},
				root.renderer
			)
		);
		expect(
			root.renderer.findByTestId("scrollbar-vertical-drag")
		).toBeUndefined();
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
		Math.abs(bounds.y - (viewport.y + viewport.height - 10))
	).toBeLessThanOrEqual(2);
	root.renderer.nativeSimulateKeyDown(horizontal.id, "end");
	expect(root.renderer.getScrollOffset(content.id)?.[0]).toBeLessThan(-100);
});
