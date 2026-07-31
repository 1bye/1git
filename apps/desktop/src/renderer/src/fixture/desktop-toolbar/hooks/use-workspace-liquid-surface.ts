import type { RefObject } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";
import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "../constants/workspace-tab.js";
import { createWorkspaceLiquidPath } from "../lib/workspace-liquid-geometry.js";

interface UseWorkspaceLiquidSurfaceOptions {
	readonly activeSessionId: RepositorySessionId | null;
	readonly isDragging: boolean;
}

interface WorkspaceLiquidSurfaceState {
	readonly hostRef: RefObject<HTMLDivElement | null>;
	readonly path: string;
	readonly surfaceWidth: number | null;
}

interface SurfaceMeasurement {
	readonly surfaceWidth: number;
	readonly tabLeft: number;
	readonly tabTop: number;
}

const POST_DRAG_TRACKING_DURATION_MS = 260;
const MEASUREMENT_SCALE = 10;

const roundMeasurement = (value: number): number =>
	Math.round(value * MEASUREMENT_SCALE) / MEASUREMENT_SCALE;

const hasSameMeasurement = (
	current: SurfaceMeasurement | null,
	next: SurfaceMeasurement
): boolean =>
	current?.surfaceWidth === next.surfaceWidth &&
	current.tabLeft === next.tabLeft &&
	current.tabTop === next.tabTop;

const findTrackedActiveTab = (
	titlebar: HTMLElement,
	activeSessionId: RepositorySessionId | null
): HTMLElement | null => {
	if (!activeSessionId) {
		return null;
	}

	const tabs = titlebar.querySelectorAll<HTMLElement>(
		'[data-name="WorkspaceTab"]'
	);
	let sourceTab: HTMLElement | null = null;

	for (const tab of tabs) {
		if (tab.dataset.workspaceSessionId !== activeSessionId) {
			continue;
		}
		if (tab.dataset.overlay !== "true") {
			sourceTab = tab;
			continue;
		}

		// The drag overlay is the visible tab, so the liquid surface must follow it.
		const overlayRoot = tab.closest<HTMLElement>("[data-dnd-overlay]");
		if (overlayRoot?.hasAttribute("data-dnd-dragging")) {
			return tab;
		}
	}

	return sourceTab;
};

export function useWorkspaceLiquidSurface({
	activeSessionId,
	isDragging,
}: UseWorkspaceLiquidSurfaceOptions): WorkspaceLiquidSurfaceState {
	const hostRef = useRef<HTMLDivElement>(null);
	const [measurement, setMeasurement] = useState<SurfaceMeasurement | null>(
		null
	);
	const measureSurface = useCallback((): void => {
		const host = hostRef.current;
		const titlebar = host?.parentElement;
		if (!(titlebar instanceof HTMLElement)) {
			return;
		}

		const activeTab = findTrackedActiveTab(titlebar, activeSessionId);
		if (!activeTab) {
			setMeasurement(null);
			return;
		}

		const titlebarBounds = titlebar.getBoundingClientRect();
		const tabBounds = activeTab.getBoundingClientRect();
		const nextMeasurement: SurfaceMeasurement = {
			surfaceWidth: roundMeasurement(titlebarBounds.width),
			tabLeft: roundMeasurement(tabBounds.left - titlebarBounds.left),
			tabTop: roundMeasurement(tabBounds.top - titlebarBounds.top),
		};
		setMeasurement((current) =>
			hasSameMeasurement(current, nextMeasurement) ? current : nextMeasurement
		);
	}, [activeSessionId]);

	useLayoutEffect(() => {
		const host = hostRef.current;
		const titlebar = host?.parentElement;
		if (!(titlebar instanceof HTMLElement)) {
			return;
		}

		const activeTab = findTrackedActiveTab(titlebar, activeSessionId);
		const resizeObserver = new ResizeObserver(measureSurface);
		resizeObserver.observe(titlebar);
		if (activeTab) {
			resizeObserver.observe(activeTab);
		}
		measureSurface();

		const trackingStartedAtMs = performance.now();
		let animationFrameId = 0;
		const trackTabPosition = (): void => {
			measureSurface();
			const isSettling =
				performance.now() - trackingStartedAtMs <
				POST_DRAG_TRACKING_DURATION_MS;
			if (isDragging || isSettling) {
				animationFrameId = requestAnimationFrame(trackTabPosition);
			}
		};
		animationFrameId = requestAnimationFrame(trackTabPosition);

		return () => {
			cancelAnimationFrame(animationFrameId);
			resizeObserver.disconnect();
		};
	}, [activeSessionId, isDragging, measureSurface]);

	const path = useMemo(() => {
		if (!measurement) {
			return "";
		}

		const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
		const tabLeft = measurement.tabLeft + geometry.tabVisualInsetInline;
		const tabWidth = geometry.tabWidth - geometry.tabVisualInsetInline * 2;
		const tabRight = tabLeft + tabWidth;
		const edgeClearance = Math.max(
			0,
			Math.min(
				tabLeft - geometry.containerInset,
				measurement.surfaceWidth - geometry.containerInset - tabRight
			)
		);
		const edgeProgress = Math.min(1, edgeClearance / geometry.containerRadius);
		const sdfExtension =
			geometry.tabSdfEdgeExtensionBlockEnd +
			(geometry.tabSdfExtensionBlockEnd -
				geometry.tabSdfEdgeExtensionBlockEnd) *
				edgeProgress;

		return createWorkspaceLiquidPath({
			blendRadius: geometry.blendRadius,
			containerDepth: geometry.containerDepth,
			containerInset: geometry.containerInset,
			containerRadius: geometry.containerRadius,
			containerTop: geometry.toolbarHeight,
			sampleCellSize: geometry.sampleCellSize,
			smoothingPasses: geometry.smoothingPasses,
			surfaceWidth: measurement.surfaceWidth,
			tabHeight:
				geometry.tabHeight - geometry.tabVisualInsetBlock * 2 + sdfExtension,
			tabLeft,
			tabRadius: geometry.tabRadius,
			tabTop: measurement.tabTop + geometry.tabVisualInsetBlock,
			tabWidth,
		});
	}, [measurement]);

	return {
		hostRef,
		path,
		surfaceWidth: measurement?.surfaceWidth ?? null,
	};
}
