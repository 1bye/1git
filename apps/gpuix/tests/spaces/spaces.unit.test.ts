/**
 * Covers: legacy migration, isolated tab ownership, safe space deletion, membership, background results and session round trips.
 * Real: space, tab and session models with in-memory repository snapshots.
 * Doubles: none.
 * Requires: none; no Git, SSH or user files.
 */
import { expect, it } from "bun:test";
import { WorkspaceSpaces } from "../../src/feature/spaces/workspace-spaces";
import { spaceIconPresets } from "../../src/feature/spaces/space-icons";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { repositorySnapshot } from "../_shared/repository-snapshot";

const work = "00000000-0000-4000-8000-000000000001";
const folders = { folders: ["/test/work"], hidden: ["/test/ignored"] };
const library = { starred: ["/test/project"], view: "list" as const };

const initial = () =>
	WorkspaceSpaces.initialize(
		WorkspaceSession.restore({
			version: 1,
			tabs: [
				{ id: "workspace-1", path: "/test/project", draft: "Keep draft" },
				{ id: "workspace-2", path: "/test/second", draft: "Another draft" },
			],
			activeId: "workspace-1",
		}),
		folders,
		library
	);

const create = () =>
	WorkspaceTabsModel.reduce(initial(), {
		type: "space-create",
		space: {
			id: work,
			name: "Work",
			icon: "💼",
			repositories: ["/test/company"],
		},
		discovery: folders,
		library,
	});

it("supports the outline presets and keeps membership when changing a space's name or icon", () => {
	for (const preset of spaceIconPresets)
		expect(WorkspaceSpaces.validIcon(preset.id)).toBe(true);

	const state = create();

	const renamed = WorkspaceTabsModel.reduce(state, {
		type: "space-edit",
		id: work,
		name: "Projects",
		icon: "mountain",
	});

	expect(WorkspaceSpaces.current(renamed)).toMatchObject({
		name: "Projects",
		icon: "mountain",
		repositories: ["/test/company"],
	});
	expect(renamed.tabs).toBe(state.tabs);
	expect(renamed.spaces?.find((space) => space.id === "default")).toEqual(
		state.spaces?.find((space) => space.id === "default")
	);
});

it("navigates in saved space order and stops at the ends without wrapping", () => {
	const spaces = create().spaces ?? [];

	expect(WorkspaceSpaces.destination(spaces, "default", "next")).toBe(work);
	expect(WorkspaceSpaces.destination(spaces, work, "previous")).toBe("default");
	expect(WorkspaceSpaces.destination(spaces, "default", "previous")).toBeNull();
	expect(WorkspaceSpaces.destination(spaces, work, "next")).toBeNull();
	expect(WorkspaceSpaces.destination(spaces, "missing", "next")).toBeNull();
});

it("deletes the active space while preserving its repositories, tabs and drafts in Default across restart", () => {
	let state = WorkspaceTabsModel.reduce(create(), {
		type: "add",
		path: "/test/company",
	});

	state = WorkspaceTabsModel.reduce(state, {
		type: "workspace",
		id: "workspace-3",
		action: { type: "edit-commit-message", value: "Work draft" },
	});
	const workspace = state.tabs[2]?.workspace;

	const deleted = WorkspaceTabsModel.reduce(state, {
		type: "space-delete",
		id: work,
	});

	expect(deleted.spaces?.map((space) => space.id)).toEqual(["default"]);
	expect(deleted.activeSpaceId).toBe("default");
	expect(deleted.activeId).toBe("workspace-3");
	expect(WorkspaceSpaces.tabs(deleted)).toHaveLength(3);
	expect(deleted.tabs[2]?.workspace).toBe(workspace);
	expect(WorkspaceSpaces.current(deleted)?.repositories).toEqual([
		"/test/project",
		"/test/second",
		"/test/company",
	]);
	expect(state.tabs[2]?.spaceId).toBe(work);
	expect(state.spaces).toHaveLength(2);
	const restored = WorkspaceSession.restore(
		WorkspaceSession.parse(JSON.stringify(WorkspaceSession.capture(deleted)))
	);

	expect(restored.spaces).toHaveLength(1);
	expect(restored.activeSpaceId).toBe("default");
	expect(restored.activeId).toBe("workspace-3");
	expect(restored.tabs.map((tab) => tab.workspace.commitMessage)).toEqual([
		"Keep draft",
		"Another draft",
		"Work draft",
	]);
});

it("deletes an inactive space without changing the current selection or duplicating repository membership", () => {
	let state = WorkspaceTabsModel.reduce(create(), {
		type: "add",
		path: "/test/project",
	});

	state = WorkspaceTabsModel.reduce(state, {
		type: "space-select",
		id: "default",
	});
	const deleted = WorkspaceTabsModel.reduce(state, {
		type: "space-delete",
		id: work,
	});

	expect(deleted.activeSpaceId).toBe(state.activeSpaceId);
	expect(deleted.activeId).toBe(state.activeId);
	expect(deleted.tabs[2]?.spaceId).toBe("default");
	expect(WorkspaceSpaces.current(deleted)?.repositories).toEqual([
		"/test/project",
		"/test/second",
		"/test/company",
	]);
});

it("protects Default and ignores attempts to delete a missing space", () => {
	const state = create();

	for (const id of ["default", "missing"])
		expect(WorkspaceTabsModel.reduce(state, { type: "space-delete", id })).toBe(
			state
		);
});

it("assigns a late worktree result from a deleted space to Default instead of saving an orphan tab", () => {
	const state = WorkspaceTabsModel.reduce(create(), {
		type: "space-delete",
		id: work,
	});

	const updated = WorkspaceTabsModel.reduce(state, {
		type: "open-worktree",
		spaceId: work,
		snapshot: repositorySnapshot([]),
	});

	expect(updated.tabs.at(-1)?.spaceId).toBe("default");
	expect(() =>
		WorkspaceSession.parse(JSON.stringify(WorkspaceSession.capture(updated)))
	).not.toThrow();
});

it("migrates current tabs and preferences into Default and starts a separate empty tab strip", () => {
	let state = create();

	expect(WorkspaceSpaces.current(state)).toMatchObject({
		id: work,
		icon: "💼",
		repositories: ["/test/company"],
		discovery: { folders: [], hidden: [] },
		library: { starred: [], view: "tiles" },
	});
	expect(WorkspaceSpaces.tabs(state)).toEqual([]);
	expect(state.activeId).toBeNull();
	state = WorkspaceTabsModel.reduce(state, {
		type: "add",
		path: "/test/project",
	});
	state = WorkspaceTabsModel.reduce(state, {
		type: "workspace",
		id: "workspace-3",
		action: { type: "edit-commit-message", value: "Work draft" },
	});
	state = WorkspaceTabsModel.reduce(state, {
		type: "space-select",
		id: "default",
	});

	expect(WorkspaceSpaces.tabs(state).map((tab) => tab.id)).toEqual([
		"workspace-1",
		"workspace-2",
	]);
	expect(state.activeId).toBe("workspace-1");
	expect(state.tabs[0]?.workspace.commitMessage).toBe("Keep draft");
	expect(WorkspaceSpaces.current(state)?.discovery).toEqual(folders);
	expect(WorkspaceSpaces.current(state)?.library).toEqual(library);
	state = WorkspaceTabsModel.reduce(state, { type: "space-select", id: work });
	expect(state.activeId).toBe("workspace-3");
	expect(WorkspaceSpaces.tabs(state)[0]?.workspace.commitMessage).toBe(
		"Work draft"
	);
});

it("keeps closing, tab reordering and late worktree results inside their original space", () => {
	let state = WorkspaceTabsModel.reduce(create(), {
		type: "add",
		path: "/test/company",
	});

	state = WorkspaceTabsModel.reduce(state, {
		type: "close",
		id: "workspace-3",
	});
	expect(state.activeId).toBeNull();
	state = WorkspaceTabsModel.reduce(state, {
		type: "space-select",
		id: "default",
	});
	state = WorkspaceTabsModel.reduce(state, {
		type: "add",
		path: "/test/third",
	});
	state = WorkspaceTabsModel.reduce(state, {
		type: "reorder",
		id: "workspace-4",
		overId: "workspace-1",
	});
	expect(WorkspaceSpaces.tabs(state).map((tab) => tab.id)).toEqual([
		"workspace-4",
		"workspace-1",
		"workspace-2",
	]);
	const snapshot = repositorySnapshot([]);

	state = WorkspaceTabsModel.reduce(state, {
		type: "open-worktree",
		spaceId: work,
		snapshot: {
			...snapshot,
			repository: { ...snapshot.repository, root: "/test/company-next" },
		},
	});
	expect(state.activeId).toBe("workspace-4");
	expect(state.tabs.at(-1)?.spaceId).toBe(work);
	expect(
		state.spaces?.find((space) => space.id === work)?.repositories
	).toContain("/test/company-next");
});

it("persists every space's drafts, symbols, memberships, tab order and active selection", () => {
	let state = WorkspaceTabsModel.reduce(create(), {
		type: "add",
		path: "/test/company",
	});

	state = WorkspaceTabsModel.reduce(state, {
		type: "space-preferences",
		id: work,
		library: { starred: ["/test/company"], view: "list" },
		discovery: { folders: ["/test/company-folder"], hidden: [] },
	});
	const document = WorkspaceSession.parse(
		JSON.stringify(WorkspaceSession.capture(state))
	);

	let restored = WorkspaceSession.restore(document);

	expect(restored.activeSpaceId).toBe(work);
	expect(restored.activeId).toBe("workspace-3");
	expect(WorkspaceSpaces.current(restored)?.library.starred).toEqual([
		"/test/company",
	]);
	expect(WorkspaceSpaces.current(restored)?.discovery.folders).toEqual([
		"/test/company-folder",
	]);
	restored = WorkspaceTabsModel.reduce(restored, {
		type: "space-select",
		id: "default",
	});
	expect(restored.activeId).toBe("workspace-1");
	expect(
		WorkspaceSpaces.tabs(restored).map((tab) => tab.workspace.commitMessage)
	).toEqual(["Keep draft", "Another draft"]);
});

it("validates names, one emoji grapheme and saved ownership before accepting a session", () => {
	expect(WorkspaceSpaces.validIcon("👩🏽‍💻")).toBe(true);
	expect(WorkspaceSpaces.validIcon("💼🏠")).toBe(false);
	expect(WorkspaceSpaces.validIcon("hello")).toBe(false);
	expect(WorkspaceSpaces.validName("\nWork")).toBe(false);
	const document = WorkspaceSession.capture(create());

	expect(() =>
		WorkspaceSession.parse(
			JSON.stringify({
				...document,
				spaces: [...document.spaces!, document.spaces![0]],
			})
		)
	).toThrow("space");
	expect(() =>
		WorkspaceSession.parse(
			JSON.stringify({
				...document,
				tabs: [
					{
						id: "workspace-1",
						spaceId: "missing",
						path: "/test/repo",
						draft: "Keep",
					},
				],
			})
		)
	).toThrow("workspace");
});

it("persists optional space colours and drops invalid legacy colour values", () => {
	const updated = WorkspaceTabsModel.reduce(create(), {
		type: "space-edit",
		id: work,
		name: "Work",
		icon: "work",
		color: "#A478EF",
	});

	const document = WorkspaceSession.parse(
		JSON.stringify(WorkspaceSession.capture(updated))
	);

	expect(document.spaces?.find((space) => space.id === work)?.color).toBe(
		"#a478ef"
	);
	const corrupt = {
		...document,
		spaces: document.spaces?.map((space) => ({ ...space, color: "invalid" })),
	};

	expect(
		WorkspaceSession.parse(JSON.stringify(corrupt)).spaces?.every(
			(space) => space.color === undefined
		)
	).toBe(true);
});
