import {
	useGpuixRequired,
	useWindowSize,
	type PublicInstance,
	type StyleDesc,
} from "@gpuix/react";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import {
	useCallback,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	type ReactNode,
	type Ref,
} from "react";
import { useAppTheme } from "../styles/theme";

const marquee = {
	hoverDelay: 0.32,
	minDuration: 0.7,
	maxDuration: 2.2,
	pixelsPerSecond: 48,
	returnDuration: 0.22,
	overflowTolerance: 1,
} as const;

const restingMotion = {
	generation: 0,
	isExit: false,
	initial: false,
	animate: { left: 0 },
} as const;

/** Pointer and focus changes can drive native motion without rerendering a file row. */
export interface OverflowingLabelHandle {
	setRevealed(revealed: boolean): void;
}

/** Clips a label and reveals only its overflow on hover or keyboard focus, using native motion. */
export function OverflowingLabel({
	ref,
	children,
	reveal = false,
	contentKey,
	testId,
	style,
	gap,
}: {
	ref?: Ref<OverflowingLabelHandle>;
	children: ReactNode;
	reveal?: boolean;
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
	const requested = useRef(reveal);
	const previousReveal = useRef(reveal);
	const offset = useRef(0);
	const generation = useRef(0);

	const animate = useCallback(() => {
		if (!viewport.current || !track.current) return;

		const viewportBounds = renderer.getElementBounds?.(viewport.current.id);
		const trackBounds = renderer.getElementBounds?.(track.current.id);

		if (!viewportBounds || !trackBounds) return;

		const difference = trackBounds.width - viewportBounds.width;

		const overflow =
			requested.current && difference > marquee.overflowTolerance
				? Math.ceil(difference)
				: 0;

		if (offset.current === overflow) return;

		offset.current = overflow;
		const duration = Math.min(
			marquee.maxDuration,
			Math.max(marquee.minDuration, overflow / marquee.pixelsPerSecond)
		);

		// Keep hover and wheel events on the native motion path, outside React layout.
		renderer.applyBatch(
			JSON.stringify([
				[
					"setCustomProp",
					track.current.id,
					"motion",
					{
						generation: ++generation.current,
						isExit: false,
						initial: false,
						animate: { left: -overflow },
						transition: requested.current
							? { duration, delay: marquee.hoverDelay, ease: "linear" }
							: {
									duration: marquee.returnDuration,
									ease: [0.22, 1, 0.36, 1],
								},
					},
				],
			])
		);
	}, [renderer]);

	useImperativeHandle(
		ref,
		() => ({
			setRevealed(next) {
				requested.current = next;
				animate();
			},
		}),
		[animate]
	);
	useLayoutEffect(() => {
		if (previousReveal.current !== reveal) {
			previousReveal.current = reveal;
			requested.current = reveal;
		}

		animate();
	}, [animate, reveal, contentKey, window.width, typography]);

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
			<div
				ref={track}
				motion={restingMotion}
				style={{
					position: "relative",
					left: 0,
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					flexShrink: 0,
					gap,
				}}
			>
				{children}
			</div>
		</div>
	);
}
