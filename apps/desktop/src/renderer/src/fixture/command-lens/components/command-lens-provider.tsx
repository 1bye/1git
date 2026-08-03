import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type CommandLensMeasuredTarget,
	CommandLensOverlay,
} from "@/fixture/command-lens/components/command-lens-overlay.js";
import { COMMAND_LENS_DWELL_MS } from "@/fixture/command-lens/constants/command-lens.js";
import {
	CommandLensContext,
	type CommandLensContextValue,
	type CommandLensTargetReader,
	type CommandLensTargetSource,
} from "@/fixture/command-lens/hooks/use-command-lens-context.js";
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

const isTargetVisible = (target: CommandLensTargetSource): boolean => {
	const { element } = target;
	if (!(element?.isConnected && !target.disabled)) {
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
	target: CommandLensTargetSource
): CommandLensMeasuredTarget | null => {
	if (!isTargetVisible(target) || target.commands.length === 0) {
		return null;
	}
	const rect = target.element?.getBoundingClientRect();
	if (!rect) {
		return null;
	}
	return {
		commands: target.commands,
		id: target.id,
		placement: target.placement ?? "bottom",
		radius: target.radius ?? 12,
		rect: {
			height: rect.height,
			left: rect.left,
			top: rect.top,
			width: rect.width,
		},
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
	const isVisibleRef = useRef(false);
	const isSuppressedRef = useRef(false);
	const layerIdsRef = useRef(liquidMenuStack.layerIds);
	const [isVisible, setIsVisible] = useState(false);
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
	const readVisibleTargets =
		useCallback((): readonly CommandLensMeasuredTarget[] => {
			const measuredTargets: CommandLensMeasuredTarget[] = [];
			for (const readTarget of targetReadersRef.current.values()) {
				const measuredTarget = measureTarget(readTarget());
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
		setTargets(readVisibleTargets());
	}, [readVisibleTargets]);
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
		setTargets(visibleTargets);
		setIsVisible(true);
	}, [readVisibleTargets]);
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
			const result = command.onInvoke();
			if (result instanceof Promise) {
				result.catch((error: unknown) => window.reportError(error));
			}
			requestMeasurement();
		},
		[requestMeasurement]
	);

	useEffect(() => {
		if (liquidMenuStack.layerIds.length > 0) {
			hideLens(true);
		}
	}, [hideLens, liquidMenuStack.layerIds]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				hideLens(isMetaDownRef.current);
				return;
			}
			if (event.key === "Meta") {
				startMetaDwell(event);
				return;
			}
			if (
				!(event.metaKey && isMetaDownRef.current) ||
				isCommandLensModifierKey(event.key)
			) {
				return;
			}

			if (!isVisibleRef.current) {
				clearDwellTimer();
				isSuppressedRef.current = true;
			}
			runMatchingCommand(event);
		};
		const handleKeyUp = (event: KeyboardEvent): void => {
			if (event.key !== "Meta") {
				return;
			}
			isMetaDownRef.current = false;
			isSuppressedRef.current = false;
			hideLens(false);
		};
		const resetLens = (): void => {
			isMetaDownRef.current = false;
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

		window.addEventListener("keydown", handleKeyDown, true);
		window.addEventListener("keyup", handleKeyUp, true);
		window.addEventListener("blur", resetLens);
		document.addEventListener("visibilitychange", resetHiddenLens);
		document.addEventListener("pointerdown", dismissForPointer, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			window.removeEventListener("keyup", handleKeyUp, true);
			window.removeEventListener("blur", resetLens);
			document.removeEventListener("visibilitychange", resetHiddenLens);
			document.removeEventListener("pointerdown", dismissForPointer, true);
			clearDwellTimer();
		};
	}, [clearDwellTimer, hideLens, runMatchingCommand, startMetaDwell]);

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
			{isVisible ? <CommandLensOverlay targets={targets} /> : null}
		</CommandLensContext>
	);
}
