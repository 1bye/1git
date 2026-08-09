import type { RefObject } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	WORKSPACE_TAB_SURFACE_GEOMETRY,
	WORKSPACE_TAB_SURFACE_MOTION,
} from "@/fixture/desktop-toolbar/constants/workspace-tab.js";
import {
	createWorkspaceLiquidMeasurement,
	createWorkspaceLiquidPath,
	getWorkspaceLiquidCornerRadius,
	getWorkspaceLiquidEdgeConnections,
} from "@/fixture/desktop-toolbar/lib/workspace-liquid-geometry.js";
import {
	createCollapsedWorkspaceLiquidMeasurement,
	easeWorkspaceLiquidMotion,
	interpolateWorkspaceLiquidMeasurement,
	type WorkspaceLiquidMeasurement,
} from "@/fixture/desktop-toolbar/lib/workspace-liquid-motion.js";
import {
	getWorkspaceTabRevealFrame,
	getWorkspaceTabRevealScrollLeft,
} from "@/fixture/desktop-toolbar/lib/workspace-tab-scroll.js";
import { useReducedMotion } from "@/fixture/liquid-surface/hooks/use-reduced-motion.js";
import { createLiquidGeometryTracker } from "@/fixture/liquid-surface/lib/track-liquid-geometry.js";
import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

interface UseWorkspaceLiquidSurfaceOptions {
	readonly activeSessionId: RepositorySessionId | null;
	readonly activeTabIndex: number;
	readonly isPositionTracking: boolean;
	readonly workspaceRootRef: RefObject<HTMLElement | null>;
}

interface WorkspaceLiquidSurfaceState {
	readonly hostRef: RefObject<HTMLDivElement | null>;
	readonly path: string;
	readonly surfaceWidth: number | null;
}

interface WorkspaceTabRevealAnimation {
	animationFrameId: number;
	readonly sessionId: RepositorySessionId;
	readonly tabList: HTMLElement;
	readonly targetScrollLeft: number;
}

const WORKSPACE_TOP_LEFT_RADIUS_PROPERTY =
	"--workspace-liquid-container-top-left-radius";
const WORKSPACE_TOP_RIGHT_RADIUS_PROPERTY =
	"--workspace-liquid-container-top-right-radius";

const setWorkspaceCornerRadii = (
	workspaceRoot: HTMLElement | null,
	measurement: WorkspaceLiquidMeasurement | null
): void => {
	if (!workspaceRoot) {
		return;
	}
	const { containerRadius } = WORKSPACE_TAB_SURFACE_GEOMETRY;
	const edgeConnections = measurement
		? getWorkspaceLiquidEdgeConnections(measurement)
		: { left: 0, right: 0 };
	const leftRadius = getWorkspaceLiquidCornerRadius(
		containerRadius,
		edgeConnections.left
	);
	const rightRadius = getWorkspaceLiquidCornerRadius(
		containerRadius,
		edgeConnections.right
	);
	workspaceRoot.style.setProperty(
		WORKSPACE_TOP_LEFT_RADIUS_PROPERTY,
		`${leftRadius}px`
	);
	workspaceRoot.style.setProperty(
		WORKSPACE_TOP_RIGHT_RADIUS_PROPERTY,
		`${rightRadius}px`
	);
};

const clearWorkspaceCornerRadii = (workspaceRoot: HTMLElement | null): void => {
	workspaceRoot?.style.removeProperty(WORKSPACE_TOP_LEFT_RADIUS_PROPERTY);
	workspaceRoot?.style.removeProperty(WORKSPACE_TOP_RIGHT_RADIUS_PROPERTY);
};

const hasSameMeasurement = (
	current: WorkspaceLiquidMeasurement | null,
	next: WorkspaceLiquidMeasurement
): boolean =>
	current?.surfaceWidth === next.surfaceWidth &&
	current.tabFullWidth === next.tabFullWidth &&
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
	isPositionTracking,
	workspaceRootRef,
}: UseWorkspaceLiquidSurfaceOptions): WorkspaceLiquidSurfaceState {
	const prefersReducedMotion = useReducedMotion();
	const hostRef = useRef<HTMLDivElement>(null);
	const animationFrameRef = useRef(0);
	const measurementRef = useRef<WorkspaceLiquidMeasurement | null>(null);
	const measuredSessionIdRef = useRef<RepositorySessionId | null>(null);
	const tabRevealAnimationRef = useRef<WorkspaceTabRevealAnimation | null>(
		null
	);
	const targetMeasurementRef = useRef<WorkspaceLiquidMeasurement | null>(null);
	const [measurement, setMeasurement] =
		useState<WorkspaceLiquidMeasurement | null>(null);
	const stopWorkspaceTabReveal = useCallback((shouldFinish: boolean): void => {
		const animation = tabRevealAnimationRef.current;
		if (!animation) {
			return;
		}
		cancelAnimationFrame(animation.animationFrameId);
		tabRevealAnimationRef.current = null;
		if (shouldFinish) {
			animation.tabList.scrollLeft = animation.targetScrollLeft;
		}
	}, []);
	const startWorkspaceTabReveal = useCallback(
		(
			tabList: HTMLElement,
			sessionId: RepositorySessionId,
			targetScrollLeft: number
		): void => {
			stopWorkspaceTabReveal(false);
			const initialScrollLeft = tabList.scrollLeft;
			const animationStartedAt = performance.now();
			const animation: WorkspaceTabRevealAnimation = {
				animationFrameId: 0,
				sessionId,
				tabList,
				targetScrollLeft,
			};
			const animateFrame = (timestamp: number): void => {
				if (tabRevealAnimationRef.current !== animation) {
					return;
				}
				const frame = getWorkspaceTabRevealFrame({
					durationMs: WORKSPACE_TAB_SURFACE_MOTION.offscreenRevealDurationMs,
					elapsedMs: timestamp - animationStartedAt,
					initialScrollLeft,
					targetScrollLeft,
				});
				tabList.scrollLeft = frame.scrollLeft;
				if (frame.isComplete) {
					tabRevealAnimationRef.current = null;
					return;
				}
				animation.animationFrameId = requestAnimationFrame(animateFrame);
			};
			tabRevealAnimationRef.current = animation;
			animation.animationFrameId = requestAnimationFrame(animateFrame);
		},
		[stopWorkspaceTabReveal]
	);
	const commitMeasurement = useCallback(
		(nextMeasurement: WorkspaceLiquidMeasurement | null): void => {
			measurementRef.current = nextMeasurement;
			setWorkspaceCornerRadii(workspaceRootRef.current, nextMeasurement);
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
		[workspaceRootRef]
	);
	const animateToMeasurement = useCallback(
		(
			nextMeasurement: WorkspaceLiquidMeasurement | null,
			shouldAnimate: boolean,
			shouldFollowImmediately = false,
			durationMs: number = WORKSPACE_TAB_SURFACE_MOTION.durationMs
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
				const progress = Math.min(1, elapsedMs / durationMs);
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
		[commitMeasurement, prefersReducedMotion]
	);
	const revealActiveWorkspaceTab = useCallback(
		(
			titlebar: HTMLElement,
			activeTab: HTMLElement,
			tabList: HTMLElement,
			sessionId: RepositorySessionId
		): boolean => {
			const tabBounds = activeTab.getBoundingClientRect();
			const tabListBounds = tabList.getBoundingClientRect();
			const initialScrollLeft = tabList.scrollLeft;
			const targetScrollLeft = getWorkspaceTabRevealScrollLeft({
				currentScrollLeft: initialScrollLeft,
				maximumScrollLeft: tabList.scrollWidth - tabList.clientWidth,
				tabLeft: tabBounds.left,
				tabRight: tabBounds.right,
				viewportLeft: tabListBounds.left,
				viewportRight: tabListBounds.right,
			});
			const shouldAnimateReveal =
				!prefersReducedMotion && targetScrollLeft !== initialScrollLeft;
			if (!shouldAnimateReveal) {
				tabList.scrollLeft = targetScrollLeft;
				return false;
			}

			const scrollDelta = targetScrollLeft - initialScrollLeft;
			const targetMeasurement = createWorkspaceLiquidMeasurement(
				titlebar.getBoundingClientRect(),
				{
					height: tabBounds.height,
					left: tabBounds.left - scrollDelta,
					top: tabBounds.top,
					width: tabBounds.width,
				},
				tabListBounds
			);
			measuredSessionIdRef.current = sessionId;
			startWorkspaceTabReveal(tabList, sessionId, targetScrollLeft);
			animateToMeasurement(
				targetMeasurement,
				true,
				false,
				WORKSPACE_TAB_SURFACE_MOTION.offscreenRevealDurationMs
			);
			return true;
		},
		[animateToMeasurement, prefersReducedMotion, startWorkspaceTabReveal]
	);
	const measureSurface = useCallback((): void => {
		const host = hostRef.current;
		const titlebar = host?.parentElement;
		if (!(titlebar instanceof HTMLElement)) {
			return;
		}
		if (activeTabIndex < 0) {
			stopWorkspaceTabReveal(false);
			measuredSessionIdRef.current = null;
			animateToMeasurement(null, true);
			return;
		}

		const activeTab = findTrackedActiveTab(titlebar, activeSessionId);
		const tabList = titlebar.querySelector<HTMLElement>(
			'[data-name="WorkspaceTabList"]'
		);
		if (!(activeTab && tabList)) {
			stopWorkspaceTabReveal(false);
			return;
		}

		const revealAnimation = tabRevealAnimationRef.current;
		if (revealAnimation) {
			const shouldContinueReveal =
				revealAnimation.sessionId === activeSessionId && !isPositionTracking;
			if (shouldContinueReveal) {
				return;
			}
			stopWorkspaceTabReveal(false);
		}

		const didSessionChange = measuredSessionIdRef.current !== activeSessionId;
		const didStartReveal =
			didSessionChange &&
			!isPositionTracking &&
			activeSessionId !== null &&
			revealActiveWorkspaceTab(titlebar, activeTab, tabList, activeSessionId);
		if (didStartReveal) {
			return;
		}

		const titlebarBounds = titlebar.getBoundingClientRect();
		const tabBounds = activeTab.getBoundingClientRect();
		const nextMeasurement = createWorkspaceLiquidMeasurement(
			titlebarBounds,
			tabBounds,
			tabList.getBoundingClientRect()
		);
		const shouldAnimateSessionChange = !isPositionTracking && didSessionChange;
		measuredSessionIdRef.current = activeSessionId;
		animateToMeasurement(
			nextMeasurement,
			shouldAnimateSessionChange,
			isPositionTracking
		);
	}, [
		activeSessionId,
		activeTabIndex,
		animateToMeasurement,
		isPositionTracking,
		revealActiveWorkspaceTab,
		stopWorkspaceTabReveal,
	]);

	useLayoutEffect(() => {
		const host = hostRef.current;
		const titlebar = host?.parentElement;
		if (!(titlebar instanceof HTMLElement)) {
			return;
		}

		const activeTab = findTrackedActiveTab(titlebar, activeSessionId);
		const tabList = titlebar.querySelector<HTMLElement>(
			'[data-name="WorkspaceTabList"]'
		);
		const trackedElements: Element[] = [titlebar];
		if (activeTab) {
			trackedElements.push(activeTab);
		}
		if (tabList) {
			trackedElements.push(tabList);
		}
		for (const child of titlebar.children) {
			if (child instanceof HTMLElement && child !== host) {
				trackedElements.push(child);
			}
		}
		const tracker = createLiquidGeometryTracker(measureSurface);
		tracker.setElements(trackedElements);
		tracker.setContinuousTracking(isPositionTracking);
		tracker.measureNow();

		return tracker.disconnect;
	}, [activeSessionId, isPositionTracking, measureSurface]);

	useLayoutEffect(
		() => () => {
			cancelAnimationFrame(animationFrameRef.current);
			stopWorkspaceTabReveal(false);
			clearWorkspaceCornerRadii(workspaceRootRef.current);
		},
		[stopWorkspaceTabReveal, workspaceRootRef]
	);
	useLayoutEffect(() => {
		if (!prefersReducedMotion) {
			return;
		}
		stopWorkspaceTabReveal(true);
		if (animationFrameRef.current !== 0) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = 0;
			commitMeasurement(targetMeasurementRef.current);
		}
	}, [commitMeasurement, prefersReducedMotion, stopWorkspaceTabReveal]);

	const path = useMemo(() => {
		if (!measurement) {
			return "";
		}

		const geometry = WORKSPACE_TAB_SURFACE_GEOMETRY;
		return createWorkspaceLiquidPath({
			blendRadius: geometry.blendRadius,
			containerDepth: geometry.containerDepth,
			containerOverlap: geometry.containerOverlap,
			containerRadius: geometry.containerRadius,
			containerTop: geometry.toolbarHeight,
			sampleCellSize: geometry.sampleCellSize,
			smoothingPasses: geometry.smoothingPasses,
			surfaceWidth: measurement.surfaceWidth,
			tabFullWidth: measurement.tabFullWidth,
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
