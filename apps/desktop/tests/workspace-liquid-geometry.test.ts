import { describe, expect, test } from "bun:test";
import { createWorkspaceActionsLiquidFrame } from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-actions-liquid-geometry.js";
import {
	createLiquidUnionPath,
	createWorkspaceLiquidPath,
	smoothMinimum,
} from "../src/renderer/src/fixture/desktop-toolbar/lib/workspace-liquid-geometry.js";

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
			menu: { height: 262, left: 132, top: 45, width: 288 },
			tab: { height: 40, left: 171, top: 3, width: 210 },
		};
		const seedFrame = createWorkspaceActionsLiquidFrame(measurement, 0.001);
		const openFrame = createWorkspaceActionsLiquidFrame(measurement, 1);
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
