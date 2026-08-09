import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import type { WorkspaceLiquidMeasurement } from "@/fixture/desktop-toolbar/lib/workspace-liquid-motion.js";
import {
	type RoundedBox,
	signedDistanceToRoundedBox,
	smoothMinimum,
	traceDistanceField,
} from "@/fixture/liquid-surface/lib/liquid-surface-geometry.js";

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

export interface WorkspaceLiquidRect {
	readonly height: number;
	readonly left: number;
	readonly top: number;
	readonly width: number;
}

const MINIMUM_CELL_SIZE = 1;
const MEASUREMENT_SCALE = 10;
const TAB_SDF_HEIGHT =
	WORKSPACE_TAB_SURFACE_GEOMETRY.tabHeight -
	WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetBlock * 2 +
	WORKSPACE_TAB_SURFACE_GEOMETRY.tabSdfExtensionBlockEnd;

const roundMeasurement = (value: number): number =>
	Math.round(value * MEASUREMENT_SCALE) / MEASUREMENT_SCALE;

const intersectWorkspaceLiquidRects = (
	first: WorkspaceLiquidRect,
	second: WorkspaceLiquidRect
): WorkspaceLiquidRect | null => {
	const left = Math.max(first.left, second.left);
	const right = Math.min(
		first.left + Math.max(0, first.width),
		second.left + Math.max(0, second.width)
	);
	const top = Math.max(first.top, second.top);
	const bottom = Math.min(
		first.top + Math.max(0, first.height),
		second.top + Math.max(0, second.height)
	);
	if (right <= left || bottom <= top) {
		return null;
	}
	return {
		height: bottom - top,
		left,
		top,
		width: right - left,
	};
};

export const getVisibleWorkspaceTabAnchorRect = (
	tab: WorkspaceLiquidRect,
	tabListViewport: WorkspaceLiquidRect
): WorkspaceLiquidRect | null => {
	const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
	return intersectWorkspaceLiquidRects(
		{
			height: Math.max(0, tab.height - geometry.tabVisualInsetBlock * 2),
			left: tab.left + geometry.tabVisualInsetInline,
			top: tab.top + geometry.tabVisualInsetBlock,
			width: Math.max(0, tab.width - geometry.tabVisualInsetInline * 2),
		},
		tabListViewport
	);
};

export const createWorkspaceLiquidMeasurement = (
	surface: WorkspaceLiquidRect,
	tab: WorkspaceLiquidRect,
	tabListViewport: WorkspaceLiquidRect
): WorkspaceLiquidMeasurement => {
	const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
	const surfaceWidth = roundMeasurement(surface.width);
	const visibleTab = getVisibleWorkspaceTabAnchorRect(tab, tabListViewport);
	if (!visibleTab) {
		return {
			surfaceWidth,
			tabHeight: 0,
			tabLeft: 0,
			tabTop: geometry.toolbarHeight,
			tabWidth: 0,
		};
	}

	const tabLeft = roundMeasurement(visibleTab.left - surface.left);
	const tabWidth = roundMeasurement(visibleTab.width);
	return {
		surfaceWidth,
		tabHeight: TAB_SDF_HEIGHT,
		tabLeft,
		tabTop: roundMeasurement(visibleTab.top - surface.top),
		tabWidth,
	};
};

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
	const hasVisibleTab = input.tabHeight > 0 && input.tabWidth > 0;
	let tab: RoundedBox | null = null;
	if (hasVisibleTab) {
		const clippedTabWidth = Math.min(input.tabWidth, clipRight - clipLeft);
		const clippedTabLeft = Math.max(
			clipLeft,
			Math.min(input.tabLeft, clipRight - clippedTabWidth)
		);
		tab = {
			centerX: clippedTabLeft + clippedTabWidth / 2,
			centerY: input.tabTop + input.tabHeight / 2,
			halfHeight: input.tabHeight / 2,
			halfWidth: clippedTabWidth / 2,
			radius: input.tabRadius,
		};
	}
	const container: RoundedBox = {
		centerX: input.surfaceWidth / 2,
		centerY: input.containerTop + input.containerDepth / 2,
		halfHeight: input.containerDepth / 2,
		halfWidth: (input.surfaceWidth - input.containerInset * 2) / 2,
		radius: input.containerRadius,
	};
	const fieldValue = (x: number, y: number): number => {
		const containerDistance = signedDistanceToRoundedBox(x, y, container);
		const unionDistance = tab
			? smoothMinimum(
					signedDistanceToRoundedBox(x, y, tab),
					containerDistance,
					input.blendRadius
				)
			: containerDistance;
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
