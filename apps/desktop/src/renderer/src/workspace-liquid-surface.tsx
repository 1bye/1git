import type { CSSProperties, ReactElement } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RepositorySessionId } from "../../shared/repository-session.js";
import { createWorkspaceLiquidPath } from "./workspace-liquid-geometry.js";
import { WORKSPACE_TAB_SURFACE_GEOMETRY } from "./workspace-tab.js";

interface WorkspaceLiquidSurfaceProps {
	readonly activeSessionId: RepositorySessionId | null;
	readonly isDragging: boolean;
}

interface SurfaceMeasurement {
	readonly surfaceWidth: number;
	readonly tabLeft: number;
	readonly tabTop: number;
}

const POST_DRAG_TRACKING_DURATION = 260;
const MEASUREMENT_PRECISION = 10;

const roundMeasurement = (value: number): number =>
	Math.round(value * MEASUREMENT_PRECISION) / MEASUREMENT_PRECISION;

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
		const overlayRoot = tab.closest<HTMLElement>("[data-dnd-overlay]");
		if (overlayRoot?.hasAttribute("data-dnd-dragging")) {
			return tab;
		}
	}
	return sourceTab;
};

export const WorkspaceLiquidSurface = ({
	activeSessionId,
	isDragging,
}: WorkspaceLiquidSurfaceProps): ReactElement => {
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
		const trackingStartedAt = performance.now();
		let animationFrame = 0;
		const trackTabPosition = (): void => {
			measureSurface();
			const isSettling =
				performance.now() - trackingStartedAt < POST_DRAG_TRACKING_DURATION;
			if (isDragging || isSettling) {
				animationFrame = requestAnimationFrame(trackTabPosition);
			}
		};
		animationFrame = requestAnimationFrame(trackTabPosition);
		return () => {
			cancelAnimationFrame(animationFrame);
			resizeObserver.disconnect();
		};
	}, [activeSessionId, isDragging, measureSurface]);

	const path = useMemo(() => {
		if (!measurement) {
			return "";
		}
		const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
		return createWorkspaceLiquidPath({
			blendRadius: geometry.blendRadius,
			containerDepth: geometry.containerDepth,
			containerInset: geometry.containerInset,
			containerRadius: geometry.containerRadius,
			containerTop: geometry.toolbarHeight,
			sampleCellSize: geometry.sampleCellSize,
			smoothingPasses: geometry.smoothingPasses,
			surfaceWidth: measurement.surfaceWidth,
			tabHeight: geometry.tabHeight,
			tabLeft: measurement.tabLeft + geometry.tabContentInset,
			tabRadius: geometry.tabRadius,
			tabTop: measurement.tabTop,
			tabWidth: geometry.tabWidth - geometry.tabContentInset * 2,
		});
	}, [measurement]);
	const surfaceStyle = useMemo<CSSProperties | undefined>(() => {
		if (!measurement) {
			return;
		}
		return {
			height:
				WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight +
				WORKSPACE_TAB_SURFACE_GEOMETRY.containerOverlap,
			width: measurement.surfaceWidth,
		};
	}, [measurement]);

	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 z-[1] overflow-visible"
			data-name="WorkspaceLiquidSurfaceHost"
			ref={hostRef}
		>
			{path && measurement ? (
				<svg
					className="absolute top-0 left-0 overflow-hidden"
					data-name="WorkspaceLiquidSurface"
					preserveAspectRatio="none"
					style={surfaceStyle}
					viewBox={`0 0 ${measurement.surfaceWidth} ${WORKSPACE_TAB_SURFACE_GEOMETRY.toolbarHeight + WORKSPACE_TAB_SURFACE_GEOMETRY.containerOverlap}`}
				>
					<title>Active workspace surface</title>
					<path d={path} data-name="WorkspaceLiquidSurfaceFill" />
					<path
						d={path}
						data-name="WorkspaceLiquidSurfaceOutline"
						fill="none"
						strokeLinejoin="round"
						strokeWidth={WORKSPACE_TAB_SURFACE_GEOMETRY.outlineWidth}
						vectorEffect="non-scaling-stroke"
					/>
				</svg>
			) : null}
		</div>
	);
};
