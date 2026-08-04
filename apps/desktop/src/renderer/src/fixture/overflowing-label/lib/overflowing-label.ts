import { OVERFLOWING_LABEL_MARQUEE } from "@/fixture/overflowing-label/constants/overflowing-label.js";

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
