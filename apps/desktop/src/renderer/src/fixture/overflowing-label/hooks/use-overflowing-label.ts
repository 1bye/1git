import type { CSSProperties, RefObject } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { OVERFLOWING_LABEL_MARQUEE } from "@/fixture/overflowing-label/constants/overflowing-label.js";
import {
	getOverflowingLabelMarqueeDuration,
	getOverflowingLabelOffsets,
	getOverflowingLabelOverflow,
	type OverflowingLabelDirection,
} from "@/fixture/overflowing-label/lib/overflowing-label.js";

interface OverflowingLabelStyle extends CSSProperties {
	readonly "--overflowing-label-hover-delay": string;
	readonly "--overflowing-label-hover-offset": string;
	readonly "--overflowing-label-leading-mask-fade-duration": string;
	readonly "--overflowing-label-marquee-duration": string;
	readonly "--overflowing-label-rest-offset": string;
	readonly "--overflowing-label-return-duration": string;
}

interface OverflowingLabelState {
	readonly isOverflowing: boolean;
	readonly style: OverflowingLabelStyle;
	readonly trackRef: RefObject<HTMLSpanElement | null>;
	readonly viewportRef: RefObject<HTMLSpanElement | null>;
}

const visibilityCallbacks = new Map<Element, () => void>();
let visibilityObserver: IntersectionObserver | null = null;

const stopVisibilityObserverWhenIdle = (): void => {
	if (visibilityCallbacks.size > 0) {
		return;
	}

	visibilityObserver?.disconnect();
	visibilityObserver = null;
};

const observeOnceVisible = (
	element: Element,
	onVisible: () => void
): (() => void) => {
	visibilityObserver ??= new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) {
				continue;
			}

			const callback = visibilityCallbacks.get(entry.target);

			if (!callback) {
				continue;
			}

			visibilityCallbacks.delete(entry.target);
			visibilityObserver?.unobserve(entry.target);
			callback();
		}

		stopVisibilityObserverWhenIdle();
	});
	visibilityCallbacks.set(element, onVisible);
	visibilityObserver.observe(element);

	return () => {
		visibilityCallbacks.delete(element);
		visibilityObserver?.unobserve(element);
		stopVisibilityObserverWhenIdle();
	};
};

export const useOverflowingLabel = (
	deferUntilVisible = false,
	direction: OverflowingLabelDirection = "start-to-end"
): OverflowingLabelState => {
	const viewportRef = useRef<HTMLSpanElement>(null);
	const trackRef = useRef<HTMLSpanElement>(null);
	const [overflowPixels, setOverflowPixels] = useState(0);

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		const track = trackRef.current;

		if (!(viewport && track)) {
			return;
		}

		const measureOverflow = (): void => {
			const nextOverflow = getOverflowingLabelOverflow(
				viewport.clientWidth,
				track.scrollWidth
			);

			setOverflowPixels((currentOverflow) =>
				currentOverflow === nextOverflow ? currentOverflow : nextOverflow
			);
		};

		let resizeObserver: ResizeObserver | null = null;

		const startMeasuring = (): void => {
			measureOverflow();
			resizeObserver = new ResizeObserver(measureOverflow);
			resizeObserver.observe(viewport);
			resizeObserver.observe(track);
		};

		const stopWaiting = deferUntilVisible
			? observeOnceVisible(viewport, startMeasuring)
			: undefined;

		if (!deferUntilVisible) {
			startMeasuring();
		}

		return () => {
			stopWaiting?.();
			resizeObserver?.disconnect();
		};
	}, [deferUntilVisible]);

	const style = useMemo<OverflowingLabelStyle>(() => {
		const offsets = getOverflowingLabelOffsets(overflowPixels, direction);

		return {
			"--overflowing-label-hover-delay": `${OVERFLOWING_LABEL_MARQUEE.hoverDelayMs}ms`,
			"--overflowing-label-hover-offset": `${offsets.hover}px`,
			"--overflowing-label-leading-mask-fade-duration": `${OVERFLOWING_LABEL_MARQUEE.leadingMaskFadeDurationMs}ms`,
			"--overflowing-label-marquee-duration": `${getOverflowingLabelMarqueeDuration(overflowPixels)}ms`,
			"--overflowing-label-rest-offset": `${offsets.rest}px`,
			"--overflowing-label-return-duration": `${OVERFLOWING_LABEL_MARQUEE.returnDurationMs}ms`,
		};
	}, [direction, overflowPixels]);

	return {
		isOverflowing: overflowPixels > 0,
		style,
		trackRef,
		viewportRef,
	};
};
