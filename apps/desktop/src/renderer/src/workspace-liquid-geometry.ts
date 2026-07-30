/**
 * CPU SDF → marching-squares SVG geometry, inspired by Arlan's MIT-licensed
 * Liquid UI study: https://www.arlan.me/vault/liquid-ui
 */

interface Point {
	readonly x: number;
	readonly y: number;
}

interface RoundedBox {
	readonly centerX: number;
	readonly centerY: number;
	readonly halfHeight: number;
	readonly halfWidth: number;
	readonly radius: number;
}

interface Segment {
	readonly end: Point;
	readonly start: Point;
}

export interface WorkspaceLiquidPathInput {
	readonly blendRadius: number;
	readonly containerDepth: number;
	readonly containerInset: number;
	readonly containerRadius: number;
	readonly containerTop: number;
	readonly sampleCellSize: number;
	readonly smoothingPasses: number;
	readonly surfaceWidth: number;
	readonly tabHeight: number;
	readonly tabLeft: number;
	readonly tabRadius: number;
	readonly tabTop: number;
	readonly tabWidth: number;
}

const CONTOUR_EDGES: readonly (readonly (readonly [number, number])[])[] = [
	[],
	[[3, 2]],
	[[2, 1]],
	[[3, 1]],
	[[0, 1]],
	[
		[3, 2],
		[0, 1],
	],
	[[0, 2]],
	[[3, 0]],
	[[3, 0]],
	[[0, 2]],
	[
		[3, 0],
		[2, 1],
	],
	[[0, 1]],
	[[3, 1]],
	[[2, 1]],
	[[3, 2]],
	[],
];

const SADDLE_FIVE_INSIDE: readonly (readonly [number, number])[] = [
	[3, 0],
	[2, 1],
];
const SADDLE_FIVE_OUTSIDE: readonly (readonly [number, number])[] = [
	[3, 2],
	[0, 1],
];
const SADDLE_TEN_INSIDE = SADDLE_FIVE_OUTSIDE;
const SADDLE_TEN_OUTSIDE = SADDLE_FIVE_INSIDE;
const MINIMUM_CELL_SIZE = 1;
const FIELD_EPSILON = 0.000_001;

export const signedDistanceToRoundedBox = (
	x: number,
	y: number,
	box: RoundedBox
): number => {
	const radius = Math.min(box.radius, box.halfWidth, box.halfHeight);
	const offsetX = Math.abs(x - box.centerX) - box.halfWidth + radius;
	const offsetY = Math.abs(y - box.centerY) - box.halfHeight + radius;
	const outsideX = Math.max(offsetX, 0);
	const outsideY = Math.max(offsetY, 0);
	const outsideDistance = Math.hypot(outsideX, outsideY);
	const insideDistance = Math.min(Math.max(offsetX, offsetY), 0);
	return outsideDistance + insideDistance - radius;
};

export const smoothMinimum = (
	firstDistance: number,
	secondDistance: number,
	blendRadius: number
): number => {
	if (blendRadius <= 0) {
		return Math.min(firstDistance, secondDistance);
	}
	const interpolation = Math.max(
		0,
		Math.min(1, 0.5 + (0.5 * (secondDistance - firstDistance)) / blendRadius)
	);
	return (
		secondDistance * (1 - interpolation) +
		firstDistance * interpolation -
		blendRadius * interpolation * (1 - interpolation)
	);
};

const interpolateZeroCrossing = (
	start: Point,
	startValue: number,
	end: Point,
	endValue: number
): Point => {
	const denominator = startValue - endValue;
	const rawProgress =
		Math.abs(denominator) < FIELD_EPSILON ? 0.5 : startValue / denominator;
	const progress = Math.max(0, Math.min(1, rawProgress));
	return {
		x: start.x + (end.x - start.x) * progress,
		y: start.y + (end.y - start.y) * progress,
	};
};

const contourMask = (
	topLeft: number,
	topRight: number,
	bottomRight: number,
	bottomLeft: number
): number =>
	(topLeft < 0 ? 8 : 0) +
	(topRight < 0 ? 4 : 0) +
	(bottomRight < 0 ? 2 : 0) +
	(bottomLeft < 0 ? 1 : 0);

const edgesForMask = (
	mask: number,
	centerDistance: number
): readonly (readonly [number, number])[] => {
	if (mask === 5) {
		return centerDistance < 0 ? SADDLE_FIVE_INSIDE : SADDLE_FIVE_OUTSIDE;
	}
	if (mask === 10) {
		return centerDistance < 0 ? SADDLE_TEN_INSIDE : SADDLE_TEN_OUTSIDE;
	}
	return CONTOUR_EDGES[mask] ?? [];
};

interface CellSamples {
	readonly bottomLeft: number;
	readonly bottomRight: number;
	readonly topLeft: number;
	readonly topRight: number;
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}

const pointOnCellEdge = (edge: number, cell: CellSamples): Point => {
	const topLeft = { x: cell.x0, y: cell.y0 };
	const topRight = { x: cell.x1, y: cell.y0 };
	const bottomRight = { x: cell.x1, y: cell.y1 };
	const bottomLeft = { x: cell.x0, y: cell.y1 };
	if (edge === 0) {
		return interpolateZeroCrossing(
			topLeft,
			cell.topLeft,
			topRight,
			cell.topRight
		);
	}
	if (edge === 1) {
		return interpolateZeroCrossing(
			topRight,
			cell.topRight,
			bottomRight,
			cell.bottomRight
		);
	}
	if (edge === 2) {
		return interpolateZeroCrossing(
			bottomLeft,
			cell.bottomLeft,
			bottomRight,
			cell.bottomRight
		);
	}
	return interpolateZeroCrossing(
		topLeft,
		cell.topLeft,
		bottomLeft,
		cell.bottomLeft
	);
};

const pointKey = (point: Point, tolerance: number): string =>
	`${Math.round(point.x / tolerance)},${Math.round(point.y / tolerance)}`;

type SegmentEnd = "end" | "start";

interface SegmentConnection {
	readonly end: SegmentEnd;
	readonly segmentIndex: number;
}

const buildSegmentAdjacency = (
	segments: readonly Segment[],
	tolerance: number
): ReadonlyMap<string, readonly SegmentConnection[]> => {
	const adjacency = new Map<string, SegmentConnection[]>();
	for (const [segmentIndex, segment] of segments.entries()) {
		for (const end of ["start", "end"] as const) {
			const key = pointKey(segment[end], tolerance);
			const entries = adjacency.get(key) ?? [];
			entries.push({ end, segmentIndex });
			adjacency.set(key, entries);
		}
	}
	return adjacency;
};

const traceLoop = (
	startIndex: number,
	segments: readonly Segment[],
	adjacency: ReadonlyMap<string, readonly SegmentConnection[]>,
	usedSegments: Set<number>,
	tolerance: number
): Point[] => {
	const loop: Point[] = [];
	let currentIndex = startIndex;
	let currentEnd: SegmentEnd = "start";
	while (!usedSegments.has(currentIndex)) {
		const segment = segments[currentIndex];
		if (!segment) {
			break;
		}
		usedSegments.add(currentIndex);
		const nextPoint: Point =
			currentEnd === "start" ? segment.end : segment.start;
		loop.push(currentEnd === "start" ? segment.start : segment.end);
		const candidates: readonly SegmentConnection[] =
			adjacency.get(pointKey(nextPoint, tolerance)) ?? [];
		const next: SegmentConnection | undefined = candidates.find(
			(candidate) => !usedSegments.has(candidate.segmentIndex)
		);
		if (!next) {
			break;
		}
		currentIndex = next.segmentIndex;
		currentEnd = next.end;
	}
	return loop;
};

const stitchSegments = (
	segments: readonly Segment[],
	cellSize: number
): Point[][] => {
	const tolerance = cellSize * 0.5;
	const adjacency = buildSegmentAdjacency(segments, tolerance);
	const usedSegments = new Set<number>();
	const loops: Point[][] = [];
	for (const startIndex of segments.keys()) {
		if (usedSegments.has(startIndex)) {
			continue;
		}
		const loop = traceLoop(
			startIndex,
			segments,
			adjacency,
			usedSegments,
			tolerance
		);
		if (loop.length >= 3) {
			loops.push(loop);
		}
	}
	return loops;
};

const smoothLoop = (points: readonly Point[], passes: number): Point[] => {
	let smoothedPoints = [...points];
	for (let pass = 0; pass < passes; pass += 1) {
		const nextPoints: Point[] = [];
		for (const [index, point] of smoothedPoints.entries()) {
			const nextPoint = smoothedPoints[(index + 1) % smoothedPoints.length];
			if (!nextPoint) {
				continue;
			}
			nextPoints.push(
				{
					x: point.x * 0.75 + nextPoint.x * 0.25,
					y: point.y * 0.75 + nextPoint.y * 0.25,
				},
				{
					x: point.x * 0.25 + nextPoint.x * 0.75,
					y: point.y * 0.25 + nextPoint.y * 0.75,
				}
			);
		}
		smoothedPoints = nextPoints;
	}
	return smoothedPoints;
};

const formatCoordinate = (coordinate: number): string => coordinate.toFixed(2);

const loopsToPath = (
	loops: readonly Point[][],
	smoothingPasses: number
): string =>
	loops
		.map((loop) => smoothLoop(loop, smoothingPasses))
		.filter((loop) => loop.length >= 3)
		.map((loop) => {
			const [firstPoint, ...remainingPoints] = loop;
			if (!firstPoint) {
				return "";
			}
			const lines = remainingPoints
				.map(
					(point) =>
						`L ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`
				)
				.join(" ");
			return `M ${formatCoordinate(firstPoint.x)} ${formatCoordinate(firstPoint.y)} ${lines} Z`;
		})
		.filter(Boolean)
		.join(" ");

export const createWorkspaceLiquidPath = (
	input: WorkspaceLiquidPathInput
): string => {
	const cellSize = Math.max(MINIMUM_CELL_SIZE, input.sampleCellSize);
	const sampleWidth = Math.max(0, input.surfaceWidth);
	const sampleHeight =
		input.containerTop +
		input.containerDepth +
		input.blendRadius +
		cellSize * 2;
	if (sampleWidth <= input.containerInset * 2 || sampleHeight <= 0) {
		return "";
	}

	const clipLeft = input.containerInset;
	const clipRight = input.surfaceWidth - input.containerInset;
	const clippedTabWidth = Math.min(input.tabWidth, clipRight - clipLeft);
	const clippedTabLeft = Math.max(
		clipLeft,
		Math.min(input.tabLeft, clipRight - clippedTabWidth)
	);
	const tab: RoundedBox = {
		centerX: clippedTabLeft + clippedTabWidth / 2,
		centerY: input.tabTop + input.tabHeight / 2,
		halfHeight: input.tabHeight / 2,
		halfWidth: clippedTabWidth / 2,
		radius: input.tabRadius,
	};
	const container: RoundedBox = {
		centerX: input.surfaceWidth / 2,
		centerY: input.containerTop + input.containerDepth / 2,
		halfHeight: input.containerDepth / 2,
		halfWidth: (input.surfaceWidth - input.containerInset * 2) / 2,
		radius: input.containerRadius,
	};
	const edgeBlendFalloff = Math.max(input.containerRadius, cellSize);
	const fieldValue = (x: number, y: number): number => {
		const edgeClearance = Math.max(0, Math.min(x - clipLeft, clipRight - x));
		const edgeBlendProgress = Math.min(1, edgeClearance / edgeBlendFalloff);
		const unionDistance = smoothMinimum(
			signedDistanceToRoundedBox(x, y, tab),
			signedDistanceToRoundedBox(x, y, container),
			input.blendRadius * edgeBlendProgress
		);
		return Math.max(unionDistance, clipLeft - x, x - clipRight);
	};

	const columns = Math.ceil(sampleWidth / cellSize) + 1;
	const rows = Math.ceil(sampleHeight / cellSize) + 1;
	const samples = new Float32Array(columns * rows);
	for (let row = 0; row < rows; row += 1) {
		const y = row * cellSize;
		for (let column = 0; column < columns; column += 1) {
			samples[row * columns + column] = fieldValue(column * cellSize, y);
		}
	}
	const sampleAt = (column: number, row: number): number =>
		samples[row * columns + column] ?? Number.POSITIVE_INFINITY;

	const segments: Segment[] = [];
	for (let row = 0; row < rows - 1; row += 1) {
		for (let column = 0; column < columns - 1; column += 1) {
			const cell: CellSamples = {
				bottomLeft: sampleAt(column, row + 1),
				bottomRight: sampleAt(column + 1, row + 1),
				topLeft: sampleAt(column, row),
				topRight: sampleAt(column + 1, row),
				x0: column * cellSize,
				x1: (column + 1) * cellSize,
				y0: row * cellSize,
				y1: (row + 1) * cellSize,
			};
			const mask = contourMask(
				cell.topLeft,
				cell.topRight,
				cell.bottomRight,
				cell.bottomLeft
			);
			if (mask === 0 || mask === 15) {
				continue;
			}
			const centerDistance = fieldValue(
				(cell.x0 + cell.x1) / 2,
				(cell.y0 + cell.y1) / 2
			);
			for (const [startEdge, endEdge] of edgesForMask(mask, centerDistance)) {
				segments.push({
					end: pointOnCellEdge(endEdge, cell),
					start: pointOnCellEdge(startEdge, cell),
				});
			}
		}
	}
	return loopsToPath(
		stitchSegments(segments, cellSize),
		Math.max(0, input.smoothingPasses)
	);
};
