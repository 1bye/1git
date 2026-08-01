import type { RefObject } from "react";
import { useLayoutEffect, useRef } from "react";
import { WORKSPACE_ACTIONS_LIQUID_MOTION } from "../constants/workspace-actions-menu.js";

interface WorkspaceActionsMenuSizeRefs {
	readonly containerRef: RefObject<HTMLDivElement | null>;
	readonly contentRef: RefObject<HTMLDivElement | null>;
}

const HEIGHT_EPSILON = 0.5;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const RESIZE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export const useWorkspaceActionsMenuSize = (): WorkspaceActionsMenuSizeRefs => {
	const containerRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const container = containerRef.current;
		const content = contentRef.current;
		if (!(container && content)) {
			return;
		}

		let activeAnimation: Animation | null = null;
		let measuredHeight: number | null = null;
		const prefersReducedMotion =
			window.matchMedia(REDUCED_MOTION_QUERY).matches;
		const resize = (): void => {
			const nextHeight = content.getBoundingClientRect().height;
			if (
				measuredHeight !== null &&
				Math.abs(measuredHeight - nextHeight) < HEIGHT_EPSILON
			) {
				return;
			}

			const currentHeight = container.getBoundingClientRect().height;
			measuredHeight = nextHeight;
			activeAnimation?.cancel();
			container.style.height = `${nextHeight}px`;
			if (
				prefersReducedMotion ||
				Math.abs(currentHeight - nextHeight) < HEIGHT_EPSILON
			) {
				container.removeAttribute("data-resizing");
				return;
			}

			container.dataset.resizing = "true";
			const animation = container.animate(
				[{ height: `${currentHeight}px` }, { height: `${nextHeight}px` }],
				{
					duration: WORKSPACE_ACTIONS_LIQUID_MOTION.resizeDurationMs,
					easing: RESIZE_EASING,
				}
			);
			activeAnimation = animation;
			animation.onfinish = () => {
				if (activeAnimation !== animation) {
					return;
				}
				activeAnimation = null;
				container.removeAttribute("data-resizing");
			};
			animation.oncancel = () => {
				if (activeAnimation === animation) {
					activeAnimation = null;
				}
			};
		};

		resize();
		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(content);
		return () => {
			activeAnimation?.cancel();
			resizeObserver.disconnect();
		};
	}, []);

	return { containerRef, contentRef };
};
