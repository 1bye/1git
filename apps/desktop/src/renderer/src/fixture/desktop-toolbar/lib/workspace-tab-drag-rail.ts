import type { DragDropManager } from "@dnd-kit/dom";

const DEFAULT_EDGE_THRESHOLD = 48;
const DEFAULT_MAX_FRAME_DELTA_MS = 32;
const DEFAULT_MAX_SCROLL_SPEED = 960;
const MILLISECONDS_PER_SECOND = 1000;
const CLIP_PRECISION = 1000;

interface HorizontalBounds {
	readonly left: number;
	readonly right: number;
}

interface HorizontalScrollMetrics {
	readonly clientWidth: number;
	readonly scrollLeft: number;
	readonly scrollWidth: number;
}

interface WorkspaceTabDragRailFrameInput {
	readonly elapsedMs: number;
	readonly overlayBounds: HorizontalBounds;
	readonly pointerX: number | null;
	readonly railBounds: HorizontalBounds;
	readonly scrollMetrics: HorizontalScrollMetrics;
}

export interface WorkspaceTabDragRailFrame {
	readonly clipInsetLeft: number;
	readonly clipInsetRight: number;
	readonly maskOffsetLeft: number;
	readonly maskWidth: number;
	readonly scrollLeft: number;
}

interface WorkspaceTabDragRailControllerOptions {
	readonly cancelFrame: (frameId: number) => void;
	readonly getOverlay: () => HTMLElement | null;
	readonly getRail: () => HTMLElement | null;
	readonly getRailMaskImage: (rail: HTMLElement) => string | null;
	readonly postDragTrackingDurationMs: number;
	readonly refreshCollisions: () => void;
	readonly requestFrame: (callback: FrameRequestCallback) => number;
}

export interface WorkspaceTabDragRailController {
	readonly disconnect: () => void;
	readonly end: () => void;
	readonly move: (pointerX: number) => void;
	readonly start: (pointerX: number | null) => void;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
	Math.min(maximum, Math.max(minimum, value));

const getScrollVelocity = (
	pointerX: number | null,
	railBounds: HorizontalBounds
): number => {
	if (pointerX === null) {
		return 0;
	}
	const railWidth = Math.max(0, railBounds.right - railBounds.left);
	const threshold = Math.min(DEFAULT_EDGE_THRESHOLD, railWidth / 2);
	if (threshold <= 0) {
		return 0;
	}
	if (pointerX < railBounds.left + threshold) {
		const progress = clamp(
			(railBounds.left + threshold - pointerX) / threshold,
			0,
			1
		);
		return -DEFAULT_MAX_SCROLL_SPEED * progress;
	}
	if (pointerX > railBounds.right - threshold) {
		const progress = clamp(
			(pointerX - (railBounds.right - threshold)) / threshold,
			0,
			1
		);
		return DEFAULT_MAX_SCROLL_SPEED * progress;
	}
	return 0;
};

export const createWorkspaceTabDragRailFrame = ({
	elapsedMs,
	overlayBounds,
	pointerX,
	railBounds,
	scrollMetrics,
}: WorkspaceTabDragRailFrameInput): WorkspaceTabDragRailFrame => {
	const overlayWidth = Math.max(0, overlayBounds.right - overlayBounds.left);
	const clipInsetLeft = clamp(
		railBounds.left - overlayBounds.left,
		0,
		overlayWidth
	);
	const clipInsetRight = clamp(
		overlayBounds.right - railBounds.right,
		0,
		overlayWidth - clipInsetLeft
	);
	const maxScrollLeft = Math.max(
		0,
		scrollMetrics.scrollWidth - scrollMetrics.clientWidth
	);
	const frameDeltaMs = clamp(elapsedMs, 0, DEFAULT_MAX_FRAME_DELTA_MS);
	const scrollDelta =
		getScrollVelocity(pointerX, railBounds) *
		(frameDeltaMs / MILLISECONDS_PER_SECOND);

	return {
		clipInsetLeft,
		clipInsetRight,
		maskOffsetLeft: railBounds.left - overlayBounds.left,
		maskWidth: Math.max(0, railBounds.right - railBounds.left),
		scrollLeft: clamp(scrollMetrics.scrollLeft + scrollDelta, 0, maxScrollLeft),
	};
};

const roundClipInset = (value: number): number =>
	Math.round(value * CLIP_PRECISION) / CLIP_PRECISION;

const getClipPath = ({
	clipInsetLeft,
	clipInsetRight,
}: WorkspaceTabDragRailFrame): string | null => {
	if (clipInsetLeft === 0 && clipInsetRight === 0) {
		return null;
	}
	return `inset(-100vh ${roundClipInset(
		clipInsetRight
	)}px -100vh ${roundClipInset(clipInsetLeft)}px)`;
};

interface WorkspaceTabDragRailOverlayStyle {
	readonly clipPath: string | null;
	readonly maskImage: string | null;
	readonly maskPosition: string | null;
	readonly maskSize: string | null;
}

const getOverlayStyle = (
	frame: WorkspaceTabDragRailFrame,
	maskImage: string | null
): WorkspaceTabDragRailOverlayStyle => ({
	clipPath: getClipPath(frame),
	maskImage,
	maskPosition: maskImage
		? `${roundClipInset(frame.maskOffsetLeft)}px -100vh`
		: null,
	maskSize: maskImage
		? `${roundClipInset(frame.maskWidth)}px calc(100% + 200vh)`
		: null,
});

const setStyleProperty = (
	style: CSSStyleDeclaration,
	name: string,
	value: string | null
): void => {
	if (value === null) {
		style.removeProperty(name);
	} else {
		style.setProperty(name, value);
	}
};

export const refreshWorkspaceTabDragCollisions = (
	manager: DragDropManager
): void => {
	for (const droppable of manager.registry.droppables) {
		droppable.refreshShape();
	}
	manager.collisionObserver.forceUpdate(true);
};

const isOverlayPresent = (overlay: HTMLElement | null): boolean =>
	Boolean(
		overlay?.hasAttribute("data-dnd-dragging") ||
		overlay?.hasAttribute("data-dnd-dropping")
	);

const shouldTrackDragRail = (
	dragActive: boolean,
	overlayPresent: boolean,
	frameTime: number,
	postDragTrackingStartedAt: number | null,
	postDragTrackingDurationMs: number
): boolean =>
	dragActive ||
	(overlayPresent &&
		postDragTrackingStartedAt !== null &&
		frameTime - postDragTrackingStartedAt <= postDragTrackingDurationMs);

const getActivePointerX = (
	dragActive: boolean,
	pointerDriven: boolean,
	pointerX: number | null
): number | null => (dragActive && pointerDriven ? pointerX : null);

export const createWorkspaceTabDragRailController = ({
	cancelFrame,
	getOverlay,
	getRail,
	getRailMaskImage,
	postDragTrackingDurationMs,
	refreshCollisions,
	requestFrame,
}: WorkspaceTabDragRailControllerOptions): WorkspaceTabDragRailController => {
	let animationFrameId = 0;
	let appliedOverlayStyleKey: string | null = null;
	let currentOverlay: HTMLElement | null = null;
	let disconnected = false;
	let dragActive = false;
	let pointerDriven = false;
	let pointerX: number | null = null;
	let postDragTrackingStartedAt: number | null = null;
	let previousFrameTime: number | null = null;

	const clearOverlayClip = (): void => {
		if (currentOverlay) {
			for (const property of [
				"clip-path",
				"mask-clip",
				"mask-image",
				"mask-position",
				"mask-repeat",
				"mask-size",
				"-webkit-mask-clip",
				"-webkit-mask-image",
				"-webkit-mask-position",
				"-webkit-mask-repeat",
				"-webkit-mask-size",
			]) {
				currentOverlay.style.removeProperty(property);
			}
		}
		appliedOverlayStyleKey = null;
		currentOverlay = null;
	};

	const applyOverlayClip = (
		overlay: HTMLElement | null,
		overlayStyle: WorkspaceTabDragRailOverlayStyle
	): void => {
		if (currentOverlay !== overlay) {
			clearOverlayClip();
			currentOverlay = overlay;
		}
		const { clipPath, maskImage, maskPosition, maskSize } = overlayStyle;
		const overlayStyleKey = [clipPath, maskImage, maskPosition, maskSize].join(
			"|"
		);
		if (!overlay || appliedOverlayStyleKey === overlayStyleKey) {
			return;
		}
		const { style } = overlay;
		setStyleProperty(style, "clip-path", clipPath);
		for (const prefix of ["", "-webkit-"]) {
			setStyleProperty(
				style,
				`${prefix}mask-clip`,
				maskImage ? "no-clip" : null
			);
			setStyleProperty(style, `${prefix}mask-image`, maskImage);
			setStyleProperty(style, `${prefix}mask-position`, maskPosition);
			setStyleProperty(style, `${prefix}mask-size`, maskSize);
			setStyleProperty(
				style,
				`${prefix}mask-repeat`,
				maskImage ? "no-repeat" : null
			);
		}
		appliedOverlayStyleKey = overlayStyleKey;
	};

	const scheduleFrame = (): void => {
		if (disconnected || animationFrameId !== 0) {
			return;
		}
		animationFrameId = requestFrame(updateFrame);
	};

	const updateFrame = (frameTime: number): void => {
		animationFrameId = 0;
		const rail = getRail();
		const overlay = getOverlay();
		const overlayPresent = isOverlayPresent(overlay);
		if (!dragActive && postDragTrackingStartedAt === null) {
			postDragTrackingStartedAt = frameTime;
		}
		const shouldTrack = shouldTrackDragRail(
			dragActive,
			overlayPresent,
			frameTime,
			postDragTrackingStartedAt,
			postDragTrackingDurationMs
		);
		if (!(shouldTrack && rail && overlay)) {
			clearOverlayClip();
			previousFrameTime = shouldTrack ? frameTime : null;
			if (shouldTrack) {
				scheduleFrame();
			}
			return;
		}

		const elapsedMs =
			previousFrameTime === null ? 0 : frameTime - previousFrameTime;
		const frame = createWorkspaceTabDragRailFrame({
			elapsedMs,
			overlayBounds: overlay.getBoundingClientRect(),
			pointerX: getActivePointerX(dragActive, pointerDriven, pointerX),
			railBounds: rail.getBoundingClientRect(),
			scrollMetrics: rail,
		});
		applyOverlayClip(overlay, getOverlayStyle(frame, getRailMaskImage(rail)));
		if (frame.scrollLeft !== rail.scrollLeft) {
			rail.scrollLeft = frame.scrollLeft;
			refreshCollisions();
		}
		previousFrameTime = frameTime;
		scheduleFrame();
	};

	return {
		disconnect: (): void => {
			disconnected = true;
			dragActive = false;
			pointerDriven = false;
			pointerX = null;
			postDragTrackingStartedAt = null;
			previousFrameTime = null;
			if (animationFrameId !== 0) {
				cancelFrame(animationFrameId);
				animationFrameId = 0;
			}
			clearOverlayClip();
		},
		end: (): void => {
			dragActive = false;
			pointerDriven = false;
			pointerX = null;
			postDragTrackingStartedAt = null;
			scheduleFrame();
		},
		move: (nextPointerX: number): void => {
			if (!(dragActive && pointerDriven)) {
				return;
			}
			pointerX = nextPointerX;
			scheduleFrame();
		},
		start: (initialPointerX: number | null): void => {
			dragActive = true;
			pointerDriven = initialPointerX !== null;
			pointerX = initialPointerX;
			postDragTrackingStartedAt = null;
			previousFrameTime = null;
			scheduleFrame();
		},
	};
};
