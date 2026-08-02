import { describe, expect, test } from "bun:test";
import { getLiquidMenuAnchorPresentation } from "@/fixture/liquid-menu/lib/liquid-menu-layer.js";

describe("liquid menu ordered layers", () => {
	test("promotes only the active foreground anchor", () => {
		expect(
			getLiquidMenuAnchorPresentation({
				hasSurface: false,
				isObscured: false,
				isOpen: true,
			})
		).toEqual({
			isActive: true,
			isPromoted: true,
		});
	});

	test("keeps an obscured parent active without promoting it", () => {
		expect(
			getLiquidMenuAnchorPresentation({
				hasSurface: true,
				isObscured: true,
				isOpen: true,
			})
		).toEqual({
			isActive: true,
			isPromoted: false,
		});
	});

	test("keeps the foreground dimmer active while its surface closes", () => {
		expect(
			getLiquidMenuAnchorPresentation({
				hasSurface: true,
				isObscured: false,
				isOpen: false,
			})
		).toEqual({
			isActive: true,
			isPromoted: true,
		});
	});
});
