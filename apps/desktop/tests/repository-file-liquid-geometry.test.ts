import { describe, expect, it } from "bun:test";
import {
	createRepositoryFileLiquidMeasurement,
	createRepositoryFileLiquidPath,
	type RepositoryFileLiquidRect,
} from "@/fixture/repository-workspace/lib/repository-file-liquid-geometry.js";

const surface: RepositoryFileLiquidRect = {
	height: 760,
	left: 20,
	top: 40,
	width: 1280,
};
const canvas: RepositoryFileLiquidRect = {
	height: 700,
	left: 20,
	top: 90,
	width: 980,
};
const viewport: RepositoryFileLiquidRect = {
	height: 500,
	left: 1000,
	top: 150,
	width: 300,
};

const getPathCoordinates = (path: string): readonly [number, number][] =>
	[...path.matchAll(/[ML] (-?\d+\.\d+) (-?\d+\.\d+)/g)].map((match) => [
		Number(match[1]),
		Number(match[2]),
	]);

describe("repository file liquid geometry", () => {
	it("connects a visible file row to the canvas edge", () => {
		const measurement = createRepositoryFileLiquidMeasurement(
			surface,
			canvas,
			{
				height: 28,
				left: 1004,
				top: 220,
				width: 292,
			},
			viewport
		);

		if (!measurement) {
			throw new Error("Expected a visible file surface measurement.");
		}
		expect(measurement).toEqual({
			canvasEdgeX: 16,
			rowHeight: 28,
			rowLeft: 20,
			rowTop: 18,
			rowWidth: 292,
			surfaceHeight: 64,
			surfaceLeft: 964,
			surfaceTop: 162,
			surfaceWidth: 330,
		});
		const path = createRepositoryFileLiquidPath(measurement);
		const canvasBoundaryYs = getPathCoordinates(path)
			.filter(([x]) => x === measurement?.canvasEdgeX)
			.map(([, y]) => y);
		expect(path).toStartWith("M ");
		expect(path).toEndWith(" Z");
		expect(path).not.toContain("NaN");
		expect(Math.min(...canvasBoundaryYs)).toBeLessThan(measurement.rowTop);
		expect(Math.max(...canvasBoundaryYs)).toBeGreaterThan(
			measurement.rowTop + measurement.rowHeight
		);
	});

	it("clips the surface to the visible file viewport", () => {
		const measurement = createRepositoryFileLiquidMeasurement(
			surface,
			canvas,
			{
				height: 28,
				left: 1004,
				top: 142,
				width: 292,
			},
			viewport
		);

		expect(measurement).toMatchObject({
			rowHeight: 28,
			rowTop: -8,
			surfaceHeight: 38,
			surfaceTop: 110,
		});
	});

	it("omits rows outside the visible file viewport", () => {
		const aboveViewport = createRepositoryFileLiquidMeasurement(
			surface,
			canvas,
			{
				height: 28,
				left: 1004,
				top: 100,
				width: 292,
			},
			viewport
		);
		const belowViewport = createRepositoryFileLiquidMeasurement(
			surface,
			canvas,
			{
				height: 28,
				left: 1004,
				top: 660,
				width: 292,
			},
			viewport
		);

		expect(aboveViewport).toBeNull();
		expect(belowViewport).toBeNull();
	});
});
