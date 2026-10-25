/**
 * Covers: navigation round trips, fresh-data reconciliation, bounded history search and stale selections.
 * Real: session and workspace reducers. Doubles: Git snapshot/page fixtures.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { RepositoryWorkspaceModel } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import {
	repositorySnapshot,
	changedFile,
} from "../_shared/repository-snapshot";
import {
	commitInfo,
	committedFiles,
	historyPage,
} from "../_shared/history-page";
import { stashList } from "../_shared/stash-list";
import type { RepositoryView } from "../../src/feature/repository-workspace/types";

const document = (view: RepositoryView = "history") => ({
	version: 1,
	activeId: "workspace-1",
	tabs: [
		{
			id: "workspace-1",
			path: "/test/project",
			draft: "Keep draft",
			navigation: {
				view,
				changes: "chosen.ts",
				history: commitInfo(60).oid,
				historyFile: "src/file-2.ts",
				historyLimit: 150,
				stashes: stashList()[1]?.oid ?? null,
				stashFile: "src/file-3.ts",
			},
		},
	],
});

const restored = (view: RepositoryView = "history") => {
	const tabs = WorkspaceSession.restore(
		WorkspaceSession.parse(JSON.stringify(document(view)))
	);

	const workspace = tabs.tabs[0]?.workspace;

	if (!workspace) throw new Error("Missing restored workspace");

	return RepositoryWorkspaceModel.reduce(workspace, {
		type: "loaded",
		snapshot: repositorySnapshot([changedFile("chosen.ts")]),
	});
};

it("round trips every view and selected IDs without saving Git data", () => {
	for (const view of ["changes", "history", "stashes", "graph"] as const) {
		const tabs = WorkspaceSession.restore(
			WorkspaceSession.parse(JSON.stringify(document(view)))
		);

		const saved = WorkspaceSession.capture(tabs);

		expect(saved.tabs[0]?.navigation).toEqual(
			document(view).tabs[0]?.navigation
		);
		expect(restored(view).view).toBe(view);
		expect(restored(view).views.changes.selectedId).toBe("chosen.ts");
		expect(restored(view).views.history.selectedId).toBe(commitInfo(60).oid);
		expect(restored(view).entries.history).toEqual([]);
	}
});

it("retains an older commit through paging, reconciles its file and stops searching", () => {
	let state = restored();
	const root = "/test/project";
	const head = repositorySnapshot().head.oid ?? "";

	state = RepositoryWorkspaceModel.reduce(state, {
		type: "history-page",
		root,
		head,
		offset: 0,
		page: historyPage(0, 50, true),
	});
	expect(state.views.history.selectedId).toBe(commitInfo(60).oid);
	expect(state.restoreHistoryLimit).toBe(150);
	state = RepositoryWorkspaceModel.reduce(state, {
		type: "history-page",
		root,
		head,
		offset: 50,
		page: historyPage(50, 50, true),
	});
	expect(state.restoreHistoryLimit).toBeUndefined();
	state = RepositoryWorkspaceModel.reduce(state, {
		type: "history-files",
		root,
		head,
		commit: commitInfo(60).oid,
		files: committedFiles(commitInfo(60).oid),
	});
	expect(state.views.history.files.selectedId).toBe("src/file-2.ts");
	state = RepositoryWorkspaceModel.reduce(state, {
		type: "history-files",
		root,
		head,
		commit: commitInfo(60).oid,
		files: committedFiles(commitInfo(60).oid, 1),
	});
	expect(state.views.history.files.selectedId).toBe("src/file-0.ts");
});

it("falls back for missing commits and cancels restoration when the user selects another", () => {
	const root = "/test/project";
	const head = repositorySnapshot().head.oid ?? "";

	const state = RepositoryWorkspaceModel.reduce(restored(), {
		type: "history-page",
		root,
		head,
		offset: 0,
		page: historyPage(0, 5, true),
	});

	const selected = RepositoryWorkspaceModel.reduce(state, {
		type: "select",
		view: "history",
		id: commitInfo(2).oid,
	});

	expect(selected.restoreHistoryLimit).toBeUndefined();
	expect(selected.views.history.selectedId).toBe(commitInfo(2).oid);
	const exhausted = RepositoryWorkspaceModel.reduce(state, {
		type: "history-page",
		root,
		head,
		offset: 5,
		page: historyPage(5, 5),
	});

	expect(exhausted.views.history.selectedId).toBe(commitInfo(0).oid);
	expect(exhausted.restoreHistoryLimit).toBeUndefined();
	const bounded = RepositoryWorkspaceModel.reduce(
		{ ...state, restoreHistoryLimit: 10 },
		{
			type: "history-page",
			root,
			head,
			offset: 5,
			page: historyPage(5, 5, true),
		}
	);

	expect(bounded.views.history.selectedId).toBe(commitInfo(0).oid);
	expect(bounded.restoreHistoryLimit).toBeUndefined();
});

it("restores a stash by immutable ID and falls back when its file disappears", () => {
	let state = restored("stashes");
	const root = "/test/project";
	const generation = state.stashes.generation;
	const oid = stashList()[1]?.oid ?? "";

	state = RepositoryWorkspaceModel.reduce(state, {
		type: "stashes-loaded",
		root,
		generation,
		stashes: stashList(),
	});
	expect(state.views.stashes.selectedId).toBe(oid);
	state = RepositoryWorkspaceModel.reduce(state, {
		type: "stash-files",
		root,
		generation,
		oid,
		files: committedFiles(oid),
	});
	expect(state.views.stashes.files.selectedId).toBe("src/file-3.ts");
	state = RepositoryWorkspaceModel.reduce(state, {
		type: "stash-files",
		root,
		generation,
		oid,
		files: [],
	});
	expect(state.views.stashes.files.selectedId).toBeNull();
});

it("keeps old sessions and drafts usable when optional navigation is absent or invalid", () => {
	for (const navigation of [
		undefined,
		{ view: "bad" },
		{ ...document().tabs[0]?.navigation, historyLimit: Infinity },
	]) {
		const value = document();
		const tab = value.tabs[0];

		const state = WorkspaceSession.restore(
			WorkspaceSession.parse(
				JSON.stringify({
					...value,
					tabs: [{ ...tab, navigation }],
				})
			)
		).tabs[0]?.workspace;

		expect(state?.view).toBe("changes");
		expect(state?.commitMessage).toBe("Keep draft");
	}
});

it("clears a vanished changed file and falls back when the saved stash was dropped", () => {
	const changes = RepositoryWorkspaceModel.reduce(restored("changes"), {
		type: "loaded",
		snapshot: repositorySnapshot([changedFile("other.ts")]),
	});

	expect(changes.views.changes.selectedId).toBeNull();
	const initial = restored("stashes");

	const stashes = RepositoryWorkspaceModel.reduce(initial, {
		type: "stashes-loaded",
		root: "/test/project",
		generation: initial.stashes.generation,
		stashes: stashList().slice(0, 1),
	});

	expect(stashes.views.stashes.selectedId).toBe(stashList()[0]?.oid ?? null);
	expect(stashes.views.stashes.files.selectedId).toBeNull();
	expect(stashes.commitMessage).toBe("Keep draft");
});
