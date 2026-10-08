/**
 * Covers: paired typography, canonical sizing, and density values derived from shared scales.
 * Real: design token definitions. Doubles: none. Requires: none.
 */
import { expect, it } from "bun:test";
import {
	controlLayout,
	controlSize,
	fontWeight,
	iconSize,
	radius,
	spacing,
	typography,
	workspaceLayout,
} from "../../src/tokens";

it("keeps text size and leading paired in ascending desktop sizes", () => {
	expect(Object.keys(typography)).toEqual([
		"2xs",
		"xs",
		"sm",
		"md",
		"lg",
		"xl",
		"2xl",
	]);
	const sizes = Object.values(typography);

	expect(sizes.map((size) => size.fontSize)).toEqual([
		9, 10, 11, 12, 14, 18, 20,
	]);
	expect(sizes.map((size) => size.lineHeight)).toEqual([
		12, 14, 16, 18, 20, 24, 28,
	]);
	expect(Object.values(fontWeight)).toEqual([400, 500, 600, 700]);
});

it("provides stable rounding, icon, spacing and control defaults", () => {
	expect(radius.md).toBe(4);
	expect(radius.lg).toBe(6);
	expect(radius.xl).toBe(8);
	expect(workspaceLayout.workspaceSurfaceRadius).toBe(14);
	expect(workspaceLayout.tabRadius).toBe(10);
	expect(radius.full).toBe(9999);
	expect(iconSize.md).toBe(16);

	for (const [step, pixels] of Object.entries(spacing))
		expect(Number(step) * 4).toBe(pixels);

	expect(controlLayout.compact).toMatchObject({
		controlHeight: controlSize.md,
		smallControlHeight: controlSize.sm,
		gap: spacing[1.5],
		fieldPadding: spacing[2],
	});
	expect(controlLayout.comfortable).toMatchObject({
		controlHeight: controlSize.lg,
		smallControlHeight: controlSize.md,
		gap: spacing[2],
		fieldPadding: spacing[2.5],
	});
});
