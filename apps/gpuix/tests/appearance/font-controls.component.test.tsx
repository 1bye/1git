/**
 * Covers: installed-font discovery, font selection, size dragging, keyboard bounds and reset.
 * Real: macOS CoreText family enumeration, native input/layout and Appearance controls.
 * Doubles: in-memory preference persistence; no user preferences or repository reads.
 * Requires: patched native addon and macOS graphics access.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { useState } from "react";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { FontSettings } from "../../src/feature/appearance-settings/font-settings";
import { InstalledFonts } from "../../src/feature/appearance-settings/installed-fonts";
import {
	defaultTypography,
	type AppTypography,
} from "../../src/feature/appearance-settings/app-typography";

let root: TestRoot;
let changes: AppTypography[];

function Fixture({ onChange }: { onChange: (next: AppTypography) => void }) {
	const [value, setValue] = useState(defaultTypography);

	return (
		<AppThemeContext
			value={{
				...appThemes.light,
				commitTypeBadges: true,
				typography: value,
				setTypography: (next) => {
					setValue(next);
					onChange(next);
				},
			}}
		>
			<div
				textScale={value.fontSize / 12}
				style={{
					width: 500,
					height: 420,
					backgroundColor: "#ffffff",
					padding: 16,
				}}
			>
				<FontSettings />
			</div>
		</AppThemeContext>
	);
}

beforeEach(async () => {
	root = createTestRoot({ width: 500, height: 420 });
	changes = [];
	root.render(<Fixture onChange={(value) => changes.push(value)} />);
	await Bun.sleep(0);
	root.renderer.flush();
});
afterEach(() => root.unmount());

function node(id: string) {
	const element = root.renderer.findByTestId(id);

	if (!element) throw new Error(`Missing ${id}`);

	return element;
}
function click(id: string) {
	const box = root.renderer.getElementBounds(node(id).id);

	if (!box) throw new Error(`Missing ${id} bounds`);

	root.renderer.nativeSimulateClick(
		box.x + box.width / 2,
		box.y + box.height / 2
	);
	root.renderer.flush();
}

it("loads real installed fonts and applies picker choices immediately", async () => {
	const families = InstalledFonts.list(root.renderer);

	expect(families.length).toBeGreaterThan(20);
	expect(families).toContain("Helvetica Neue");
	expect(families).toContain("Menlo");
	expect(new Set(families).size).toBe(families.length);
	click("appearance-ui-font");
	root.renderer.scrollIntoView(node("appearance-ui-font-Helvetica Neue").id);
	root.renderer.advanceTime(1);
	click("appearance-ui-font-Helvetica Neue");
	await Bun.sleep(0);
	root.renderer.flush();
	expect(changes.at(-1)?.fontFamily).toBe("Helvetica Neue");
	click("appearance-code-font");
	root.renderer.scrollIntoView(node("appearance-code-font-Courier New").id);
	root.renderer.advanceTime(1);
	click("appearance-code-font-Courier New");
	expect(changes.at(-1)?.codeFontFamily).toBe("Courier New");

	if (process.env.GPUIX_FONT_SETTINGS_SCREENSHOT)
		root.renderer.captureScreenshot(process.env.GPUIX_FONT_SETTINGS_SCREENSHOT);

	click("appearance-reset-fonts");
	expect(changes.at(-1)).toEqual(defaultTypography);
});

it("adjusts size by keyboard and dragging, clamps at both ends and cancels a drag with Escape", () => {
	const slider = node("appearance-font-size");

	const key = (value: string) =>
		root.renderer.nativeSimulateKeyDown(slider.id, value);

	for (const value of ["home", "left", "right", "end", "right"]) key(value);

	expect(changes.map((value) => value.fontSize)).toEqual([10, 11, 18]);
	const box = root.renderer.getElementBounds(slider.id)!;
	const y = box.y + box.height / 2;

	root.renderer.nativeSimulateMouseDown(box.x + box.width / 2, y);
	expect(changes.at(-1)?.fontSize).toBe(14);
	root.renderer.nativeSimulateMouseMove(box.x + box.width + 40, y, 0);
	expect(changes.at(-1)?.fontSize).toBe(18);
	root.renderer.nativeSimulateMouseUp(box.x + box.width + 40, y);
	expect(
		root.renderer.findByTestId("appearance-font-size-drag")
	).toBeUndefined();
	root.renderer.nativeSimulateMouseDown(box.x + box.width / 2, y);
	root.renderer.nativeSimulateMouseMove(box.x - 40, y, 0);
	expect(changes.at(-1)?.fontSize).toBe(10);
	key("escape");
	expect(changes.at(-1)?.fontSize).toBe(18);
	expect(
		root.renderer.findByTestId("appearance-font-size-drag")
	).toBeUndefined();
});
