import { WORKSPACE_ACTIONS_LIQUID_GEOMETRY } from "../constants/workspace-actions-menu.js";
import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "../constants/workspace-tab.js";
import {
	createLiquidUnionPath,
	type RoundedBox,
} from "./workspace-liquid-geometry.js";

export interface LiquidSurfaceRect {
	readonly height: number;
	readonly left: number;
	readonly top: number;
	readonly width: number;
}

export interface WorkspaceActionsLiquidMeasurement {
	readonly menu: LiquidSurfaceRect;
	readonly tab: LiquidSurfaceRect;
}

export interface WorkspaceActionsLiquidFrame {
	readonly bounds: LiquidSurfaceRect;
	readonly path: string;
}

const clampProgress = (progress: number): number =>
	Math.max(0, Math.min(1, progress));

const interpolate = (start: number, end: number, progress: number): number =>
	start + (end - start) * progress;

const roundedBoxFromRect = (
	rect: LiquidSurfaceRect,
	bounds: LiquidSurfaceRect,
	radius: number
): RoundedBox => ({
	centerX: rect.left - bounds.left + rect.width / 2,
	centerY: rect.top - bounds.top + rect.height / 2,
	halfHeight: rect.height / 2,
	halfWidth: rect.width / 2,
	radius,
});

export const createWorkspaceActionsLiquidFrame = (
	measurement: WorkspaceActionsLiquidMeasurement,
	progress: number
): WorkspaceActionsLiquidFrame => {
	const geometry = WORKSPACE_ACTIONS_LIQUID_GEOMETRY;
	const tabGeometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
	const normalizedProgress = clampProgress(progress);
	const visualTab: LiquidSurfaceRect = {
		height: Math.max(
			0,
			measurement.tab.height - tabGeometry.tabVisualInsetBlock * 2
		),
		left: measurement.tab.left + tabGeometry.tabVisualInsetInline,
		top: measurement.tab.top + tabGeometry.tabVisualInsetBlock,
		width: Math.max(
			0,
			measurement.tab.width - tabGeometry.tabVisualInsetInline * 2
		),
	};
	const padding = geometry.blendRadius + geometry.sampleCellSize * 2;
	const boundsLeft = Math.min(visualTab.left, measurement.menu.left) - padding;
	const boundsTop = Math.min(visualTab.top, measurement.menu.top) - padding;
	const boundsRight =
		Math.max(
			visualTab.left + visualTab.width,
			measurement.menu.left + measurement.menu.width
		) + padding;
	const boundsBottom =
		Math.max(
			visualTab.top + visualTab.height,
			measurement.menu.top + measurement.menu.height
		) + padding;
	const bounds: LiquidSurfaceRect = {
		height: boundsBottom - boundsTop,
		left: boundsLeft,
		top: boundsTop,
		width: boundsRight - boundsLeft,
	};
	const finalMenuHalfHeight = measurement.menu.height / 2;
	const finalMenuHalfWidth = measurement.menu.width / 2;
	const seedHalfHeight = geometry.sampleCellSize;
	const seedHalfWidth = visualTab.height / 2;
	const animatedMenuHalfHeight = interpolate(
		seedHalfHeight,
		finalMenuHalfHeight,
		normalizedProgress
	);
	const animatedMenuHalfWidth = interpolate(
		seedHalfWidth,
		finalMenuHalfWidth,
		normalizedProgress
	);
	const tabBox = roundedBoxFromRect(visualTab, bounds, tabGeometry.tabRadius);
	const menuBox: RoundedBox = {
		centerX: measurement.menu.left - bounds.left + measurement.menu.width / 2,
		centerY: measurement.menu.top - bounds.top + animatedMenuHalfHeight,
		halfHeight: animatedMenuHalfHeight,
		halfWidth: animatedMenuHalfWidth,
		radius: Math.min(
			geometry.menuRadius,
			animatedMenuHalfHeight,
			animatedMenuHalfWidth
		),
	};

	return {
		bounds,
		path: createLiquidUnionPath({
			blendRadius: geometry.blendRadius,
			boxes: [tabBox, menuBox],
			sampleCellSize: geometry.sampleCellSize,
			smoothingPasses: geometry.smoothingPasses,
			surfaceHeight: bounds.height,
			surfaceWidth: bounds.width,
		}),
	};
};

export const easeWorkspaceActionsLiquidProgress = (
	progress: number,
	isOpening: boolean
): number => {
	const normalizedProgress = clampProgress(progress);
	return isOpening
		? 1 - (1 - normalizedProgress) ** 3
		: normalizedProgress ** 2;
};
