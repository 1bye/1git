/**
 * Covers: controlled multiline editing, undo, read-only input, tokens and native accessibility.
 * Real: Textarea, React, and the GPUIX native editor.
 * Doubles: none.
 * Requires: native GPUIX test renderer with graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { useState } from "react";

import { Textarea } from "../../src/textarea";
import { densities, palettes, type UiTokens } from "../../src/tokens";
import { elementByTestId } from "../_shared/native-elements";

const tokens: UiTokens = { colors: palettes.light, layout: densities.compact };
let root: TestRoot;

function Editor({ readOnly = false }: { readOnly?: boolean }) {
	const [value, setValue] = useState("");

	return (
		<Textarea
			testId="editor"
			aria-label="Message"
			placeholder="Write a message"
			value={value}
			onValueChange={setValue}
			readOnly={readOnly}
			tokens={tokens}
			style={{ width: 300, fontSize: 12 }}
		/>
	);
}

beforeEach(() => {
	root = createTestRoot({ width: 400, height: 240 });
});
afterEach(() => root.unmount());

it("uses native multiline editing and undo while exposing its accessible value", () => {
	root.render(<Editor />);
	const editor = elementByTestId(root.renderer, "editor");

	expect(root.renderer.getPaintedText()).toContain("Write a message");
	root.renderer.nativeSimulateKeystrokes(editor.id, "h i enter b");
	expect(elementByTestId(root.renderer, "editor").customProps?.value).toBe(
		"hi\nb"
	);
	root.renderer.nativeSimulateKeystrokes(editor.id, "enter");
	expect(elementByTestId(root.renderer, "editor").customProps?.value).toBe(
		"hi\nb\n"
	);
	root.renderer.nativeSimulateKeystrokes(editor.id, "cmd-z");
	expect(elementByTestId(root.renderer, "editor").customProps?.value).toBe(
		"hi\nb"
	);
	expect(
		Object.values(root.renderer.getA11yTree().nodes ?? {}).some(
			(node) =>
				node.aria?.role === "MultilineTextInput" &&
				node.aria.label === "Message" &&
				node.aria.value === "hi\nb"
		)
	).toBe(true);
});

it("applies token styling and caller overrides while preserving native read-only behavior", () => {
	root.render(<Editor readOnly />);
	const editor = elementByTestId(root.renderer, "editor");

	expect(editor.style).toMatchObject({
		backgroundColor: palettes.light.field,
		color: palettes.light.text,
		padding: densities.compact.fieldPadding,
		fontSize: 12,
	});
	expect(editor.customProps?.theme).toMatchObject({
		caret: palettes.light.accent,
	});
	root.renderer.nativeSimulateKeystrokes(editor.id, "x enter");
	expect(elementByTestId(root.renderer, "editor").customProps?.value).toBe("");
});
