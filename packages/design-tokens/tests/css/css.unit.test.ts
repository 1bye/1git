/**
 * Covers: committed CSS parity with renderer-neutral token values.
 * Real: token definitions and generated stylesheet.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";

import { lightColors, workspaceLayout } from "../../src/tokens";

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
