/**
 * Covers: onboarding progress validation and independence from repository lists.
 * Real: session parser and capture.
 * Doubles: none.
 * Requires: none; no filesystem or Git.
 */
import { expect, it } from "bun:test";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";

it("round-trips setup progress and completion even with no repositories", () => {
	for (const step of ["welcome", "git", "repository", "complete"] as const) {
		const document = WorkspaceSession.capture(
			WorkspaceTabsModel.create(0),
			undefined,
			"dark",
			false,
			step
		);

		expect(WorkspaceSession.parse(JSON.stringify(document))).toEqual(document);
		expect(document.onboarding).toBe(step);
		expect(document.tabs).toEqual([]);
	}
});

it("leaves legacy sessions and invalid optional progress uninterrupted", () => {
	const document = WorkspaceSession.capture(WorkspaceTabsModel.create(0));

	for (const onboarding of [undefined, null, false, 0, {}, "future-step"]) {
		const parsed = WorkspaceSession.parse(
			JSON.stringify({ ...document, onboarding })
		);

		expect(parsed.onboarding).toBeUndefined();
		expect(parsed.tabs).toEqual([]);
	}
});
