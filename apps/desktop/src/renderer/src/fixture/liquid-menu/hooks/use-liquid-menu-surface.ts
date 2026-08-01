import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { LIQUID_MENU_MOTION } from "../constants/liquid-menu.js";
import {
	createLiquidMenuFrame,
	easeLiquidMenuProgress,
	type LiquidMenuAnchorGeometry,
	type LiquidMenuFrame,
	type LiquidMenuMeasurement,
	type LiquidMenuRect,
	type LiquidMenuSubmenuMeasurement,
} from "../lib/liquid-menu-geometry.js";

interface UseLiquidMenuSurfaceOptions {
	readonly anchor: () => Element | null;
	readonly anchorGeometry: LiquidMenuAnchorGeometry;
	readonly isOpen: boolean;
	readonly isSubmenuOpen: boolean;
	readonly menuElement: HTMLElement | null;
	readonly onPresenceChange: (isPresent: boolean) => void;
	readonly onSubmenuPresenceChange: (isPresent: boolean) => void;
	readonly submenuElement: HTMLElement | null;
	readonly submenuTriggerElement: HTMLElement | null;
}

interface LiquidMenuSurfaceState {
	readonly frame: LiquidMenuFrame | null;
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

const MEASUREMENT_SCALE = 10;
const MINIMUM_VISIBLE_PROGRESS = 0.001;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const roundMeasurement = (value: number): number =>
	Math.round(value * MEASUREMENT_SCALE) / MEASUREMENT_SCALE;

const toLiquidRect = (bounds: DOMRect): LiquidMenuRect => ({
	height: roundMeasurement(bounds.height),
	left: roundMeasurement(bounds.left),
	top: roundMeasurement(bounds.top),
	width: roundMeasurement(bounds.width),
});

const hasSameRect = (current: LiquidMenuRect, next: LiquidMenuRect): boolean =>
	current.height === next.height &&
	current.left === next.left &&
	current.top === next.top &&
	current.width === next.width;

const hasSameSubmenuMeasurement = (
	current: LiquidMenuSubmenuMeasurement | null,
	next: LiquidMenuSubmenuMeasurement | null
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
	current: LiquidMenuMeasurement | null,
	next: LiquidMenuMeasurement
): boolean =>
	current !== null &&
	hasSameRect(current.anchor, next.anchor) &&
	hasSameRect(current.menu, next.menu) &&
	hasSameSubmenuMeasurement(current.submenu, next.submenu);

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
				const easedProgress = easeLiquidMenuProgress(
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

export const useLiquidMenuSurface = ({
	anchor,
	anchorGeometry,
	isOpen,
	isSubmenuOpen,
	menuElement,
	onPresenceChange,
	onSubmenuPresenceChange,
	submenuElement,
	submenuTriggerElement,
}: UseLiquidMenuSurfaceOptions): LiquidMenuSurfaceState => {
	const [measurement, setMeasurement] = useState<LiquidMenuMeasurement | null>(
		null
	);

	useLayoutEffect(() => {
		if (!isOpen) {
			return;
		}

		let trackingFrameId = 0;
		const observedElements = new Set<Element>();
		const trackingEndsAt =
			performance.now() + LIQUID_MENU_MOTION.positionTrackingDurationMs;
		let resizeObserver: ResizeObserver;
		const observe = (element: Element): void => {
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
			const anchorElement = anchor();
			if (!(menuElement && anchorElement)) {
				return {
					hasRootMeasurement: false,
					hasSubmenuMeasurement: false,
				};
			}

			observe(menuElement);
			observe(anchorElement);
			const nextMenuRect = toLiquidRect(menuElement.getBoundingClientRect());
			const nextAnchorRect = toLiquidRect(
				anchorElement.getBoundingClientRect()
			);
			let nextSubmenu: LiquidMenuSubmenuMeasurement | null = null;
			if (isSubmenuOpen && submenuElement && submenuTriggerElement) {
				observe(submenuElement);
				observe(submenuTriggerElement);
				nextSubmenu = {
					menu: toLiquidRect(submenuElement.getBoundingClientRect()),
					side: submenuElement.dataset.side === "right" ? "right" : "left",
					trigger: toLiquidRect(submenuTriggerElement.getBoundingClientRect()),
				};
			}
			setMeasurement((current) => {
				const nextMeasurement: LiquidMenuMeasurement = {
					anchor: nextAnchorRect,
					menu: nextMenuRect,
					submenu: nextSubmenu ?? current?.submenu ?? null,
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
	}, [
		anchor,
		isOpen,
		isSubmenuOpen,
		menuElement,
		submenuElement,
		submenuTriggerElement,
	]);

	const hideMenu = useCallback((): void => setMeasurement(null), []);
	const hideSubmenu = useCallback(
		(): void =>
			setMeasurement((current) =>
				current?.submenu ? { ...current, submenu: null } : current
			),
		[]
	);
	const progress = useLiquidProgress({
		closeDurationMs: LIQUID_MENU_MOTION.closeDurationMs,
		hasMeasurement: measurement !== null,
		isActive: isOpen,
		onHidden: hideMenu,
		onPresenceChange,
		openDurationMs: LIQUID_MENU_MOTION.openDurationMs,
	});
	const submenuProgress = useLiquidProgress({
		closeDurationMs: LIQUID_MENU_MOTION.submenuCloseDurationMs,
		hasMeasurement: measurement?.submenu !== null,
		isActive: isOpen && isSubmenuOpen,
		onHidden: hideSubmenu,
		onPresenceChange: onSubmenuPresenceChange,
		openDurationMs: LIQUID_MENU_MOTION.submenuOpenDurationMs,
	});

	const frame = useMemo(
		() =>
			measurement && progress > 0
				? createLiquidMenuFrame(
						measurement,
						{
							menu: progress,
							submenu: submenuProgress,
						},
						anchorGeometry
					)
				: null,
		[anchorGeometry, measurement, progress, submenuProgress]
	);

	return { frame, progress, submenuProgress };
};
