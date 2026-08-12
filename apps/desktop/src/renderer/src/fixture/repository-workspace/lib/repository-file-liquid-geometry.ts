import { createLiquidUnionPath } from "@/fixture/liquid-surface/lib/liquid-surface-geometry.js";

export interface RepositoryFileLiquidRect {
	readonly height: number;
	readonly left: number;
	readonly top: number;
	readonly width: number;
}

export interface RepositoryFileLiquidMeasurement {
	readonly canvasEdgeX: number;
	readonly clipBottom: number;
	readonly clipTop: number;
	readonly rowHeight: number;
	readonly rowLeft: number;
	readonly rowTop: number;
	readonly rowWidth: number;
	readonly surfaceHeight: number;
	readonly surfaceLeft: number;
	readonly surfaceTop: number;
	readonly surfaceWidth: number;
}

const BLEND_RADIUS = 20;
const CANVAS_OVERLAP = BLEND_RADIUS;
const MEASUREMENT_SCALE = 10;
const ROW_RADIUS = 8;
const SAMPLE_CELL_SIZE = 2;
const SMOOTHING_PASSES = 1;
const SURFACE_PADDING = BLEND_RADIUS + SAMPLE_CELL_SIZE;

const roundMeasurement = (value: number): number =>
	Math.round(value * MEASUREMENT_SCALE) / MEASUREMENT_SCALE;

export const createRepositoryFileLiquidMeasurement = (
	surface: RepositoryFileLiquidRect,
	canvas: RepositoryFileLiquidRect,
	row: RepositoryFileLiquidRect,
	viewport: RepositoryFileLiquidRect
): RepositoryFileLiquidMeasurement | null => {
	const rowBottom = row.top + row.height;
	const viewportBottom = viewport.top + viewport.height;
	const visibleTop = Math.max(row.top, viewport.top);
	const visibleBottom = Math.min(rowBottom, viewportBottom);
	if (visibleBottom <= visibleTop) {
		return null;
	}

	const canvasRight = canvas.left + canvas.width;
	const rowRight = row.left + row.width;
	const surfaceLeft = canvasRight - CANVAS_OVERLAP;
	const surfaceRight = rowRight + SURFACE_PADDING;
	const surfaceTop = row.top - SURFACE_PADDING;
	const surfaceBottom = rowBottom + SURFACE_PADDING;
	if (surfaceRight <= surfaceLeft || surfaceBottom <= surfaceTop) {
		return null;
	}

	return {
		canvasEdgeX: roundMeasurement(canvasRight - surfaceLeft),
		clipBottom: roundMeasurement(Math.max(0, surfaceBottom - viewportBottom)),
		clipTop: roundMeasurement(Math.max(0, viewport.top - surfaceTop)),
		rowHeight: roundMeasurement(row.height),
		rowLeft: roundMeasurement(row.left - surfaceLeft),
		rowTop: roundMeasurement(row.top - surfaceTop),
		rowWidth: roundMeasurement(row.width),
		surfaceHeight: roundMeasurement(surfaceBottom - surfaceTop),
		surfaceLeft: roundMeasurement(surfaceLeft - surface.left),
		surfaceTop: roundMeasurement(surfaceTop - surface.top),
		surfaceWidth: roundMeasurement(surfaceRight - surfaceLeft),
	};
};

export const createRepositoryFileLiquidPath = (
	measurement: RepositoryFileLiquidMeasurement
): string => {
	const rowCenterY = measurement.rowTop + measurement.rowHeight / 2;
	const canvasLeft = -BLEND_RADIUS;
	const canvasRight = measurement.canvasEdgeX;

	return createLiquidUnionPath({
		blendRadius: BLEND_RADIUS,
		boxes: [
			{
				centerX: (canvasLeft + canvasRight) / 2,
				centerY: measurement.surfaceHeight / 2,
				halfHeight: measurement.surfaceHeight / 2 + BLEND_RADIUS,
				halfWidth: (canvasRight - canvasLeft) / 2,
				radius: 0,
			},
			{
				centerX: measurement.rowLeft + measurement.rowWidth / 2,
				centerY: rowCenterY,
				halfHeight: measurement.rowHeight / 2,
				halfWidth: measurement.rowWidth / 2,
				radius: ROW_RADIUS,
			},
		],
		sampleCellSize: SAMPLE_CELL_SIZE,
		smoothingPasses: SMOOTHING_PASSES,
		surfaceHeight: measurement.surfaceHeight,
		surfaceWidth: measurement.surfaceWidth,
	});
};

export const hasSameRepositoryFileLiquidPathGeometry = (
	current: RepositoryFileLiquidMeasurement,
	next: RepositoryFileLiquidMeasurement
): boolean =>
	current.canvasEdgeX === next.canvasEdgeX &&
	current.rowHeight === next.rowHeight &&
	current.rowLeft === next.rowLeft &&
	current.rowTop === next.rowTop &&
	current.rowWidth === next.rowWidth &&
	current.surfaceHeight === next.surfaceHeight &&
	current.surfaceWidth === next.surfaceWidth;
