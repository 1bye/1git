/**
 * Covers: independent palette/density updates, custom tokens, and tokenized Select parts.
 * Real: UI controls, React reconciliation, and GPUIX native layout and styles.
 * Doubles: none.
 * Requires: GPUIX native test renderer (macOS or Windows with graphics access).
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";

import { Button } from "../../src/button";
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
