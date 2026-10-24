/**
 * Covers: palette endpoints, alpha blending and validation of saved transition preferences.
 * Real: theme blending, Bun CSS color parsing and workspace session parsing.
 * Doubles: none.
 * Requires: Bun; no native window or filesystem I/O.
 */
import { expect, it } from "bun:test";
import { ThemeTransition } from "../../src/styles/theme-transition";
import { appThemes } from "../../src/styles/theme";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";

it("blends complete palettes and retains exact endpoints", () => {
	const from = appThemes.light.colors;
	const to = appThemes.dark.colors;
	const middle = ThemeTransition.palette(from, to, 0.5);

	expect(ThemeTransition.palette(from, to, 0)).toEqual(from);
	expect(ThemeTransition.palette(from, to, 1)).toEqual(to);
	expect(Object.keys(middle)).toEqual(Object.keys(to));
	expect(Bun.color(middle.editorSurface, "{rgba}")).toEqual({
		r: 144,
		g: 145,
		b: 147,
		a: 1,
	});

	for (const value of Object.values(middle))
		expect(Bun.color(value, "{rgba}")).not.toBeNull();
});

it("fades transparent tints without introducing black and handles alpha colors", () => {
	expect(
		Bun.color(ThemeTransition.color("#ff000080", "transparent", 0.5), "{rgba}")
	).toMatchObject({ r: 255, g: 0, b: 0 });
	const fade = Bun.color(
		ThemeTransition.color("transparent", "#ff0000", 0.5),
		"{rgba}"
	);

	expect(fade).toMatchObject({ r: 255, g: 0, b: 0 });
	expect(fade?.a).toBeCloseTo(0.5, 2);
	expect(ThemeTransition.color("transparent", "transparent", 0.5)).toBe(
		"transparent"
	);
	expect(ThemeTransition.color("invalid", "#ffffff", 0.5)).toBe("#ffffff");
});

it("round-trips both saved choices and ignores malformed preferences", () => {
	const state = WorkspaceTabsModel.create();

	for (const enabled of [true, false]) {
		const document = WorkspaceSession.capture(
			state,
			undefined,
			"light",
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			enabled
		);

		expect(
			WorkspaceSession.parse(JSON.stringify(document)).smoothTransitions
		).toBe(enabled);
	}

	const document = WorkspaceSession.capture(state);

	for (const smoothTransitions of [undefined, null, "true", 1, {}]) {
		const parsed = WorkspaceSession.parse(
			JSON.stringify({ ...document, smoothTransitions })
		);

		expect(parsed.smoothTransitions).toBeUndefined();
		expect(parsed.tabs).toEqual(document.tabs);
	}
});
