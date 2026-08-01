import { describe, expect, test } from "bun:test";
import { createWorkspaceLiquidPath } from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-liquid-geometry.js";
import { createLiquidMenuFrame } from "../src/renderer/src/fixture/liquid-menu/lib/liquid-menu-geometry.js";
import {
	createLiquidUnionPath,
	smoothMinimum,
} from "../src/renderer/src/fixture/liquid-menu/lib/liquid-surface-geometry.js";

const LIQUID_MENU_ANCHOR_GEOMETRY = {
	insetBlock: 4,
	insetInline: 4,
	radius: 10,
} as const;

const pathCoordinates = (path: string): readonly [number, number][] =>
	[...path.matchAll(/[ML] (-?\d+\.\d+) (-?\d+\.\d+)/g)].map((match) => [
		Number(match[1]),
		Number(match[2]),
	]);

describe("workspace liquid geometry", () => {
	test("smoothly unions overlapping distance fields", () => {
		expect(smoothMinimum(4, 4, 0)).toBe(4);
		expect(smoothMinimum(4, 4, 16)).toBe(0);
		expect(smoothMinimum(-2, 12, 16)).toBeLessThan(-2);
	});

	test("traces a fused tab and workspace as one SVG contour", () => {
		const path = createWorkspaceLiquidPath({
			blendRadius: 16,
			containerDepth: 48,
			containerInset: 6,
			containerRadius: 14,
			containerTop: 46,
			sampleCellSize: 2,
			smoothingPasses: 1,
			surfaceWidth: 900,
			tabHeight: 40,
			tabLeft: 220,
			tabRadius: 12,
			tabTop: 6,
			tabWidth: 178,
		});

		expect(path.startsWith("M ")).toBe(true);
		expect(path.endsWith(" Z")).toBe(true);
		expect(path.match(/ Z/g)).toHaveLength(1);
		expect(pathCoordinates(path).length).toBeGreaterThan(100);
	});

	test("fuses a tab and floating menu into one liquid contour", () => {
		const path = createLiquidUnionPath({
			blendRadius: 18,
			boxes: [
				{
					centerX: 180,
					centerY: 30,
					halfHeight: 16,
					halfWidth: 101,
					radius: 10,
				},
				{
					centerX: 180,
					centerY: 135,
					halfHeight: 85,
					halfWidth: 144,
					radius: 12,
				},
			],
			sampleCellSize: 2,
			smoothingPasses: 1,
			surfaceHeight: 240,
			surfaceWidth: 360,
		});

		expect(path.startsWith("M ")).toBe(true);
		expect(path.match(/ Z/g)).toHaveLength(1);
		expect(pathCoordinates(path).length).toBeGreaterThan(100);
	});

	test("grows the floating menu from a connected SDF seed", () => {
		const measurement = {
			anchor: { height: 40, left: 171, top: 3, width: 210 },
			menu: { height: 262, left: 132, top: 45, width: 288 },
			submenu: null,
		};
		const seedFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 0.001,
				submenu: 0,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const openFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 1,
				submenu: 0,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const seedCoordinates = pathCoordinates(seedFrame.path);
		const openCoordinates = pathCoordinates(openFrame.path);
		const horizontalSpan = (
			coordinates: readonly [number, number][]
		): number => {
			const horizontalCoordinates = coordinates.map(([x]) => x);
			return (
				Math.max(...horizontalCoordinates) - Math.min(...horizontalCoordinates)
			);
		};

		expect(seedFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(openFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(horizontalSpan(seedCoordinates)).toBeLessThan(
			horizontalSpan(openCoordinates)
		);
		expect(seedFrame.bounds).toEqual(openFrame.bounds);
	});

	test("grows a submenu from its parent edge as one SDF contour", () => {
		const measurement = {
			anchor: { height: 40, left: 259, top: 3, width: 210 },
			menu: { height: 262, left: 220, top: 45, width: 288 },
			submenu: {
				menu: { height: 196, left: 24, top: 132, width: 192 },
				side: "left" as const,
				trigger: { height: 28, left: 228, top: 174, width: 272 },
			},
		};
		const seedFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 1,
				submenu: 0.001,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const openFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 1,
				submenu: 1,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const seedCoordinates = pathCoordinates(seedFrame.path);
		const openCoordinates = pathCoordinates(openFrame.path);
		const minimumX = (coordinates: readonly [number, number][]): number =>
			Math.min(...coordinates.map(([x]) => x));

		expect(seedFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(openFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(minimumX(openCoordinates)).toBeLessThan(minimumX(seedCoordinates));
		expect(seedFrame.bounds).toEqual(openFrame.bounds);
	});

	test("grows a right-side submenu from the nearest parent edge", () => {
		const measurement = {
			anchor: { height: 40, left: 159, top: 3, width: 210 },
			menu: { height: 262, left: 120, top: 45, width: 288 },
			submenu: {
				menu: { height: 196, left: 408, top: 132, width: 192 },
				side: "right" as const,
				trigger: { height: 28, left: 128, top: 174, width: 272 },
			},
		};
		const seedFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 1,
				submenu: 0.001,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const openFrame = createLiquidMenuFrame(
			measurement,
			{
				menu: 1,
				submenu: 1,
			},
			LIQUID_MENU_ANCHOR_GEOMETRY
		);
		const seedCoordinates = pathCoordinates(seedFrame.path);
		const openCoordinates = pathCoordinates(openFrame.path);
		const maximumX = (coordinates: readonly [number, number][]): number =>
			Math.max(...coordinates.map(([x]) => x));

		expect(seedFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(openFrame.path.match(/ Z/g)).toHaveLength(1);
		expect(maximumX(openCoordinates)).toBeGreaterThan(
			maximumX(seedCoordinates)
		);
		expect(seedFrame.bounds).toEqual(openFrame.bounds);
	});

	test("clips the liquid skin to the workspace inset at the right edge", () => {
		const surfaceWidth = 320;
		const containerInset = 6;
		const path = createWorkspaceLiquidPath({
			blendRadius: 16,
			containerDepth: 48,
			containerInset,
			containerRadius: 14,
			containerTop: 46,
			sampleCellSize: 2,
			smoothingPasses: 1,
			surfaceWidth,
			tabHeight: 40,
			tabLeft: 136,
			tabRadius: 12,
			tabTop: 6,
			tabWidth: 178,
		});
		const coordinates = pathCoordinates(path);
		const horizontalCoordinates = coordinates.map(([x]) => x);

		expect(Math.min(...horizontalCoordinates)).toBeGreaterThanOrEqual(
			containerInset
		);
		expect(Math.max(...horizontalCoordinates)).toBeLessThanOrEqual(
			surfaceWidth - containerInset
		);
	});

	test("preserves rounded container corners when the tab reaches an edge", () => {
		const surfaceWidth = 320;
		const containerInset = 6;
		const containerTop = 46;
		const tabWidth = 188;
		const createEdgePath = (tabLeft: number): readonly [number, number][] =>
			pathCoordinates(
				createWorkspaceLiquidPath({
					blendRadius: 12,
					containerDepth: 48,
					containerInset,
					containerRadius: 14,
					containerTop,
					sampleCellSize: 2,
					smoothingPasses: 1,
					surfaceWidth,
					tabHeight: 35,
					tabLeft,
					tabRadius: 10,
					tabTop: 7,
					tabWidth,
				})
			);
		const coordinatesNearCorner = (
			coordinates: readonly [number, number][]
		): readonly [number, number][] =>
			coordinates.filter(
				([, y]) => y >= containerTop - 4 && y <= containerTop + 6
			);
		const coordinatesInsideTabBody = (
			coordinates: readonly [number, number][]
		): readonly [number, number][] =>
			coordinates.filter(([, y]) => y >= 17 && y <= 32);

		const leftCoordinates = createEdgePath(-tabWidth);
		const leftCornerX = coordinatesNearCorner(leftCoordinates).map(([x]) => x);
		const leftBodyX = coordinatesInsideTabBody(leftCoordinates).map(([x]) => x);
		expect(Math.min(...leftBodyX)).toBe(containerInset);
		expect(Math.min(...leftCornerX)).toBeGreaterThan(containerInset);

		const rightCoordinates = createEdgePath(surfaceWidth + tabWidth);
		const rightCornerX = coordinatesNearCorner(rightCoordinates).map(
			([x]) => x
		);
		const rightBodyX = coordinatesInsideTabBody(rightCoordinates).map(
			([x]) => x
		);
		expect(Math.max(...rightBodyX)).toBe(surfaceWidth - containerInset);
		expect(Math.max(...rightCornerX)).toBeLessThan(
			surfaceWidth - containerInset
		);
	});
});
