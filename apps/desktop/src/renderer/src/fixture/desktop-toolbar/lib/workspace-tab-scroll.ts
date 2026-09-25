import { easeWorkspaceLiquidMotion } from "@/fixture/desktop-toolbar/lib/workspace-liquid-motion.js";

interface WorkspaceTabScrollInput {
	readonly currentScrollLeft: number;
	readonly maximumScrollLeft: number;
	readonly tabLeft: number;
	readonly tabRight: number;
	readonly viewportLeft: number;
	readonly viewportRight: number;
}

interface WorkspaceTabRevealFrameInput {
	readonly durationMs: number;
	readonly elapsedMs: number;
	readonly initialScrollLeft: number;
	readonly targetScrollLeft: number;
}

export interface WorkspaceTabRevealFrame {
	readonly isComplete: boolean;
	readonly scrollLeft: number;
}

const clampScrollLeft = (value: number, maximum: number): number =>
	Math.max(0, Math.min(value, Math.max(0, maximum)));

const clampProgress = (value: number): number =>
	Math.max(0, Math.min(1, value));

export const getWorkspaceTabRevealScrollLeft = ({
	currentScrollLeft,
	maximumScrollLeft,
	tabLeft,
	tabRight,
	viewportLeft,
	viewportRight,
}: WorkspaceTabScrollInput): number => {
	let scrollDelta = 0;

	if (tabLeft < viewportLeft) {
		scrollDelta = tabLeft - viewportLeft;
	} else if (tabRight > viewportRight) {
		scrollDelta = tabRight - viewportRight;
	}

	return clampScrollLeft(currentScrollLeft + scrollDelta, maximumScrollLeft);
};

export const getWorkspaceTabRevealFrame = ({
	durationMs,
	elapsedMs,
	initialScrollLeft,
	targetScrollLeft,
}: WorkspaceTabRevealFrameInput): WorkspaceTabRevealFrame => {
	const progress = durationMs <= 0 ? 1 : clampProgress(elapsedMs / durationMs);
	const easedProgress = easeWorkspaceLiquidMotion(progress);

	return {
		isComplete: progress === 1,
		scrollLeft:
			initialScrollLeft +
			(targetScrollLeft - initialScrollLeft) * easedProgress,
	};
};
