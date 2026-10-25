/**
 * Covers: saved tour progress, strict malformed input handling and forward-compatible step ids.
 * Real: session capture and parser.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";

it("round trips completed and dismissed tour state without modifying older documents", () => {
	const args: Parameters<typeof WorkspaceSession.capture> = [
		WorkspaceTabsModel.create(),
	];

	args[12] = { completed: ["tab-menu", "worktrees"], dismissed: false };
	const captured = WorkspaceSession.capture(...args);

	expect(WorkspaceSession.parse(JSON.stringify(captured)).tips).toEqual(
		args[12]
	);
	expect(
		WorkspaceSession.parse(JSON.stringify({ ...captured, tips: undefined }))
			.tips
	).toBeUndefined();
});

it.each(
	[
		null,
		false,
		[],
		{},
		{ completed: "tab-menu" },
		{ completed: [null] },
		{ completed: [1] },
		{ completed: [], dismissed: "true" },
	].map((tips) => ({ tips }))
)("ignores malformed tips %j", ({ tips }) => {
	const document = WorkspaceSession.capture(WorkspaceTabsModel.create());

	expect(
		WorkspaceSession.parse(JSON.stringify({ ...document, tips })).tips
	).toBeUndefined();
});

it("drops unknown ids and deduplicates known steps in tour order", () => {
	const document = WorkspaceSession.capture(WorkspaceTabsModel.create());

	expect(
		WorkspaceSession.parse(
			JSON.stringify({
				...document,
				tips: {
					completed: ["space-swipe", "future-step", "tab-menu", "tab-menu"],
					dismissed: true,
				},
			})
		).tips
	).toEqual({ completed: ["tab-menu", "space-swipe"], dismissed: true });
});
