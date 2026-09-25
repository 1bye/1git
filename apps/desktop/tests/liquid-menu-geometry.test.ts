import { describe, expect, test } from "bun:test";

import { LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY } from "@/fixture/liquid-menu/constants/liquid-menu.js";
import {
	clipLiquidMenuRect,
	createLiquidMenuFrame,
} from "@/fixture/liquid-menu/lib/liquid-menu-geometry.js";

const ANCHOR_GEOMETRY = {
	insetBlock: 4,
	insetInline: 4,
	radius: 8,
} as const;

const frameAnchorRect = (
	frame: ReturnType<typeof createLiquidMenuFrame>
): {
	readonly height: number;
	readonly left: number;
	readonly top: number;
	readonly width: number;
} => ({
	height: frame.anchor.height,
	left: frame.bounds.left + frame.anchor.left,
	top: frame.bounds.top + frame.anchor.top,
	width: frame.anchor.width,
});

const pathCoordinates = (path: string): readonly [number, number][] =>
	[...path.matchAll(/[ML] (-?\d+\.\d+) (-?\d+\.\d+)/g)].map((match) => [
		Number(match[1]),
		Number(match[2]),
	]);

describe("liquid menu anchor clipping", () => {
	test("intersects a partially visible anchor", () => {
		expect(
			clipLiquidMenuRect(
				{ height: 32, left: 104, top: 24, width: 92 },
				{ height: 100, left: 120, top: 0, width: 200 }
			)
		).toEqual({ height: 32, left: 120, top: 24, width: 76 });
	});

	test("clips after applying visual anchor insets", () => {
		const frame = createLiquidMenuFrame(
			{
				anchor: { height: 40, left: 100, top: 20, width: 100 },
				anchorClip: { height: 100, left: 120, top: 0, width: 200 },
				menu: { height: 120, left: 100, top: 64, width: 180 },
				submenu: null,
			},
			{ menu: 1, submenu: 0 },
			ANCHOR_GEOMETRY
		);

		expect(frameAnchorRect(frame)).toEqual({
			height: 32,
			left: 120,
			top: 24,
			width: 76,
		});
	});

	test("preserves the shared connected-button radius", () => {
		const frame = createLiquidMenuFrame(
			{
				anchor: { height: 28, left: 100, top: 20, width: 80 },
				menu: { height: 120, left: 100, top: 54, width: 180 },
				submenu: null,
			},
			{ menu: 1, submenu: 0 },
			LIQUID_MENU_CONNECTED_BUTTON_ANCHOR_GEOMETRY
		);

		expect(frame.anchor.radius).toBe(10);
	});

	test("leaves no anchor cutout when fully clipped", () => {
		const frame = createLiquidMenuFrame(
			{
				anchor: { height: 40, left: 100, top: 20, width: 100 },
				anchorClip: { height: 100, left: 0, top: 0, width: 90 },
				menu: { height: 120, left: 100, top: 64, width: 180 },
				submenu: null,
			},
			{ menu: 1, submenu: 0 },
			ANCHOR_GEOMETRY
		);

		expect(frameAnchorRect(frame)).toEqual({
			height: 32,
			left: 90,
			top: 24,
			width: 0,
		});
		const coordinates = pathCoordinates(frame.path);
		expect(
			Math.min(...coordinates.map(([x]) => x)) + frame.bounds.left
		).toBeGreaterThanOrEqual(99);
		expect(
			Math.min(...coordinates.map(([, y]) => y)) + frame.bounds.top
		).toBeGreaterThanOrEqual(63);
	});
});
