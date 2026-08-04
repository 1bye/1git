import type { RefObject } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	WORKSPACE_TAB_SURFACE_GEOMETRY,
	WORKSPACE_TAB_SURFACE_MOTION,
} from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import { createWorkspaceLiquidPath } from "@/fixture/desktop-toolbar/lib/workspace-liquid-geometry.js";
import {
	createCollapsedWorkspaceLiquidMeasurement,
	easeWorkspaceLiquidMotion,
	interpolateWorkspaceLiquidMeasurement,
	type WorkspaceLiquidMeasurement,
} from "@/fixture/desktop-toolbar/lib/workspace-liquid-motion.js";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

interface UseWorkspaceLiquidSurfaceOptions {
	readonly activeSessionId: RepositorySessionId | null;
	readonly activeTabIndex: number;
	readonly isDragging: boolean;
}

interface WorkspaceLiquidSurfaceState {
	readonly hostRef: RefObject<HTMLDivElement | null>;
	readonly path: string;
	readonly surfaceWidth: number | null;
}

const MEASUREMENT_SCALE = 10;

const roundMeasurement = (value: number): number =>
	Math.round(value * MEASUREMENT_SCALE) / MEASUREMENT_SCALE;

const hasSameMeasurement = (
	current: WorkspaceLiquidMeasurement | null,
	next: WorkspaceLiquidMeasurement
): boolean =>
	current?.surfaceWidth === next.surfaceWidth &&
	current.tabHeight === next.tabHeight &&
	current.tabLeft === next.tabLeft &&
	current.tabTop === next.tabTop &&
	current.tabWidth === next.tabWidth;

const isAnimatingToMeasurement = (
	animationFrame: number,
	targetMeasurement: WorkspaceLiquidMeasurement | null,
	nextMeasurement: WorkspaceLiquidMeasurement | null
): boolean => {
	if (animationFrame === 0) {
		return false;
	}
	if (nextMeasurement === null) {
		return targetMeasurement === null;
	}
	return hasSameMeasurement(targetMeasurement, nextMeasurement);
};

const getAnimationStartMeasurement = (
	currentMeasurement: WorkspaceLiquidMeasurement | null,
	nextMeasurement: WorkspaceLiquidMeasurement | null
): WorkspaceLiquidMeasurement | null =>
	currentMeasurement ??
	(nextMeasurement
		? createCollapsedWorkspaceLiquidMeasurement(nextMeasurement)
		: null);

const getTabSdfHeight = (
	surfaceWidth: number,
	tabLeft: number,
	tabWidth: number
): number => {
	const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
	const tabRight = tabLeft + tabWidth;
	const edgeClearance = Math.max(
		0,
		Math.min(
			tabLeft - geometry.containerInset,
			surfaceWidth - geometry.containerInset - tabRight
		)
	);
	const edgeProgress = Math.min(1, edgeClearance / geometry.containerRadius);
	const sdfExtension =
		geometry.tabSdfEdgeExtensionBlockEnd +
		(geometry.tabSdfExtensionBlockEnd - geometry.tabSdfEdgeExtensionBlockEnd) *
			edgeProgress;
	return geometry.tabHeight - geometry.tabVisualInsetBlock * 2 + sdfExtension;
};

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
	activeTabIndex,
	isDragging,
}: UseWorkspaceLiquidSurfaceOptions): WorkspaceLiquidSurfaceState {
	const hostRef = useRef<HTMLDivElement>(null);
	const animationFrameRef = useRef(0);
	const measurementRef = useRef<WorkspaceLiquidMeasurement | null>(null);
	const measuredSessionIdRef = useRef<RepositorySessionId | null>(null);
	const positionTrackingDeadlineRef = useRef(0);
	const previousActiveTabIndexRef = useRef(activeTabIndex);
	const targetMeasurementRef = useRef<WorkspaceLiquidMeasurement | null>(null);
	const wasDraggingRef = useRef(false);
	const [measurement, setMeasurement] =
		useState<WorkspaceLiquidMeasurement | null>(null);
	const commitMeasurement = useCallback(
		(nextMeasurement: WorkspaceLiquidMeasurement | null): void => {
			measurementRef.current = nextMeasurement;
			setMeasurement((currentMeasurement) => {
				if (
					nextMeasurement &&
					hasSameMeasurement(currentMeasurement, nextMeasurement)
				) {
					return currentMeasurement;
				}
				return nextMeasurement;
			});
		},
		[]
	);
	const animateToMeasurement = useCallback(
		(
			nextMeasurement: WorkspaceLiquidMeasurement | null,
			shouldAnimate: boolean,
			shouldFollowImmediately = false
		): void => {
			const currentMeasurement = measurementRef.current;
			const isAlreadyAnimatingToTarget = isAnimatingToMeasurement(
				animationFrameRef.current,
				targetMeasurementRef.current,
				nextMeasurement
			);
			if (isAlreadyAnimatingToTarget) {
				return;
			}
			const canRetargetCurrentAnimation =
				!(shouldAnimate || shouldFollowImmediately) &&
				animationFrameRef.current !== 0 &&
				targetMeasurementRef.current !== null &&
				nextMeasurement !== null;
			if (canRetargetCurrentAnimation) {
				targetMeasurementRef.current = nextMeasurement;
				return;
			}
			if (
				nextMeasurement &&
				hasSameMeasurement(currentMeasurement, nextMeasurement)
			) {
				targetMeasurementRef.current = nextMeasurement;
				return;
			}
			if (!(currentMeasurement || nextMeasurement)) {
				return;
			}

			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = 0;
			targetMeasurementRef.current = nextMeasurement;

			const prefersReducedMotion = window.matchMedia(
				"(prefers-reduced-motion: reduce)"
			).matches;
			const animationStartMeasurement = getAnimationStartMeasurement(
				currentMeasurement,
				nextMeasurement
			);
			if (
				!(shouldAnimate && animationStartMeasurement) ||
				prefersReducedMotion
			) {
				commitMeasurement(nextMeasurement);
				return;
			}

			const targetMeasurement =
				nextMeasurement ??
				createCollapsedWorkspaceLiquidMeasurement(animationStartMeasurement);
			const animationStartedAt = performance.now();
			const animateFrame = (timestamp: number): void => {
				const elapsedMs = timestamp - animationStartedAt;
				const progress = Math.min(
					1,
					elapsedMs / WORKSPACE_TAB_SURFACE_MOTION.durationMs
				);
				const easedProgress = easeWorkspaceLiquidMotion(progress);
				const liveTargetMeasurement =
					targetMeasurementRef.current ?? targetMeasurement;
				commitMeasurement(
					interpolateWorkspaceLiquidMeasurement(
						animationStartMeasurement,
						liveTargetMeasurement,
						easedProgress
					)
				);
				if (progress < 1) {
					animationFrameRef.current = requestAnimationFrame(animateFrame);
					return;
				}

				animationFrameRef.current = 0;
				commitMeasurement(targetMeasurementRef.current);
			};
			animationFrameRef.current = requestAnimationFrame(animateFrame);
		},
		[commitMeasurement]
	);
	const measureSurface = useCallback((): void => {
		const host = hostRef.current;
		const titlebar = host?.parentElement;
		if (!(titlebar instanceof HTMLElement)) {
			return;
		}
		if (activeTabIndex < 0) {
			measuredSessionIdRef.current = null;
			animateToMeasurement(null, true);
			return;
		}

		const activeTab = findTrackedActiveTab(titlebar, activeSessionId);
		if (!activeTab) {
			return;
		}

		const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
		const titlebarBounds = titlebar.getBoundingClientRect();
		const tabBounds = activeTab.getBoundingClientRect();
		const surfaceWidth = roundMeasurement(titlebarBounds.width);
		const tabLeft = roundMeasurement(
			tabBounds.left - titlebarBounds.left + geometry.tabVisualInsetInline
		);
		const tabWidth = roundMeasurement(
			Math.max(0, tabBounds.width - geometry.tabVisualInsetInline * 2)
		);
		const nextMeasurement: WorkspaceLiquidMeasurement = {
			surfaceWidth,
			tabHeight: roundMeasurement(
				getTabSdfHeight(surfaceWidth, tabLeft, tabWidth)
			),
			tabLeft,
			tabTop: roundMeasurement(
				tabBounds.top - titlebarBounds.top + geometry.tabVisualInsetBlock
			),
			tabWidth,
		};
		const shouldAnimateSessionChange =
			!isDragging && measuredSessionIdRef.current !== activeSessionId;
		measuredSessionIdRef.current = activeSessionId;
		animateToMeasurement(
			nextMeasurement,
			shouldAnimateSessionChange,
			isDragging
		);
	}, [activeSessionId, activeTabIndex, animateToMeasurement, isDragging]);

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

		const shouldTrackDropSettling = wasDraggingRef.current && !isDragging;
		const shouldTrackFirstWorkspaceOpening =
			previousActiveTabIndexRef.current < 0 && activeTabIndex >= 0;
		wasDraggingRef.current = isDragging;
		previousActiveTabIndexRef.current = activeTabIndex;
		if (shouldTrackDropSettling || shouldTrackFirstWorkspaceOpening) {
			positionTrackingDeadlineRef.current =
				performance.now() +
				WORKSPACE_TAB_SURFACE_MOTION.positionTrackingDurationMs;
		}
		let animationFrameId = 0;
		const trackTabPosition = (): void => {
			measureSurface();
			const isSettling =
				performance.now() < positionTrackingDeadlineRef.current;
			if (isDragging || isSettling) {
				animationFrameId = requestAnimationFrame(trackTabPosition);
			}
		};
		animationFrameId = requestAnimationFrame(trackTabPosition);

		return () => {
			cancelAnimationFrame(animationFrameId);
			resizeObserver.disconnect();
		};
	}, [activeSessionId, activeTabIndex, isDragging, measureSurface]);

	useLayoutEffect(
		() => () => {
			cancelAnimationFrame(animationFrameRef.current);
		},
		[]
	);

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
			tabHeight: measurement.tabHeight,
			tabLeft: measurement.tabLeft,
			tabRadius: geometry.tabRadius,
			tabTop: measurement.tabTop,
			tabWidth: measurement.tabWidth,
		});
	}, [measurement]);

	return {
		hostRef,
		path,
		surfaceWidth: measurement?.surfaceWidth ?? null,
	};
}
