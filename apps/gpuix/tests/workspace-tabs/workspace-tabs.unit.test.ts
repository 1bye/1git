/**
 * Covers: tab identity, activation, reordering, close neighbors, empty state, and keyboard destinations.
 * Real: workspace tab model.
 * Doubles: none.
 * Requires: none.
 */
import { expect, it } from "bun:test";

import { WorkspaceTabsModel as Model } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";

it("returns from comparison without changing workspace state", () => {
	const initial = Model.create();

	const comparing = Model.reduce(initial, {
		type: "compare",
		id: "workspace-1",
		comparison: { root: "/repo", base: "oid", baseName: "main", branches: [] },
	});

	expect(comparing.tabs[0]?.workspace).toBe(initial.tabs[0]?.workspace);
	expect(comparing.tabs[0]?.comparison?.baseName).toBe("main");
	const closed = Model.reduce(comparing, {
		type: "compare",
		id: "workspace-1",
	});

	expect(closed.tabs[0]?.comparison).toBeUndefined();
	expect(closed.tabs[0]?.workspace).toBe(initial.tabs[0]?.workspace);
});

it("removes restored worktree tabs and drafts from the saved session after confirmed removal", () => {
	const initial = Model.create(2);

	const state = {
		...initial,
		activeId: "workspace-2",
		tabs: initial.tabs.map((tab, index) => ({
			...tab,
			kind: "repository" as const,
			workspace: {
				...tab.workspace,
				repositoryPath: index === 0 ? "/main" : "/linked",
				commitMessage: "draft",
			},
		})),
	};

	const removed = Model.reduce(state, {
		type: "worktree-removed",
		path: "/linked",
	});

	const saved = WorkspaceSession.capture(removed);

	expect(saved.tabs).toHaveLength(1);
	expect(saved.tabs[0]?.path).toBe("/main");
	expect(saved.tabs[0]?.draft).toBe("draft");
	expect(removed.activeId).toBe("workspace-1");
	expect(state.tabs).toHaveLength(2);
});

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

it("returns Home without adding tabs, clearing drafts or stopping operations", () => {
	let initial = Model.create(2);

	initial = Model.reduce(initial, {
		type: "workspace",
		id: "workspace-1",
		action: { type: "edit-commit-message", value: "Keep draft" },
	});
	initial = Model.reduce(initial, {
		type: "workspace",
		id: "workspace-1",
		action: { type: "sync-started", kind: "fetch" },
	});
	const home = Model.reduce(initial, { type: "home" });

	expect(home.activeId).toBeNull();
	expect(home.tabs).toBe(initial.tabs);
	expect(home.nextId).toBe(initial.nextId);
	expect(home.tabs[0]?.workspace.commitMessage).toBe("Keep draft");
	expect(home.tabs[0]?.workspace.sync.pending).toBe("fetch");
	expect(Model.reduce(home, { type: "home" })).toBe(home);
	expect(
		Model.reduce(home, { type: "activate", id: "workspace-1" }).activeId
	).toBe("workspace-1");
	expect(
		Model.reduce(home, { type: "worktree-removed", path: "/missing" }).activeId
	).toBeNull();
});

it("adds unique tabs without mutating the input and keeps the active tab on an inactive close", () => {
	const initial = Model.create();
	const added = Model.reduce(initial, { type: "add" });
	const closed = Model.reduce(added, { type: "close", id: "workspace-1" });

	expect(initial.tabs).toHaveLength(1);
	expect(added.tabs).toHaveLength(2);
	expect(added.tabs[1]?.name).toBe("Welcome");
	expect(closed.activeId).toBe("workspace-2");
	expect(Model.reduce(closed, { type: "add" }).activeId).toBe("workspace-3");
});

it("seeds a multi-tab preview and supports starting on Home without placeholder tabs", () => {
	const state = Model.create(8, true);

	expect(state.tabs).toHaveLength(8);
	expect(new Set(state.tabs.map((tab) => tab.id)).size).toBe(8);
	expect(state.activeId).toBe("workspace-1");
	expect(Model.reduce(state, { type: "add" }).activeId).toBe("workspace-9");

	expect(Model.create(0)).toMatchObject({
		tabs: [],
		activeId: null,
		nextId: 1,
	});

	for (const count of [-1, 1.5, Number.POSITIVE_INFINITY]) {
		expect(() => Model.create(count)).toThrow("non-negative integer");
	}
});

it("creates empty tabs, fills the selected tab, and keeps one settings tab per space", () => {
	let state = Model.create(0);

	state = Model.reduce(state, { type: "add", kind: "empty" });
	expect(state.tabs[0]).toMatchObject({ kind: "empty", name: "Welcome" });

	state = Model.reduce(state, {
		type: "fill",
		id: "workspace-1",
		path: "/test/project",
	});
	expect(state.tabs[0]).toMatchObject({
		kind: "repository",
		name: "project",
		workspace: { repositoryPath: "/test/project", loading: true },
	});

	state = Model.reduce(state, { type: "open-settings" });
	state = Model.reduce(state, { type: "open-settings", section: "appearance" });
	expect(state.tabs.filter((tab) => tab.kind === "settings")).toHaveLength(1);
	expect(state.activeId).toBe("workspace-2");

	const closed = Model.reduce(state, { type: "close", id: "workspace-2" });

	expect(closed.tabs.every((tab) => tab.kind !== "settings")).toBe(true);
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
