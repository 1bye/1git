/**
 * Covers: minimal session snapshots, validation, restored drafts/tab order and fresh workspace state.
 * Real: session and workspace models.
 * Doubles: repository snapshots; no filesystem or Git.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import { repositorySnapshot } from "../_shared/repository-snapshot";

it("restores tab order, separate drafts, active tab and worktree roots without stale Git state", () => {
	let state = WorkspaceTabsModel.create(3);

	for (const id of ["workspace-1", "workspace-2", "workspace-3"]) {
		const snapshot = repositorySnapshot();
		const root = id === "workspace-3" ? "/test/linked" : "/test/project";

		state = WorkspaceTabsModel.reduce(state, {
			type: "workspace",
			id,
			action: {
				type: "loaded",
				snapshot: {
					...snapshot,
					repository: { ...snapshot.repository, root },
				},
			},
		});
		state = WorkspaceTabsModel.reduce(state, {
			type: "workspace",
			id,
			action: {
				type: "edit-commit-message",
				value: `Draft ${id}\n\nDetails ✨`,
			},
		});
	}

	state = WorkspaceTabsModel.reduce(state, {
		type: "workspace",
		id: "workspace-1",
		action: { type: "sync-started", kind: "push" },
	});
	state = WorkspaceTabsModel.reduce(state, {
		type: "reorder",
		id: "workspace-3",
		overId: "workspace-1",
	});
	state = WorkspaceTabsModel.reduce(state, {
		type: "activate",
		id: "workspace-2",
	});
	const serialized = JSON.stringify(WorkspaceSession.capture(state));
	const restored = WorkspaceSession.restore(WorkspaceSession.parse(serialized));

	expect(serialized).not.toContain("commonDirectory");
	expect(serialized).not.toContain("pending");
	expect(serialized).not.toContain("main");
	expect(restored.tabs.map(({ id }) => id)).toEqual([
		"workspace-3",
		"workspace-1",
		"workspace-2",
	]);
	expect(restored.activeId).toBe("workspace-2");
	expect(
		restored.tabs.map(({ workspace }) => workspace.repositoryPath)
	).toEqual(["/test/linked", "/test/project", "/test/project"]);
	expect(restored.tabs[1]?.workspace).toMatchObject({
		repository: null,
		loading: true,
		commitMessage: "Draft workspace-1\n\nDetails ✨",
		sync: { pending: null },
		entries: { changes: [], history: [], stashes: [] },
	});
	const added = WorkspaceTabsModel.reduce(restored, { type: "add" });

	expect(added.tabs.at(-1)?.id).toBe("workspace-4");
});

it("preserves empty tabs and an intentionally empty session", () => {
	const initial = WorkspaceTabsModel.create();
	const restored = WorkspaceSession.restore(WorkspaceSession.capture(initial));

	expect(restored.tabs[0]?.workspace).toMatchObject({
		repositoryPath: null,
		loading: false,
	});
	const closed = WorkspaceTabsModel.reduce(initial, {
		type: "close",
		id: "workspace-1",
	});

	const empty = WorkspaceSession.restore(
		WorkspaceSession.parse(JSON.stringify(WorkspaceSession.capture(closed)))
	);

	expect(empty.tabs).toEqual([]);
	expect(empty.activeId).toBeNull();
	expect(WorkspaceTabsModel.reduce(empty, { type: "add" }).tabs).toHaveLength(
		1
	);
});

it("rejects malformed, future, duplicate-ID and invalid-path sessions instead of silently losing drafts", () => {
	const tab = { id: "workspace-1", path: "/test/project", draft: "keep" };

	for (const document of [
		{},
		{ version: 2, tabs: [] },
		{ version: 1, tabs: [tab, tab] },
		{ version: 1, tabs: [{ ...tab, draft: 12 }] },
		{ version: 1, tabs: [{ ...tab, path: "relative/path" }] },
		{ version: 1, tabs: [{ ...tab, path: "/with\0nul" }] },
		{ version: 1, tabs: [{ ...tab, id: "workspace-9007199254740991" }] },
	])
		expect(() => WorkspaceSession.parse(JSON.stringify(document))).toThrow();

	expect(() => WorkspaceSession.parse("{")).toThrow();
	expect(
		WorkspaceSession.parse(
			JSON.stringify({ version: 1, tabs: [tab], activeId: "missing" })
		).activeId
	).toBe("workspace-1");
});
