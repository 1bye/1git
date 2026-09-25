import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	type CommandLensMeasuredTarget,
	CommandLensOverlay,
} from "@/feature/command-lens/components/command-lens-overlay.js";
import {
	COMMAND_LENS_DWELL_MS,
	COMMAND_LENS_GEOMETRY,
	COMMAND_LENS_LAYOUT_TRACKING_MS,
} from "@/feature/command-lens/constants/command-lens.js";
import {
	CommandLensContext,
	type CommandLensContextValue,
	type CommandLensTargetReader,
	type CommandLensTargetSource,
} from "@/feature/command-lens/hooks/use-command-lens-context.js";
import { insetCommandLensRect } from "@/feature/command-lens/lib/command-lens-geometry.js";
import {
	type CommandLensNavigationDirection,
	getInitialCommandLensNavigationTarget,
	getNextCommandLensNavigationGroupTarget,
	getNextCommandLensNavigationTarget,
	getPlainArrowNavigationTargets,
	isCommandLensNavigationKey,
} from "@/feature/command-lens/lib/command-lens-navigation.js";
import {
	type CommandLensCommand,
	isCommandLensFocusedActivation,
	isCommandLensModifierKey,
	matchesCommandLensCommand,
} from "@/feature/command-lens/lib/command-lens-shortcut.js";
import { useLiquidMenuStack } from "@/fixture/liquid-menu/hooks/use-liquid-menu-stack.js";

interface CommandLensProviderProps {
	readonly children: ReactNode;
}

type InvokableCommand = CommandLensCommand & {
	readonly onInvoke: NonNullable<CommandLensCommand["onInvoke"]>;
};

const isEditableEventTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof Element)) {
		return false;
	}
	return Boolean(
		target.closest(
			'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
		)
	);
};

const isTargetVisible = (
	target: CommandLensTargetSource,
	includeDisabled = false
): boolean => {
	const { element } = target;
	if (!(element?.isConnected && (includeDisabled || !target.disabled))) {
		return false;
	}
	if (element.closest("[inert]")) {
		return false;
	}
	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) {
		return false;
	}
	if (
		rect.right <= 0 ||
		rect.bottom <= 0 ||
		rect.left >= window.innerWidth ||
		rect.top >= window.innerHeight
	) {
		return false;
	}
	const style = window.getComputedStyle(element);
	return (
		style.display !== "none" &&
		style.visibility !== "hidden" &&
		Number.parseFloat(style.opacity || "1") > 0.01
	);
};

const measureTarget = (
	target: CommandLensTargetSource,
	includeDisabled = false
): CommandLensMeasuredTarget | null => {
	if (
		!isTargetVisible(target, includeDisabled) ||
		(target.commands.length === 0 && !target.navigationGroup)
	) {
		return null;
	}
	const rect = target.element?.getBoundingClientRect();
	if (!rect) {
		return null;
	}
	const highlightRect = insetCommandLensRect(
		{
			height: rect.height,
			left: rect.left,
			top: rect.top,
			width: rect.width,
		},
		target.highlightInsetBlock,
		target.highlightInsetInline
	);
	if (highlightRect.width <= 0 || highlightRect.height <= 0) {
		return null;
	}
	return {
		commands: target.commands,
		highlightOutset:
			target.highlightOutset ?? COMMAND_LENS_GEOMETRY.backdropInset,
		hintLayout: target.hintLayout ?? "floating",
		id: target.id,
		navigationDefault: target.navigationDefault ?? false,
		navigationGroup: target.navigationGroup ?? target.id,
		navigationOrder: target.navigationOrder ?? 0,
		navigationOrientation: target.navigationOrientation ?? "vertical",
		placement: target.placement ?? "bottom",
		plainArrowNavigation: target.plainArrowNavigation ?? false,
		radius: target.radius ?? 12,
		rect: highlightRect,
	};
};

const findInvokableCommand = (
	event: KeyboardEvent,
	targetReaders: Iterable<CommandLensTargetReader>
): InvokableCommand | null => {
	for (const readTarget of targetReaders) {
		const target = readTarget();
		if (!isTargetVisible(target)) {
			continue;
		}
		const command = target.commands.find((candidate) =>
			matchesCommandLensCommand(event, candidate)
		);
		if (command?.onInvoke) {
			return command as InvokableCommand;
		}
	}
	return null;
};

const findFocusedTargetId = (
	targetReaders: Iterable<CommandLensTargetReader>
): string | null => {
	const { activeElement } = document;
	if (!activeElement) {
		return null;
	}
	for (const readTarget of targetReaders) {
		const target = readTarget();
		if (
			target.element === activeElement ||
			target.element?.contains(activeElement)
		) {
			return target.id;
		}
	}
	return null;
};

const isUnmodifiedNavigationKey = (
	event: KeyboardEvent
): event is KeyboardEvent & {
	readonly key: CommandLensNavigationDirection;
} =>
	!(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) &&
	isCommandLensNavigationKey(event.key);

export function CommandLensProvider({
	children,
}: CommandLensProviderProps): ReactElement {
	const liquidMenuStack = useLiquidMenuStack();
	const targetReadersRef = useRef(new Map<string, CommandLensTargetReader>());
	const targetRevisionsRef = useRef(new Map<string, string>());
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const measurementFrameRef = useRef<number | null>(null);
	const measurementRunnerRef = useRef<() => void>(() => undefined);
	const layoutTrackingEndTimeRef = useRef(0);
	const dwellTimerRef = useRef<number | null>(null);
	const isMetaDownRef = useRef(false);
	const isOptionDownRef = useRef(false);
	const isVisibleRef = useRef(false);
	const isSuppressedRef = useRef(false);
	const layerIdsRef = useRef(liquidMenuStack.layerIds);
	const [isVisible, setIsVisible] = useState(false);
	const [isOptionActive, setIsOptionActive] = useState(false);
	const [targets, setTargets] = useState<readonly CommandLensMeasuredTarget[]>(
		[]
	);
	layerIdsRef.current = liquidMenuStack.layerIds;

	const clearDwellTimer = useCallback((): void => {
		if (dwellTimerRef.current === null) {
			return;
		}
		window.clearTimeout(dwellTimerRef.current);
		dwellTimerRef.current = null;
	}, []);
	const setMeasuredTargets = useCallback(
		(nextTargets: readonly CommandLensMeasuredTarget[]): void => {
			setTargets(nextTargets);
		},
		[]
	);
	const readVisibleTargets =
		useCallback((): readonly CommandLensMeasuredTarget[] => {
			const measuredTargets: CommandLensMeasuredTarget[] = [];
			for (const readTarget of targetReadersRef.current.values()) {
				const target = readTarget();
				const measuredTarget = measureTarget(target);
				if (measuredTarget) {
					measuredTargets.push(measuredTarget);
				}
			}
			return measuredTargets;
		}, []);
	const measureTargets = useCallback((): void => {
		measurementFrameRef.current = null;
		if (!isVisibleRef.current) {
			return;
		}
		const nextTargets = readVisibleTargets();
		setMeasuredTargets(nextTargets);
		if (window.performance.now() < layoutTrackingEndTimeRef.current) {
			measurementFrameRef.current = window.requestAnimationFrame(() =>
				measurementRunnerRef.current()
			);
		}
	}, [readVisibleTargets, setMeasuredTargets]);
	measurementRunnerRef.current = measureTargets;
	const requestMeasurement = useCallback((): void => {
		if (!isVisibleRef.current || measurementFrameRef.current !== null) {
			return;
		}
		measurementFrameRef.current = window.requestAnimationFrame(() =>
			measurementRunnerRef.current()
		);
	}, []);
	const hideLens = useCallback(
		(suppressUntilMetaRelease: boolean): void => {
			clearDwellTimer();
			layoutTrackingEndTimeRef.current = 0;
			if (measurementFrameRef.current !== null) {
				window.cancelAnimationFrame(measurementFrameRef.current);
				measurementFrameRef.current = null;
			}
			isVisibleRef.current = false;
			if (suppressUntilMetaRelease) {
				isSuppressedRef.current = true;
			}
			setIsOptionActive(false);
			setIsVisible(false);
			setTargets([]);
		},
		[clearDwellTimer]
	);
	const showLens = useCallback((): void => {
		dwellTimerRef.current = null;
		if (
			!isMetaDownRef.current ||
			isSuppressedRef.current ||
			layerIdsRef.current.length > 0
		) {
			return;
		}
		const visibleTargets = readVisibleTargets();
		if (visibleTargets.length === 0) {
			return;
		}
		isVisibleRef.current = true;
		setIsOptionActive(isOptionDownRef.current);
		setMeasuredTargets(visibleTargets);
		setIsVisible(true);
	}, [readVisibleTargets, setMeasuredTargets]);
	const registerTarget = useCallback(
		(id: string, readTarget: CommandLensTargetReader): (() => void) => {
			targetReadersRef.current.set(id, readTarget);
			const { element } = readTarget();
			if (element) {
				resizeObserverRef.current?.observe(element);
			}
			requestMeasurement();
			return () => {
				if (targetReadersRef.current.get(id) !== readTarget) {
					return;
				}
				if (element) {
					resizeObserverRef.current?.unobserve(element);
				}
				targetReadersRef.current.delete(id);
				targetRevisionsRef.current.delete(id);
				layoutTrackingEndTimeRef.current =
					window.performance.now() + COMMAND_LENS_LAYOUT_TRACKING_MS;
				requestMeasurement();
			};
		},
		[requestMeasurement]
	);
	const refreshTarget = useCallback(
		(id: string, revision: string): void => {
			if (targetRevisionsRef.current.get(id) === revision) {
				return;
			}
			targetRevisionsRef.current.set(id, revision);
			const element = targetReadersRef.current.get(id)?.().element;
			if (element) {
				resizeObserverRef.current?.observe(element);
			}
			requestMeasurement();
		},
		[requestMeasurement]
	);
	const startMetaDwell = useCallback(
		(event: KeyboardEvent): void => {
			if (event.repeat) {
				return;
			}
			isMetaDownRef.current = true;
			isOptionDownRef.current = event.altKey;
			isSuppressedRef.current = false;
			clearDwellTimer();
			if (layerIdsRef.current.length > 0) {
				isSuppressedRef.current = true;
				return;
			}
			dwellTimerRef.current = window.setTimeout(
				showLens,
				COMMAND_LENS_DWELL_MS
			);
		},
		[clearDwellTimer, showLens]
	);
	const invokeCommand = useCallback(
		(command: InvokableCommand): void => {
			const result = command.onInvoke();
			if (result instanceof Promise) {
				result.catch((error: unknown) => window.reportError(error));
			}
			requestMeasurement();
		},
		[requestMeasurement]
	);
	const runMatchingCommand = useCallback(
		(event: KeyboardEvent): boolean => {
			const command = findInvokableCommand(
				event,
				targetReadersRef.current.values()
			);
			if (
				!command ||
				(!command.allowInEditable && isEditableEventTarget(event.target))
			) {
				return false;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			invokeCommand(command);
			return true;
		},
		[invokeCommand]
	);
	const focusNavigationTarget = useCallback(
		(
			event: KeyboardEvent,
			direction: CommandLensNavigationDirection,
			plainArrowNavigationOnly = false
		): boolean => {
			if (isEditableEventTarget(event.target)) {
				return false;
			}
			const visibleTargets = readVisibleTargets();
			const navigationTargets = plainArrowNavigationOnly
				? getPlainArrowNavigationTargets(visibleTargets)
				: visibleTargets;
			if (navigationTargets.length === 0) {
				return false;
			}
			const focusedTargetId = findFocusedTargetId(
				targetReadersRef.current.values()
			);
			const nextTarget = focusedTargetId
				? getNextCommandLensNavigationTarget(
						navigationTargets,
						focusedTargetId,
						direction
					)
				: getInitialCommandLensNavigationTarget(navigationTargets, null);
			if (!nextTarget) {
				return false;
			}
			const nextElement = targetReadersRef.current.get(nextTarget.id)?.()
				.element;
			if (!nextElement) {
				return false;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			nextElement.focus({ preventScroll: true });
			nextElement.scrollIntoView({
				block: "nearest",
				inline: "nearest",
			});
			return true;
		},
		[readVisibleTargets]
	);
	const trackOptionKeyDown = useCallback((event: KeyboardEvent): boolean => {
		if (event.key !== "Alt") {
			return false;
		}
		isOptionDownRef.current = true;
		if (isVisibleRef.current) {
			setIsOptionActive(true);
		}
		return true;
	}, []);
	const focusWithPlainArrow = useCallback(
		(event: KeyboardEvent): boolean => {
			if (!isUnmodifiedNavigationKey(event) || layerIdsRef.current.length > 0) {
				return false;
			}
			return focusNavigationTarget(event, event.key, true);
		},
		[focusNavigationTarget]
	);
	const advanceFocusedTarget = useCallback(
		(currentTargetId: string): void => {
			const navigationTargets =
				getPlainArrowNavigationTargets(readVisibleTargets());
			const nextTarget = getNextCommandLensNavigationGroupTarget(
				navigationTargets,
				currentTargetId
			);
			const nextElement = nextTarget
				? targetReadersRef.current.get(nextTarget.id)?.().element
				: null;
			if (!nextElement) {
				return;
			}
			nextElement.focus({ preventScroll: true });
			nextElement.scrollIntoView({
				block: "nearest",
				inline: "nearest",
			});
		},
		[readVisibleTargets]
	);
	const activateFocusedPlainArrowTarget = useCallback(
		(event: KeyboardEvent): boolean => {
			if (
				!isCommandLensFocusedActivation(event) ||
				isEditableEventTarget(event.target)
			) {
				return false;
			}
			const focusedTargetId = findFocusedTargetId(
				targetReadersRef.current.values()
			);
			if (!focusedTargetId) {
				return false;
			}
			const focusedTarget = targetReadersRef.current.get(focusedTargetId)?.();
			if (
				!(focusedTarget?.plainArrowNavigation && isTargetVisible(focusedTarget))
			) {
				return false;
			}
			const focusedElement = focusedTarget.element;
			if (!focusedElement) {
				return false;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			hideLens(true);
			const focusedCommand = focusedTarget.commands.find(
				(command) =>
					command.onInvoke && matchesCommandLensCommand(event, command)
			);
			if (focusedCommand?.onInvoke) {
				invokeCommand({
					...focusedCommand,
					onInvoke: focusedCommand.onInvoke,
				});
				if (focusedCommand.advanceFocus) {
					advanceFocusedTarget(focusedTarget.id);
				}
			} else {
				focusedElement.click();
			}
			return true;
		},
		[advanceFocusedTarget, hideLens, invokeCommand]
	);
	const handleCommandLensMetaKeyDown = useCallback(
		(event: KeyboardEvent): void => {
			if (isCommandLensModifierKey(event.key)) {
				return;
			}
			if (activateFocusedPlainArrowTarget(event)) {
				return;
			}
			if (isCommandLensNavigationKey(event.key)) {
				hideLens(true);
				if (runMatchingCommand(event)) {
					return;
				}
				focusNavigationTarget(event, event.key);
				return;
			}
			if (!isVisibleRef.current) {
				clearDwellTimer();
				isSuppressedRef.current = true;
			}
			runMatchingCommand(event);
		},
		[
			activateFocusedPlainArrowTarget,
			clearDwellTimer,
			focusNavigationTarget,
			hideLens,
			runMatchingCommand,
		]
	);
	const handleCommandLensKeyDown = useCallback(
		(event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				hideLens(isMetaDownRef.current);
				return;
			}
			if (event.key === "Meta") {
				startMetaDwell(event);
				return;
			}
			if (trackOptionKeyDown(event)) {
				return;
			}
			if (focusWithPlainArrow(event)) {
				return;
			}
			if (!event.metaKey) {
				return;
			}
			handleCommandLensMetaKeyDown(event);
		},
		[
			focusWithPlainArrow,
			handleCommandLensMetaKeyDown,
			hideLens,
			startMetaDwell,
			trackOptionKeyDown,
		]
	);
	const handleCommandLensKeyUp = useCallback(
		(event: KeyboardEvent): void => {
			if (event.key === "Alt") {
				isOptionDownRef.current = false;
				setIsOptionActive(false);
				return;
			}
			if (event.key !== "Meta") {
				return;
			}
			isMetaDownRef.current = false;
			isOptionDownRef.current = false;
			isSuppressedRef.current = false;
			hideLens(false);
		},
		[hideLens]
	);

	useEffect(() => {
		if (liquidMenuStack.layerIds.length > 0) {
			hideLens(true);
		}
	}, [hideLens, liquidMenuStack.layerIds]);

	useEffect(() => {
		const resetLens = (): void => {
			isMetaDownRef.current = false;
			isOptionDownRef.current = false;
			isSuppressedRef.current = false;
			hideLens(false);
		};
		const resetHiddenLens = (): void => {
			if (document.visibilityState === "hidden") {
				resetLens();
			}
		};
		const dismissForPointer = (): void => {
			if (isVisibleRef.current) {
				hideLens(isMetaDownRef.current);
			}
		};

		window.addEventListener("keydown", handleCommandLensKeyDown, true);
		window.addEventListener("keyup", handleCommandLensKeyUp, true);
		window.addEventListener("blur", resetLens);
		document.addEventListener("visibilitychange", resetHiddenLens);
		document.addEventListener("pointerdown", dismissForPointer, true);
		return () => {
			window.removeEventListener("keydown", handleCommandLensKeyDown, true);
			window.removeEventListener("keyup", handleCommandLensKeyUp, true);
			window.removeEventListener("blur", resetLens);
			document.removeEventListener("visibilitychange", resetHiddenLens);
			document.removeEventListener("pointerdown", dismissForPointer, true);
			clearDwellTimer();
		};
	}, [
		clearDwellTimer,
		handleCommandLensKeyDown,
		handleCommandLensKeyUp,
		hideLens,
	]);

	useEffect(() => {
		if (!isVisible) {
			return;
		}
		const observer = new ResizeObserver(requestMeasurement);
		resizeObserverRef.current = observer;
		for (const readTarget of targetReadersRef.current.values()) {
			const { element } = readTarget();
			if (element) {
				observer.observe(element);
			}
		}
		window.addEventListener("resize", requestMeasurement);
		window.addEventListener("scroll", requestMeasurement, true);
		requestMeasurement();
		return () => {
			resizeObserverRef.current = null;
			observer.disconnect();
			window.removeEventListener("resize", requestMeasurement);
			window.removeEventListener("scroll", requestMeasurement, true);
		};
	}, [isVisible, requestMeasurement]);

	const context = useMemo<CommandLensContextValue>(
		() => ({
			refreshTarget,
			registerTarget,
			requestMeasurement,
		}),
		[refreshTarget, registerTarget, requestMeasurement]
	);

	return (
		<CommandLensContext value={context}>
			{children}
			{isVisible ? (
				<CommandLensOverlay isOptionActive={isOptionActive} targets={targets} />
			) : null}
		</CommandLensContext>
	);
}
