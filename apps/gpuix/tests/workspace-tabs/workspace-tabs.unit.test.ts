/**
 * Covers: tab identity, activation, close neighbors, empty state, and keyboard destinations.
 * Real: workspace tab model.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";

import { WorkspaceTabsModel as Model } from "../../src/feature/workspace-tabs/workspace-tabs-model";

it("creates independent state and preserves identity for ignored actions", () => {
	const state = Model.create();
	expect(Model.create()).not.toBe(state);
	expect(Model.reduce(state, { type: "activate", id: "missing" })).toBe(state);
	expect(Model.reduce(state, { type: "close", id: "missing" })).toBe(state);
	expect(Model.reduce(state, { type: "activate", id: "workspace-1" })).toBe(
		state
	);
	expect(Model.destination(state.tabs, "missing", "right")).toBeUndefined();
});

it("adds unique tabs without mutating the input and keeps the active tab on an inactive close", () => {
	const initial = Model.create();
	const added = Model.reduce(initial, { type: "add" });
	const closed = Model.reduce(added, { type: "close", id: "workspace-1" });

	expect(initial.tabs).toHaveLength(1);
	expect(added.tabs).toHaveLength(2);
	expect(closed.activeId).toBe("workspace-2");
	expect(Model.reduce(closed, { type: "add" }).activeId).toBe("workspace-3");
});

it("closes to the right, then left, then empty, and can reopen from empty", () => {
	let state = Model.reduce(Model.reduce(Model.create(), { type: "add" }), {
		type: "add",
	});
	state = Model.reduce(state, { type: "activate", id: "workspace-2" });
	state = Model.reduce(state, { type: "close", id: "workspace-2" });
	expect(state.activeId).toBe("workspace-3");
	state = Model.reduce(state, { type: "close", id: "workspace-3" });
	expect(state.activeId).toBe("workspace-1");
	state = Model.reduce(state, { type: "close", id: "workspace-1" });
	expect(state.activeId).toBeNull();
	expect(state.tabs).toEqual([]);
	expect(Model.reduce(state, { type: "add" }).activeId).toBe("workspace-4");
});

it("wraps arrow navigation and supports Home/End without accepting unrelated keys", () => {
	const { tabs } = Model.reduce(Model.create(), { type: "add" });
	expect(Model.destination(tabs, "workspace-1", "left")).toBe("workspace-2");
	expect(Model.destination(tabs, "workspace-2", "right")).toBe("workspace-1");
	expect(Model.destination(tabs, "workspace-2", "home")).toBe("workspace-1");
	expect(Model.destination(tabs, "workspace-1", "end")).toBe("workspace-2");
	expect(Model.destination(tabs, "workspace-1", "tab")).toBeUndefined();
	expect(Model.destination([], "workspace-1", "right")).toBeUndefined();
});
