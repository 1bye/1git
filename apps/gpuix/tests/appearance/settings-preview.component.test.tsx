/**
 * Covers: Appearance's live, repository-free preview follows fonts, size, theme and badge preferences.
 * Real: settings controls, commit subjects, diff palette and native text layout/input.
 * Doubles: in-memory preferences only. Requires: native addon and graphics access.
 */
import { expect, it } from "bun:test";
import { useState } from "react";
import { createTestRoot } from "@gpuix/react/testing";
import { AppThemeContext, appThemes } from "../../src/styles/theme";
import { AppearanceSettings } from "../../src/feature/appearance-settings/appearance-settings";
import { defaultTypography } from "../../src/feature/appearance-settings/app-typography";
import { windowOptions } from "../../src/window-options";
function Fixture() {
	const [appearance, setAppearance] = useState<"light" | "dark">("light");
	const [typography, setTypography] = useState(defaultTypography);
	const [commitTypeBadges, setCommitTypeBadges] = useState(true);

	return (
		<AppThemeContext
			value={{
				...appThemes[appearance],
				appearancePreference: appearance,
				setAppearance: (value) => {
					if (value !== "system") setAppearance(value);
				},
				typography,
				setTypography,
				commitTypeBadges,
				setCommitTypeBadges,
			}}
		>
			<div style={{ display: "flex", height: "100%", flexDirection: "column" }}>
				<AppearanceSettings />
			</div>
		</AppThemeContext>
	);
}
it("updates the visible preview immediately while retaining a plain commit subject", async () => {
	const root = createTestRoot({
		width: 1080,
		height: 760,
		onKeyDown: windowOptions.onKeyDown,
	});

	const node = (id: string) => {
		const value = root.renderer.findByTestId(id);

		if (!value) throw new Error(`Missing ${id}`);

		return value;
	};

	const settle = async () => {
		for (let n = 0; n < 6; n++) {
			await Bun.sleep(0);
			root.renderer.flush();
		}
	};

	const press = async (id: string, key = "enter") => {
		root.renderer.nativeSimulateKeyDown(node(id).id, key);
		await settle();
	};

	const choose = async (id: string) => {
		root.renderer.scrollIntoView(node(id).id);
		root.renderer.advanceTime(1);
		const box = root.renderer.getElementBounds(node(id).id)!;

		root.renderer.nativeSimulateClick(
			box.x + box.width / 2,
			box.y + box.height / 2
		);
		await settle();
	};

	try {
		root.render(<Fixture />);
		await settle();
		expect(node("appearance-commit-preview-feat-badge")).toBeDefined();
		expect(
			root.renderer.findByTestId("appearance-commit-preview-plain-badge")
		).toBeUndefined();
		const before = root.renderer.getElementBounds(
			node("appearance-diff-preview-0").id
		)!;

		await press("appearance-font-size", "end");
		expect(node("appearance-live-preview").customProps?.textScale).toBe(1.5);
		expect(
			root.renderer.getElementBounds(node("appearance-diff-preview-0").id)!
				.height
		).toBeGreaterThan(before.height);
		await press("appearance-ui-font");
		await choose("appearance-ui-font-Helvetica Neue");
		expect(node("appearance-live-preview").style?.fontFamily).toBe(
			"Helvetica Neue"
		);
		await press("appearance-code-font");
		await choose("appearance-code-font-Courier New");
		expect(node("appearance-diff-preview-0").style?.fontFamily).toBe(
			"Courier New"
		);
		const background = node("appearance-live-preview").style?.backgroundColor;

		await press("appearance-dark");
		expect(node("appearance-live-preview").style?.backgroundColor).not.toBe(
			background
		);
		await press("appearance-commit-type-badges", "space");
		root.renderer.nativeSimulateKeyUp(
			node("appearance-commit-type-badges").id,
			"space"
		);
		await settle();
		expect(
			root.renderer.findByTestId("appearance-commit-preview-feat-badge")
		).toBeUndefined();
		expect(root.renderer.getAllText()).toContain(
			"feat(core): add workspace shortcuts"
		);
		await press("appearance-reset-fonts");
		expect(node("appearance-live-preview").customProps?.textScale).toBe(1);
	} finally {
		root.unmount();
	}
});
