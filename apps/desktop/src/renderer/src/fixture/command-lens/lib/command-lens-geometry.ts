import { COMMAND_LENS_GEOMETRY } from "@/fixture/command-lens/constants/command-lens.js";

export interface CommandLensRect {
	readonly height: number;
	readonly left: number;
	readonly top: number;
	readonly width: number;
}

export type CommandLensPlacement = "bottom" | "left" | "right" | "top";
export type CommandLensHintLayout = "floating" | "gutter-start" | "inline-end";

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
	const { floatingGap, viewportInset } = COMMAND_LENS_GEOMETRY;
	if (placement === "bottom") {
		return (
			anchor.top + anchor.height + floatingGap + hintHeight <=
			viewport.height - viewportInset
		);
	}
	if (placement === "top") {
		return anchor.top - floatingGap - hintHeight >= viewportInset;
	}
	if (placement === "left") {
		return anchor.left - floatingGap - hintWidth >= viewportInset;
	}
	return (
		anchor.left + anchor.width + floatingGap + hintWidth <=
		viewport.width - viewportInset
	);
};

const getFloatingHintRect = (
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
	const { floatingGap, viewportInset } = COMMAND_LENS_GEOMETRY;
	let left = anchor.left + (anchor.width - hintWidth) / 2;
	let top = anchor.top + (anchor.height - hintHeight) / 2;

	if (placement === "bottom") {
		top = anchor.top + anchor.height + floatingGap;
	} else if (placement === "top") {
		top = anchor.top - hintHeight - floatingGap;
	} else if (placement === "left") {
		left = anchor.left - hintWidth - floatingGap;
	} else {
		left = anchor.left + anchor.width + floatingGap;
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

export const getCommandLensHintRect = (
	anchor: CommandLensRect,
	hintWidth: number,
	hintHeight: number,
	layout: CommandLensHintLayout,
	preferredPlacement: CommandLensPlacement,
	viewport: CommandLensViewport
): CommandLensRect => {
	if (layout === "floating") {
		return getFloatingHintRect(
			anchor,
			hintWidth,
			hintHeight,
			preferredPlacement,
			viewport
		);
	}
	const { gutterGap, inlineInset, viewportInset } = COMMAND_LENS_GEOMETRY;
	const left =
		layout === "inline-end"
			? anchor.left + anchor.width - hintWidth - inlineInset
			: anchor.left - hintWidth - gutterGap;
	const top = anchor.top + (anchor.height - hintHeight) / 2;
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
