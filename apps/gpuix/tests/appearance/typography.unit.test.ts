/**
 * Covers: safe text preferences, font-name validation and session restoration.
 * Real: typography preferences and workspace session parser.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import {
	defaultTypography,
	TypographyPreferences,
} from "../../src/feature/appearance-settings/app-typography";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";

it("restores bounded text preferences and ignores invalid sizes or unsafe font names", () => {
	expect(TypographyPreferences.parse(null)).toEqual(defaultTypography);
	expect(
		TypographyPreferences.parse({
			fontSize: 99,
			fontFamily: "bad\0font",
			codeFontFamily: "x".repeat(129),
		})
	).toEqual(defaultTypography);
	const typography = {
		fontSize: 16,
		fontFamily: "Helvetica Neue",
		codeFontFamily: "SF Mono",
	} as const;

	expect(
		TypographyPreferences.parse({
			...typography,
			fontFamily: " Helvetica Neue ",
		})
	).toEqual(typography);
	expect(
		WorkspaceSession.parse(
			JSON.stringify({ version: 1, tabs: [], activeId: null, typography })
		).typography
	).toEqual(typography);
});

it("restores every slider size and rejects out-of-range or fractional values", () => {
	for (const fontSize of [10, 11, 13, 15, 17, 18])
		expect(TypographyPreferences.parse({ fontSize }).fontSize).toBe(fontSize);

	for (const fontSize of [9, 19, 12.5, Number.NaN, "14"])
		expect(TypographyPreferences.parse({ fontSize }).fontSize).toBe(12);
});
