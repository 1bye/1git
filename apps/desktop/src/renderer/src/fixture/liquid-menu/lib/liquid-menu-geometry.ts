import { LIQUID_MENU_GEOMETRY } from "@/fixture/liquid-menu/constants/liquid-menu.js";
import {
	createLiquidUnionPath,
	type RoundedBox,
} from "@/fixture/liquid-menu/lib/liquid-surface-geometry.js";

export interface LiquidMenuRect {
	readonly height: number;
	readonly left: number;
	readonly top: number;
	readonly width: number;
}

export interface LiquidMenuAnchorGeometry {
	readonly insetBlock: number;
	readonly insetInline: number;
	readonly radius: number;
}

export interface LiquidMenuMeasurement {
	readonly anchor: LiquidMenuRect;
	readonly menu: LiquidMenuRect;
	readonly submenu: LiquidMenuSubmenuMeasurement | null;
}

export interface LiquidMenuSubmenuMeasurement {
	readonly menu: LiquidMenuRect;
	readonly side: "left" | "right";
	readonly trigger: LiquidMenuRect;
}

export interface LiquidMenuProgress {
	readonly menu: number;
	readonly submenu: number;
}

export interface LiquidMenuFrame {
	readonly bounds: LiquidMenuRect;
	readonly path: string;
}

const clampProgress = (progress: number): number =>
	Math.max(0, Math.min(1, progress));

const interpolate = (start: number, end: number, progress: number): number =>
	start + (end - start) * progress;

const roundedBoxFromRect = (
	rect: LiquidMenuRect,
	bounds: LiquidMenuRect,
	radius: number
): RoundedBox => ({
	centerX: rect.left - bounds.left + rect.width / 2,
	centerY: rect.top - bounds.top + rect.height / 2,
	halfHeight: rect.height / 2,
	halfWidth: rect.width / 2,
	radius,
});

export const createLiquidMenuFrame = (
	measurement: LiquidMenuMeasurement,
	progress: LiquidMenuProgress,
	anchorGeometry: LiquidMenuAnchorGeometry
): LiquidMenuFrame => {
	const geometry = LIQUID_MENU_GEOMETRY;
	const menuProgress = clampProgress(progress.menu);
	const submenuProgress = clampProgress(progress.submenu);
	const visualAnchor: LiquidMenuRect = {
		height: Math.max(
			0,
			measurement.anchor.height - anchorGeometry.insetBlock * 2
		),
		left: measurement.anchor.left + anchorGeometry.insetInline,
		top: measurement.anchor.top + anchorGeometry.insetBlock,
		width: Math.max(
			0,
			measurement.anchor.width - anchorGeometry.insetInline * 2
		),
	};
	const padding = geometry.blendRadius + geometry.sampleCellSize * 2;
	let boundsLeft = Math.min(visualAnchor.left, measurement.menu.left) - padding;
	let boundsTop = Math.min(visualAnchor.top, measurement.menu.top) - padding;
	let boundsRight =
		Math.max(
			visualAnchor.left + visualAnchor.width,
			measurement.menu.left + measurement.menu.width
		) + padding;
	let boundsBottom =
		Math.max(
			visualAnchor.top + visualAnchor.height,
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
	const bounds: LiquidMenuRect = {
		height: boundsBottom - boundsTop,
		left: boundsLeft,
		top: boundsTop,
		width: boundsRight - boundsLeft,
	};
	const finalMenuHalfHeight = measurement.menu.height / 2;
	const finalMenuHalfWidth = measurement.menu.width / 2;
	const anchorCenterX = visualAnchor.left + visualAnchor.width / 2;
	const finalMenuCenterX = measurement.menu.left + measurement.menu.width / 2;
	const seedHalfHeight = geometry.sampleCellSize;
	const seedHalfWidth = visualAnchor.height / 2;
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
	const anchorBox = roundedBoxFromRect(
		visualAnchor,
		bounds,
		anchorGeometry.radius
	);
	const menuBox: RoundedBox = {
		centerX:
			interpolate(anchorCenterX, finalMenuCenterX, menuProgress) - bounds.left,
		centerY: measurement.menu.top - bounds.top + animatedMenuHalfHeight,
		halfHeight: animatedMenuHalfHeight,
		halfWidth: animatedMenuHalfWidth,
		radius: Math.min(
			geometry.menuRadius,
			animatedMenuHalfHeight,
			animatedMenuHalfWidth
		),
	};

	const boxes: RoundedBox[] = [anchorBox, menuBox];
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

export const easeLiquidMenuProgress = (
	progress: number,
	isOpening: boolean
): number => {
	const normalizedProgress = clampProgress(progress);
	return isOpening
		? 1 - (1 - normalizedProgress) ** 3
		: normalizedProgress ** 2;
};
