/**
 * Covers: anchored pages, cache/selection preservation, refresh invalidation and stale responses.
 * Real: workspace reducer and history presentation mapping.
 * Doubles: explicit snapshots, commits and file lists.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { RepositoryWorkspaceModel as Model } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import {
	commitInfo,
	committedFiles,
	historyPage,
} from "../_shared/history-page";

it("appends pages without losing selection or scroll, and preserves history on same-HEAD refresh", () => {
	const snapshot = repositorySnapshot();

	const source = {
		root: snapshot.repository.root,
		head: snapshot.head.oid ?? "",
	};

	let state = Model.reduce(Model.create(), { type: "loaded", snapshot });

	state = Model.reduce(state, {
		type: "history-page",
		...source,
		offset: 0,
		page: historyPage(0, 12, true),
	});
	state = Model.reduce(state, {
		type: "select",
		view: "history",
		id: commitInfo(4).oid,
	});
	state = Model.reduce(state, {
		type: "history-files",
		...source,
		commit: commitInfo(4).oid,
		files: committedFiles(commitInfo(4).oid),
	});
	state = Model.reduce(state, {
		type: "select-revision-file",
		view: "history",
		id: "src/file-3.ts",
	});
	state = Model.reduce(state, { type: "scroll", view: "history", y: -300 });
	state = Model.reduce(state, {
		type: "scroll-revision-files",
		view: "history",
		y: -80,
	});
	const selection = state.views.history;

	state = Model.reduce(state, {
		type: "history-page",
		...source,
		offset: 12,
		page: historyPage(10, 5),
	});
	state = Model.reduce(state, { type: "loaded", snapshot });

	expect(state.entries.history).toHaveLength(15);
	expect(state.views.history).toEqual(selection);
	expect(Model.revision(state, "history")?.files).toHaveLength(18);
	expect(state.entries.history[0]?.detail).toContain("Test Author");
	expect(state.entries.history[0]?.detail).toContain("2026");
	expect(state.history.nextOffset).toBeNull();
});

it("invalidates history for changed HEAD and rejects results from the old snapshot or wrong page", () => {
	const snapshot = repositorySnapshot();

	const source = {
		root: snapshot.repository.root,
		head: snapshot.head.oid ?? "",
	};

	let state = Model.reduce(Model.create(), { type: "loaded", snapshot });

	expect(
		Model.reduce(state, {
			type: "history-page",
			...source,
			offset: 50,
			page: historyPage(),
		})
	).toBe(state);
	state = Model.reduce(state, {
		type: "history-page",
		...source,
		offset: 0,
		page: historyPage(),
	});
	state = Model.reduce(state, {
		type: "loaded",
		snapshot: { ...snapshot, head: { ...snapshot.head, oid: "b".repeat(40) } },
	});
	expect(state.entries.history).toEqual([]);
	expect(state.views.history.selectedId).toBeNull();
	expect(state.history.nextOffset).toBe(0);
	expect(
		Model.reduce(state, {
			type: "history-page",
			...source,
			offset: 0,
			page: historyPage(),
		})
	).toBe(state);
	expect(
		Model.reduce(state, {
			type: "history-files",
			...source,
			commit: commitInfo().oid,
			files: committedFiles(commitInfo().oid),
		})
	).toBe(state);
	state = Model.reduce(state, {
		type: "loaded",
		snapshot: {
			...snapshot,
			head: { ...snapshot.head, oid: null, unborn: true },
		},
	});
	expect(state.history.nextOffset).toBeNull();
});
