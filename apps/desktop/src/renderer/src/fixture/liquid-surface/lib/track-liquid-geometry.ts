export interface LiquidGeometryTracker {
	readonly disconnect: () => void;
	readonly measureNow: () => void;
	readonly schedule: () => void;
	readonly setContinuousTracking: (isActive: boolean) => void;
	readonly setElements: (elements: readonly Element[]) => void;
}

const SCROLLABLE_OVERFLOW = /(auto|clip|hidden|overlay|scroll)/;
const PASSIVE_LISTENER_OPTIONS = { passive: true } as const;

const getParentElement = (element: Element): Element | null => {
	const parent = element.assignedSlot ?? element.parentNode;
	if (parent instanceof ShadowRoot) {
		return parent.host;
	}
	return parent instanceof Element ? parent : null;
};

const isScrollAncestor = (element: Element): boolean => {
	const view = element.ownerDocument.defaultView;
	if (!view) {
		return false;
	}
	const style = view.getComputedStyle(element);
	return SCROLLABLE_OVERFLOW.test(
		`${style.overflow}${style.overflowX}${style.overflowY}`
	);
};

const getScrollAncestors = (element: Element): readonly Element[] => {
	const ancestors: Element[] = [];
	let ancestor = getParentElement(element);
	while (ancestor) {
		if (isScrollAncestor(ancestor)) {
			ancestors.push(ancestor);
		}
		ancestor = getParentElement(ancestor);
	}
	return ancestors;
};

const dedupeElements = (elements: readonly Element[]): readonly Element[] => [
	...new Set(elements),
];

const hasSameElements = (
	current: readonly Element[],
	next: readonly Element[]
): boolean =>
	current.length === next.length &&
	current.every((element, index) => element === next[index]);

export const createLiquidGeometryTracker = (
	onMeasure: () => void
): LiquidGeometryTracker => {
	let animationFrameId: number | null = null;
	let isContinuousTracking = false;
	let isDisconnected = false;
	let observedElements: readonly Element[] = [];
	let scrollAncestors: readonly Element[] = [];
	const { visualViewport } = window;

	const schedule = (): void => {
		if (isDisconnected || animationFrameId !== null) {
			return;
		}
		animationFrameId = window.requestAnimationFrame(() => {
			animationFrameId = null;
			onMeasure();
			if (isContinuousTracking) {
				schedule();
			}
		});
	};
	const resizeObserver = new ResizeObserver(schedule);
	const updateScrollAncestors = (elements: readonly Element[]): void => {
		const nextScrollAncestors = dedupeElements(
			elements.flatMap(getScrollAncestors)
		);
		if (hasSameElements(scrollAncestors, nextScrollAncestors)) {
			return;
		}
		for (const ancestor of scrollAncestors) {
			ancestor.removeEventListener("scroll", schedule);
		}
		for (const ancestor of nextScrollAncestors) {
			ancestor.addEventListener("scroll", schedule, PASSIVE_LISTENER_OPTIONS);
		}
		scrollAncestors = nextScrollAncestors;
	};
	const setContinuousTracking = (isActive: boolean): void => {
		isContinuousTracking = isActive;
		if (isActive) {
			schedule();
		}
	};
	const setElements = (elements: readonly Element[]): void => {
		if (isDisconnected) {
			return;
		}
		const nextElements = dedupeElements(elements);
		const didElementsChange = !hasSameElements(observedElements, nextElements);
		if (didElementsChange) {
			resizeObserver.disconnect();
			for (const element of nextElements) {
				resizeObserver.observe(element);
			}
			observedElements = nextElements;
		}
		updateScrollAncestors(nextElements);
		if (didElementsChange) {
			schedule();
		}
	};
	const disconnect = (): void => {
		if (isDisconnected) {
			return;
		}
		isDisconnected = true;
		if (animationFrameId !== null) {
			window.cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
		resizeObserver.disconnect();
		for (const ancestor of scrollAncestors) {
			ancestor.removeEventListener("scroll", schedule);
		}
		window.removeEventListener("resize", schedule);
		window.removeEventListener("scroll", schedule);
		visualViewport?.removeEventListener("resize", schedule);
		visualViewport?.removeEventListener("scroll", schedule);
		observedElements = [];
		scrollAncestors = [];
	};
	const measureNow = (): void => {
		if (isDisconnected) {
			return;
		}
		if (animationFrameId !== null) {
			window.cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
		onMeasure();
		if (isContinuousTracking) {
			schedule();
		}
	};

	window.addEventListener("resize", schedule, PASSIVE_LISTENER_OPTIONS);
	window.addEventListener("scroll", schedule, PASSIVE_LISTENER_OPTIONS);
	visualViewport?.addEventListener(
		"resize",
		schedule,
		PASSIVE_LISTENER_OPTIONS
	);
	visualViewport?.addEventListener(
		"scroll",
		schedule,
		PASSIVE_LISTENER_OPTIONS
	);

	return {
		disconnect,
		measureNow,
		schedule,
		setContinuousTracking,
		setElements,
	};
};
