/**
 * Covers: live palette/density controls and preserved example interaction state.
 * Real: example app, UI components, React, and GPUIX native layout/events.
 * Doubles: none.
 * Requires: GPUIX native test renderer (macOS or Windows with graphics access).
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";

import { ExampleApp } from "../../example/app";
import { densities, palettes } from "../../src/tokens";
import { clickElement, elementByTestId } from "../_shared/native-elements";

let root: TestRoot;
beforeEach(() => {
	root = createTestRoot({ width: 1120, height: 800 });
	root.render(<ExampleApp />);
});
afterEach(() => {
	root.unmount();
});

it("switches palette and density independently while preserving demo state", () => {
	clickElement(root.renderer, "button-primary-md");
	clickElement(root.renderer, "branch-select");
	clickElement(root.renderer, "branch-select-develop");
	expect(root.renderer.getPaintedText()).toContain("Activated 1 times");
	expect(root.renderer.getPaintedText()).toContain("Selected: develop");

	clickElement(root.renderer, "palette-light");
	expect(
		elementByTestId(root.renderer, "playground").style.backgroundColor
	).toBe(palettes.light.background);
	expect(elementByTestId(root.renderer, "button-primary-md").style.height).toBe(
		densities.comfortable.controlHeight
	);

	clickElement(root.renderer, "density-compact");
	expect(elementByTestId(root.renderer, "playground").style).toMatchObject({
		backgroundColor: palettes.light.background,
		padding: densities.compact.pagePadding,
	});
	expect(
		elementByTestId(root.renderer, "button-primary-md").style
	).toMatchObject({
		backgroundColor: palettes.light.accent,
		height: densities.compact.controlHeight,
	});
	expect(elementByTestId(root.renderer, "button-primary-sm").style.height).toBe(
		densities.compact.smallControlHeight
	);
	expect(elementByTestId(root.renderer, "branch-select").style.height).toBe(
		densities.compact.controlHeight
	);
	expect(root.renderer.getPaintedText()).toContain("Activated 1 times");
	expect(root.renderer.getPaintedText()).toContain("Selected: develop");

	clickElement(root.renderer, "palette-dark");
	clickElement(root.renderer, "density-comfortable");
	expect(
		elementByTestId(root.renderer, "playground").style.backgroundColor
	).toBe(palettes.dark.background);
	expect(elementByTestId(root.renderer, "button-primary-md").style.height).toBe(
		densities.comfortable.controlHeight
	);
	clickElement(root.renderer, "reset-count");
	expect(root.renderer.getPaintedText()).toContain("Activated 0 times");
});

it("keeps uncontrolled selection and disabled examples working after a keyboard token change", () => {
	clickElement(root.renderer, "uncontrolled-select");
	clickElement(root.renderer, "uncontrolled-select-archived");
	expect(
		root.renderer.findByTestId("uncontrolled-select-content")
	).toBeDefined();
	clickElement(root.renderer, "uncontrolled-select-develop");
	expect(
		root.renderer.findByTestId("uncontrolled-select-content")
	).toBeUndefined();

	const light = elementByTestId(root.renderer, "palette-light");
	root.renderer.nativeSimulateKeystrokes(light.id, "enter");
	expect(
		elementByTestId(root.renderer, "playground").style.backgroundColor
	).toBe(palettes.light.background);
	expect(root.renderer.getPaintedText()).toContain("Development");
	expect(root.renderer.getPaintedText()).toContain("Selected: main");

	clickElement(root.renderer, "button-disabled");
	clickElement(root.renderer, "disabled-select");
	expect(root.renderer.findByTestId("disabled-select-content")).toBeUndefined();
	expect(root.renderer.getPaintedText()).toContain("Activated 0 times");
});
