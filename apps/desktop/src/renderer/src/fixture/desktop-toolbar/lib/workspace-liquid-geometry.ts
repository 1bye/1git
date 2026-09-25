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
	readonly containerOverlap: number;
	readonly containerRadius: number;
	readonly containerTop: number;
	readonly sampleCellSize: number;
	readonly smoothingPasses: number;
	readonly surfaceWidth: number;
	readonly tabFullWidth: number;
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
const EDGE_CONTAINMENT_TOLERANCE = 0.5;

const TAB_SDF_HEIGHT =
	WORKSPACE_TAB_SURFACE_GEOMETRY.tabHeight -
	WORKSPACE_TAB_SURFACE_GEOMETRY.tabVisualInsetBlock * 2 +
	WORKSPACE_TAB_SURFACE_GEOMETRY.tabSdfExtensionBlockEnd;

const roundMeasurement = (value: number): number =>
	Math.round(value * MEASUREMENT_SCALE) / MEASUREMENT_SCALE;

const smoothStep = (progress: number): number =>
	progress * progress * (3 - 2 * progress);

const clampProgress = (progress: number): number =>
	Math.max(0, Math.min(1, progress));

export interface WorkspaceLiquidEdgeConnections {
	readonly left: number;
	readonly right: number;
}

const insetWorkspaceTabRect = (
	tab: WorkspaceLiquidRect
): WorkspaceLiquidRect => {
	const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;

	return {
		height: Math.max(0, tab.height - geometry.tabVisualInsetBlock * 2),
		left: tab.left + geometry.tabVisualInsetInline,
		top: tab.top + geometry.tabVisualInsetBlock,
		width: Math.max(0, tab.width - geometry.tabVisualInsetInline * 2),
	};
};

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
): WorkspaceLiquidRect | null =>
	intersectWorkspaceLiquidRects(insetWorkspaceTabRect(tab), tabListViewport);

const edgeConnectionFromClearance = (clearance: number): number => {
	const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;

	const connectedClearance =
		geometry.tabListInset + geometry.tabVisualInsetInline;

	const progress = clampProgress(
		(clearance - connectedClearance) / geometry.blendRadius
	);

	return 1 - smoothStep(progress);
};

export const getWorkspaceLiquidEdgeConnections = (
	measurement: WorkspaceLiquidMeasurement
): WorkspaceLiquidEdgeConnections => {
	const isFullyVisible =
		measurement.tabHeight > 0 &&
		measurement.tabFullWidth > 0 &&
		Math.abs(measurement.tabWidth - measurement.tabFullWidth) <=
			EDGE_CONTAINMENT_TOLERANCE &&
		measurement.tabLeft >= -EDGE_CONTAINMENT_TOLERANCE &&
		measurement.tabLeft + measurement.tabWidth <=
			measurement.surfaceWidth + EDGE_CONTAINMENT_TOLERANCE;

	if (!isFullyVisible) {
		return { left: 0, right: 0 };
	}

	return {
		left: edgeConnectionFromClearance(measurement.tabLeft),
		right: edgeConnectionFromClearance(
			measurement.surfaceWidth - (measurement.tabLeft + measurement.tabWidth)
		),
	};
};

export const getWorkspaceLiquidCornerRadius = (
	containerRadius: number,
	edgeConnection: number
): number => {
	const normalizedConnection = clampProgress(edgeConnection);

	return containerRadius * (1 - normalizedConnection);
};

interface CornerRoundedBox extends RoundedBox {
	readonly bottomLeftRadius: number;
	readonly bottomRightRadius: number;
	readonly topLeftRadius: number;
	readonly topRightRadius: number;
}

const signedDistanceToCornerRoundedBox = (
	x: number,
	y: number,
	box: CornerRoundedBox
): number => {
	const isRight = x >= box.centerX;
	const isBottom = y >= box.centerY;
	let cornerRadius: number;

	if (isRight) {
		cornerRadius = isBottom ? box.bottomRightRadius : box.topRightRadius;
	} else {
		cornerRadius = isBottom ? box.bottomLeftRadius : box.topLeftRadius;
	}

	return signedDistanceToRoundedBox(x, y, {
		centerX: box.centerX,
		centerY: box.centerY,
		halfHeight: box.halfHeight,
		halfWidth: box.halfWidth,
		radius: cornerRadius,
	});
};

export const createWorkspaceLiquidMeasurement = (
	surface: WorkspaceLiquidRect,
	tab: WorkspaceLiquidRect,
	tabListViewport: WorkspaceLiquidRect
): WorkspaceLiquidMeasurement => {
	const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
	const surfaceWidth = roundMeasurement(surface.width);
	const fullTab = insetWorkspaceTabRect(tab);
	const visibleTab = getVisibleWorkspaceTabAnchorRect(tab, tabListViewport);

	if (!visibleTab) {
		return {
			surfaceWidth,
			tabFullWidth: roundMeasurement(fullTab.width),
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
		tabFullWidth: roundMeasurement(fullTab.width),
		tabHeight: TAB_SDF_HEIGHT,
		tabLeft,
		tabTop: roundMeasurement(visibleTab.top - surface.top),
		tabWidth,
	};
};

export const createWorkspaceLiquidPath = (
	input: WorkspaceLiquidPathInput
): string => {
	const { left: leftEdgeConnection, right: rightEdgeConnection } =
		getWorkspaceLiquidEdgeConnections(input);

	const cellSize = Math.max(MINIMUM_CELL_SIZE, input.sampleCellSize);
	const sampleWidth = Math.max(0, input.surfaceWidth);

	const sampleHeight =
		input.containerTop +
		input.containerDepth +
		input.blendRadius +
		cellSize * 2;

	if (sampleWidth <= 0 || sampleHeight <= 0) {
		return "";
	}

	const clipLeft = 0;
	const clipRight = input.surfaceWidth;
	const hasVisibleTab = input.tabHeight > 0 && input.tabWidth > 0;
	let tab: CornerRoundedBox | null = null;

	if (hasVisibleTab) {
		const clippedTabWidth = Math.min(input.tabWidth, clipRight - clipLeft);

		const clippedTabLeft = Math.max(
			clipLeft,
			Math.min(input.tabLeft, clipRight - clippedTabWidth)
		);

		const clippedTabRight = clippedTabLeft + clippedTabWidth;

		const connectedTabLeft =
			clippedTabLeft * (1 - leftEdgeConnection) + clipLeft * leftEdgeConnection;

		const connectedTabRight =
			clippedTabRight * (1 - rightEdgeConnection) +
			clipRight * rightEdgeConnection;

		const connectedTabWidth = connectedTabRight - connectedTabLeft;

		tab = {
			bottomLeftRadius: getWorkspaceLiquidCornerRadius(
				input.tabRadius,
				leftEdgeConnection
			),
			bottomRightRadius: getWorkspaceLiquidCornerRadius(
				input.tabRadius,
				rightEdgeConnection
			),
			centerX: connectedTabLeft + connectedTabWidth / 2,
			centerY: input.tabTop + input.tabHeight / 2,
			halfHeight: input.tabHeight / 2,
			halfWidth: connectedTabWidth / 2,
			radius: input.tabRadius,
			topLeftRadius: input.tabRadius,
			topRightRadius: input.tabRadius,
		};
	}

	const container: CornerRoundedBox = {
		bottomLeftRadius: input.containerRadius,
		bottomRightRadius: input.containerRadius,
		centerX: input.surfaceWidth / 2,
		centerY: input.containerTop + input.containerDepth / 2,
		halfHeight: input.containerDepth / 2,
		halfWidth: input.surfaceWidth / 2,
		radius: input.containerRadius,
		topLeftRadius: getWorkspaceLiquidCornerRadius(
			input.containerRadius,
			leftEdgeConnection
		),
		topRightRadius: getWorkspaceLiquidCornerRadius(
			input.containerRadius,
			rightEdgeConnection
		),
	};

	const handoffY = input.containerTop + input.containerOverlap;
	const blendDepth = Math.max(cellSize, input.blendRadius);

	const fieldValue = (x: number, y: number): number => {
		const containerDistance = signedDistanceToCornerRoundedBox(x, y, container);

		const unionDistance = tab
			? smoothMinimum(
					signedDistanceToCornerRoundedBox(x, y, tab),
					containerDistance,
					input.blendRadius
				)
			: containerDistance;

		const rawHandoffProgress = Math.max(
			0,
			Math.min(1, (handoffY - y) / blendDepth)
		);

		// Keep the full liquid union through the tab, while converging the outer
		// corners to the DOM workspace contour at the SVG handoff.
		const edgeClearance = Math.max(0, Math.min(x - clipLeft, clipRight - x));

		const rawInteriorProgress = Math.max(
			0,
			Math.min(1, (edgeClearance - input.containerRadius) / blendDepth)
		);

		const interiorLiquidWeight = smoothStep(rawInteriorProgress);
		const handoffLiquidWeight = smoothStep(rawHandoffProgress);

		const connectedEdgeWeight =
			x < input.surfaceWidth / 2 ? leftEdgeConnection : rightEdgeConnection;

		const rawConnectedProgress = clampProgress(
			(input.containerTop - y) / Math.max(1, input.containerOverlap)
		);

		const connectedLiquidWeight =
			connectedEdgeWeight * smoothStep(rawConnectedProgress);

		const connectedInteriorLiquidWeight =
			interiorLiquidWeight + connectedLiquidWeight * (1 - interiorLiquidWeight);

		const liquidWeight =
			handoffLiquidWeight +
			connectedInteriorLiquidWeight * (1 - handoffLiquidWeight);

		const handoffDistance =
			containerDistance + (unionDistance - containerDistance) * liquidWeight;

		return Math.max(handoffDistance, clipLeft - x, x - clipRight);
	};

	return traceDistanceField(
		sampleWidth,
		sampleHeight,
		cellSize,
		input.smoothingPasses,
		fieldValue
	);
};
