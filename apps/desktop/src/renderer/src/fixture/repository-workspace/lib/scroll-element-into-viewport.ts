export interface ScrollElementIntoViewportOptions {
	readonly block?: "nearest" | "start";
	readonly offset?: number;
}

const nearestScrollDelta = (
	elementRect: DOMRect,
	visibleTop: number,
	visibleBottom: number
): number => {
	if (elementRect.top < visibleTop) {
		return elementRect.top - visibleTop;
	}
	if (elementRect.bottom > visibleBottom) {
		return elementRect.bottom - visibleBottom;
	}
	return 0;
};

export const scrollElementIntoViewport = (
	viewport: HTMLElement,
	element: HTMLElement,
	{ block = "nearest", offset = 0 }: ScrollElementIntoViewportOptions = {}
): void => {
	const viewportRect = viewport.getBoundingClientRect();
	const elementRect = element.getBoundingClientRect();
	const visibleTop = viewportRect.top + offset;
	const delta =
		block === "start"
			? elementRect.top - visibleTop
			: nearestScrollDelta(elementRect, visibleTop, viewportRect.bottom);
	if (delta !== 0) {
		viewport.scrollTop += delta;
	}
};
