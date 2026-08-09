import {
	LIQUID_MENU_GEOMETRY,
	type LiquidMenuGeometry,
} from "@/fixture/liquid-menu/constants/liquid-menu.js";
import {
	createLiquidUnionPath,
	type RoundedBox,
} from "@/fixture/liquid-surface/lib/liquid-surface-geometry.js";

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
	readonly anchorClip?: LiquidMenuRect | null;
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
	readonly anchor: LiquidMenuFrameAnchor;
	readonly bounds: LiquidMenuRect;
	readonly path: string;
}

export interface LiquidMenuFrameAnchor extends LiquidMenuRect {
	readonly radius: number;
}

export const clipLiquidMenuRect = (
	rect: LiquidMenuRect,
	clip: LiquidMenuRect
): LiquidMenuRect => {
	const clipRight = clip.left + clip.width;
	const clipBottom = clip.top + clip.height;
	const left = Math.min(Math.max(rect.left, clip.left), clipRight);
	const top = Math.min(Math.max(rect.top, clip.top), clipBottom);
	const right = Math.max(left, Math.min(rect.left + rect.width, clipRight));
	const bottom = Math.max(top, Math.min(rect.top + rect.height, clipBottom));
	return {
		height: bottom - top,
		left,
		top,
		width: right - left,
	};
};

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

type LiquidMenuSide = "bottom" | "left" | "right" | "top";

interface LiquidMenuPoint {
	readonly x: number;
	readonly y: number;
}

const getLiquidMenuSide = (
	anchor: LiquidMenuRect,
	menu: LiquidMenuRect
): LiquidMenuSide => {
	const anchorRight = anchor.left + anchor.width;
	const anchorBottom = anchor.top + anchor.height;
	const menuRight = menu.left + menu.width;
	const menuBottom = menu.top + menu.height;
	if (menu.left >= anchorRight) {
		return "right";
	}
	if (menuRight <= anchor.left) {
		return "left";
	}
	if (menu.top >= anchorBottom) {
		return "bottom";
	}
	if (menuBottom <= anchor.top) {
		return "top";
	}

	const horizontalOffset =
		menu.left + menu.width / 2 - (anchor.left + anchor.width / 2);
	const verticalOffset =
		menu.top + menu.height / 2 - (anchor.top + anchor.height / 2);
	if (Math.abs(horizontalOffset) > Math.abs(verticalOffset)) {
		return horizontalOffset >= 0 ? "right" : "left";
	}
	return verticalOffset >= 0 ? "bottom" : "top";
};

const getAnimatedMenuCenter = (
	side: LiquidMenuSide,
	anchor: LiquidMenuRect,
	menu: LiquidMenuRect,
	halfHeight: number,
	halfWidth: number,
	progress: number
): LiquidMenuPoint => {
	const anchorCenterX = anchor.left + anchor.width / 2;
	const anchorCenterY = anchor.top + anchor.height / 2;
	const menuCenterX = menu.left + menu.width / 2;
	const menuCenterY = menu.top + menu.height / 2;

	switch (side) {
		case "right":
			return {
				x: menu.left + halfWidth,
				y: interpolate(anchorCenterY, menuCenterY, progress),
			};
		case "left":
			return {
				x: menu.left + menu.width - halfWidth,
				y: interpolate(anchorCenterY, menuCenterY, progress),
			};
		case "top":
			return {
				x: interpolate(anchorCenterX, menuCenterX, progress),
				y: menu.top + menu.height - halfHeight,
			};
		default:
			return {
				x: interpolate(anchorCenterX, menuCenterX, progress),
				y: menu.top + halfHeight,
			};
	}
};

export const createLiquidMenuFrame = (
	measurement: LiquidMenuMeasurement,
	progress: LiquidMenuProgress,
	anchorGeometry: LiquidMenuAnchorGeometry,
	geometry: LiquidMenuGeometry = LIQUID_MENU_GEOMETRY
): LiquidMenuFrame => {
	const menuProgress = clampProgress(progress.menu);
	const submenuProgress = clampProgress(progress.submenu);
	const insetAnchor: LiquidMenuRect = {
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
	const visualAnchor = measurement.anchorClip
		? clipLiquidMenuRect(insetAnchor, measurement.anchorClip)
		: insetAnchor;
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
	const seedHalfHeight = geometry.sampleCellSize;
	const seedHalfWidth = visualAnchor.height / 2;
	const menuSide = getLiquidMenuSide(visualAnchor, measurement.menu);
	const isInlineMenu = menuSide === "left" || menuSide === "right";
	const animatedMenuHalfHeight = interpolate(
		isInlineMenu
			? Math.min(seedHalfWidth, finalMenuHalfHeight)
			: seedHalfHeight,
		finalMenuHalfHeight,
		menuProgress
	);
	const animatedMenuHalfWidth = interpolate(
		isInlineMenu ? seedHalfHeight : seedHalfWidth,
		finalMenuHalfWidth,
		menuProgress
	);
	const animatedMenuCenter = getAnimatedMenuCenter(
		menuSide,
		visualAnchor,
		measurement.menu,
		animatedMenuHalfHeight,
		animatedMenuHalfWidth,
		menuProgress
	);
	const anchorBox = roundedBoxFromRect(
		visualAnchor,
		bounds,
		anchorGeometry.radius
	);
	const menuBox: RoundedBox = {
		centerX: animatedMenuCenter.x - bounds.left,
		centerY: animatedMenuCenter.y - bounds.top,
		halfHeight: animatedMenuHalfHeight,
		halfWidth: animatedMenuHalfWidth,
		radius: Math.min(
			geometry.menuRadius,
			animatedMenuHalfHeight,
			animatedMenuHalfWidth
		),
	};

	const hasVisibleAnchor = visualAnchor.width > 0 && visualAnchor.height > 0;
	const boxes: RoundedBox[] = hasVisibleAnchor
		? [anchorBox, menuBox]
		: [menuBox];
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
		anchor: {
			height: visualAnchor.height,
			left: visualAnchor.left - bounds.left,
			radius: anchorGeometry.radius,
			top: visualAnchor.top - bounds.top,
			width: visualAnchor.width,
		},
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
