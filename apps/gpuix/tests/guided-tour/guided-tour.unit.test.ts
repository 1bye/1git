/**
 * Covers: action ordering, deferred space tips, dismissal and pause conditions.
 * Real: pure guided tour model.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import {
	GuidedTour,
	tourSteps,
	type TourContext,
	type TourTips,
} from "../../src/feature/guided-tour/guided-tour";

const context: TourContext = {
	onboardingComplete: true,
	hasRepositoryTab: true,
	spaceCount: 2,
	blocked: false,
};

it("migrates the previous worktree lesson without restarting completed tours", () => {
	expect(
		GuidedTour.parse({ completed: ["tab-menu", "worktrees", "space-swipe"] })
	).toEqual({ completed: tourSteps });
});

it("progresses only through completed actions in order", () => {
	let tips: TourTips = { completed: [] };

	for (const id of tourSteps) {
		expect(GuidedTour.current(tips, context)).toBe(id);
		tips = GuidedTour.complete(tips, id);
	}

	expect(GuidedTour.current(tips, context)).toBeNull();
	expect(GuidedTour.complete(tips, "create-branch")).toBe(tips);
});

it("defers the swipe until a second space exists, even when its new space has no repository", () => {
	const tips: TourTips = { completed: ["tab-menu", "create-branch"] };

	expect(GuidedTour.current(tips, { ...context, spaceCount: 1 })).toBeNull();
	expect(
		GuidedTour.current(tips, { ...context, hasRepositoryTab: false })
	).toBe("space-swipe");
});

it("skip dismisses every remaining tip including a deferred swipe", () => {
	const tips = GuidedTour.skip({ completed: ["tab-menu"] });

	expect(tips).toEqual({ completed: tourSteps, dismissed: true });
	expect(GuidedTour.current(tips, context)).toBeNull();
	expect(GuidedTour.complete(tips, "space-swipe")).toBe(tips);
});

it("waits for onboarding and a repository, and resumes the same step after a blocker", () => {
	const tips: TourTips = { completed: ["tab-menu"] };

	expect(GuidedTour.current(tips, { ...context, blocked: true })).toBeNull();
	expect(
		GuidedTour.current(tips, { ...context, onboardingComplete: false })
	).toBeNull();
	expect(
		GuidedTour.current(tips, { ...context, hasRepositoryTab: false })
	).toBeNull();
	expect(GuidedTour.current(tips, context)).toBe("create-branch");
});
