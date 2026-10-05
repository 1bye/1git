/**
 * Covers: native text rendering, typography defaults, and caller overrides.
 * Real: Text, React reconciliation, and GPUIX native rendering.
 * Doubles: none.
 * Requires: GPUIX native test renderer (macOS or Windows with graphics access).
 */
import { expect, it } from "bun:test";
import { createTestRoot } from "@gpuix/react/testing";
import { typography, fontWeight } from "@1git/design-tokens";

import { Text } from "../../src/text";
import { elementByTestId } from "../_shared/native-elements";

it("paints text with explicit color and allows typography overrides", () => {
	const root = createTestRoot({ width: 400, height: 200 });

	try {
		root.render(
			<Text
				testId="text"
				size="lg"
				tone="muted"
				weight="semibold"
				style={{ color: "#ffffff", fontSize: 18 }}
			>
				Hello {2} GPUIX
			</Text>
		);
		const text = elementByTestId(root.renderer, "text");

		expect(text.style).toMatchObject({
			color: "#ffffff",
			fontSize: 18,
			fontWeight: 600,
		});
		expect(root.renderer.getPaintedText()).toEqual(["Hello 2 GPUIX"]);
	} finally {
		root.unmount();
	}
});

it("uses the shared size/leading pairs and supports the complete emphasis scale", () => {
	const root = createTestRoot({ width: 400, height: 300 });

	try {
		for (const size of Object.keys(typography) as (keyof typeof typography)[]) {
			root.render(
				<Text testId="text" size={size} weight="bold">
					Title
				</Text>
			);
			expect(elementByTestId(root.renderer, "text").style).toMatchObject({
				...typography[size],
				fontWeight: fontWeight.bold,
			});
		}

		root.render(<Text testId="text">Body</Text>);
		expect(elementByTestId(root.renderer, "text").style).toMatchObject({
			...typography.md,
			fontWeight: fontWeight.regular,
		});
		root.render(
			<Text testId="text" size="2xl" style={{ fontSize: 17, lineHeight: 23 }}>
				Custom
			</Text>
		);
		expect(elementByTestId(root.renderer, "text").style).toMatchObject({
			fontSize: 17,
			lineHeight: 23,
		});
	} finally {
		root.unmount();
	}
});
