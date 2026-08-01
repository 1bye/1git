import {
	type RoundedBox,
	signedDistanceToRoundedBox,
	smoothMinimum,
	traceDistanceField,
} from "../../liquid-menu/lib/liquid-surface-geometry.js";

interface WorkspaceLiquidPathInput {
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

const MINIMUM_CELL_SIZE = 1;

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

	return traceDistanceField(
		sampleWidth,
		sampleHeight,
		cellSize,
		input.smoothingPasses,
		fieldValue
	);
};
