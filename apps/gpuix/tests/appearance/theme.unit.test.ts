/**
 * Covers: matching palettes, readable dark text and accents, independent precomputed styles and safe session preferences.
 * Real: app tokens, theme factory and session parsing/capture.
 * Doubles: none.
 * Requires: none; no native window or filesystem I/O.
 */
import { expect, it } from "bun:test";
import { appColors, appControlTokens } from "../../src/styles/tokens";
import { appThemes, createThemedStyles } from "../../src/styles/theme";
import { darkDiffTheme } from "../../src/styles/dark-diff-theme";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";

function luminance(color: string): number {
	const values = [1, 3, 5].map((offset) => {
		const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;

		return channel <= 0.04045
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4;
	});

	return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}

function contrast(text: string, background: string): number {
	const first = luminance(text);
	const second = luminance(background);

	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

it("keeps complete palettes and transparent fields without changing density", () => {
	expect(Object.keys(appColors.dark).sort()).toEqual(
		Object.keys(appColors.light).sort()
	);
	expect(appControlTokens.dark.layout).toBe(appControlTokens.light.layout);
	expect(appColors.light.chrome).toBe("transparent");
	expect(appColors.dark.chrome).toBe("transparent");
	expect(appControlTokens.dark.colors.field).toBe("transparent");
	expect(appControlTokens.dark.colors.fieldHover).toBe("transparent");
	expect(appControlTokens.light.colors.background).toBe("#ffffff");
	expect(appControlTokens.dark.colors.overlay).toBe(
		appColors.dark.editorSurface
	);
});

it("retains readable dark text, syntax and actionable accents", () => {
	const colors = appColors.dark;

	for (const color of [
		colors.editorInk,
		colors.editorMuted,
		colors.editorFaint,
		colors.brand,
		colors.success,
		colors.deletion,
	])
		expect(contrast(color, colors.editorSurface)).toBeGreaterThanOrEqual(4.5);

	expect(contrast(colors.brandForeground, colors.brand)).toBeGreaterThanOrEqual(
		4.5
	);

	for (const color of Object.values(darkDiffTheme.syntax ?? {}))
		for (const background of [
			colors.editorSurface,
			darkDiffTheme.diffAddBg!,
			darkDiffTheme.diffDelBg!,
		])
			expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
});

it("precomputes independent style values without mutating a shared palette", () => {
	const calls: string[] = [];

	const styles = createThemedStyles(({ appearance, colors }) => {
		calls.push(appearance);

		return { backgroundColor: colors.editorSurface };
	});

	expect(calls).toEqual(["light", "dark"]);
	expect(styles.light).not.toBe(styles.dark);
	expect(styles.dark.backgroundColor).toBe(appThemes.dark.colors.editorSurface);
	expect(styles.light.backgroundColor).toBe(
		appThemes.light.colors.editorSurface
	);
	expect(calls).toHaveLength(2);
});

it("round-trips appearance and tolerates missing or invalid optional preferences", () => {
	const state = WorkspaceTabsModel.create();
	const captured = WorkspaceSession.capture(state, undefined, "dark");

	expect(WorkspaceSession.parse(JSON.stringify(captured))).toEqual(captured);

	for (const appearance of [undefined, "system", "future-mode", 5, null]) {
		const parsed = WorkspaceSession.parse(
			JSON.stringify({ ...captured, appearance })
		);

		expect(parsed.appearance).toBeUndefined();
		expect(parsed.tabs).toEqual(captured.tabs);
	}
});
