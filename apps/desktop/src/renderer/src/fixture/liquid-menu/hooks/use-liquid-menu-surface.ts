import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import type {
	LiquidMenuGeometry,
	LiquidMenuMotion,
} from "@/fixture/liquid-menu/constants/liquid-menu.js";
import {
	createLiquidMenuFrame,
	easeLiquidMenuProgress,
	type LiquidMenuAnchorGeometry,
	type LiquidMenuFrame,
	type LiquidMenuMeasurement,
	type LiquidMenuRect,
	type LiquidMenuSubmenuMeasurement,
} from "@/fixture/liquid-menu/lib/liquid-menu-geometry.js";
import { useReducedMotion } from "@/fixture/liquid-surface/hooks/use-reduced-motion.js";
import {
	createLiquidGeometryTracker,
	type LiquidGeometryTracker,
} from "@/fixture/liquid-surface/lib/track-liquid-geometry.js";

interface UseLiquidMenuSurfaceOptions {
	readonly anchor: () => Element | null;
	readonly anchorClip: (() => Element | null) | undefined;
	readonly anchorGeometry: LiquidMenuAnchorGeometry;
	readonly geometry: LiquidMenuGeometry;
	readonly isOpen: boolean;
	readonly isSubmenuOpen: boolean;
	readonly menuElement: HTMLElement | null;
	readonly motion: LiquidMenuMotion;
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

interface LiquidMenuRootMeasurement {
	readonly anchor: LiquidMenuRect;
	readonly anchorClip: LiquidMenuRect | null;
	readonly menu: LiquidMenuRect;
}

interface LiquidMenuMeasurementElements {
	readonly anchor: Element | null;
	readonly anchorClip: Element | null;
	readonly menu: HTMLElement | null;
	readonly submenu: HTMLElement | null;
	readonly submenuTrigger: HTMLElement | null;
}

interface ResolveLiquidMenuMeasurementElementsOptions {
	readonly anchor: () => Element | null;
	readonly anchorClip: (() => Element | null) | undefined;
	readonly isSubmenuOpen: boolean;
	readonly menu: HTMLElement | null;
	readonly submenu: HTMLElement | null;
	readonly submenuTrigger: HTMLElement | null;
}

interface MeasurementStability<Measurement> {
	candidate: Measurement | null;
	consecutiveFrames: number;
	isStable: boolean;
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
const REQUIRED_STABLE_POSITION_FRAMES = 2;

const roundMeasurement = (value: number): number =>
	Math.round(value * MEASUREMENT_SCALE) / MEASUREMENT_SCALE;

const toLiquidRect = (bounds: DOMRect): LiquidMenuRect => ({
	height: roundMeasurement(bounds.height),
	left: roundMeasurement(bounds.left),
	top: roundMeasurement(bounds.top),
	width: roundMeasurement(bounds.width),
});

const isElement = (element: Element | null): element is Element =>
	element !== null;

const getTrackedElements = ({
	anchor,
	anchorClip,
	menu,
	submenu,
	submenuTrigger,
}: LiquidMenuMeasurementElements): readonly Element[] =>
	[anchor, anchorClip, menu, submenu, submenuTrigger].filter(isElement);

const resolveMeasurementElements = ({
	anchor,
	anchorClip,
	isSubmenuOpen,
	menu,
	submenu,
	submenuTrigger,
}: ResolveLiquidMenuMeasurementElementsOptions): LiquidMenuMeasurementElements => ({
	anchor: anchor(),
	anchorClip: anchorClip?.() ?? null,
	menu,
	submenu: isSubmenuOpen ? submenu : null,
	submenuTrigger: isSubmenuOpen ? submenuTrigger : null,
});

const readRootMeasurement = ({
	anchor,
	anchorClip,
	menu,
}: LiquidMenuMeasurementElements): LiquidMenuRootMeasurement | null => {
	if (!(anchor && menu)) {
		return null;
	}
	return {
		anchor: toLiquidRect(anchor.getBoundingClientRect()),
		anchorClip: anchorClip
			? toLiquidRect(anchorClip.getBoundingClientRect())
			: null,
		menu: toLiquidRect(menu.getBoundingClientRect()),
	};
};

const readSubmenuMeasurement = ({
	submenu,
	submenuTrigger,
}: LiquidMenuMeasurementElements): LiquidMenuSubmenuMeasurement | null => {
	if (!(submenu && submenuTrigger)) {
		return null;
	}
	return {
		menu: toLiquidRect(submenu.getBoundingClientRect()),
		side: submenu.dataset.side === "right" ? "right" : "left",
		trigger: toLiquidRect(submenuTrigger.getBoundingClientRect()),
	};
};

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

const hasSameOptionalRect = (
	current: LiquidMenuRect | null | undefined,
	next: LiquidMenuRect | null | undefined
): boolean => {
	if (current === null || current === undefined) {
		return next === null || next === undefined;
	}
	return next !== null && next !== undefined && hasSameRect(current, next);
};

const hasSameRootMeasurement = (
	current: LiquidMenuRootMeasurement | null,
	next: LiquidMenuRootMeasurement
): boolean =>
	current !== null &&
	hasSameRect(current.anchor, next.anchor) &&
	hasSameOptionalRect(current.anchorClip, next.anchorClip) &&
	hasSameRect(current.menu, next.menu);

const hasSameMeasurement = (
	current: LiquidMenuMeasurement | null,
	next: LiquidMenuMeasurement
): boolean =>
	current !== null &&
	hasSameRect(current.anchor, next.anchor) &&
	hasSameOptionalRect(current.anchorClip, next.anchorClip) &&
	hasSameRect(current.menu, next.menu) &&
	hasSameSubmenuMeasurement(current.submenu, next.submenu);

const advanceMeasurementStability = <Measurement>(
	stability: MeasurementStability<Measurement>,
	nextMeasurement: Measurement,
	hasSameValue: (current: Measurement | null, next: Measurement) => boolean
): boolean => {
	if (stability.isStable) {
		return stability.isStable;
	}
	if (hasSameValue(stability.candidate, nextMeasurement)) {
		stability.consecutiveFrames += 1;
	} else {
		stability.candidate = nextMeasurement;
		stability.consecutiveFrames = 1;
	}
	stability.isStable =
		stability.consecutiveFrames >= REQUIRED_STABLE_POSITION_FRAMES;
	return stability.isStable;
};

const useLiquidProgress = ({
	closeDurationMs,
	hasMeasurement,
	isActive,
	onHidden,
	onPresenceChange,
	openDurationMs,
}: UseLiquidProgressOptions): number => {
	const prefersReducedMotion = useReducedMotion();
	const [progress, setProgress] = useState(0);
	const animationFrameRef = useRef(0);
	const isPresentRef = useRef(false);
	const onHiddenRef = useRef(onHidden);
	const onPresenceChangeRef = useRef(onPresenceChange);
	const progressRef = useRef(0);
	onHiddenRef.current = onHidden;
	onPresenceChangeRef.current = onPresenceChange;

	const updateProgress = useCallback((nextProgress: number): void => {
		progressRef.current = nextProgress;
		setProgress(nextProgress);
	}, []);
	const changePresence = useCallback((isPresent: boolean): void => {
		if (isPresentRef.current === isPresent) {
			return;
		}
		isPresentRef.current = isPresent;
		onPresenceChangeRef.current(isPresent);
	}, []);

	const animateProgress = useCallback(
		(targetProgress: number, durationMs: number): void => {
			cancelAnimationFrame(animationFrameRef.current);
			let startingProgress = progressRef.current;
			if (targetProgress > 0) {
				changePresence(true);
				if (startingProgress === 0) {
					startingProgress = MINIMUM_VISIBLE_PROGRESS;
					updateProgress(startingProgress);
				}
			}
			if (startingProgress === targetProgress || durationMs <= 0) {
				updateProgress(targetProgress);
				if (targetProgress === 0) {
					onHiddenRef.current();
					changePresence(false);
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
					changePresence(false);
				}
			};
			animationFrameRef.current = requestAnimationFrame(tick);
		},
		[changePresence, updateProgress]
	);

	useEffect(() => {
		if (isActive) {
			if (hasMeasurement) {
				animateProgress(1, prefersReducedMotion ? 0 : openDurationMs);
				return;
			}
			animateProgress(0, 0);
			return;
		}
		animateProgress(0, prefersReducedMotion ? 0 : closeDurationMs);
	}, [
		animateProgress,
		closeDurationMs,
		hasMeasurement,
		isActive,
		openDurationMs,
		prefersReducedMotion,
	]);

	useEffect(
		() => (): void => {
			cancelAnimationFrame(animationFrameRef.current);
			changePresence(false);
		},
		[changePresence]
	);

	return progress;
};

export const useLiquidMenuSurface = ({
	anchor,
	anchorClip,
	anchorGeometry,
	geometry,
	isOpen,
	isSubmenuOpen,
	menuElement,
	motion,
	onPresenceChange,
	onSubmenuPresenceChange,
	submenuElement,
	submenuTriggerElement,
}: UseLiquidMenuSurfaceOptions): LiquidMenuSurfaceState => {
	const [measurement, setMeasurement] = useState<LiquidMenuMeasurement | null>(
		null
	);
	const positionedMenuElementRef = useRef<HTMLElement | null>(null);
	const positionedSubmenuElementRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!isOpen) {
			return;
		}

		const rootStability: MeasurementStability<LiquidMenuRootMeasurement> = {
			candidate: null,
			consecutiveFrames: 0,
			isStable: positionedMenuElementRef.current === menuElement,
		};
		const submenuStability: MeasurementStability<LiquidMenuSubmenuMeasurement> =
			{
				candidate: null,
				consecutiveFrames: 0,
				isStable: positionedSubmenuElementRef.current === submenuElement,
			};
		let tracker: LiquidGeometryTracker;
		const commitRootMeasurement = (
			nextRootMeasurement: LiquidMenuRootMeasurement
		): void => {
			setMeasurement((current) => {
				const nextMeasurement: LiquidMenuMeasurement = {
					...nextRootMeasurement,
					submenu: current?.submenu ?? null,
				};
				return hasSameMeasurement(current, nextMeasurement)
					? current
					: nextMeasurement;
			});
		};
		const commitSubmenuMeasurement = (
			nextSubmenuMeasurement: LiquidMenuSubmenuMeasurement
		): void => {
			setMeasurement((current) => {
				if (!current) {
					return current;
				}
				const nextMeasurement: LiquidMenuMeasurement = {
					...current,
					submenu: nextSubmenuMeasurement,
				};
				return hasSameMeasurement(current, nextMeasurement)
					? current
					: nextMeasurement;
			});
		};
		const measure = (): void => {
			const elements = resolveMeasurementElements({
				anchor,
				anchorClip,
				isSubmenuOpen,
				menu: menuElement,
				submenu: submenuElement,
				submenuTrigger: submenuTriggerElement,
			});
			tracker.setElements(getTrackedElements(elements));
			const nextRootMeasurement = readRootMeasurement(elements);
			if (!nextRootMeasurement) {
				positionedMenuElementRef.current = null;
				positionedSubmenuElementRef.current = null;
				setMeasurement((current) => (current ? null : current));
				return;
			}
			const hasStableRootMeasurement = advanceMeasurementStability(
				rootStability,
				nextRootMeasurement,
				hasSameRootMeasurement
			);
			if (hasStableRootMeasurement) {
				positionedMenuElementRef.current = elements.menu;
				commitRootMeasurement(nextRootMeasurement);
			}

			const nextSubmenuMeasurement = readSubmenuMeasurement(elements);
			if (isSubmenuOpen && !nextSubmenuMeasurement) {
				positionedSubmenuElementRef.current = null;
				setMeasurement((current) =>
					current?.submenu ? { ...current, submenu: null } : current
				);
			}
			if (
				nextSubmenuMeasurement &&
				advanceMeasurementStability(
					submenuStability,
					nextSubmenuMeasurement,
					hasSameSubmenuMeasurement
				)
			) {
				positionedSubmenuElementRef.current = elements.submenu;
				commitSubmenuMeasurement(nextSubmenuMeasurement);
			}
			const isWaitingForExpectedMeasurement =
				!hasStableRootMeasurement ||
				(isSubmenuOpen && !submenuStability.isStable);
			if (isWaitingForExpectedMeasurement) {
				tracker.schedule();
			}
		};

		tracker = createLiquidGeometryTracker(measure);
		tracker.schedule();
		return tracker.disconnect;
	}, [
		anchor,
		anchorClip,
		isOpen,
		isSubmenuOpen,
		menuElement,
		submenuElement,
		submenuTriggerElement,
	]);

	const hideMenu = useCallback((): void => {
		positionedMenuElementRef.current = null;
		positionedSubmenuElementRef.current = null;
		setMeasurement(null);
	}, []);
	const hideSubmenu = useCallback((): void => {
		positionedSubmenuElementRef.current = null;
		setMeasurement((current) =>
			current?.submenu ? { ...current, submenu: null } : current
		);
	}, []);
	const progress = useLiquidProgress({
		closeDurationMs: motion.closeDurationMs,
		hasMeasurement: measurement !== null,
		isActive: isOpen,
		onHidden: hideMenu,
		onPresenceChange,
		openDurationMs: motion.openDurationMs,
	});
	const submenuProgress = useLiquidProgress({
		closeDurationMs: motion.submenuCloseDurationMs,
		hasMeasurement: Boolean(measurement?.submenu),
		isActive: isOpen && isSubmenuOpen,
		onHidden: hideSubmenu,
		onPresenceChange: onSubmenuPresenceChange,
		openDurationMs: motion.submenuOpenDurationMs,
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
						anchorGeometry,
						geometry
					)
				: null,
		[anchorGeometry, geometry, measurement, progress, submenuProgress]
	);

	return { frame, progress, submenuProgress };
};
