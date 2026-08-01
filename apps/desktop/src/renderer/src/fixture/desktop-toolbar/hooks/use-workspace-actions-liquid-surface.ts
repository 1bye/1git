import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { WORKSPACE_ACTIONS_LIQUID_MOTION } from "../constants/workspace-actions-menu.js";
import {
	WORKSPACE_ACTIONS_MENU_ID,
	WORKSPACE_ACTIONS_SUBMENU_ID,
	WORKSPACE_ACTIONS_SUBMENU_TRIGGER_ID,
} from "../constants/workspace-tab.js";
import {
	createWorkspaceActionsLiquidFrame,
	easeWorkspaceActionsLiquidProgress,
	type LiquidSurfaceRect,
	type WorkspaceActionsLiquidFrame,
	type WorkspaceActionsLiquidMeasurement,
	type WorkspaceActionsLiquidSubmenuMeasurement,
} from "../lib/workspace-actions-liquid-geometry.js";

interface UseWorkspaceActionsLiquidSurfaceOptions {
	readonly isOpen: boolean;
	readonly isSubmenuOpen: boolean;
	readonly onPresenceChange: (isPresent: boolean) => void;
	readonly onSubmenuPresenceChange: (isPresent: boolean) => void;
}

interface WorkspaceActionsLiquidSurfaceState {
	readonly frame: WorkspaceActionsLiquidFrame | null;
	readonly progress: number;
	readonly submenuProgress: number;
}

interface UseLiquidProgressOptions {
	readonly closeDurationMs: number;
	readonly hasMeasurement: boolean;
	readonly isActive: boolean;
	readonly onHidden: () => void;
	readonly onPresenceChange: (isPresent: boolean) => void;
	readonly openDurationMs: number;
}

const ACTIVE_WORKSPACE_TAB_SELECTOR =
	'[data-name="WorkspaceTab"][data-active="true"]:not([data-overlay="true"])';
const MEASUREMENT_SCALE = 10;
const MINIMUM_VISIBLE_PROGRESS = 0.001;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const roundMeasurement = (value: number): number =>
	Math.round(value * MEASUREMENT_SCALE) / MEASUREMENT_SCALE;

const toLiquidRect = (bounds: DOMRect): LiquidSurfaceRect => ({
	height: roundMeasurement(bounds.height),
	left: roundMeasurement(bounds.left),
	top: roundMeasurement(bounds.top),
	width: roundMeasurement(bounds.width),
});

const hasSameRect = (
	current: LiquidSurfaceRect,
	next: LiquidSurfaceRect
): boolean =>
	current.height === next.height &&
	current.left === next.left &&
	current.top === next.top &&
	current.width === next.width;

const hasSameSubmenuMeasurement = (
	current: WorkspaceActionsLiquidSubmenuMeasurement | null,
	next: WorkspaceActionsLiquidSubmenuMeasurement | null
): boolean => {
	if (current === null || next === null) {
		return current === next;
	}
	return (
		current.side === next.side &&
		hasSameRect(current.menu, next.menu) &&
		hasSameRect(current.trigger, next.trigger)
	);
};

const hasSameMeasurement = (
	current: WorkspaceActionsLiquidMeasurement | null,
	next: WorkspaceActionsLiquidMeasurement
): boolean =>
	current !== null &&
	hasSameRect(current.menu, next.menu) &&
	hasSameSubmenuMeasurement(current.submenu, next.submenu) &&
	hasSameRect(current.tab, next.tab);

const useLiquidProgress = ({
	closeDurationMs,
	hasMeasurement,
	isActive,
	onHidden,
	onPresenceChange,
	openDurationMs,
}: UseLiquidProgressOptions): number => {
	const [progress, setProgress] = useState(0);
	const animationFrameRef = useRef(0);
	const onHiddenRef = useRef(onHidden);
	const onPresenceChangeRef = useRef(onPresenceChange);
	const progressRef = useRef(0);
	onHiddenRef.current = onHidden;
	onPresenceChangeRef.current = onPresenceChange;

	const updateProgress = useCallback((nextProgress: number): void => {
		progressRef.current = nextProgress;
		setProgress(nextProgress);
	}, []);

	const animateProgress = useCallback(
		(targetProgress: number, durationMs: number): void => {
			cancelAnimationFrame(animationFrameRef.current);
			let startingProgress = progressRef.current;
			if (targetProgress > 0) {
				onPresenceChangeRef.current(true);
				if (startingProgress === 0) {
					startingProgress = MINIMUM_VISIBLE_PROGRESS;
					updateProgress(startingProgress);
				}
			}
			if (startingProgress === targetProgress || durationMs <= 0) {
				updateProgress(targetProgress);
				if (targetProgress === 0) {
					onHiddenRef.current();
					onPresenceChangeRef.current(false);
				}
				return;
			}

			const startedAt = performance.now();
			const isOpening = targetProgress > startingProgress;
			const tick = (now: number): void => {
				const elapsedProgress = Math.min(1, (now - startedAt) / durationMs);
				const easedProgress = easeWorkspaceActionsLiquidProgress(
					elapsedProgress,
					isOpening
				);
				const nextProgress =
					startingProgress +
					(targetProgress - startingProgress) * easedProgress;
				updateProgress(nextProgress);
				if (elapsedProgress < 1) {
					animationFrameRef.current = requestAnimationFrame(tick);
					return;
				}
				if (targetProgress === 0) {
					onHiddenRef.current();
					onPresenceChangeRef.current(false);
				}
			};
			animationFrameRef.current = requestAnimationFrame(tick);
		},
		[updateProgress]
	);

	useEffect(() => {
		const prefersReducedMotion =
			window.matchMedia(REDUCED_MOTION_QUERY).matches;
		if (isActive) {
			if (hasMeasurement) {
				animateProgress(1, prefersReducedMotion ? 0 : openDurationMs);
			}
			return;
		}
		animateProgress(0, prefersReducedMotion ? 0 : closeDurationMs);
	}, [
		animateProgress,
		closeDurationMs,
		hasMeasurement,
		isActive,
		openDurationMs,
	]);

	useEffect(() => () => cancelAnimationFrame(animationFrameRef.current), []);

	return progress;
};

export const useWorkspaceActionsLiquidSurface = ({
	isOpen,
	isSubmenuOpen,
	onPresenceChange,
	onSubmenuPresenceChange,
}: UseWorkspaceActionsLiquidSurfaceOptions): WorkspaceActionsLiquidSurfaceState => {
	const [measurement, setMeasurement] =
		useState<WorkspaceActionsLiquidMeasurement | null>(null);

	useLayoutEffect(() => {
		if (!isOpen) {
			return;
		}

		let menuElement: HTMLElement | null = null;
		let submenuElement: HTMLElement | null = null;
		let submenuTriggerElement: HTMLElement | null = null;
		let tabElement: HTMLElement | null = null;
		let trackingFrameId = 0;
		const observedElements = new Set<HTMLElement>();
		const trackingEndsAt =
			performance.now() +
			WORKSPACE_ACTIONS_LIQUID_MOTION.positionTrackingDurationMs;
		let resizeObserver: ResizeObserver;
		const observe = (element: HTMLElement): void => {
			if (observedElements.has(element)) {
				return;
			}
			observedElements.add(element);
			resizeObserver.observe(element);
		};
		const measure = (): {
			readonly hasRootMeasurement: boolean;
			readonly hasSubmenuMeasurement: boolean;
		} => {
			menuElement = document.getElementById(WORKSPACE_ACTIONS_MENU_ID);
			tabElement = document.querySelector<HTMLElement>(
				ACTIVE_WORKSPACE_TAB_SELECTOR
			);
			if (!(menuElement && tabElement)) {
				return {
					hasRootMeasurement: false,
					hasSubmenuMeasurement: false,
				};
			}

			observe(menuElement);
			observe(tabElement);
			const nextMenuRect = toLiquidRect(menuElement.getBoundingClientRect());
			const nextTabRect = toLiquidRect(tabElement.getBoundingClientRect());
			let nextSubmenu: WorkspaceActionsLiquidSubmenuMeasurement | null = null;
			if (isSubmenuOpen) {
				submenuElement = document.getElementById(WORKSPACE_ACTIONS_SUBMENU_ID);
				submenuTriggerElement = document.getElementById(
					WORKSPACE_ACTIONS_SUBMENU_TRIGGER_ID
				);
				if (submenuElement && submenuTriggerElement) {
					observe(submenuElement);
					observe(submenuTriggerElement);
					nextSubmenu = {
						menu: toLiquidRect(submenuElement.getBoundingClientRect()),
						side: submenuElement.dataset.side === "right" ? "right" : "left",
						trigger: toLiquidRect(
							submenuTriggerElement.getBoundingClientRect()
						),
					};
				}
			}
			setMeasurement((current) => {
				const nextMeasurement: WorkspaceActionsLiquidMeasurement = {
					menu: nextMenuRect,
					submenu: nextSubmenu ?? current?.submenu ?? null,
					tab: nextTabRect,
				};
				return hasSameMeasurement(current, nextMeasurement)
					? current
					: nextMeasurement;
			});
			return {
				hasRootMeasurement: true,
				hasSubmenuMeasurement: nextSubmenu !== null,
			};
		};
		resizeObserver = new ResizeObserver(measure);
		const trackInitialPosition = (): void => {
			const { hasRootMeasurement, hasSubmenuMeasurement } = measure();
			const isWaitingForExpectedMeasurement =
				!hasRootMeasurement || (isSubmenuOpen && !hasSubmenuMeasurement);
			if (
				performance.now() < trackingEndsAt ||
				isWaitingForExpectedMeasurement
			) {
				trackingFrameId = requestAnimationFrame(trackInitialPosition);
			}
		};
		const scheduleMeasurement = (): void => {
			cancelAnimationFrame(trackingFrameId);
			trackingFrameId = requestAnimationFrame(measure);
		};

		trackInitialPosition();
		window.addEventListener("resize", scheduleMeasurement);
		return () => {
			cancelAnimationFrame(trackingFrameId);
			resizeObserver.disconnect();
			window.removeEventListener("resize", scheduleMeasurement);
		};
	}, [isOpen, isSubmenuOpen]);

	const hideMenu = useCallback((): void => setMeasurement(null), []);
	const hideSubmenu = useCallback(
		(): void =>
			setMeasurement((current) =>
				current?.submenu
					? {
							...current,
							submenu: null,
						}
					: current
			),
		[]
	);
	const progress = useLiquidProgress({
		closeDurationMs: WORKSPACE_ACTIONS_LIQUID_MOTION.closeDurationMs,
		hasMeasurement: measurement !== null,
		isActive: isOpen,
		onHidden: hideMenu,
		onPresenceChange,
		openDurationMs: WORKSPACE_ACTIONS_LIQUID_MOTION.openDurationMs,
	});
	const submenuProgress = useLiquidProgress({
		closeDurationMs: WORKSPACE_ACTIONS_LIQUID_MOTION.submenuCloseDurationMs,
		hasMeasurement: measurement?.submenu !== null,
		isActive: isOpen && isSubmenuOpen,
		onHidden: hideSubmenu,
		onPresenceChange: onSubmenuPresenceChange,
		openDurationMs: WORKSPACE_ACTIONS_LIQUID_MOTION.submenuOpenDurationMs,
	});

	const frame = useMemo(
		() =>
			measurement && progress > 0
				? createWorkspaceActionsLiquidFrame(measurement, {
						menu: progress,
						submenu: submenuProgress,
					})
				: null,
		[measurement, progress, submenuProgress]
	);

	return { frame, progress, submenuProgress };
};
