import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { WORKSPACE_ACTIONS_LIQUID_MOTION } from "../constants/workspace-actions-menu.js";
import { WORKSPACE_ACTIONS_MENU_ID } from "../constants/workspace-tab.js";
import {
	createWorkspaceActionsLiquidFrame,
	easeWorkspaceActionsLiquidProgress,
	type LiquidSurfaceRect,
	type WorkspaceActionsLiquidFrame,
	type WorkspaceActionsLiquidMeasurement,
} from "../lib/workspace-actions-liquid-geometry.js";

interface UseWorkspaceActionsLiquidSurfaceOptions {
	readonly isOpen: boolean;
	readonly onPresenceChange: (isPresent: boolean) => void;
}

interface WorkspaceActionsLiquidSurfaceState {
	readonly frame: WorkspaceActionsLiquidFrame | null;
	readonly progress: number;
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

const hasSameMeasurement = (
	current: WorkspaceActionsLiquidMeasurement | null,
	next: WorkspaceActionsLiquidMeasurement
): boolean =>
	current !== null &&
	hasSameRect(current.menu, next.menu) &&
	hasSameRect(current.tab, next.tab);

export const useWorkspaceActionsLiquidSurface = ({
	isOpen,
	onPresenceChange,
}: UseWorkspaceActionsLiquidSurfaceOptions): WorkspaceActionsLiquidSurfaceState => {
	const [measurement, setMeasurement] =
		useState<WorkspaceActionsLiquidMeasurement | null>(null);
	const [progress, setProgress] = useState(0);
	const animationFrameRef = useRef(0);
	const progressRef = useRef(0);

	const updateProgress = useCallback((nextProgress: number): void => {
		progressRef.current = nextProgress;
		setProgress(nextProgress);
	}, []);

	const animateProgress = useCallback(
		(targetProgress: number, durationMs: number): void => {
			cancelAnimationFrame(animationFrameRef.current);
			let startingProgress = progressRef.current;
			if (targetProgress > 0) {
				onPresenceChange(true);
				if (startingProgress === 0) {
					startingProgress = MINIMUM_VISIBLE_PROGRESS;
					updateProgress(startingProgress);
				}
			}
			if (startingProgress === targetProgress || durationMs <= 0) {
				updateProgress(targetProgress);
				if (targetProgress === 0) {
					setMeasurement(null);
					onPresenceChange(false);
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
					setMeasurement(null);
					onPresenceChange(false);
				}
			};
			animationFrameRef.current = requestAnimationFrame(tick);
		},
		[onPresenceChange, updateProgress]
	);

	useLayoutEffect(() => {
		if (!isOpen) {
			return;
		}

		let menuElement: HTMLElement | null = null;
		let tabElement: HTMLElement | null = null;
		let resizeObserver: ResizeObserver | null = null;
		let trackingFrameId = 0;
		const trackingEndsAt =
			performance.now() +
			WORKSPACE_ACTIONS_LIQUID_MOTION.positionTrackingDurationMs;
		const measure = (): boolean => {
			menuElement = document.getElementById(WORKSPACE_ACTIONS_MENU_ID);
			tabElement = document.querySelector<HTMLElement>(
				ACTIVE_WORKSPACE_TAB_SELECTOR
			);
			if (!(menuElement && tabElement)) {
				return false;
			}

			const nextMeasurement: WorkspaceActionsLiquidMeasurement = {
				menu: toLiquidRect(menuElement.getBoundingClientRect()),
				tab: toLiquidRect(tabElement.getBoundingClientRect()),
			};
			setMeasurement((current) =>
				hasSameMeasurement(current, nextMeasurement) ? current : nextMeasurement
			);
			if (!resizeObserver) {
				resizeObserver = new ResizeObserver(measure);
				resizeObserver.observe(menuElement);
				resizeObserver.observe(tabElement);
			}
			return true;
		};
		const trackInitialPosition = (): void => {
			const didMeasure = measure();
			if (performance.now() < trackingEndsAt || (!didMeasure && isOpen)) {
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
			resizeObserver?.disconnect();
			window.removeEventListener("resize", scheduleMeasurement);
		};
	}, [isOpen]);

	const hasMeasurement = measurement !== null;
	useEffect(() => {
		const prefersReducedMotion =
			window.matchMedia(REDUCED_MOTION_QUERY).matches;
		if (isOpen && hasMeasurement) {
			animateProgress(
				1,
				prefersReducedMotion
					? 0
					: WORKSPACE_ACTIONS_LIQUID_MOTION.openDurationMs
			);
			return;
		}
		if (!isOpen) {
			animateProgress(
				0,
				prefersReducedMotion
					? 0
					: WORKSPACE_ACTIONS_LIQUID_MOTION.closeDurationMs
			);
		}
	}, [animateProgress, hasMeasurement, isOpen]);

	useEffect(() => () => cancelAnimationFrame(animationFrameRef.current), []);

	const frame = useMemo(
		() =>
			measurement && progress > 0
				? createWorkspaceActionsLiquidFrame(measurement, progress)
				: null,
		[measurement, progress]
	);

	return { frame, progress };
};
