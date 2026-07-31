import type { CSSProperties, RefObject } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { WORKSPACE_TAB_LABEL_MARQUEE } from "../constants/workspace-tab.js";
import {
	getWorkspaceTabLabelMarqueeDuration,
	getWorkspaceTabLabelOverflow,
} from "../lib/workspace-tab-label.js";

interface WorkspaceTabLabelStyle extends CSSProperties {
	readonly "--workspace-tab-label-hover-delay": string;
	readonly "--workspace-tab-label-marquee-duration": string;
	readonly "--workspace-tab-label-overflow": string;
	readonly "--workspace-tab-label-return-duration": string;
}

interface OverflowingTabLabel {
	readonly isOverflowing: boolean;
	readonly style: WorkspaceTabLabelStyle;
	readonly trackRef: RefObject<HTMLSpanElement | null>;
	readonly viewportRef: RefObject<HTMLSpanElement | null>;
}

export const useOverflowingTabLabel = (): OverflowingTabLabel => {
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
			const nextOverflow = getWorkspaceTabLabelOverflow(
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

	const style = useMemo<WorkspaceTabLabelStyle>(
		() => ({
			"--workspace-tab-label-hover-delay": `${WORKSPACE_TAB_LABEL_MARQUEE.hoverDelayMs}ms`,
			"--workspace-tab-label-marquee-duration": `${getWorkspaceTabLabelMarqueeDuration(overflowPixels)}ms`,
			"--workspace-tab-label-overflow": `${overflowPixels}px`,
			"--workspace-tab-label-return-duration": `${WORKSPACE_TAB_LABEL_MARQUEE.returnDurationMs}ms`,
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
