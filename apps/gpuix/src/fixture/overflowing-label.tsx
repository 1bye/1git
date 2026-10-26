import {
	motion,
	useGpuixRequired,
	useWindowSize,
	type PublicInstance,
	type StyleDesc,
} from "@gpuix/react";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAppTheme } from "../styles/theme";

const marquee = {
	hoverDelay: 0.32,
	minDuration: 0.7,
	maxDuration: 2.2,
	pixelsPerSecond: 48,
	returnDuration: 0.22,
	overflowTolerance: 1,
} as const;

/** Clips a label and reveals only its overflow on hover or keyboard focus, using native motion. */
export function OverflowingLabel({
	children,
	reveal,
	contentKey,
	testId,
	style,
	gap,
}: {
	children: ReactNode;
	reveal: boolean;
	contentKey: string;
	testId: string;
	style?: StyleDesc;
	gap?: number;
}) {
	const renderer = useGpuixRequired();
	const window = useWindowSize();
	const { typography } = useAppTheme();
	const viewport = useRef<PublicInstance>(null);
	const track = useRef<PublicInstance>(null);
	const [overflow, setOverflow] = useState(0);

	useLayoutEffect(() => {
		if (!reveal || !viewport.current || !track.current) return;

		const viewportBounds = renderer.getElementBounds?.(viewport.current.id);
		const trackBounds = renderer.getElementBounds?.(track.current.id);

		if (!viewportBounds || !trackBounds) return;

		const difference = trackBounds.width - viewportBounds.width;

		setOverflow(
			difference > marquee.overflowTolerance ? Math.ceil(difference) : 0
		);
	}, [renderer, reveal, contentKey, window.width, typography]);

	const duration = Math.min(
		marquee.maxDuration,
		Math.max(marquee.minDuration, overflow / marquee.pixelsPerSecond)
	);

	return (
		<div
			ref={viewport}
			testId={testId}
			style={StyleSheet.compose(
				{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					flexShrink: 1,
					minWidth: 0,
					overflow: "hidden",
					whiteSpace: "nowrap",
					pointerEvents: "none",
				},
				style
			)}
		>
			<motion.div
				ref={track}
				style={{
					position: "relative",
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					flexShrink: 0,
					gap,
				}}
				initial={false}
				animate={{ left: reveal ? -overflow : 0 }}
				transition={
					reveal
						? { duration, delay: marquee.hoverDelay, ease: "linear" }
						: { duration: marquee.returnDuration, ease: [0.22, 1, 0.36, 1] }
				}
			>
				{children}
			</motion.div>
		</div>
	);
}
