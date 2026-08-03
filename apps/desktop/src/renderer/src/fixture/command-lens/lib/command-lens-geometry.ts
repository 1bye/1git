import { COMMAND_LENS_GEOMETRY } from "@/fixture/command-lens/constants/command-lens.js";
import {
	createLiquidUnionPath,
	type RoundedBox,
} from "@/fixture/liquid-menu/lib/liquid-surface-geometry.js";

export interface CommandLensRect {
	readonly height: number;
	readonly left: number;
	readonly top: number;
	readonly width: number;
}

export type CommandLensPlacement = "bottom" | "left" | "right" | "top";

export interface CommandLensSurfaceFrame {
	readonly anchor: CommandLensRect;
	readonly bounds: CommandLensRect;
	readonly hint: CommandLensRect;
	readonly path: string;
}

interface CommandLensViewport {
	readonly height: number;
	readonly width: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
	Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

const oppositePlacement = (
	placement: CommandLensPlacement
): CommandLensPlacement => {
	if (placement === "bottom") {
		return "top";
	}
	if (placement === "top") {
		return "bottom";
	}
	if (placement === "left") {
		return "right";
	}
	return "left";
};

const hasPlacementSpace = (
	anchor: CommandLensRect,
	hintWidth: number,
	hintHeight: number,
	placement: CommandLensPlacement,
	viewport: CommandLensViewport
): boolean => {
	const { hintGap, viewportInset } = COMMAND_LENS_GEOMETRY;
	if (placement === "bottom") {
		return (
			anchor.top + anchor.height + hintGap + hintHeight <=
			viewport.height - viewportInset
		);
	}
	if (placement === "top") {
		return anchor.top - hintGap - hintHeight >= viewportInset;
	}
	if (placement === "left") {
		return anchor.left - hintGap - hintWidth >= viewportInset;
	}
	return (
		anchor.left + anchor.width + hintGap + hintWidth <=
		viewport.width - viewportInset
	);
};

export const getCommandLensHintRect = (
	anchor: CommandLensRect,
	hintWidth: number,
	hintHeight: number,
	preferredPlacement: CommandLensPlacement,
	viewport: CommandLensViewport
): CommandLensRect => {
	const placement = hasPlacementSpace(
		anchor,
		hintWidth,
		hintHeight,
		preferredPlacement,
		viewport
	)
		? preferredPlacement
		: oppositePlacement(preferredPlacement);
	const { hintGap, viewportInset } = COMMAND_LENS_GEOMETRY;
	let left = anchor.left + (anchor.width - hintWidth) / 2;
	let top = anchor.top + (anchor.height - hintHeight) / 2;

	if (placement === "bottom") {
		top = anchor.top + anchor.height + hintGap;
	} else if (placement === "top") {
		top = anchor.top - hintHeight - hintGap;
	} else if (placement === "left") {
		left = anchor.left - hintWidth - hintGap;
	} else {
		left = anchor.left + anchor.width + hintGap;
	}

	return {
		height: hintHeight,
		left: clamp(
			left,
			viewportInset,
			viewport.width - hintWidth - viewportInset
		),
		top: clamp(
			top,
			viewportInset,
			viewport.height - hintHeight - viewportInset
		),
		width: hintWidth,
	};
};

const roundedBoxFromRect = (
	rect: CommandLensRect,
	bounds: CommandLensRect,
	radius: number
): RoundedBox => ({
	centerX: rect.left - bounds.left + rect.width / 2,
	centerY: rect.top - bounds.top + rect.height / 2,
	halfHeight: rect.height / 2,
	halfWidth: rect.width / 2,
	radius,
});

export const createCommandLensSurfaceFrame = (
	anchor: CommandLensRect,
	hint: CommandLensRect,
	anchorRadius: number
): CommandLensSurfaceFrame => {
	const { surfacePadding } = COMMAND_LENS_GEOMETRY;
	const left = Math.min(anchor.left, hint.left) - surfacePadding;
	const top = Math.min(anchor.top, hint.top) - surfacePadding;
	const right =
		Math.max(anchor.left + anchor.width, hint.left + hint.width) +
		surfacePadding;
	const bottom =
		Math.max(anchor.top + anchor.height, hint.top + hint.height) +
		surfacePadding;
	const bounds: CommandLensRect = {
		height: bottom - top,
		left,
		top,
		width: right - left,
	};
	const relativeAnchor: CommandLensRect = {
		...anchor,
		left: anchor.left - bounds.left,
		top: anchor.top - bounds.top,
	};
	const relativeHint: CommandLensRect = {
		...hint,
		left: hint.left - bounds.left,
		top: hint.top - bounds.top,
	};

	return {
		anchor: relativeAnchor,
		bounds,
		hint: relativeHint,
		path: createLiquidUnionPath({
			blendRadius: COMMAND_LENS_GEOMETRY.blendRadius,
			boxes: [
				roundedBoxFromRect(anchor, bounds, anchorRadius),
				roundedBoxFromRect(hint, bounds, COMMAND_LENS_GEOMETRY.hintRadius),
			],
			sampleCellSize: COMMAND_LENS_GEOMETRY.sampleCellSize,
			smoothingPasses: COMMAND_LENS_GEOMETRY.smoothingPasses,
			surfaceHeight: bounds.height,
			surfaceWidth: bounds.width,
		}),
	};
};
