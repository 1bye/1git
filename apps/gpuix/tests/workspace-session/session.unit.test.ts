/**
 * Covers: session snapshots, diff preference validation, restored drafts/tab order and fresh workspace state.
 * Real: session and workspace models.
 * Doubles: repository snapshots; no filesystem or Git.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import { commitInfo, historyPage } from "../_shared/history-page";

it("round-trips grain visibility and ignores invalid saved choices without losing tabs", () => {
	const args: Parameters<typeof WorkspaceSession.capture> = [
		WorkspaceTabsModel.create(),
	];

	for (const enabled of [true, false]) {
		args[15] = enabled;
		const saved = WorkspaceSession.parse(
			JSON.stringify(WorkspaceSession.capture(...args))
		);

		expect(saved.showGrain).toBe(enabled);
	}

	const document = WorkspaceSession.capture(args[0]);

	for (const showGrain of [undefined, null, "false", 0, {}]) {
		const parsed = WorkspaceSession.parse(
			JSON.stringify({ ...document, showGrain })
		);

		expect(parsed.showGrain).toBeUndefined();
		expect(parsed.tabs).toEqual(document.tabs);
	}
});

it.each([false, true])(
	"persists automatic inclusion across restart (enabled: %s)",
	(enabled) => {
		const state = WorkspaceTabsModel.reduce(WorkspaceTabsModel.create(0), {
			type: "auto-include-changes",
			enabled,
		});

		const document = WorkspaceSession.parse(
			JSON.stringify(WorkspaceSession.capture(state))
		);

		expect(document.autoIncludeChanges).toBe(enabled);
		expect(WorkspaceSession.restore(document).autoIncludeChanges).toBe(enabled);
	}
);

it("defaults older sessions and invalid automatic-inclusion preferences to off", () => {
	const document = WorkspaceSession.capture(WorkspaceTabsModel.create(0));

	for (const autoIncludeChanges of [undefined, null, "true", 1]) {
		const restored = WorkspaceSession.restore(
			WorkspaceSession.parse(
				JSON.stringify({ ...document, autoIncludeChanges })
			)
		);

		expect(restored.autoIncludeChanges).toBe(false);
	}
});

it("captures keybinds and the file layout together without losing either preference", () => {
	const args: Parameters<typeof WorkspaceSession.capture> = [
		WorkspaceTabsModel.create(),
	];

	args[13] = { "quick-open": "cmd-k" };
	args[14] = "tree";
	const saved = WorkspaceSession.parse(
		JSON.stringify(WorkspaceSession.capture(...args))
	);

	expect(saved.keybinds).toEqual({ "quick-open": "cmd-k" });
	expect(saved.fileListLayout).toBe("tree");
});

it("validates the optional file layout without invalidating older sessions", () => {
	const document = WorkspaceSession.capture(WorkspaceTabsModel.create());

	for (const fileListLayout of ["list", "tree"] as const)
		expect(
			WorkspaceSession.parse(JSON.stringify({ ...document, fileListLayout }))
				.fileListLayout
		).toBe(fileListLayout);

	for (const fileListLayout of [undefined, null, "unknown", true])
		expect(
			WorkspaceSession.parse(JSON.stringify({ ...document, fileListLayout }))
				.fileListLayout
		).toBeUndefined();
});

it("persists discovery scope and hidden suggestions without saving scan results or changing older sessions", () => {
	const state = WorkspaceTabsModel.create();
	const preferences = { folders: ["/Volumes/Work"], hidden: ["/test/hidden"] };

	const captured = WorkspaceSession.capture(
		state,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		preferences
	);

	const parsed = WorkspaceSession.parse(JSON.stringify(captured));

	expect(parsed.repositoryDiscovery).toEqual(preferences);
	expect(parsed.recentRepositories).toEqual(captured.recentRepositories);
	expect(
		WorkspaceSession.parse(
			JSON.stringify({ ...captured, repositoryDiscovery: undefined })
		).repositoryDiscovery
	).toBeUndefined();
	expect(
		WorkspaceSession.parse(
			JSON.stringify({
				...captured,
				repositoryDiscovery: {
					folders: [
						null,
						"relative",
						"/test/../test/path",
						"/test/path",
						"/bad\0path",
					],
					hidden: [false, "/hidden", "/hidden"],
					paths: ["/must-not-persist"],
				},
			})
		).repositoryDiscovery
	).toEqual({ folders: ["/test/path"], hidden: ["/hidden"] });
});

it("restores full-history navigation rather than a temporary file history scope", () => {
	const snapshot = repositorySnapshot();
	let state = WorkspaceTabsModel.create();

	for (const action of [
		{ type: "loaded" as const, snapshot },
		{
			type: "history-page" as const,
			root: snapshot.repository.root,
			head: snapshot.head.oid ?? "",
			offset: 0,
			page: historyPage(),
		},
		{
			type: "history-file" as const,
			file: { path: "old-name.ts", revision: "a".repeat(40) },
		},
	])
		state = WorkspaceTabsModel.reduce(state, {
			type: "workspace",
			id: "workspace-1",
			action,
		});

	const captured = WorkspaceSession.capture(state);

	expect(captured.tabs[0]?.navigation?.history).toBe(commitInfo().oid);
	expect(captured.tabs[0]?.navigation?.historyFile).toBeNull();
	expect(
		WorkspaceSession.restore(captured).tabs[0]?.workspace.history.file
	).toBeUndefined();
});

it("restores the ordinary draft rather than silently turning an amendment into a new commit", () => {
	const snapshot = repositorySnapshot();
	const id = "workspace-1";
	let state = WorkspaceTabsModel.create();

	for (const action of [
		{ type: "loaded" as const, snapshot },
		{ type: "edit-commit-message" as const, value: "Ordinary draft" },
		{
			type: "amend-commit" as const,
			head: snapshot.head.oid ?? "",
			branch: "main",
			message: "Amend draft",
		},
	])
		state = WorkspaceTabsModel.reduce(state, { type: "workspace", id, action });

	expect(state.tabs[0]?.workspace.commitMessage).toBe("Amend draft");
	const restored = WorkspaceSession.restore(WorkspaceSession.capture(state));

	expect(restored.tabs[0]?.workspace.commitMessage).toBe("Ordinary draft");
	expect(restored.tabs[0]?.workspace.amend).toBeUndefined();
});

it("defaults older or unknown split layouts to fixed without losing navigation or drafts", () => {
	const state = WorkspaceTabsModel.create();
	const session = WorkspaceSession.capture(state);

	for (const splitLayout of [undefined, "future-mode", 5]) {
		const parsed = WorkspaceSession.parse(
			JSON.stringify({
				...session,
				diffSettings: { mode: "split", ignoreWhitespace: true, splitLayout },
			})
		);

		expect(parsed.diffSettings).toEqual({
			mode: "split",
			ignoreWhitespace: true,
			splitLayout: "fixed",
		});
		expect(parsed.tabs).toEqual(session.tabs);
	}

	for (const diffSettings of [
		null,
		{ mode: "future-mode", ignoreWhitespace: false },
		{ mode: "split", ignoreWhitespace: "false" },
	]) {
		expect(
			WorkspaceSession.parse(JSON.stringify({ ...session, diffSettings }))
				.diffSettings
		).toBeUndefined();
	}
});

it("forgets a saved entry without closing its tab or restoring it on restart", () => {
	const snapshot = repositorySnapshot();

	let state = WorkspaceTabsModel.reduce(WorkspaceTabsModel.create(), {
		type: "workspace",
		id: "workspace-1",
		action: { type: "loaded", snapshot },
	});

	const tabs = state.tabs;

	state = WorkspaceTabsModel.reduce(state, {
		type: "forget-repository",
		path: snapshot.repository.root,
	});
	expect(state.tabs).toBe(tabs);
	expect(state.recentRepositories).toEqual([]);
	const saved = WorkspaceSession.parse(
		JSON.stringify(WorkspaceSession.capture(state))
	);

	expect(saved).not.toBeNull();
	state = WorkspaceSession.restore(saved!);
	state = WorkspaceTabsModel.reduce(state, {
		type: "workspace",
		id: "workspace-1",
		action: { type: "loaded", snapshot },
	});
	expect(state.recentRepositories).toEqual([]);
	expect(state.tabs).toHaveLength(1);
});

it("retains recent roots after the last tab closes, round-trips them and ignores invalid optional entries", () => {
	let state = WorkspaceTabsModel.create();

	state = WorkspaceTabsModel.reduce(state, {
		type: "workspace",
		id: "workspace-1",
		action: { type: "loaded", snapshot: repositorySnapshot() },
	});
	state = WorkspaceTabsModel.reduce(state, {
		type: "close",
		id: "workspace-1",
	});
	const restored = WorkspaceSession.restore(
		WorkspaceSession.parse(JSON.stringify(WorkspaceSession.capture(state)))
	);

	expect(restored.tabs).toEqual([]);
	expect(restored.recentRepositories).toEqual(["/test/project"]);
	const parsed = WorkspaceSession.parse(
		JSON.stringify({
			version: 1,
			tabs: [],
			activeId: null,
			recentRepositories: ["relative", 5, "/valid", "/bad\0path", "/valid"],
		})
	);

	expect(parsed.recentRepositories).toEqual(["/valid"]);
	expect(
		WorkspaceTabsModel.remember(
			Array.from({ length: 110 }, (_, index) => `/repo/${index}`),
			"/repo/50"
		)
	).toHaveLength(100);
});

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

it("round-trips Home selection while retaining repository tabs and drafts", () => {
	const document = {
		version: 1 as const,
		tabs: [{ id: "workspace-1", path: "/test/project", draft: "Keep draft" }],
		activeId: null,
	};

	const restored = WorkspaceSession.restore(
		WorkspaceSession.parse(JSON.stringify(document))
	);

	expect(restored.activeId).toBeNull();
	expect(restored.tabs).toHaveLength(1);
	expect(restored.tabs[0]?.workspace.commitMessage).toBe("Keep draft");
	expect(WorkspaceSession.capture(restored).activeId).toBeNull();
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
