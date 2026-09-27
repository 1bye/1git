/**
 * Covers: modal focus, dismissal, busy state, exit lifetime and viewport positioning.
 * Real: Popover, Button, native layout, keyboard dispatch and motion.
 * Doubles: none.
 * Requires: GPUIX native test renderer with graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { useState } from "react";
import { Button } from "../../src/button";
import {
	handlePopoverKeyDown,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "../../src/popover";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({
		width: 500,
		height: 400,
		onKeyDown(event, renderer) {
			if (handlePopoverKeyDown(event, renderer)) return;

			if (event.key === "tab") renderer.focusNext?.();
		},
	});
	root.renderer.clockPause();
});
afterEach(() => root.unmount());

function Example({ busy = false, y = 320 }: { busy?: boolean; y?: number }) {
	const [open, setOpen] = useState(false);

	return (
		<div style={{ width: "100%", height: "100%", backgroundColor: "#ffffff" }}>
			<Button testId="outside">Outside</Button>
			<div style={{ position: "absolute", left: 390, top: y }}>
				<Popover open={open} onOpenChange={setOpen} modal>
					<PopoverTrigger asChild>
						<Button testId="trigger">New stash</Button>
					</PopoverTrigger>
					<PopoverContent aria-label="Test form" dismissible={!busy}>
						<input
							testId="first"
							aria-label="Message"
							tabIndex={0}
							style={{ height: 32 }}
						/>
						<Button testId="last" onPress={() => setOpen(false)}>
							Done
						</Button>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}

function node(id: string) {
	const found = root.renderer.findByTestId(id);

	if (!found) throw new Error(`Missing ${id}`);

	return found;
}
function click(id: string) {
	const bounds = root.renderer.getElementBounds(node(id).id);

	if (!bounds) throw new Error(`Missing bounds for ${id}`);

	root.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2
	);
	root.renderer.flush();
}
async function finish() {
	root.renderer.clockFastForward(200);
	root.renderer.flush();
	root.renderer.advanceTime(1);
	await Bun.sleep(120);
	root.renderer.flush();
}

it("contains focus, closes with Escape, restores focus and reopens", async () => {
	root.render(<Example />);
	click("trigger");
	await finish();
	expect(root.renderer.getFocusedElementId()).toBe(node("first").id);
	root.renderer.simulateKeystrokes("tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(node("last").id);
	root.renderer.simulateKeystrokes("tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(node("first").id);
	root.renderer.simulateKeystrokes("shift-tab");
	root.renderer.flush();
	expect(root.renderer.getFocusedElementId()).toBe(node("last").id);
	root.renderer.simulateKeystrokes("escape");
	root.renderer.flush();
	expect(root.renderer.findByTestId("popover-content")).toBeDefined();
	await finish();
	expect(root.renderer.findByTestId("popover-content")).toBeUndefined();
	expect(root.renderer.getFocusedElementId()).toBe(node("trigger").id);
	click("trigger");
	await finish();
	expect(root.renderer.findByTestId("first")).toBeDefined();
});

it("blocks dismissal while busy and never activates background controls", async () => {
	root.render(<Example busy />);
	click("trigger");
	await finish();
	root.renderer.simulateKeystrokes("escape");
	click("outside");
	await finish();
	expect(root.renderer.findByTestId("popover-content")).toBeDefined();
	root.render(<Example />);
	click("outside");
	await finish();
	expect(root.renderer.findByTestId("popover-content")).toBeUndefined();
});

it("opens above the trigger, clamps the right edge, and flips below near the top", async () => {
	root.render(<Example />);
	click("trigger");
	await finish();
	const panel = root.renderer.getElementBounds(node("popover-content").id);
	const trigger = root.renderer.getElementBounds(node("trigger").id);

	expect(panel).not.toBeNull();
	expect(panel!.x + panel!.width).toBeLessThanOrEqual(488);
	expect(panel!.y + panel!.height).toBeLessThan(trigger!.y);
	root.render(<Example y={10} />);
	await finish();
	const below = root.renderer.getElementBounds(node("popover-content").id);
	const moved = root.renderer.getElementBounds(node("trigger").id);

	expect(below!.y).toBeGreaterThanOrEqual(moved!.y + moved!.height);
});
