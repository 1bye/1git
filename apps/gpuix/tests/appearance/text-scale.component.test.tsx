/**
 * Covers: native scaling of host text, deferred virtual-list text and native text fields.
 * Real: GPUIX text shaping, font inheritance and the app's textScale patch.
 * Doubles: none.
 * Requires: native preload and macOS graphics access.
 */
import { AppearanceSettings } from "../../src/feature/appearance-settings/appearance-settings";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { expect, it } from "bun:test";
import { createTestRoot } from "@gpuix/react/testing";

it("scales explicit sizes once throughout a subtree and preserves native fields", () => {
	const root = createTestRoot({ width: 400, height: 300 });

	const render = (scale: number) =>
		root.render(
			<div
				textScale={scale}
				style={{ width: 400, height: 300, fontFamily: "Helvetica Neue" }}
			>
				<text testId="sample" style={{ fontSize: 12, lineHeight: 18 }}>
					Sample text
				</text>
				<virtual-list
					style={{ width: 400, height: 100 }}
					estimatedItemHeight={24}
				>
					<text testId="row" style={{ fontSize: 12, lineHeight: 18 }}>
						Virtual row
					</text>
				</virtual-list>
				<input
					testId="field"
					value="Retain this draft"
					style={{ fontSize: 12, lineHeight: 18, height: 40 }}
				/>
			</div>
		);

	const bounds = (testId: string) => {
		const node = root.renderer.findByTestId(testId);

		if (!node) throw new Error(`Missing ${testId}`);

		const bounds = root.renderer.getElementBounds(node.id);

		if (!bounds) throw new Error(`Missing ${testId} bounds`);

		return bounds;
	};

	try {
		render(1);
		const initial = bounds("sample");
		const row = bounds("row");
		const field = root.renderer.findByTestId("field")!;

		render(4 / 3);
		expect(bounds("sample").height).toBeGreaterThan(initial.height * 1.2);
		expect(bounds("row").height).toBeGreaterThan(row.height * 1.2);
		expect(root.renderer.findByTestId("field")?.id).toBe(field.id);
		expect(root.renderer.findByTestId("field")?.customProps?.value).toBe(
			"Retain this draft"
		);
		render(1);
		expect(bounds("sample").height).toBeCloseTo(initial.height, 0);
	} finally {
		root.unmount();
	}
});

it("keeps font controls scrollable at the minimum window height", () => {
	const root = createTestRoot({ width: 640, height: 420 });

	try {
		root.render(
			<AppThemeContext value={{ ...appThemes.dark, commitTypeBadges: true }}>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						width: 640,
						height: 420,
					}}
				>
					<AppearanceSettings />
				</div>
			</AppThemeContext>
		);
		const settings = root.renderer.findByTestId("appearance-settings-scroll")!;
		const apply = root.renderer.findByTestId("appearance-reset-fonts")!;

		expect(
			root.renderer.getElementBounds(settings.id)!.height
		).toBeLessThanOrEqual(420);
		root.renderer.scrollIntoView(apply.id);
		root.renderer.advanceTime(1);
		const bounds = root.renderer.getElementBounds(apply.id)!;

		expect(bounds.y).toBeGreaterThanOrEqual(0);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(420);
		expect(root.renderer.getScrollOffset(settings.id)![1]).toBeLessThan(0);
	} finally {
		root.unmount();
	}
});
