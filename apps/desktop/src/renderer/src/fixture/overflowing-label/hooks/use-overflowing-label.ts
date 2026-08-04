import type { CSSProperties, RefObject } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { OVERFLOWING_LABEL_MARQUEE } from "@/fixture/overflowing-label/constants/overflowing-label.js";
import {
	getOverflowingLabelMarqueeDuration,
	getOverflowingLabelOverflow,
} from "@/fixture/overflowing-label/lib/overflowing-label.js";

interface OverflowingLabelStyle extends CSSProperties {
	readonly "--overflowing-label-hover-delay": string;
	readonly "--overflowing-label-leading-mask-fade-duration": string;
	readonly "--overflowing-label-marquee-duration": string;
	readonly "--overflowing-label-overflow": string;
	readonly "--overflowing-label-return-duration": string;
}

interface OverflowingLabelState {
	readonly isOverflowing: boolean;
	readonly style: OverflowingLabelStyle;
	readonly trackRef: RefObject<HTMLSpanElement | null>;
	readonly viewportRef: RefObject<HTMLSpanElement | null>;
}

export const useOverflowingLabel = (): OverflowingLabelState => {
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

		measureOverflow();
		const resizeObserver = new ResizeObserver(measureOverflow);
		resizeObserver.observe(viewport);
		resizeObserver.observe(track);
		return () => resizeObserver.disconnect();
	}, []);

	const style = useMemo<OverflowingLabelStyle>(
		() => ({
			"--overflowing-label-hover-delay": `${OVERFLOWING_LABEL_MARQUEE.hoverDelayMs}ms`,
			"--overflowing-label-leading-mask-fade-duration": `${OVERFLOWING_LABEL_MARQUEE.leadingMaskFadeDurationMs}ms`,
			"--overflowing-label-marquee-duration": `${getOverflowingLabelMarqueeDuration(overflowPixels)}ms`,
			"--overflowing-label-overflow": `${overflowPixels}px`,
			"--overflowing-label-return-duration": `${OVERFLOWING_LABEL_MARQUEE.returnDurationMs}ms`,
		}),
		[overflowPixels]
	);

	return {
		isOverflowing: overflowPixels > 0,
		style,
		trackRef,
		viewportRef,
	};
};
