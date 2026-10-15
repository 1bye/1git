/**
 * Covers: local color validation/reset, worktree identity, persisted choices, palette contrast and style caching.
 * Real: repository color/theme and session models.
 * Doubles: none.
 * Requires: none; no native window, preferences or Git I/O.
 */
import { expect, it } from "bun:test";
import {
	RepositoryColors,
	repositoryColorPresets,
} from "../../src/feature/repository-appearance/repository-colors";
import { RepositoryTheme } from "../../src/styles/repository-theme";
import { appThemes, createThemedStyles } from "../../src/styles/theme";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";

it("validates optional preferences, normalizes colors and resets only the chosen repository", () => {
	const choices = RepositoryColors.parse({
		"/repo/.git": "#A478EF",
		"/other/.git": "#46b8b3",
		relative: "#528bff",
		"/invalid": "rgb(0 0 0)",
		"/nul\0": "#000000",
	});

	expect(choices).toEqual({
		"/repo/.git": "#a478ef",
		"/other/.git": "#46b8b3",
	});
	expect(RepositoryColors.set(choices, "/repo/.git", undefined)).toEqual({
		"/other/.git": "#46b8b3",
	});
	expect(choices["/repo/.git"]).toBe("#a478ef");
	expect(() => RepositoryColors.set(choices, "relative", "#ffffff")).toThrow();
	expect(() => RepositoryColors.set(choices, "/repo/.git", "#fff")).toThrow();

	for (const value of [undefined, null, [], false])
		expect(RepositoryColors.parse(value)).toEqual({});
});

it("persists common-directory choices independently of open tabs and tolerates old sessions", () => {
	const choices = RepositoryColors.set({}, "/repo/.git", "#a478ef");
	const empty = WorkspaceTabsModel.create(0);

	const captured = WorkspaceSession.capture(
		empty,
		undefined,
		"dark",
		true,
		"complete",
		choices
	);

	const restored = WorkspaceSession.parse(JSON.stringify(captured));

	expect(restored.repositoryColors).toEqual(choices);
	expect(restored.tabs).toEqual([]);
	expect(
		WorkspaceSession.parse(
			JSON.stringify({ version: 1, tabs: [], activeId: null })
		).repositoryColors
	).toBeUndefined();
	expect(
		WorkspaceSession.parse(
			JSON.stringify({ ...captured, repositoryColors: { "/repo/.git": "bad" } })
		).repositoryColors
	).toBeUndefined();
});

it("keeps defaults and semantic colors unchanged while giving every custom accent readable text", () => {
	for (const appearance of ["light", "dark"] as const) {
		const base = appThemes[appearance];

		expect(RepositoryTheme.create(base)).toBe(base);
		expect(RepositoryTheme.create(base, "invalid")).toBe(base);

		for (const color of [
			...repositoryColorPresets.map((preset) => preset.color),
			"#ffffff",
			"#000000",
			"#ffff00",
			"#ff0000",
			"#0000ff",
		]) {
			const themed = RepositoryTheme.create(base, color);

			expect(themed.colors.success).toBe(base.colors.success);
			expect(themed.colors.deletion).toBe(base.colors.deletion);
			expect(themed.colors.editorCodeBg).toBe(base.colors.editorCodeBg);
			expect(themed.tokens.colors.danger).toBe(base.tokens.colors.danger);
			expect(themed.tokens.layout).toBe(base.tokens.layout);
			expect(themed.colors.editorInk).toBe(base.colors.editorInk);

			for (const background of [
				themed.colors.editorSurface,
				themed.tokens.colors.accent,
				themed.tokens.colors.accentHover,
				themed.tokens.colors.accentPressed,
			])
				expect(
					RepositoryTheme.contrast(themed.tokens.colors.onAccent, background)
				).toBeGreaterThanOrEqual(4.5);
		}

		expect(base.colors.chrome).toBe("transparent");
	}
});

it("reuses cached styles per palette without sharing colors across windows", () => {
	let calls = 0;

	const styles = createThemedStyles(({ colors }) => {
		calls++;

		return { backgroundColor: colors.editorSurface };
	});

	const violet = RepositoryTheme.create(appThemes.dark, "#a478ef");
	const teal = RepositoryTheme.create(appThemes.dark, "#46b8b3");
	const first = styles.get(violet);

	expect(styles.get(violet)).toBe(first);
	expect(styles.get(teal)).not.toBe(first);
	expect(styles.get(appThemes.dark)).toBe(styles.dark);
	expect(calls).toBe(4);
	expect(styles.dark.backgroundColor).toBe(appThemes.dark.colors.editorSurface);
});
