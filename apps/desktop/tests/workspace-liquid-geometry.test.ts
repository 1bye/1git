import { describe, expect, test } from "bun:test";
import {
	createWorkspaceLiquidPath,
	smoothMinimum,
} from "../src/renderer/src/workspace-liquid-geometry.js";

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
});
