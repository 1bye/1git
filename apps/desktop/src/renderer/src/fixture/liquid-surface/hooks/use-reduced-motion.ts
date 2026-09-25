import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface ReducedMotionMediaQuery {
	readonly addEventListener: (type: "change", listener: () => void) => void;
	readonly matches: boolean;
	readonly removeEventListener: (type: "change", listener: () => void) => void;
}

const getReducedMotionMediaQuery = (): ReducedMotionMediaQuery | null => {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return null;
	}

	return window.matchMedia(REDUCED_MOTION_QUERY);
};

export const readReducedMotionPreference = (
	mediaQuery: ReducedMotionMediaQuery | null = getReducedMotionMediaQuery()
): boolean => (mediaQuery ? mediaQuery.matches : false);

export const subscribeReducedMotionPreference = (
	onChange: (matches: boolean) => void,
	mediaQuery: ReducedMotionMediaQuery | null = getReducedMotionMediaQuery()
): (() => void) => {
	if (!mediaQuery) {
		return () => undefined;
	}

	const changePreference = (): void => {
		onChange(mediaQuery.matches);
	};

	mediaQuery.addEventListener("change", changePreference);
	changePreference();

	return () => mediaQuery.removeEventListener("change", changePreference);
};

export const useReducedMotion = (): boolean => {
	const [prefersReducedMotion, setPrefersReducedMotion] = useState(
		readReducedMotionPreference
	);

	useEffect(
		() => subscribeReducedMotionPreference(setPrefersReducedMotion),
		[]
	);

	return prefersReducedMotion;
};
