import type { DragDropManager } from "@dnd-kit/dom";
import type {
	DragEndEvent,
	DragMoveEvent,
	DragStartEvent,
} from "@dnd-kit/react";
import type { RefObject } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";

import {
	createWorkspaceTabDragRailController,
	refreshWorkspaceTabDragCollisions,
} from "@/fixture/desktop-toolbar/lib/workspace-tab-drag-rail.js";

interface UseWorkspaceTabDragRailOptions {
	readonly dropAnimationDurationMs: number;
	readonly railRef: RefObject<HTMLElement | null>;
}

interface WorkspaceTabDragRailHandlers {
	readonly endDragRail: (event: DragEndEvent, manager: DragDropManager) => void;
	readonly moveDragRail: (
		event: DragMoveEvent,
		manager: DragDropManager
	) => void;
	readonly startDragRail: (
		event: DragStartEvent,
		manager: DragDropManager
	) => void;
}

const isPointerDrag = (event: Event | null | undefined): boolean =>
	event?.type.startsWith("pointer") ?? false;

export const useWorkspaceTabDragRail = ({
	dropAnimationDurationMs,
	railRef,
}: UseWorkspaceTabDragRailOptions): WorkspaceTabDragRailHandlers => {
	const controllerRef = useRef<ReturnType<
		typeof createWorkspaceTabDragRailController
	> | null>(null);
	const managerRef = useRef<DragDropManager | null>(null);
	useLayoutEffect(() => {
		const controller = createWorkspaceTabDragRailController({
			cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
			getOverlay: () =>
				railRef.current?.parentElement?.querySelector<HTMLElement>(
					"[data-dnd-overlay]"
				) ?? null,
			getRail: () => railRef.current,
			getRailMaskImage: (rail) => {
				const styles = window.getComputedStyle(rail);
				if (styles.maskImage && styles.maskImage !== "none") {
					return styles.maskImage;
				}
				const webkitMaskImage = styles.getPropertyValue("-webkit-mask-image");
				return webkitMaskImage && webkitMaskImage !== "none"
					? webkitMaskImage
					: null;
			},
			postDragTrackingDurationMs: dropAnimationDurationMs,
			refreshCollisions: () => {
				if (managerRef.current) {
					refreshWorkspaceTabDragCollisions(managerRef.current);
				}
			},
			requestFrame: (callback) => window.requestAnimationFrame(callback),
		});
		controllerRef.current = controller;
		return () => {
			controllerRef.current = null;
			managerRef.current = null;
			controller.disconnect();
		};
	}, [dropAnimationDurationMs, railRef]);

	const startDragRail = useCallback(
		(event: DragStartEvent, manager: DragDropManager): void => {
			managerRef.current = manager;
			const sourceEvent =
				event.nativeEvent ?? event.operation.activatorEvent ?? undefined;
			controllerRef.current?.start(
				isPointerDrag(sourceEvent) ? event.operation.position.current.x : null
			);
		},
		[]
	);
	const moveDragRail = useCallback(
		(event: DragMoveEvent, manager: DragDropManager): void => {
			managerRef.current = manager;
			controllerRef.current?.move(
				event.to?.x ?? event.operation.position.current.x
			);
		},
		[]
	);
	const endDragRail = useCallback(
		(_event: DragEndEvent, manager: DragDropManager): void => {
			managerRef.current = manager;
			controllerRef.current?.end();
			managerRef.current = null;
		},
		[]
	);

	return {
		endDragRail,
		moveDragRail,
		startDragRail,
	};
};
