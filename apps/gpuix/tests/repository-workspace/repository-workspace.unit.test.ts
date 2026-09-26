/**
 * Covers: per-view/per-tab selection and scroll, lifecycle cleanup, and keyboard destinations.
 * Real: workspace and tab models.
 * Doubles: display-only sample data.
 * Requires: none.
 */
import { expect, it } from "bun:test";

import { RepositoryWorkspaceModel as Model } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { sampleEntries } from "../../src/feature/repository-workspace/lib/sample-workspace";
import { WorkspaceTabsModel as Tabs } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";

it("remembers independent view selections and offsets without mutating the previous state", () => {
	const initial = Model.create();

	let state = Model.reduce(initial, {
		type: "select",
		view: "changes",
		id: "src/app.tsx",
	});

	state = Model.reduce(state, { type: "scroll", view: "changes", y: -240 });
	state = Model.reduce(state, { type: "view", view: "history" });
	state = Model.reduce(state, {
		type: "select",
		view: "history",
		id: "commit-2",
	});
	state = Model.reduce(state, { type: "view", view: "changes" });
	expect(state.views.changes).toEqual({
		selectedId: "src/app.tsx",
		scrollY: -240,
	});
	expect(state.views.history.selectedId).toBe("commit-2");
	expect(state.views.stashes.selectedId).toBeNull();
	expect(initial.views.changes).toEqual({ selectedId: null, scrollY: 0 });
	expect(Model.create().views).not.toBe(initial.views);
});

it("rejects invalid entries and scroll offsets and preserves identity for no-ops", () => {
	const state = Model.create();

	expect(Model.reduce(state, { type: "view", view: "changes" })).toBe(state);
	expect(
		Model.reduce(state, { type: "select", view: "history", id: "src/app.tsx" })
	).toBe(state);

	for (const y of [0, 10, Number.NaN, Number.NEGATIVE_INFINITY]) {
		expect(Model.reduce(state, { type: "scroll", view: "changes", y })).toBe(
			state
		);
	}
});

it("clamps row navigation and supports pages, Home, and End", () => {
	const first = "src/app.tsx";
	const last = sampleEntries.changes.at(-1)?.id;

	expect(Model.destination("changes", first, "up", 10)).toBe(first);
	expect(Model.destination("changes", first, "down", 10)).toBe(
		"src/styles/tokens.ts"
	);
	expect(Model.destination("changes", first, "pagedown", 10)).toBe(
		sampleEntries.changes[10]?.id
	);
	expect(Model.destination("changes", first, "pageup", 10)).toBe(first);
	expect(Model.destination("changes", first, "end", 10)).toBe(last);
	expect(Model.destination("changes", "tsconfig.json", "down", 10)).toBe(last);
	expect(Model.destination("changes", "tsconfig.json", "home", 10)).toBe(first);
	expect(Model.destination("changes", first, "tab", 10)).toBeUndefined();
	expect(Model.destination("changes", "missing", "down", 10)).toBeUndefined();
});

it("keeps state attached to tab IDs across activation and reorder and removes it on close", () => {
	let state = Tabs.create(2);

	state = Tabs.reduce(state, {
		type: "workspace",
		id: "workspace-1",
		action: { type: "select", view: "changes", id: "src/app.tsx" },
	});
	state = Tabs.reduce(state, {
		type: "workspace",
		id: "workspace-1",
		action: { type: "view", view: "history" },
	});
	state = Tabs.reduce(state, { type: "activate", id: "workspace-2" });
	state = Tabs.reduce(state, {
		type: "reorder",
		id: "workspace-1",
		overId: "workspace-2",
	});
	expect(state.tabs[0]?.workspace.view).toBe("changes");
	expect(state.tabs[0]?.workspace.views.changes.selectedId).toBeNull();
	expect(state.tabs[1]?.workspace.view).toBe("history");
	expect(state.tabs[1]?.workspace.views.changes.selectedId).toBe("src/app.tsx");
	state = Tabs.reduce(state, { type: "close", id: "workspace-1" });
	expect(state.tabs.some((tab) => tab.id === "workspace-1")).toBe(false);
	expect(
		Tabs.reduce(state, {
			type: "workspace",
			id: "workspace-1",
			action: { type: "view", view: "stashes" },
		})
	).toBe(state);
	state = Tabs.reduce(state, { type: "add" });
	expect(state.tabs.at(-1)?.workspace).toEqual(Model.create());
});
