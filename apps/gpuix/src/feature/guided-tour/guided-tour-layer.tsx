import { useEffect, useRef, useState, type RefObject } from "react";
import {
	useGpuixRequired,
	type NativeRenderer,
	type PublicInstance,
	type WindowKeyEventHandler,
} from "@gpuix/react";
import { typography } from "@1git/design-tokens";
import { appThemes, useAppTheme } from "../../styles/theme";
import { CoachMark } from "./coach-mark";
import { GuidedTour, type TourContext, type TourTips } from "./guided-tour";

const dismissals = new WeakMap<NativeRenderer, () => void>();

/** Escape dismisses a visible tour without claiming other keys or moving focus. */
export function handleGuidedTourKeyDown(
	...[event, renderer]: Parameters<WindowKeyEventHandler>
): boolean {
	if (
		event.key !== "escape" ||
		event.modifiers?.cmd ||
		event.modifiers?.ctrl ||
		event.modifiers?.alt
	)
		return false;

	const dismiss = dismissals.get(renderer);

	if (!dismiss) return false;

	dismiss();

	return true;
}

/** A native motion track supplies renderer-clock delays, including under clockFastForward tests. */
function TourDelay({
	seconds,
	onElapsed,
}: {
	seconds: number;
	onElapsed: () => void;
}) {
	return (
		<div
			aria-hidden
			testId="tour-delay"
			motion={{
				initial: { opacity: 0 },
				animate: { opacity: 0.001 },
				transition: { duration: seconds, ease: "linear" },
			}}
			onMotionComplete={onElapsed}
			style={{
				position: "absolute",
				width: 1,
				height: 1,
				pointerEvents: "none",
			}}
		/>
	);
}

const copy = {
	"tab-menu": {
		title: "Find your current branch",
		body: "Open Branches in the left rail to see your current branch, switch branches, or create one.",
	},
	"create-branch": {
		title: "Create your own branch",
		body: "Choose New Branch to name a local branch and switch to it. You can cancel without changing your repository.",
	},
	"space-swipe": {
		title: "Switch spaces",
		body: "Swipe left or right with two fingers over the rail.",
	},
} as const;

/** Owns presentation timing; persisted progression stays with the app and its real UI events. */
export function GuidedTourLayer({
	tips,
	context,
	repositoryKey,
	tabAnchor,
	createBranchAnchor,
	branchesOpen = false,
	spaceAnchor,
	railAnchor,
	onSkip,
}: {
	tips: TourTips;
	context: TourContext;
	repositoryKey: string | null;
	tabAnchor: RefObject<PublicInstance | null>;
	createBranchAnchor: RefObject<PublicInstance | null>;
	branchesOpen?: boolean;
	spaceAnchor: RefObject<PublicInstance | null>;
	railAnchor: RefObject<PublicInstance | null>;
	onSkip: () => void;
}) {
	const renderer = useGpuixRequired();
	const { appearance, smoothTransitions } = useAppTheme();
	const { tokens } = appThemes[appearance === "light" ? "dark" : "light"];
	const [readyRepository, setReadyRepository] = useState<string | null>(null);
	const [confirmation, setConfirmation] = useState(false);
	const [glyphRight, setGlyphRight] = useState(true);
	const previous = useRef(tips);

	const [standalone, setStandalone] = useState(
		tips.completed.includes("create-branch")
	);

	const step = GuidedTour.current(tips, context);
	const ready = step !== "tab-menu" || readyRepository === repositoryKey;
	const visible = ready ? step : null;
	const latestSkip = useRef(onSkip);

	latestSkip.current = onSkip;

	useEffect(() => {
		const completedNow =
			tips.completed.length > previous.current.completed.length;

		previous.current = tips;

		if (
			completedNow &&
			!tips.dismissed &&
			tips.completed.includes("tab-menu") &&
			tips.completed.includes("create-branch") &&
			(context.spaceCount < 2 || tips.completed.includes("space-swipe"))
		)
			setConfirmation(true);

		if (
			completedNow &&
			context.spaceCount < 2 &&
			tips.completed.includes("create-branch")
		)
			setStandalone(true);

		if (tips.dismissed || tips.completed.length === 0) {
			setConfirmation(false);
			setStandalone(false);
		}
	}, [tips, context.spaceCount]);

	const showConfirmation =
		confirmation && !visible && !context.blocked && context.onboardingComplete;

	useEffect(() => {
		if (!visible && !showConfirmation) return;

		dismissals.set(renderer, () => {
			if (showConfirmation) setConfirmation(false);
			else latestSkip.current();
		});

		return () => {
			dismissals.delete(renderer);
		};
	}, [renderer, visible, showConfirmation]);

	const total = standalone ? 1 : context.spaceCount > 1 ? 3 : 2;
	let number = 1;

	if (!standalone && visible === "create-branch") number = 2;

	if (!standalone && visible === "space-swipe") number = 3;

	let anchor = tabAnchor;

	if (visible === "create-branch" && branchesOpen) anchor = createBranchAnchor;

	if (visible === "space-swipe") anchor = spaceAnchor;

	return (
		<>
			{repositoryKey &&
			!tips.dismissed &&
			!tips.completed.includes("tab-menu") &&
			readyRepository !== repositoryKey ? (
				<TourDelay
					key={repositoryKey}
					seconds={0.6}
					onElapsed={() => setReadyRepository(repositoryKey)}
				/>
			) : null}
			{visible ? (
				<CoachMark
					key={visible}
					anchor={anchor}
					side="right"
					{...copy[visible]}
					step={{ id: visible, number }}
					total={total}
					onSkip={onSkip}
					illustration={
						visible === "space-swipe" ? (
							<div
								aria-hidden
								style={{ display: "flex", height: 32, alignItems: "center" }}
							>
								<text
									motion={
										smoothTransitions
											? {
													initial: { left: -12 },
													animate: { left: glyphRight ? 12 : -12 },
													transition: { duration: 1.2, ease: "easeInOut" },
												}
											: undefined
									}
									onMotionComplete={
										smoothTransitions
											? () => setGlyphRight((value) => !value)
											: undefined
									}
									style={{
										...typography.lg,
										position: "relative",
										color: tokens.colors.text,
									}}
								>
									⇠ Ⅱ ⇢
								</text>
							</div>
						) : undefined
					}
				/>
			) : null}
			{showConfirmation ? (
				<>
					<CoachMark
						anchor={railAnchor.current ? railAnchor : tabAnchor}
						side="right"
						title="You’re set."
						body="Replay tips from Settings → Appearance."
						step={null}
						total={0}
						onSkip={onSkip}
						onDismiss={() => setConfirmation(false)}
					/>
					<TourDelay seconds={3} onElapsed={() => setConfirmation(false)} />
				</>
			) : null}
		</>
	);
}
