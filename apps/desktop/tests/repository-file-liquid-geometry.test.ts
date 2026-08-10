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
			clipBottom: 0,
			clipTop: 0,
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

	it("keeps a closed surface and reports viewport clipping separately", () => {
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
			clipBottom: 0,
			clipTop: 26,
			rowHeight: 28,
			rowTop: 18,
			surfaceHeight: 64,
			surfaceTop: 84,
		});
		if (!measurement) {
			throw new Error("Expected a partially visible file measurement.");
		}
		const path = createRepositoryFileLiquidPath(measurement);
		expect(path).toStartWith("M ");
		expect(path).toEndWith(" Z");
		expect(path).not.toContain("NaN");
	});

	it("keeps the first row geometry closed behind the viewport clip", () => {
		const measurement = createRepositoryFileLiquidMeasurement(
			surface,
			canvas,
			{
				height: 28,
				left: 1004,
				top: viewport.top,
				width: 292,
			},
			viewport
		);

		expect(measurement).toMatchObject({
			clipBottom: 0,
			clipTop: 18,
			rowTop: 18,
			surfaceHeight: 64,
			surfaceTop: 92,
		});
		if (!measurement) {
			throw new Error("Expected the first file surface measurement.");
		}
		const path = createRepositoryFileLiquidPath(measurement);
		expect(path).toStartWith("M ");
		expect(path).toEndWith(" Z");
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
