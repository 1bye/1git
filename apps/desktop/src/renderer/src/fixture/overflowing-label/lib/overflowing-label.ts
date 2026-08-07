import { OVERFLOWING_LABEL_MARQUEE } from "@/fixture/overflowing-label/constants/overflowing-label.js";

export type OverflowingLabelDirection = "end-to-start" | "start-to-end";

export interface OverflowingLabelOffsets {
	readonly hover: number;
	readonly rest: number;
}

export const getOverflowingLabelOverflow = (
	viewportWidth: number,
	contentWidth: number
): number => {
	const overflow = contentWidth - viewportWidth;
	return overflow > OVERFLOWING_LABEL_MARQUEE.overflowTolerancePx
		? Math.ceil(overflow)
		: 0;
};

export const getOverflowingLabelMarqueeDuration = (
	overflowPixels: number
): number => {
	const travelDuration =
		(overflowPixels / OVERFLOWING_LABEL_MARQUEE.pixelsPerSecond) * 1000;
	return Math.round(
		Math.min(
			OVERFLOWING_LABEL_MARQUEE.maxDurationMs,
			Math.max(OVERFLOWING_LABEL_MARQUEE.minDurationMs, travelDuration)
		)
	);
};

export const getOverflowingLabelOffsets = (
	overflowPixels: number,
	direction: OverflowingLabelDirection
): OverflowingLabelOffsets =>
	direction === "end-to-start"
		? { hover: 0, rest: -overflowPixels }
		: { hover: -overflowPixels, rest: 0 };
