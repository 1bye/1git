/**
 * Covers: controlled checkbox states, input, focus, disabled behavior and token changes.
 * Real: Checkbox, React and native GPUIX layout/events.
 * Doubles: focus/blur notifications for inactive windows and a batched Space event.
 * Requires: GPUIX native test renderer with graphics access; checked-state bridge is tested by the app.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { flushSync, handleGpuixEvent } from "@gpuix/react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { createRef, useState } from "react";
import type { PublicInstance } from "@gpuix/react";

import { Checkbox, type CheckboxState } from "../../src/checkbox";
import { densities, palettes } from "../../src/tokens";
import { clickElement, elementByTestId } from "../_shared/native-elements";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({
		width: 300,
		height: 200,
		onKeyDown(event, renderer) {
			if (event.key === "tab") renderer.focusNext?.();
		},
	});
});
afterEach(() => root.unmount());

function Example() {
	const [checked, setChecked] = useState<CheckboxState>("indeterminate");

	return (
		<Checkbox
			testId="check"
			aria-label="Include file"
			checked={checked}
			onCheckedChange={setChecked}
		/>
	);
}

it("toggles once from the label or box and disables the whole labelled control", () => {
	const changes: boolean[] = [];

	const render = (disabled = false) =>
		root.render(
			<Checkbox
				testId="labelled"
				label="Include untracked files"
				checked={false}
				disabled={disabled}
				onCheckedChange={(value) => changes.push(value)}
			/>
		);

	render();
	const checkbox = elementByTestId(root.renderer, "labelled");

	expect(checkbox.customProps?.["aria-label"]).toBe("Include untracked files");

	for (const child of checkbox.children) {
		const bounds = root.renderer.getElementBounds(child);

		if (!bounds) throw new Error("Missing checkbox child bounds");

		root.renderer.nativeSimulateClick(
			bounds.x + bounds.width / 2,
			bounds.y + bounds.height / 2
		);
	}

	expect(changes).toEqual([true, true]);
	root.renderer.nativeSimulateKeyDown(checkbox.id, "space");
	root.renderer.flush();
	root.renderer.nativeSimulateKeyUp(checkbox.id, "space");
	expect(changes).toEqual([true, true, true]);
	render(true);
	clickElement(root.renderer, "labelled");
	root.renderer.nativeSimulateKeystrokes(checkbox.id, "space");
	expect(changes).toEqual([true, true, true]);
});

it("activates mixed to checked, toggles by pointer, and preserves controlled ownership", () => {
	root.render(<Example />);
	expect(
		elementByTestId(root.renderer, "check").customProps?.["aria-checked"]
	).toBe("mixed");
	clickElement(root.renderer, "check");
	expect(
		elementByTestId(root.renderer, "check").customProps?.["aria-checked"]
	).toBe(true);
	clickElement(root.renderer, "check");
	expect(
		elementByTestId(root.renderer, "check").customProps?.["aria-checked"]
	).toBe(false);
	const changes: boolean[] = [];

	root.render(
		<Checkbox
			testId="check"
			aria-label="Include file"
			checked={false}
			onCheckedChange={(value) => changes.push(value)}
		/>
	);
	clickElement(root.renderer, "check");
	expect(changes).toEqual([true]);
	expect(
		elementByTestId(root.renderer, "check").customProps?.["aria-checked"]
	).toBe(false);
});

it("activates once on Space release, ignoring repeats, unarmed releases and modified shortcuts", () => {
	const changes: boolean[] = [];

	root.render(
		<Checkbox
			testId="check"
			aria-label="Include file"
			checked={false}
			onCheckedChange={(value) => changes.push(value)}
		/>
	);
	const { id } = elementByTestId(root.renderer, "check");

	root.renderer.nativeSimulateKeyUp(id, "space");
	root.renderer.nativeSimulateKeyDown(id, "space", true);
	root.renderer.nativeSimulateKeyUp(id, "space");
	root.renderer.nativeSimulateKeystrokes(id, "shift-space");
	expect(changes).toEqual([]);
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
	expect(changes).toEqual([true]);
});

it("shows keyboard-only focus and cancels Space after blur or disabling", () => {
	const changes: boolean[] = [];

	const render = (disabled = false) =>
		root.render(
			<Checkbox
				testId="check"
				aria-label="Include file"
				checked={true}
				disabled={disabled}
				onCheckedChange={(value) => changes.push(value)}
			/>
		);

	render();
	const { id } = elementByTestId(root.renderer, "check");

	const event = (eventType: string) =>
		flushSync(() =>
			handleGpuixEvent({ elementId: id, eventType }, root.renderer)
		);

	clickElement(root.renderer, "check");
	event("focus");
	expect(elementByTestId(root.renderer, "check").style.borderColor).toBe(
		"transparent"
	);
	root.renderer.nativeSimulateKeyDown(id, "space");
	expect(elementByTestId(root.renderer, "check").style.borderColor).toBe(
		palettes.dark.focusRing
	);
	event("blur");
	root.renderer.nativeSimulateKeyUp(id, "space");
	expect(changes).toEqual([false]);
	root.renderer.nativeSimulateKeyDown(id, "space");
	render(true);
	render();
	root.renderer.nativeSimulateKeyUp(id, "space");
	expect(changes).toEqual([false]);
});

it("blocks disabled input and skips it in Tab traversal", () => {
	let changes = 0;

	root.render(
		<div style={{ display: "flex" }}>
			<Checkbox
				testId="disabled"
				aria-label="Unavailable"
				checked={true}
				disabled
				onCheckedChange={() => {
					changes += 1;
				}}
			/>
			<Checkbox
				testId="enabled"
				aria-label="Available"
				checked={false}
				onCheckedChange={() => {}}
			/>
		</div>
	);
	const disabled = elementByTestId(root.renderer, "disabled");

	clickElement(root.renderer, "disabled");
	root.renderer.nativeSimulateKeystrokes(disabled.id, "space");
	root.renderer.simulateKeystrokes("tab");
	expect(changes).toBe(0);
	expect(root.renderer.getFocusedElementId()).toBe(
		elementByTestId(root.renderer, "enabled").id
	);
	expect(disabled.style.hover).toBeUndefined();
	expect(disabled.style.active).toBeUndefined();
});

it("forwards refs and metadata and updates token styles without changing checked state", () => {
	const ref = createRef<PublicInstance>();

	root.render(
		<Checkbox
			ref={ref}
			testId="check"
			aria-label="Include file"
			aria-description="Next commit"
			checked="indeterminate"
			tokens={{ colors: palettes.light, layout: densities.compact }}
			style={{ borderRadius: 8 }}
			onCheckedChange={() => {}}
		/>
	);
	const checkbox = elementByTestId(root.renderer, "check");

	expect(ref.current?.id).toBe(checkbox.id);
	expect(checkbox.style).toMatchObject({
		width: 24,
		height: 24,
		borderRadius: 8,
	});
	const box = root.renderer.getElement(checkbox.children[0] ?? -1);
	const mark = root.renderer.getElement(box?.children[0] ?? -1);

	expect(box?.style).toMatchObject({
		width: 12,
		height: 12,
		borderRadius: 4,
		backgroundColor: palettes.light.accent,
	});
	expect(mark?.style).toMatchObject({ width: 10, height: 10 });
	expect(checkbox.customProps).toMatchObject({
		"aria-checked": "mixed",
		"aria-description": "Next commit",
	});
	expect(
		Object.values(root.renderer.getA11yTree().nodes ?? {}).some(
			(node) =>
				node.aria?.role === "CheckBox" && node.aria.label === "Include file"
		)
	).toBe(true);
});
