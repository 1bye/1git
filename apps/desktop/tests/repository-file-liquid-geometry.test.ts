import { describe, expect, it } from "bun:test";
import {
	createRepositoryFileLiquidMeasurement,
	createRepositoryFileLiquidPath,
	hasSameRepositoryFileLiquidPathGeometry,
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
			canvasEdgeX: 20,
			canvasSide: "left",
			clipBottom: 0,
			clipTop: 0,
			rowHeight: 28,
			rowLeft: 24,
			rowTop: 22,
			rowWidth: 292,
			surfaceHeight: 72,
			surfaceLeft: 960,
			surfaceTop: 158,
			surfaceWidth: 338,
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

	it("mirrors the surface when the file rail is left of the canvas", () => {
		const measurement = createRepositoryFileLiquidMeasurement(
			surface,
			{
				height: 700,
				left: 320,
				top: 90,
				width: 980,
			},
			{
				height: 28,
				left: 24,
				top: 220,
				width: 292,
			},
			{
				height: 500,
				left: 20,
				top: 150,
				width: 300,
			}
		);

		if (!measurement) {
			throw new Error("Expected a mirrored file surface measurement.");
		}
		expect(measurement).toEqual({
			canvasEdgeX: 318,
			canvasSide: "right",
			clipBottom: 0,
			clipTop: 0,
			rowHeight: 28,
			rowLeft: 22,
			rowTop: 22,
			rowWidth: 292,
			surfaceHeight: 72,
			surfaceLeft: -18,
			surfaceTop: 158,
			surfaceWidth: 338,
		});
		const path = createRepositoryFileLiquidPath(measurement);
		const canvasBoundaryYs = getPathCoordinates(path)
			.filter(([x]) => x === measurement.canvasEdgeX)
			.map(([, y]) => y);
		expect(path).toStartWith("M ");
		expect(path).toEndWith(" Z");
		expect(path).not.toContain("NaN");
		expect(Math.min(...canvasBoundaryYs)).toBeLessThan(measurement.rowTop);
		expect(Math.max(...canvasBoundaryYs)).toBeGreaterThan(
			measurement.rowTop + measurement.rowHeight
		);
	});

	it("keeps an inset history row connected to its right-side shelf", () => {
		const measurement = createRepositoryFileLiquidMeasurement(
			surface,
			{
				height: 700,
				left: 340,
				top: 90,
				width: 240,
			},
			{
				height: 44,
				left: 26,
				top: 220,
				width: 286,
			},
			{
				height: 500,
				left: 20,
				top: 150,
				width: 300,
			}
		);

		if (!measurement) {
			throw new Error("Expected a history surface measurement.");
		}
		const path = createRepositoryFileLiquidPath(measurement);
		const rowConnectionX = measurement.rowLeft + measurement.rowWidth;
		const connectorCenterX = (rowConnectionX + measurement.canvasEdgeX) / 2;
		const connectorYs = getPathCoordinates(path)
			.filter(([x]) => Math.abs(x - connectorCenterX) <= 2)
			.map(([, y]) => y);
		expect(path.match(/M /g)).toHaveLength(1);
		expect(path).not.toContain("NaN");
		expect(Math.max(...connectorYs) - Math.min(...connectorYs)).toBeGreaterThan(
			measurement.rowHeight * 0.9
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
			clipTop: 30,
			rowHeight: 28,
			rowTop: 22,
			surfaceHeight: 72,
			surfaceTop: 80,
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
			clipTop: 22,
			rowTop: 22,
			surfaceHeight: 72,
			surfaceTop: 88,
		});
		if (!measurement) {
			throw new Error("Expected the first file surface measurement.");
		}
		const path = createRepositoryFileLiquidPath(measurement);
		expect(path).toStartWith("M ");
		expect(path).toEndWith(" Z");
	});

	it("reuses path geometry when only row placement and clipping change", () => {
		const firstRow = createRepositoryFileLiquidMeasurement(
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
		const laterRow = createRepositoryFileLiquidMeasurement(
			surface,
			canvas,
			{
				height: 28,
				left: 1004,
				top: 420,
				width: 292,
			},
			viewport
		);

		if (!(firstRow && laterRow)) {
			throw new Error("Expected both file surface measurements.");
		}
		expect(firstRow.surfaceTop).not.toBe(laterRow.surfaceTop);
		expect(firstRow.clipTop).not.toBe(laterRow.clipTop);
		expect(hasSameRepositoryFileLiquidPathGeometry(firstRow, laterRow)).toBe(
			true
		);
		expect(createRepositoryFileLiquidPath(firstRow)).toBe(
			createRepositoryFileLiquidPath(laterRow)
		);
	});

	it("invalidates path geometry when row dimensions change", () => {
		const regularRow = createRepositoryFileLiquidMeasurement(
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
		const resizedRow = createRepositoryFileLiquidMeasurement(
			surface,
			canvas,
			{
				height: 32,
				left: 1004,
				top: 220,
				width: 292,
			},
			viewport
		);

		if (!(regularRow && resizedRow)) {
			throw new Error("Expected both file surface measurements.");
		}
		expect(
			hasSameRepositoryFileLiquidPathGeometry(regularRow, resizedRow)
		).toBe(false);
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
