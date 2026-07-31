import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface DwellAnimationOptions {
	readonly animationName: string;
	readonly dwellMs: number;
	readonly triggerRef?: RefObject<HTMLElement | null>;
}

interface DwellAnimation {
	readonly iconRef: RefObject<SVGSVGElement | null>;
	readonly isAnimating: boolean;
}

export function useDwellAnimation({
	animationName,
	dwellMs,
	triggerRef,
}: DwellAnimationOptions): DwellAnimation {
	const iconRef = useRef<SVGSVGElement | null>(null);
	const [isAnimating, setIsAnimating] = useState(false);

	useEffect(() => {
		const icon = iconRef.current;
		if (!icon) {
			return;
		}

		const trigger = triggerRef?.current ?? icon.closest("button") ?? icon;
		let dwellTimeout: ReturnType<typeof setTimeout> | undefined;
		let isArmed = true;
		let isHovered = false;
		let isPlaying = false;

		const clearDwell = (): void => {
			if (dwellTimeout === undefined) {
				return;
			}

			clearTimeout(dwellTimeout);
			dwellTimeout = undefined;
		};

		const scheduleAnimation = (): void => {
			const prefersReducedMotion =
				window.matchMedia(REDUCED_MOTION_QUERY).matches;
			if (
				!(isArmed && isHovered) ||
				isPlaying ||
				dwellTimeout !== undefined ||
				prefersReducedMotion
			) {
				return;
			}

			dwellTimeout = setTimeout(() => {
				dwellTimeout = undefined;
				if (
					!(isArmed && isHovered) ||
					isPlaying ||
					window.matchMedia(REDUCED_MOTION_QUERY).matches
				) {
					return;
				}

				isArmed = false;
				isPlaying = true;
				setIsAnimating(true);
			}, dwellMs);
		};

		const handlePointerEnter = (): void => {
			isHovered = true;
			scheduleAnimation();
		};

		const handlePointerLeave = (): void => {
			isHovered = false;
			isArmed = true;
			clearDwell();
		};

		const handleAnimationEnd = (event: AnimationEvent): void => {
			if (event.animationName !== animationName) {
				return;
			}

			isPlaying = false;
			setIsAnimating(false);
			scheduleAnimation();
		};

		trigger.addEventListener("pointerenter", handlePointerEnter);
		trigger.addEventListener("pointerleave", handlePointerLeave);
		icon.addEventListener("animationcancel", handleAnimationEnd);
		icon.addEventListener("animationend", handleAnimationEnd);

		return () => {
			clearDwell();
			trigger.removeEventListener("pointerenter", handlePointerEnter);
			trigger.removeEventListener("pointerleave", handlePointerLeave);
			icon.removeEventListener("animationcancel", handleAnimationEnd);
			icon.removeEventListener("animationend", handleAnimationEnd);
		};
	}, [animationName, dwellMs, triggerRef]);

	return { iconRef, isAnimating };
}
