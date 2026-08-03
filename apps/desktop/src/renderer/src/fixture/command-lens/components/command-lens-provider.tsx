import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type CommandLensMeasuredTarget,
	CommandLensOverlay,
} from "@/fixture/command-lens/components/command-lens-overlay.js";
import {
	COMMAND_LENS_DWELL_MS,
	COMMAND_LENS_GEOMETRY,
} from "@/fixture/command-lens/constants/command-lens.js";
import {
	CommandLensContext,
	type CommandLensContextValue,
	type CommandLensTargetReader,
	type CommandLensTargetSource,
} from "@/fixture/command-lens/hooks/use-command-lens-context.js";
import { insetCommandLensRect } from "@/fixture/command-lens/lib/command-lens-geometry.js";
import {
	type CommandLensNavigationAction,
	type CommandLensNavigationDirection,
	getCommandLensNavigationAction,
	getCommandLensNavigationAdvanceTarget,
	getCommandLensNavigationTargets,
	getInitialCommandLensNavigationTarget,
	getNextCommandLensNavigationTarget,
	isCommandLensNavigationKey,
} from "@/fixture/command-lens/lib/command-lens-navigation.js";
import {
	type CommandLensCommand,
	isCommandLensModifierKey,
	matchesCommandLensCommand,
} from "@/fixture/command-lens/lib/command-lens-shortcut.js";
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
	const hasNavigationAction = Boolean(
		target.navigationAction || target.navigationAlternateAction
	);
	if (
		!isTargetVisible(target, includeDisabled) ||
		(target.commands.length === 0 && !hasNavigationAction)
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
		navigationAction: target.navigationAction,
		navigationAlternateAction: target.navigationAlternateAction,
		navigationDefault: target.navigationDefault ?? false,
		navigationGroup: target.navigationGroup ?? target.id,
		navigationOrder: target.navigationOrder ?? 0,
		navigationOrientation: target.navigationOrientation ?? "vertical",
		placement: target.placement ?? "bottom",
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

export function CommandLensProvider({
	children,
}: CommandLensProviderProps): ReactElement {
	const liquidMenuStack = useLiquidMenuStack();
	const targetReadersRef = useRef(new Map<string, CommandLensTargetReader>());
	const targetRevisionsRef = useRef(new Map<string, string>());
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const measurementFrameRef = useRef<number | null>(null);
	const dwellTimerRef = useRef<number | null>(null);
	const isMetaDownRef = useRef(false);
	const isNavigationActiveRef = useRef(false);
	const isOptionDownRef = useRef(false);
	const isVisibleRef = useRef(false);
	const isSuppressedRef = useRef(false);
	const layerIdsRef = useRef(liquidMenuStack.layerIds);
	const selectedTargetIdRef = useRef<string | null>(null);
	const targetsRef = useRef<readonly CommandLensMeasuredTarget[]>([]);
	const [isNavigationActive, setIsNavigationActive] = useState(false);
	const [isVisible, setIsVisible] = useState(false);
	const [isOptionActive, setIsOptionActive] = useState(false);
	const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
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
			targetsRef.current = nextTargets;
			setTargets(nextTargets);
		},
		[]
	);
	const selectNavigationTarget = useCallback(
		(targetId: string | null): void => {
			selectedTargetIdRef.current = targetId;
			setSelectedTargetId(targetId);
			if (!targetId) {
				return;
			}
			targetReadersRef.current.get(targetId)?.().element?.scrollIntoView({
				block: "nearest",
				inline: "nearest",
			});
		},
		[]
	);
	const reconcileNavigationSelection = useCallback(
		(
			nextTargets: readonly CommandLensMeasuredTarget[],
			nextIsOptionActive: boolean
		): void => {
			if (!isNavigationActiveRef.current) {
				return;
			}
			const navigationTargets = getCommandLensNavigationTargets(
				nextTargets,
				nextIsOptionActive
			);
			const currentTargetId = selectedTargetIdRef.current;
			const currentTargetStillExists = navigationTargets.some(
				(target) => target.id === currentTargetId
			);
			if (currentTargetStillExists) {
				return;
			}
			selectNavigationTarget(
				getInitialCommandLensNavigationTarget(navigationTargets, null)?.id ??
					null
			);
		},
		[selectNavigationTarget]
	);
	const readVisibleTargets =
		useCallback((): readonly CommandLensMeasuredTarget[] => {
			const measuredTargets: CommandLensMeasuredTarget[] = [];
			for (const readTarget of targetReadersRef.current.values()) {
				const target = readTarget();
				const isSelectedNavigationTarget =
					isNavigationActiveRef.current &&
					target.id === selectedTargetIdRef.current;
				const measuredTarget = measureTarget(
					target,
					isSelectedNavigationTarget
				);
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
		reconcileNavigationSelection(nextTargets, isOptionDownRef.current);
	}, [readVisibleTargets, reconcileNavigationSelection, setMeasuredTargets]);
	const requestMeasurement = useCallback((): void => {
		if (!isVisibleRef.current || measurementFrameRef.current !== null) {
			return;
		}
		measurementFrameRef.current = window.requestAnimationFrame(measureTargets);
	}, [measureTargets]);
	const hideLens = useCallback(
		(suppressUntilMetaRelease: boolean): void => {
			clearDwellTimer();
			if (measurementFrameRef.current !== null) {
				window.cancelAnimationFrame(measurementFrameRef.current);
				measurementFrameRef.current = null;
			}
			isVisibleRef.current = false;
			if (suppressUntilMetaRelease) {
				isSuppressedRef.current = true;
			}
			isNavigationActiveRef.current = false;
			selectedTargetIdRef.current = null;
			targetsRef.current = [];
			setIsNavigationActive(false);
			setIsOptionActive(false);
			setSelectedTargetId(null);
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
		isNavigationActiveRef.current = false;
		selectedTargetIdRef.current = null;
		setIsNavigationActive(false);
		setIsOptionActive(isOptionDownRef.current);
		setSelectedTargetId(null);
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
	const invokeAction = useCallback(
		(action: CommandLensNavigationAction): void => {
			const result = action.onInvoke();
			if (result instanceof Promise) {
				result.catch((error: unknown) => window.reportError(error));
			}
			requestMeasurement();
		},
		[requestMeasurement]
	);
	const runMatchingCommand = useCallback(
		(event: KeyboardEvent): void => {
			const command = findInvokableCommand(
				event,
				targetReadersRef.current.values()
			);
			if (
				!command ||
				(!command.allowInEditable && isEditableEventTarget(event.target))
			) {
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			invokeAction(command);
		},
		[invokeAction]
	);
	const navigateCommandLens = useCallback(
		(
			event: KeyboardEvent,
			direction: CommandLensNavigationDirection
		): boolean => {
			if (!isVisibleRef.current || isEditableEventTarget(event.target)) {
				return false;
			}
			const navigationTargets = getCommandLensNavigationTargets(
				targetsRef.current,
				isOptionDownRef.current
			);
			if (navigationTargets.length === 0) {
				return false;
			}
			let nextTarget: CommandLensMeasuredTarget | null;
			if (isNavigationActiveRef.current) {
				const currentTargetId = selectedTargetIdRef.current;
				nextTarget = currentTargetId
					? getNextCommandLensNavigationTarget(
							navigationTargets,
							currentTargetId,
							direction
						)
					: getInitialCommandLensNavigationTarget(navigationTargets, null);
			} else {
				const focusedTargetId = findFocusedTargetId(
					targetReadersRef.current.values()
				);
				nextTarget = getInitialCommandLensNavigationTarget(
					navigationTargets,
					focusedTargetId
				);
				isNavigationActiveRef.current = true;
				setIsNavigationActive(true);
			}
			if (!nextTarget) {
				return false;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			selectNavigationTarget(nextTarget.id);
			return true;
		},
		[selectNavigationTarget]
	);
	const runSelectedNavigationAction = useCallback(
		(event: KeyboardEvent): boolean => {
			if (
				!isNavigationActiveRef.current ||
				isEditableEventTarget(event.target)
			) {
				return false;
			}
			const target = targetsRef.current.find(
				(candidate) => candidate.id === selectedTargetIdRef.current
			);
			if (!target) {
				return false;
			}
			const currentTarget = targetReadersRef.current.get(target.id)?.();
			if (!currentTarget || currentTarget.disabled) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return true;
			}
			const action = getCommandLensNavigationAction(
				target,
				isOptionDownRef.current
			);
			if (!action) {
				return false;
			}
			const advanceTarget = getCommandLensNavigationAdvanceTarget(
				getCommandLensNavigationTargets(
					targetsRef.current,
					isOptionDownRef.current
				),
				target.id,
				action
			);
			event.preventDefault();
			event.stopImmediatePropagation();
			invokeAction(action);
			if (advanceTarget) {
				selectNavigationTarget(advanceTarget.id);
			}
			return true;
		},
		[invokeAction, selectNavigationTarget]
	);
	const trackOptionKeyDown = useCallback(
		(event: KeyboardEvent): boolean => {
			if (event.key !== "Alt") {
				return false;
			}
			isOptionDownRef.current = true;
			if (isVisibleRef.current) {
				setIsOptionActive(true);
				reconcileNavigationSelection(targetsRef.current, true);
			}
			return true;
		},
		[reconcileNavigationSelection]
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
			if (!event.metaKey || isCommandLensModifierKey(event.key)) {
				return;
			}
			if (
				isCommandLensNavigationKey(event.key) &&
				navigateCommandLens(event, event.key)
			) {
				return;
			}
			if (event.key === "Enter" && runSelectedNavigationAction(event)) {
				return;
			}
			if (!isVisibleRef.current) {
				clearDwellTimer();
				isSuppressedRef.current = true;
			}
			runMatchingCommand(event);
		},
		[
			clearDwellTimer,
			hideLens,
			navigateCommandLens,
			runMatchingCommand,
			runSelectedNavigationAction,
			startMetaDwell,
			trackOptionKeyDown,
		]
	);
	const handleCommandLensKeyUp = useCallback(
		(event: KeyboardEvent): void => {
			if (event.key === "Alt") {
				isOptionDownRef.current = false;
				setIsOptionActive(false);
				reconcileNavigationSelection(targetsRef.current, false);
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
		[hideLens, reconcileNavigationSelection]
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
				<CommandLensOverlay
					isNavigationActive={isNavigationActive}
					isOptionActive={isOptionActive}
					selectedTargetId={selectedTargetId}
					targets={targets}
				/>
			) : null}
		</CommandLensContext>
	);
}
