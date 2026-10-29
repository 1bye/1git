/** Ordered actions taught on the real workspace controls. */
export const tourSteps = ["tab-menu", "create-branch", "space-swipe"] as const;

/** Stable identifiers are the only tour data stored in a session. */
export type TourStepId = (typeof tourSteps)[number];

/** Completed actions and an explicit dismissal survive app restarts. */
export interface TourTips {
	readonly completed: readonly TourStepId[];
	readonly dismissed?: boolean;
}

/** Workspace conditions that permit a non-modal tip to appear. */
export interface TourContext {
	readonly onboardingComplete: boolean;
	readonly hasRepositoryTab: boolean;
	readonly spaceCount: number;
	readonly blocked: boolean;
}

/** Pure tour progression and validation, independent of layout and React. */
export class GuidedTour {
	static parse(value: unknown): TourTips | undefined {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return undefined;

		const record = value as Record<string, unknown>;

		if (
			!Array.isArray(record.completed) ||
			record.completed.some((id: unknown) => typeof id !== "string") ||
			(record.dismissed !== undefined && typeof record.dismissed !== "boolean")
		)
			return undefined;

		// Keep previously completed tours complete when replacing the worktree lesson.
		const completed = record.completed;

		return {
			completed: tourSteps.filter(
				(id) =>
					completed.includes(id) ||
					(id === "create-branch" && completed.includes("worktrees"))
			),
			...(record.dismissed !== undefined
				? { dismissed: record.dismissed }
				: {}),
		};
	}

	static current(tips: TourTips, context: TourContext): TourStepId | null {
		if (tips.dismissed || !context.onboardingComplete || context.blocked)
			return null;

		for (const id of tourSteps) {
			if (tips.completed.includes(id)) continue;

			if (id === "space-swipe") return context.spaceCount > 1 ? id : null;

			if (!context.hasRepositoryTab) return null;

			return id;
		}

		return null;
	}

	static complete(tips: TourTips, id: TourStepId): TourTips {
		if (tips.dismissed || tips.completed.includes(id)) return tips;

		return {
			...tips,
			completed: tourSteps.filter(
				(step) => step === id || tips.completed.includes(step)
			),
		};
	}

	static skip(tips: TourTips): TourTips {
		return { ...tips, completed: tourSteps, dismissed: true };
	}
}
