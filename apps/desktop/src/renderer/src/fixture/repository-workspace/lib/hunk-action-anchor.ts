import {
	clipLiquidMenuRect,
	type LiquidMenuRect,
} from "@/fixture/liquid-menu/lib/liquid-menu-geometry.js";

type HunkActionGeometryElement = Pick<
	Element,
	"getBoundingClientRect" | "isConnected"
>;

export interface HunkActionAnchorMeasurement {
	readonly anchor: LiquidMenuRect;
	readonly visibleAnchor: LiquidMenuRect;
}

const toLiquidMenuRect = (bounds: DOMRect): LiquidMenuRect => ({
	height: bounds.height,
	left: bounds.left,
	top: bounds.top,
	width: bounds.width,
});

export const measureHunkActionBounds = (
	anchor: LiquidMenuRect,
	viewportElement: HunkActionGeometryElement | null
): HunkActionAnchorMeasurement | null => {
	if (!viewportElement?.isConnected) {
		return null;
	}

	const visibleAnchor = clipLiquidMenuRect(
		anchor,
		toLiquidMenuRect(viewportElement.getBoundingClientRect())
	);

	if (visibleAnchor.width <= 0 || visibleAnchor.height <= 0) {
		return null;
	}

	return { anchor, visibleAnchor };
};

export const measureHunkActionAnchor = (
	anchorElement: HunkActionGeometryElement,
	viewportElement: HunkActionGeometryElement | null
): HunkActionAnchorMeasurement | null => {
	if (!anchorElement.isConnected) {
		return null;
	}

	return measureHunkActionBounds(
		toLiquidMenuRect(anchorElement.getBoundingClientRect()),
		viewportElement
	);
};

export const measureHunkActionSelection = (
	anchorElement: HunkActionGeometryElement,
	capturedAnchor: LiquidMenuRect,
	viewportElement: HunkActionGeometryElement | null
): HunkActionAnchorMeasurement | null =>
	measureHunkActionAnchor(anchorElement, viewportElement) ??
	measureHunkActionBounds(capturedAnchor, viewportElement);
