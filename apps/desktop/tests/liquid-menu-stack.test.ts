import { describe, expect, test } from "bun:test";
import { LIQUID_MENU_MOTION } from "@/fixture/liquid-menu/constants/liquid-menu.js";
import {
	addLiquidMenuLayer,
	getLiquidMenuBackdropOpacity,
	getLiquidMenuLayerZIndices,
	removeLiquidMenuLayer,
} from "@/fixture/liquid-menu/lib/liquid-menu-stack.js";

describe("liquid menu stack", () => {
	test("preserves registration order without duplicating layers", () => {
		const rootLayers = addLiquidMenuLayer([], "root");
		const nestedLayers = addLiquidMenuLayer(rootLayers, "nested");

		expect(addLiquidMenuLayer(nestedLayers, "root")).toBe(nestedLayers);
		expect(nestedLayers).toEqual(["root", "nested"]);
		expect(removeLiquidMenuLayer(nestedLayers, "nested")).toEqual(["root"]);
	});

	test("places each child scrim above its parent content", () => {
		const parent = getLiquidMenuLayerZIndices(0);
		const child = getLiquidMenuLayerZIndices(1);

		expect(parent.backdrop).toBeLessThan(parent.selection);
		expect(parent.selection).toBeLessThan(parent.surface);
		expect(parent.surface).toBeLessThan(parent.content);
		expect(parent.content).toBeLessThan(child.backdrop);
		expect(child.backdrop).toBeLessThan(child.selection);
		expect(child.selection).toBeLessThan(child.surface);
		expect(child.surface).toBeLessThan(child.content);
	});

	test("renders one constant nested scrim while root scrims follow motion", () => {
		expect(
			getLiquidMenuBackdropOpacity({
				hasLayerBelow: false,
				isTopLayer: true,
				progress: 0.5,
			})
		).toBe(LIQUID_MENU_MOTION.backdropOpacity * 0.5);
		expect(
			getLiquidMenuBackdropOpacity({
				hasLayerBelow: true,
				isTopLayer: true,
				progress: 0.01,
			})
		).toBe(LIQUID_MENU_MOTION.backdropOpacity);
		expect(
			getLiquidMenuBackdropOpacity({
				hasLayerBelow: false,
				isTopLayer: false,
				progress: 1,
			})
		).toBe(0);
	});
});
