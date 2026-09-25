import type { CommandLensRect } from "@/feature/command-lens/lib/command-lens-geometry.js";
import type { CommandLensCommand } from "@/feature/command-lens/lib/command-lens-shortcut.js";

export type CommandLensNavigationDirection =
	| "ArrowDown"
	| "ArrowLeft"
	| "ArrowRight"
	| "ArrowUp";

export type CommandLensNavigationOrientation = "horizontal" | "vertical";

export interface CommandLensNavigationTarget {
	readonly commands: readonly CommandLensCommand[];
	readonly id: string;
	readonly navigationDefault: boolean;
	readonly navigationGroup: string;
	readonly navigationOrder: number;
	readonly navigationOrientation: CommandLensNavigationOrientation;
	readonly plainArrowNavigation: boolean;
	readonly rect: CommandLensRect;
}

const NAVIGATION_KEYS = new Set<CommandLensNavigationDirection>([
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
]);

const CROSS_AXIS_WEIGHT = 2;

const isHorizontalDirection = (
	direction: CommandLensNavigationDirection
): boolean => direction === "ArrowLeft" || direction === "ArrowRight";

const isForwardDirection = (
	direction: CommandLensNavigationDirection
): boolean => direction === "ArrowDown" || direction === "ArrowRight";

const rectCenter = (
	rect: CommandLensRect
): {
	readonly x: number;
	readonly y: number;
} => ({
	x: rect.left + rect.width / 2,
	y: rect.top + rect.height / 2,
});

const compareVisualOrder = (
	first: CommandLensNavigationTarget,
	second: CommandLensNavigationTarget
): number =>
	first.rect.top - second.rect.top ||
	first.rect.left - second.rect.left ||
	first.navigationOrder - second.navigationOrder ||
	first.id.localeCompare(second.id);

const compareNavigationOrder = (
	first: CommandLensNavigationTarget,
	second: CommandLensNavigationTarget
): number =>
	first.navigationOrder - second.navigationOrder ||
	compareVisualOrder(first, second);

const spatialScore = (
	current: CommandLensNavigationTarget,
	candidate: CommandLensNavigationTarget,
	direction: CommandLensNavigationDirection
): number | null => {
	const currentCenter = rectCenter(current.rect);
	const candidateCenter = rectCenter(candidate.rect);
	const horizontal = isHorizontalDirection(direction);

	const primaryDelta = horizontal
		? candidateCenter.x - currentCenter.x
		: candidateCenter.y - currentCenter.y;

	const forward = isForwardDirection(direction);

	if ((forward && primaryDelta <= 0) || (!forward && primaryDelta >= 0)) {
		return null;
	}

	const crossDelta = horizontal
		? Math.abs(candidateCenter.y - currentCenter.y)
		: Math.abs(candidateCenter.x - currentCenter.x);

	return Math.abs(primaryDelta) + crossDelta * CROSS_AXIS_WEIGHT;
};

const findSpatialTarget = <Target extends CommandLensNavigationTarget>(
	targets: readonly Target[],
	current: Target,
	direction: CommandLensNavigationDirection
): Target | null => {
	let bestTarget: Target | null = null;
	let bestScore = Number.POSITIVE_INFINITY;

	for (const candidate of targets) {
		if (
			candidate.id === current.id ||
			candidate.navigationGroup === current.navigationGroup
		) {
			continue;
		}

		const score = spatialScore(current, candidate, direction);

		if (score === null || score >= bestScore) {
			continue;
		}

		bestScore = score;
		bestTarget = candidate;
	}

	return bestTarget;
};

export const isCommandLensNavigationKey = (
	key: string
): key is CommandLensNavigationDirection =>
	NAVIGATION_KEYS.has(key as CommandLensNavigationDirection);

export const getPlainArrowNavigationTargets = <
	Target extends CommandLensNavigationTarget,
>(
	targets: readonly Target[]
): readonly Target[] => targets.filter((target) => target.plainArrowNavigation);

export const getInitialCommandLensNavigationTarget = <
	Target extends CommandLensNavigationTarget,
>(
	targets: readonly Target[],
	preferredTargetId: string | null
): Target | null => {
	if (preferredTargetId) {
		const preferredTarget = targets.find(
			(target) => target.id === preferredTargetId
		);

		if (preferredTarget) {
			return preferredTarget;
		}
	}

	const defaultTarget = targets.find((target) => target.navigationDefault);

	return defaultTarget ?? targets.toSorted(compareVisualOrder)[0] ?? null;
};

export const getNextCommandLensNavigationTarget = <
	Target extends CommandLensNavigationTarget,
>(
	targets: readonly Target[],
	currentTargetId: string,
	direction: CommandLensNavigationDirection
): Target | null => {
	const currentTarget = targets.find((target) => target.id === currentTargetId);

	if (!currentTarget) {
		return getInitialCommandLensNavigationTarget(targets, null);
	}

	const horizontal = isHorizontalDirection(direction);

	const followsGroupOrientation =
		(horizontal && currentTarget.navigationOrientation === "horizontal") ||
		(!horizontal && currentTarget.navigationOrientation === "vertical");

	if (followsGroupOrientation) {
		const groupTargets = targets
			.filter(
				(target) => target.navigationGroup === currentTarget.navigationGroup
			)
			.toSorted(compareNavigationOrder);

		const currentIndex = groupTargets.findIndex(
			(target) => target.id === currentTarget.id
		);

		const nextIndex = currentIndex + (isForwardDirection(direction) ? 1 : -1);
		const nextTarget = groupTargets[nextIndex];

		if (nextTarget) {
			return nextTarget;
		}

		if (currentTarget.navigationOrientation === "horizontal") {
			return currentTarget;
		}
	}

	return findSpatialTarget(targets, currentTarget, direction) ?? currentTarget;
};

export const getNextCommandLensNavigationGroupTarget = <
	Target extends CommandLensNavigationTarget,
>(
	targets: readonly Target[],
	currentTargetId: string
): Target | null => {
	const currentTarget = targets.find((target) => target.id === currentTargetId);

	if (!currentTarget) {
		return null;
	}

	const groupTargets = targets
		.filter(
			(target) => target.navigationGroup === currentTarget.navigationGroup
		)
		.toSorted(compareNavigationOrder);

	const currentIndex = groupTargets.findIndex(
		(target) => target.id === currentTarget.id
	);

	return groupTargets[currentIndex + 1] ?? null;
};
