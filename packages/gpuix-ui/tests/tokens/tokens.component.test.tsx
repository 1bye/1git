/**
 * Covers: independent palette/density updates, custom tokens, focus appearance, and tokenized Select parts.
 * Real: UI controls, React reconciliation, and GPUIX native layout and styles.
 * Doubles: focus notifications for inactive native test windows.
 * Requires: GPUIX native test renderer (macOS or Windows with graphics access).
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { flushSync, handleGpuixEvent } from "@gpuix/react";

import { Button } from "../../src/button";
import { Checkbox } from "../../src/checkbox";
import { DiffView } from "../../src/diff-view";
import { Textarea } from "../../src/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../src/select";
import { Text } from "../../src/text";
import {
	defaultTokens,
	densities,
	palettes,
	type UiTokens,
} from "../../src/tokens";
import { elementByTestId } from "../_shared/native-elements";

let root: TestRoot;

beforeEach(() => {
	root = createTestRoot({ width: 600, height: 400 });
});
afterEach(() => {
	root.unmount();
});

function TokenControls({ tokens }: { tokens: UiTokens }) {
	return (
		<div>
			<Button tokens={tokens} testId="button" variant="secondary">
				Commit
			</Button>
			<Text tokens={tokens} testId="text" tone="muted">
				Ready
			</Text>
			<Button testId="default">Default</Button>
		</div>
	);
}

it("updates colors and layout independently on rerender without changing defaults", () => {
	root.render(<TokenControls tokens={defaultTokens} />);
	const initialButtonId = elementByTestId(root.renderer, "button").id;

	expect(elementByTestId(root.renderer, "button").style).toMatchObject({
		backgroundColor: palettes.dark.surface,
		height: densities.comfortable.controlHeight,
	});

	root.render(
		<TokenControls
			tokens={{ colors: palettes.light, layout: densities.comfortable }}
		/>
	);
	expect(elementByTestId(root.renderer, "button").style).toMatchObject({
		backgroundColor: palettes.light.surface,
		height: densities.comfortable.controlHeight,
		hover: { backgroundColor: palettes.light.surfaceHover },
		active: { backgroundColor: palettes.light.surfacePressed },
	});
	expect(elementByTestId(root.renderer, "text").style.color).toBe(
		palettes.light.textMuted
	);
	expect(
		root.renderer
			.findByType("text")
			.some((text) => text.style.color === palettes.light.textControl)
	).toBe(true);

	root.render(
		<TokenControls
			tokens={{ colors: palettes.light, layout: densities.compact }}
		/>
	);
	expect(elementByTestId(root.renderer, "button").style).toMatchObject({
		backgroundColor: palettes.light.surface,
		height: densities.compact.controlHeight,
		paddingLeft: densities.compact.controlPadding,
		gap: densities.compact.gap,
	});
	expect(elementByTestId(root.renderer, "default").style).toMatchObject({
		backgroundColor: palettes.dark.accent,
		height: densities.comfortable.controlHeight,
	});
	expect(elementByTestId(root.renderer, "button").id).toBe(initialButtonId);
	expect(defaultTokens.colors).toBe(palettes.dark);
	expect(defaultTokens.layout).toBe(densities.comfortable);
});

it("accepts custom values while retaining final caller style overrides", () => {
	const tokens: UiTokens = {
		colors: { ...palettes.light, accent: "#123456", onAccent: "#fedcba" },
		layout: { ...densities.compact, smallControlHeight: 32 },
	};

	root.render(
		<Button
			tokens={tokens}
			testId="button"
			size="sm"
			style={{ paddingLeft: 20 }}
			textStyle={{ fontSize: 15 }}
		>
			Commit
		</Button>
	);

	expect(elementByTestId(root.renderer, "button").style).toMatchObject({
		backgroundColor: "#123456",
		height: 32,
		paddingLeft: 20,
		paddingRight: densities.compact.smallControlPadding,
	});
	expect(
		root.renderer
			.findByType("text")
			.some(
				(text) => text.style.color === "#fedcba" && text.style.fontSize === 15
			)
	).toBe(true);
});

it("disables outlines across controls without removing borders, focus or keyboard activation", () => {
	const tokens = { ...defaultTokens, focusVisible: false };
	let presses = 0;
	let checked = false;

	root.render(
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<Button
				tokens={tokens}
				testId="button"
				onPress={() => {
					presses += 1;
				}}
			>
				Commit
			</Button>
			<Checkbox
				tokens={tokens}
				testId="checkbox"
				aria-label="Include file"
				checked={checked}
				onCheckedChange={(value) => {
					checked = value;
				}}
			/>
			<Textarea
				tokens={tokens}
				testId="textarea"
				aria-label="Message"
				value=""
				onValueChange={() => {}}
				style={{ borderColor: "#123456" }}
			/>
			<Select defaultValue="main">
				<SelectTrigger tokens={tokens} testId="trigger" aria-label="Branch">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="main">main</SelectItem>
				</SelectContent>
			</Select>
			<DiffView
				tokens={tokens}
				testId="diff"
				aria-label="File preview"
				patch=""
			/>
		</div>
	);

	for (const [testId, borderColor] of [
		["button", "transparent"],
		["checkbox", "transparent"],
		["textarea", "#123456"],
		["trigger", tokens.colors.border],
		["diff", "transparent"],
	] as const) {
		const control = elementByTestId(root.renderer, testId);

		root.renderer.focusElement(control.id);
		flushSync(() =>
			handleGpuixEvent(
				{ elementId: control.id, eventType: "focus" },
				root.renderer
			)
		);
		expect(elementByTestId(root.renderer, testId).style.borderColor).toBe(
			borderColor
		);
		expect(root.renderer.getFocusedElementId()).toBe(control.id);
	}

	root.renderer.nativeSimulateKeyDown(
		elementByTestId(root.renderer, "button").id,
		"enter"
	);
	root.renderer.nativeSimulateKeyDown(
		elementByTestId(root.renderer, "checkbox").id,
		"space"
	);
	root.renderer.flush();
	root.renderer.nativeSimulateKeyUp(
		elementByTestId(root.renderer, "checkbox").id,
		"space"
	);
	expect(presses).toBe(1);
	expect(checked).toBe(true);
});

function TokenSelect({ tokens }: { tokens: UiTokens }) {
	return (
		<Select defaultValue="main" defaultOpen>
			<SelectTrigger tokens={tokens} testId="trigger" aria-label="Branch">
				<SelectValue tokens={tokens} testId="value" />
			</SelectTrigger>
			<SelectContent tokens={tokens} testId="content">
				<SelectItem tokens={tokens} testId="item" value="main">
					main
				</SelectItem>
			</SelectContent>
		</Select>
	);
}

it("updates every styled Select part while the popup remains open", () => {
	root.render(<TokenSelect tokens={defaultTokens} />);
	const initialPopupId = elementByTestId(root.renderer, "content").id;

	expect(elementByTestId(root.renderer, "content").style.backgroundColor).toBe(
		palettes.dark.overlay
	);

	root.render(
		<TokenSelect
			tokens={{ colors: palettes.light, layout: densities.compact }}
		/>
	);

	expect(elementByTestId(root.renderer, "trigger").style).toMatchObject({
		backgroundColor: palettes.light.field,
		borderColor: palettes.light.accentBorder,
		height: densities.compact.controlHeight,
		paddingLeft: densities.compact.fieldPadding,
	});
	expect(elementByTestId(root.renderer, "value").style.color).toBe(
		palettes.light.text
	);
	expect(elementByTestId(root.renderer, "content").style).toMatchObject({
		backgroundColor: palettes.light.overlay,
		padding: densities.compact.menuPadding,
		boxShadow: { color: palettes.light.shadow },
	});
	expect(elementByTestId(root.renderer, "item").style).toMatchObject({
		color: palettes.light.text,
		minHeight: densities.compact.itemHeight,
		paddingLeft: densities.compact.itemPadding,
	});
	expect(root.renderer.getPaintedText()).toContain("main");
	expect(elementByTestId(root.renderer, "content").id).toBe(initialPopupId);
});
