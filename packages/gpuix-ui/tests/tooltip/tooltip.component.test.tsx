/**
 * Covers: nested tooltip composition, inverted colors, placement, focus, hover, and dismissal.
 * Real: Tooltip wrappers, GPUIX primitives, native geometry and events.
 * Doubles: focus notification for offscreen windows.
 * Requires: macOS graphics access and the app's anchored-center native patch/preload for geometry.
 */
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "../../src/tooltip";
import { densities, palettes } from "../../src/tokens";
import { elementByTestId } from "../_shared/native-elements";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 500, height: 400 });
});
afterEach(() => root.unmount());

function bounds(id: string) {
	const result = root.renderer.getElementBounds(
		elementByTestId(root.renderer, id).id
	);

	if (!result) throw new Error(`Missing bounds for ${id}`);

	return result;
}

it("centers native content on every side without double-offsetting it", () => {
	for (const side of ["right", "left", "top", "bottom"] as const) {
		root.render(
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					padding: 100,
					alignItems: "start",
				}}
			>
				<Tooltip key={side} open>
					<TooltipTrigger asChild>
						<div
							testId="trigger"
							role="button"
							aria-label="Help"
							style={{ width: 56, height: 40 }}
						>
							Help
						</div>
					</TooltipTrigger>
					<TooltipContent
						testId="tip"
						side={side}
						align="center"
						tokens={{ colors: palettes.light, layout: densities.compact }}
					>
						Helpful text
					</TooltipContent>
				</Tooltip>
			</div>
		);
		root.renderer.advanceTime(1);
		const trigger = bounds("trigger");
		const tip = bounds("tip");

		if (side === "right" || side === "left") {
			expect(tip.y + tip.height / 2).toBeCloseTo(
				trigger.y + trigger.height / 2,
				0
			);
			expect(
				side === "right"
					? tip.x - trigger.x - trigger.width
					: trigger.x - tip.x - tip.width
			).toBe(8);
		} else {
			expect(tip.x + tip.width / 2).toBeCloseTo(
				trigger.x + trigger.width / 2,
				0
			);
			// Native anchors round to pixels; shaped text heights can be fractional.
			const gap =
				side === "bottom"
					? tip.y - trigger.y - trigger.height
					: trigger.y - tip.y - tip.height;

			expect(Math.abs(gap - 8)).toBeLessThanOrEqual(0.5);
		}

		expect(elementByTestId(root.renderer, "tip").style).toMatchObject({
			backgroundColor: palettes.light.text,
			color: palettes.light.background,
			pointerEvents: "none",
		});
		expect(elementByTestId(root.renderer, "tip").customProps?.role).toBe(
			"tooltip"
		);
	}
});

it("preserves child focus and click handlers, opens on focus, and dismisses on Escape", () => {
	const onFocus = mock();
	const onClick = mock();

	root.render(
		<TooltipProvider delayDuration={350}>
			<Tooltip>
				<TooltipTrigger asChild>
					<div
						testId="trigger"
						role="button"
						aria-label="Help"
						tabIndex={0}
						onFocus={onFocus}
						onClick={onClick}
						style={{ width: 40, height: 40 }}
					>
						Help
					</div>
				</TooltipTrigger>
				<TooltipContent testId="tip" style={{ fontSize: 11 }}>
					Helpful text
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
	const trigger = elementByTestId(root.renderer, "trigger");

	flushSync(() =>
		handleGpuixEvent(
			{ elementId: trigger.id, eventType: "focus" },
			root.renderer
		)
	);
	expect(onFocus).toHaveBeenCalledTimes(1);
	expect(elementByTestId(root.renderer, "tip").style.fontSize).toBe(11);
	expect(elementByTestId(root.renderer, "tip").style).toMatchObject({
		backgroundColor: palettes.dark.text,
		color: palettes.dark.background,
	});
	root.renderer.nativeSimulateKeyDown(trigger.id, "escape");
	expect(root.renderer.findByTestId("tip")).toBeUndefined();
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: trigger.id, eventType: "focus" },
			root.renderer
		)
	);
	flushSync(() =>
		handleGpuixEvent(
			{ elementId: trigger.id, eventType: "click" },
			root.renderer
		)
	);
	expect(onClick).toHaveBeenCalledTimes(1);
	expect(root.renderer.findByTestId("tip")).toBeUndefined();
});

it("delays hover and cancels pending opening on mouse leave", async () => {
	root.render(
		<TooltipProvider delayDuration={80} disableHoverableContent>
			<Tooltip>
				<TooltipTrigger testId="trigger" style={{ width: 40, height: 40 }}>
					Help
				</TooltipTrigger>
				<TooltipContent testId="tip">Helpful text</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
	const trigger = elementByTestId(root.renderer, "trigger");

	const notify = (eventType: "mouseEnter" | "mouseLeave") =>
		flushSync(() =>
			handleGpuixEvent({ elementId: trigger.id, eventType }, root.renderer)
		);

	notify("mouseEnter");
	expect(root.renderer.findByTestId("tip")).toBeUndefined();
	notify("mouseLeave");
	await Bun.sleep(100);
	root.renderer.flush();
	expect(root.renderer.findByTestId("tip")).toBeUndefined();
	notify("mouseEnter");
	await Bun.sleep(100);
	root.renderer.flush();
	expect(root.renderer.findByTestId("tip")).toBeDefined();
	notify("mouseLeave");
	expect(root.renderer.findByTestId("tip")).toBeUndefined();
});
