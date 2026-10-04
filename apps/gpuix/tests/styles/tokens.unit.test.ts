/**
 * Covers: app-wide transparent fields and hidden focus outlines without transparent menus or selection.
 * Real: native app theme tokens. Doubles: none. Requires: none.
 */
import { expect, it } from "bun:test";
import { appTokens } from "../../src/styles/tokens";

it("keeps fields transparent at rest and on hover while retaining interaction contrast", () => {
	expect(appTokens.focusVisible).toBe(false);
	expect(appTokens.colors.field).toBe("transparent");
	expect(appTokens.colors.fieldHover).toBe("transparent");

	for (const color of [
		appTokens.colors.border,
		appTokens.colors.focusRing,
		appTokens.colors.overlay,
		appTokens.colors.selected,
	]) {
		expect(color).not.toBe("transparent");
	}
});
