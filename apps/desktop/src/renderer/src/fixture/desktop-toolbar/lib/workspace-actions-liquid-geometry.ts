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
	readonly submenu: WorkspaceActionsLiquidSubmenuMeasurement | null;
	readonly tab: LiquidSurfaceRect;
}

export interface WorkspaceActionsLiquidSubmenuMeasurement {
	readonly menu: LiquidSurfaceRect;
	readonly side: "left" | "right";
	readonly trigger: LiquidSurfaceRect;
}

export interface WorkspaceActionsLiquidProgress {
	readonly menu: number;
	readonly submenu: number;
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
	progress: WorkspaceActionsLiquidProgress
): WorkspaceActionsLiquidFrame => {
	const geometry = WORKSPACE_ACTIONS_LIQUID_GEOMETRY;
	const tabGeometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
	const menuProgress = clampProgress(progress.menu);
	const submenuProgress = clampProgress(progress.submenu);
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
	let boundsLeft = Math.min(visualTab.left, measurement.menu.left) - padding;
	let boundsTop = Math.min(visualTab.top, measurement.menu.top) - padding;
	let boundsRight =
		Math.max(
			visualTab.left + visualTab.width,
			measurement.menu.left + measurement.menu.width
		) + padding;
	let boundsBottom =
		Math.max(
			visualTab.top + visualTab.height,
			measurement.menu.top + measurement.menu.height
		) + padding;
	if (measurement.submenu) {
		const { menu: submenuMenu } = measurement.submenu;
		boundsLeft = Math.min(boundsLeft, submenuMenu.left - padding);
		boundsTop = Math.min(boundsTop, submenuMenu.top - padding);
		boundsRight = Math.max(
			boundsRight,
			submenuMenu.left + submenuMenu.width + padding
		);
		boundsBottom = Math.max(
			boundsBottom,
			submenuMenu.top + submenuMenu.height + padding
		);
	}
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
		menuProgress
	);
	const animatedMenuHalfWidth = interpolate(
		seedHalfWidth,
		finalMenuHalfWidth,
		menuProgress
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

	const boxes: RoundedBox[] = [tabBox, menuBox];
	if (measurement.submenu) {
		const { submenu } = measurement;
		const finalSubmenuHalfHeight = submenu.menu.height / 2;
		const finalSubmenuHalfWidth = submenu.menu.width / 2;
		const connectionX =
			submenu.side === "left"
				? measurement.menu.left
				: measurement.menu.left + measurement.menu.width;
		const connectionY = submenu.trigger.top + submenu.trigger.height / 2;
		const finalCenterX = submenu.menu.left + submenu.menu.width / 2;
		const finalCenterY = submenu.menu.top + submenu.menu.height / 2;
		const animatedSubmenuHalfHeight = interpolate(
			Math.min(submenu.trigger.height / 2, finalSubmenuHalfHeight),
			finalSubmenuHalfHeight,
			submenuProgress
		);
		const animatedSubmenuHalfWidth = interpolate(
			geometry.sampleCellSize,
			finalSubmenuHalfWidth,
			submenuProgress
		);
		boxes.push({
			centerX:
				interpolate(connectionX, finalCenterX, submenuProgress) - bounds.left,
			centerY:
				interpolate(connectionY, finalCenterY, submenuProgress) - bounds.top,
			halfHeight: animatedSubmenuHalfHeight,
			halfWidth: animatedSubmenuHalfWidth,
			radius: Math.min(
				geometry.menuRadius,
				animatedSubmenuHalfHeight,
				animatedSubmenuHalfWidth
			),
		});
	}

	return {
		bounds,
		path: createLiquidUnionPath({
			blendRadius: geometry.blendRadius,
			boxes,
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
