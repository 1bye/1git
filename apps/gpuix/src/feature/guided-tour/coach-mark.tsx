import {
	useLayoutEffect,
	useState,
	useRef,
	type ReactNode,
	type RefObject,
} from "react";
import {
	useGpuixRequired,
	useWindowSize,
	type ElementBounds,
	type PublicInstance,
} from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import { radius, spacing, typography, fontWeight } from "@1git/design-tokens";
import { appThemes, useAppTheme } from "../../styles/theme";
import type { TourStepId } from "./guided-tour";

/** Non-modal native floating tip. Only the bubble receives input; its target remains live. */
export function CoachMark({
	anchor,
	side = "bottom",
	title,
	body,
	step,
	total,
	illustration,
	onSkip,
	onDismiss,
}: {
	anchor: RefObject<PublicInstance | null>;
	side?: "bottom" | "right";
	title: string;
	body: string;
	step: { id: TourStepId; number: number } | null;
	total: number;
	illustration?: ReactNode;
	onSkip: () => void;
	onDismiss?: () => void;
}) {
	const { appearance, tokens: anchorTokens, smoothTransitions } = useAppTheme();
	const { tokens } = appThemes[appearance === "light" ? "dark" : "light"];
	const renderer = useGpuixRequired();
	const window = useWindowSize();
	const [bounds, setBounds] = useState<ElementBounds | null>(null);
	const [bright, setBright] = useState(true);
	const panel = useRef<PublicInstance>(null);
	const [panelHeight, setPanelHeight] = useState(154);

	useLayoutEffect(() => {
		const measure = () => {
			const next = anchor.current
				? renderer.getElementBounds?.(anchor.current.id)
				: null;

			const content =
				panel.current && renderer.getElementBounds?.(panel.current.id);

			if (content && content.height > 0) setPanelHeight(content.height);

			setBounds((previous) => {
				if (!next || next.width <= 0 || next.height <= 0) return null;

				if (
					previous &&
					previous.x === next.x &&
					previous.y === next.y &&
					previous.width === next.width &&
					previous.height === next.height
				)
					return previous;

				return next;
			});
		};

		measure();
		const firstLayout = setTimeout(measure, 0);
		const timer = setInterval(measure, 32);

		return () => {
			clearTimeout(firstLayout);
			clearInterval(timer);
		};
	}, [anchor, renderer, window.width, window.height]);

	if (!bounds) return null;

	const width = Math.min(290, window.width - 24);
	const inset = 12;
	const right = bounds.x + bounds.width + inset;
	const left = bounds.x - width - inset;
	const below = bounds.y + bounds.height + inset;
	const above = bounds.y - panelHeight - inset;

	const beside =
		side === "right" &&
		(right + width <= window.width - inset || left >= inset);

	let x = bounds.x + (bounds.width - width) / 2;
	let y = below + panelHeight <= window.height - inset ? below : above;

	if (beside) {
		x = right + width <= window.width - inset ? right : left;
		y = bounds.y;
	}

	x = Math.max(inset, Math.min(x, window.width - width - inset));
	y = Math.max(inset, Math.min(y, window.height - panelHeight - inset));

	return (
		<>
			{step ? (
				<anchored
					position={{ x: bounds.x - 3, y: bounds.y - 3 }}
					anchor="topLeft"
					deferred
					priority={4}
					occlude={false}
					style={{
						width: bounds.width + 6,
						height: bounds.height + 6,
						pointerEvents: "none",
						backgroundColor: "rgba(0,0,0,0.001)",
					}}
				>
					<div
						testId="tour-target-ring"
						aria-hidden
						motion={
							smoothTransitions
								? {
										initial: { opacity: 0.4 },
										animate: { opacity: bright ? 1 : 0.4 },
										transition: { duration: 1.2, ease: "easeInOut" },
									}
								: undefined
						}
						onMotionComplete={
							smoothTransitions ? () => setBright((value) => !value) : undefined
						}
						style={{
							width: "100%",
							height: "100%",
							borderRadius: radius.lg,
							borderWidth: 2,
							borderColor: anchorTokens.colors.accent,
							pointerEvents: "none",
							opacity: smoothTransitions ? undefined : 0.7,
						}}
					/>
				</anchored>
			) : null}
			<anchored
				position={{ x, y }}
				anchor="topLeft"
				deferred
				priority={4}
				occlude
				style={{
					width,
					borderRadius: radius.xl,
					backgroundColor: tokens.colors.overlay,
				}}
			>
				<div
					ref={panel}
					testId="tour-coach-mark"
					role="status"
					aria-label={title}
					onMouseDownOutside={onDismiss}
					onClick={onDismiss}
					style={{
						display: "flex",
						flexDirection: "column",
						maxHeight: window.height - inset * 2,
						overflowY: "scroll",
						padding: spacing[4],
						gap: spacing[2],
						borderWidth: 1,
						borderColor: tokens.colors.border,
						borderRadius: radius.xl,
						backgroundColor: tokens.colors.overlay,
						boxShadow: {
							offsetX: 0,
							offsetY: 6,
							blurRadius: 20,
							spreadRadius: 0,
							color: tokens.colors.shadow,
						},
					}}
				>
					<text
						testId={step ? `tour-step-${step.id}` : "tour-confirmation"}
						style={{
							...typography.md,
							color: tokens.colors.text,
							fontWeight: fontWeight.medium,
						}}
					>
						{title}
					</text>
					<text
						style={{
							...typography.sm,
							color: tokens.colors.textMuted,
							whiteSpace: "normal",
						}}
					>
						{body}
					</text>
					{illustration}
					{step ? (
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "space-between",
							}}
						>
							<Button
								testId="tour-skip"
								tokens={tokens}
								variant="ghost"
								size="sm"
								onPress={onSkip}
							>
								Skip tour
							</Button>
							<text
								testId="tour-counter"
								style={{ ...typography.sm, color: tokens.colors.textMuted }}
							>{`${step.number} of ${total}`}</text>
						</div>
					) : null}
				</div>
			</anchored>
		</>
	);
}
