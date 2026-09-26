/**
 * Covers: tab identity, activation, reordering, close neighbors, empty state, and keyboard destinations.
 * Real: workspace tab model.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";

import { WorkspaceTabsModel as Model } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";

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

it("seeds a multi-tab preview with the first tab active and fresh IDs for +", () => {
	const state = Model.create(8, true);

	expect(state.tabs).toHaveLength(8);
	expect(new Set(state.tabs.map((tab) => tab.id)).size).toBe(8);
	expect(state.activeId).toBe("workspace-1");
	expect(Model.reduce(state, { type: "add" }).activeId).toBe("workspace-9");

	for (const count of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
		expect(() => Model.create(count)).toThrow("positive integer");
	}
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

it("reorders in either direction without changing selection or mutating the original tabs", () => {
	const initial = Model.reduce(Model.reduce(Model.create(), { type: "add" }), {
		type: "add",
	});

	Object.freeze(initial.tabs);
	const moved = Model.reduce(initial, {
		type: "reorder",
		id: "workspace-1",
		overId: "workspace-3",
	});

	expect(moved.tabs.map((tab) => tab.id)).toEqual([
		"workspace-2",
		"workspace-3",
		"workspace-1",
	]);
	expect(moved.activeId).toBe(initial.activeId);
	expect(moved.nextId).toBe(initial.nextId);
	expect(
		Model.reduce(moved, {
			type: "reorder",
			id: "workspace-1",
			overId: "workspace-2",
		})
	).toEqual(initial);
	expect(initial.tabs.map((tab) => tab.id)).toEqual([
		"workspace-1",
		"workspace-2",
		"workspace-3",
	]);
	expect(
		Model.reduce(initial, {
			type: "reorder",
			id: "missing",
			overId: "workspace-1",
		})
	).toBe(initial);
	expect(
		Model.reduce(initial, {
			type: "reorder",
			id: "workspace-1",
			overId: "missing",
		})
	).toBe(initial);
	expect(
		Model.reduce(initial, {
			type: "reorder",
			id: "workspace-1",
			overId: "workspace-1",
		})
	).toBe(initial);
});
