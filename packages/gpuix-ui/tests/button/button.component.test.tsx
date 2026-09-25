/**
 * Covers: native button activation, focus, disabled behavior, and label styling.
 * Real: Button, React reconciliation, and GPUIX native layout and event dispatch.
 * Doubles: focus/blur notifications for inactive windows, and a batched key-event sequence.
 * Requires: GPUIX native test renderer (macOS or Windows with graphics access).
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { createRef } from "react";
import { flushSync, handleGpuixEvent, type PublicInstance } from "@gpuix/react";

import { Button } from "../../src/button";
import { clickElement, elementByTestId } from "../_shared/native-elements";

let root: TestRoot;
beforeEach(() => {
	root = createTestRoot({
		width: 500,
		height: 240,
		onKeyDown(event, renderer) {
			if (event.key !== "tab") return;
			if (event.modifiers?.shift) renderer.focusPrevious?.();
			else renderer.focusNext?.();
		},
	});
});
afterEach(() => {
	root.unmount();
});

it("activates exactly once when Space down/up arrive in one React batch", () => {
	let presses = 0;
	root.render(
		<Button
			testId="button"
			onPress={() => {
				presses += 1;
			}}
		>
			Commit
		</Button>
	);
	const { id } = elementByTestId(root.renderer, "button");

	flushSync(() => {
		handleGpuixEvent(
			{ elementId: id, eventType: "keyDown", key: "space" },
			root.renderer
		);
		handleGpuixEvent(
			{ elementId: id, eventType: "keyUp", key: "space" },
			root.renderer
		);
		handleGpuixEvent(
			{ elementId: id, eventType: "keyUp", key: "space" },
			root.renderer
		);
	});

	expect(presses).toBe(1);
});

it("activates by mouse, Enter, and Space release", () => {
	let presses = 0;
	root.render(
		<Button
			testId="button"
			onPress={() => {
				presses += 1;
			}}
		>
			Commit
		</Button>
	);
	const button = elementByTestId(root.renderer, "button");

	clickElement(root.renderer, "button");
	expect(presses).toBe(1);
	root.renderer.nativeSimulateKeystrokes(button.id, "enter");
	expect(presses).toBe(2);
	root.renderer.nativeSimulateKeyDown(button.id, "space");
	expect(presses).toBe(2);
	root.renderer.nativeSimulateKeyUp(button.id, "space");
	expect(presses).toBe(3);
	expect(root.renderer.getPaintedText()).toContain("Commit");
});

it("ignores key repeats and Space release without an initial press", () => {
	let presses = 0;
	root.render(
		<Button
			testId="button"
			onPress={() => {
				presses += 1;
			}}
		>
			Commit
		</Button>
	);
	const button = elementByTestId(root.renderer, "button");

	root.renderer.nativeSimulateKeyUp(button.id, "space");
	root.renderer.nativeSimulateKeyDown(button.id, "space", true);
	root.renderer.nativeSimulateKeyUp(button.id, "space");
	root.renderer.nativeSimulateKeyDown(button.id, "enter", true);
	expect(presses).toBe(0);

	root.renderer.nativeSimulateKeyDown(button.id, "space");
	root.renderer.nativeSimulateKeyDown(button.id, "space", true);
	root.renderer.nativeSimulateKeyUp(button.id, "space");
	expect(presses).toBe(1);
});

it("shows focus and cancels an armed Space press when focus notifications arrive", () => {
	let presses = 0;
	root.render(
		<div style={{ display: "flex", gap: 10 }}>
			<Button
				testId="button"
				onPress={() => {
					presses += 1;
				}}
			>
				Commit
			</Button>
			<Button testId="other">Other</Button>
		</div>
	);
	const button = elementByTestId(root.renderer, "button");
	const other = elementByTestId(root.renderer, "other");

	root.renderer.nativeSimulateKeyDown(button.id, "space");
	// Offscreen windows are inactive, so deliver the focus notifications at the native event boundary.
	flushSync(() => {
		handleGpuixEvent(
			{ elementId: button.id, eventType: "focus" },
			root.renderer
		);
	});
	expect(elementByTestId(root.renderer, "button").style.borderColor).toBe(
		"#c4b5fd"
	);
	root.renderer.focusElement(other.id);
	flushSync(() => {
		handleGpuixEvent(
			{ elementId: button.id, eventType: "blur" },
			root.renderer
		);
	});
	root.renderer.nativeSimulateKeyUp(button.id, "space");
	expect(presses).toBe(0);
});

it("blocks disabled mouse and keyboard activation and skips the Tab order", () => {
	let presses = 0;
	root.render(
		<div style={{ display: "flex", gap: 10 }}>
			<Button
				disabled
				testId="disabled"
				onPress={() => {
					presses += 1;
				}}
			>
				Unavailable
			</Button>
			<Button testId="enabled">Available</Button>
		</div>
	);
	const disabled = elementByTestId(root.renderer, "disabled");
	const enabled = elementByTestId(root.renderer, "enabled");

	root.renderer.simulateKeystrokes("tab");
	expect(root.renderer.getFocusedElementId()).toBe(enabled.id);
	clickElement(root.renderer, "disabled");
	root.renderer.nativeSimulateKeystrokes(disabled.id, "enter space");
	expect(presses).toBe(0);
	expect(disabled.style.hover).toBeUndefined();
	expect(disabled.style.active).toBeUndefined();
});

it("cancels a pending press when disabled between key down and key up", () => {
	let presses = 0;
	const onPress = () => {
		presses += 1;
	};
	root.render(
		<Button testId="button" onPress={onPress}>
			Commit
		</Button>
	);
	const button = elementByTestId(root.renderer, "button");

	root.renderer.nativeSimulateKeyDown(button.id, "space");
	root.render(
		<Button disabled testId="button" onPress={onPress}>
			Commit
		</Button>
	);
	root.render(
		<Button testId="button" onPress={onPress}>
			Commit
		</Button>
	);
	root.renderer.nativeSimulateKeyUp(button.id, "space");
	expect(presses).toBe(0);
});

it("forwards the native ref and styles text and root separately without mutating inputs", () => {
	const ref = createRef<PublicInstance>();
	const style = {
		backgroundColor: "#112233",
		hover: { opacity: 0.8 },
	} as const;
	const textStyle = { color: "#abcdef" } as const;
	root.render(
		<Button ref={ref} testId="button" style={style} textStyle={textStyle}>
			Commit
		</Button>
	);
	const button = elementByTestId(root.renderer, "button");

	expect(ref.current?.id).toBe(button.id);
	expect(button.style.backgroundColor).toBe("#112233");
	expect(button.style.hover).toMatchObject({
		backgroundColor: "#7375f4",
		opacity: 0.8,
	});
	expect(
		root.renderer
			.findByType("text")
			.some((text) => text.style.color === "#abcdef")
	).toBe(true);
	expect(style).toEqual({
		backgroundColor: "#112233",
		hover: { opacity: 0.8 },
	});
	expect(
		Object.values(root.renderer.getA11yTree().nodes ?? {}).some(
			(node) => node.aria?.role === "Button" && node.aria.label === "Commit"
		)
	).toBe(true);
});
