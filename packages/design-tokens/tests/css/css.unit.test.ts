/**
 * Covers: committed CSS parity with renderer-neutral token values.
 * Real: token definitions and generated stylesheet.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";

import {
	controlLayout,
	controlSize,
	fontWeight,
	iconSize,
	lightColors,
	radius,
	spacing,
	typography,
	codeTypography,
	workspaceLayout,
} from "../../src/tokens";

it("exposes the same color and layout values to CSS consumers", async () => {
	const css = await Bun.file(
		new URL("../../src/light.css", import.meta.url)
	).text();

	for (const [name, value] of Object.entries(lightColors)) {
		const variable = name.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

		expect(css).toContain(`--${variable}: ${value};`);
	}

	expect(css).toContain(
		`--workspace-surface-radius: ${workspaceLayout.workspaceSurfaceRadius}px;`
	);
	expect(css).toContain(`--tab-width: ${workspaceLayout.tabWidth}px;`);
});

it("exposes every visual scale with pixel units and unitless weights without shadowing Tailwind", async () => {
	const css = await Bun.file(
		new URL("../../src/light.css", import.meta.url)
	).text();

	const variable = (name: string): string =>
		name
			.replace(/([a-z])([A-Z0-9])/g, "$1-$2")
			.replaceAll(".", "-")
			.toLowerCase();

	for (const [name, value] of Object.entries(typography)) {
		expect(css).toContain(`--1git-text-${name}: ${value.fontSize}px;`);
		expect(css).toContain(`--1git-leading-${name}: ${value.lineHeight}px;`);
		expect(css).not.toContain(`\n\t--text-${name}:`);
	}

	for (const [name, value] of Object.entries(fontWeight))
		expect(css).toContain(`--1git-weight-${name}: ${value};`);

	const groups = {
		space: spacing,
		radius,
		icon: iconSize,
		control: controlSize,
		...controlLayout,
	};

	for (const [prefix, values] of Object.entries(groups)) {
		for (const [name, value] of Object.entries(values))
			expect(css).toContain(`--1git-${prefix}-${variable(name)}: ${value}px;`);
	}

	expect(css).toContain(`--1git-code-size: ${codeTypography.fontSize}px;`);
	expect(css).toContain(`--1git-code-leading: ${codeTypography.lineHeight}px;`);
	expect(css).toContain(`--1git-code-font: ${codeTypography.fontFamily};`);
});
