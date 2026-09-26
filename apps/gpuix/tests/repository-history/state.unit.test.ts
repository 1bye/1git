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

it("keeps the selected immutable commit and file while refreshing history after an external commit", () => {
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
		page: historyPage(),
	});
	state = Model.reduce(state, {
		type: "history-files",
		...source,
		commit: commitInfo().oid,
		files: committedFiles(commitInfo().oid),
	});
	state = Model.reduce(state, { type: "scroll", view: "history", y: -80 });
	const selection = state.views.history;
	const cached = state.entries.history[0];

	const refreshed = {
		...snapshot,
		head: { ...snapshot.head, oid: "c".repeat(40) },
	};

	state = Model.reduce(state, {
		type: "loaded",
		snapshot: refreshed,
		automatic: true,
	});
	expect(state.views.history).toBe(selection);
	expect(state.history.nextOffset).toBe(0);
	state = Model.reduce(state, {
		type: "history-page",
		root: source.root,
		head: refreshed.head.oid,
		offset: 0,
		page: {
			commits: [commitInfo(99), ...historyPage().commits],
			nextOffset: null,
			hasMore: false,
		},
	});
	expect(state.entries.history[0]?.id).toBe(commitInfo(99).oid);
	expect(state.entries.history[1]).toBe(cached);
	expect(state.views.history).toEqual(selection);
	state = Model.reduce(state, {
		type: "loaded",
		snapshot: {
			...refreshed,
			head: { ...refreshed.head, oid: "d".repeat(40) },
		},
		automatic: true,
	});
	state = Model.reduce(state, {
		type: "history-page",
		root: source.root,
		head: "d".repeat(40),
		offset: 0,
		page: historyPage(77, 1),
	});
	expect(state.views.history.selectedId).toBe(commitInfo(77).oid);
	expect(state.views.history.files.selectedId).toBeNull();
	expect(state.views.history.scrollY).toBe(0);
});

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

it("selects the first loaded or cached commit file without overriding manual selection or accepting another commit's files", () => {
	const snapshot = repositorySnapshot();

	const source = {
		root: snapshot.repository.root,
		head: snapshot.head.oid ?? "",
	};

	const commit = commitInfo().oid;
	const other = commitInfo(1).oid;
	const files = committedFiles(commit);
	let state = Model.reduce(Model.create(), { type: "loaded", snapshot });

	state = Model.reduce(state, {
		type: "history-page",
		...source,
		offset: 0,
		page: historyPage(0, 2),
	});
	state = Model.reduce(state, {
		type: "history-files",
		...source,
		commit,
		files,
	});
	expect(state.views.history.files).toEqual({
		selectedId: files[0]?.id ?? null,
		scrollY: 0,
	});

	state = Model.reduce(state, {
		type: "select-revision-file",
		view: "history",
		id: "src/file-3.ts",
	});
	state = Model.reduce(state, {
		type: "scroll-revision-files",
		view: "history",
		y: -80,
	});
	const chosen = state.views.history.files;

	state = Model.reduce(state, {
		type: "history-files",
		...source,
		commit,
		files,
	});
	expect(state.views.history.files).toBe(chosen);
	state = Model.reduce(state, { type: "select", view: "history", id: other });
	expect(state.views.history.files).toEqual({ selectedId: null, scrollY: 0 });
	state = Model.reduce(state, {
		type: "history-files",
		...source,
		commit,
		files,
	});
	expect(state.views.history.files.selectedId).toBeNull();
	state = Model.reduce(state, {
		type: "history-files-error",
		...source,
		commit: other,
		message: "Read failed",
	});
	expect(state.views.history.files.selectedId).toBeNull();
	state = Model.reduce(state, {
		type: "history-files",
		...source,
		commit: other,
		files: [],
	});
	expect(state.views.history.files.selectedId).toBeNull();
	state = Model.reduce(state, { type: "select", view: "history", id: commit });
	expect(state.views.history.files).toEqual({
		selectedId: files[0]?.id ?? null,
		scrollY: 0,
	});
	state = Model.reduce(state, { type: "select", view: "history", id: other });
	expect(state.views.history.files).toEqual({ selectedId: null, scrollY: 0 });
});
