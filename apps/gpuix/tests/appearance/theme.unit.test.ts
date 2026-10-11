/**
 * Covers: matching palettes, GitHub Dark token roles, readable dark text and accents, independent precomputed styles and safe session preferences.
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

	for (const background of [
		appControlTokens.dark.colors.accent,
		appControlTokens.dark.colors.accentHover,
		appControlTokens.dark.colors.accentPressed,
	])
		expect(contrast(colors.brandForeground, background)).toBeGreaterThanOrEqual(
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

it("uses quiet dark accent fills with brighter foregrounds, leaving light controls unchanged", () => {
	const { colors } = appControlTokens.dark;

	expect(luminance(colors.onAccent)).toBeGreaterThan(luminance(colors.accent));
	expect(contrast(colors.accent, appColors.dark.editorSurface)).toBeLessThan(2);
	expect(colors.onAccent).toBe(appColors.dark.brand);
	expect(colors.focusRing).toBe(appColors.dark.brand);
	expect(darkDiffTheme.accent).toBe(colors.accent);
	expect(darkDiffTheme).toHaveProperty("diffInclusionText", colors.onAccent);
	expect(appControlTokens.light.colors.accent).toBe(appColors.light.brand);
	expect(appControlTokens.light.colors.onAccent).toBe(
		appColors.light.brandForeground
	);
});

it("maps GitHub Dark token roles without recoloring diff surfaces", () => {
	expect(darkDiffTheme).toMatchObject({
		text: "#e6edf3",
		diffAdd: "#e6edf3",
		diffDel: "#e6edf3",
		syntax: {
			comment: "#b1bac4",
			keyword: "#ff7b72",
			typeName: "#ffa657",
			constructor: "#ffa657",
			function: "#d2a8ff",
			macroName: "#d2a8ff",
			typeBuiltin: "#79c0ff",
			functionBuiltin: "#79c0ff",
			constant: "#79c0ff",
			number: "#79c0ff",
			boolean: "#79c0ff",
			variableSpecial: "#79c0ff",
			string: "#a5d6ff",
			stringSpecial: "#a5d6ff",
			escape: "#ff7b72",
			attribute: "#79c0ff",
			tag: "#7ee787",
			variable: "#e6edf3",
			parameter: "#e6edf3",
			property: "#e6edf3",
			punctuation: "#e6edf3",
			label: "#ffa657",
		},
		diffAddBg: "#25392d",
		diffDelBg: "#422a30",
		diffAddWordBg: "#365940",
		diffDelWordBg: "#703b46",
		diffHunkBg: "#25282f",
	});
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
