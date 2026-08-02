import { WORKSPACE_TAB_LABEL_MARQUEE } from "@/fixture/desktop-toolbar/constants/workspace-tab.js";

export const getWorkspaceTabLabelOverflow = (
	viewportWidth: number,
	contentWidth: number
): number => {
	const overflow = contentWidth - viewportWidth;
	return overflow > WORKSPACE_TAB_LABEL_MARQUEE.overflowTolerancePx
		? Math.ceil(overflow)
		: 0;
};

export const getWorkspaceTabLabelMarqueeDuration = (
	overflowPixels: number
): number => {
	const travelDuration =
		(overflowPixels / WORKSPACE_TAB_LABEL_MARQUEE.pixelsPerSecond) * 1000;
	return Math.round(
		Math.min(
			WORKSPACE_TAB_LABEL_MARQUEE.maxDurationMs,
			Math.max(WORKSPACE_TAB_LABEL_MARQUEE.minDurationMs, travelDuration)
		)
	);
};
