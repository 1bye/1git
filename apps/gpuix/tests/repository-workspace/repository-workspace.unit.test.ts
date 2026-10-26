/**
 * Covers: per-view/per-tab selection and scroll, revision file ownership, split limits, commit inclusion/drafts, lifecycle cleanup, and keyboard destinations.
 * Real: workspace and tab models.
 * Doubles: display-only sample data.
 * Requires: none.
 */
import { expect, it } from "bun:test";

import { RepositoryWorkspaceModel as Model } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { sampleEntries } from "../../src/feature/repository-workspace/lib/sample-workspace";
import { WorkspaceTabsModel as Tabs } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";

it("leaves all files unchecked when opening a repository by default", () => {
	const snapshot = repositorySnapshot([changedFile("first.ts")]);

	const state = Model.reduce(Model.create(), { type: "loaded", snapshot });

	expect(state.entries.changes.length).toBeGreaterThan(0);
	expect(state.includedFileIds).toEqual([]);
});

it("preserves manual inclusion and leaves newly appearing files unchecked on refresh", () => {
	const snapshot = repositorySnapshot([changedFile("first.ts")]);

	let state = Model.reduce(Model.create(), { type: "loaded", snapshot });
	const selected = state.entries.changes[0]?.id;

	if (!selected) throw new Error("Expected a changed file");

	state = Model.reduce(state, {
		type: "include-file",
		id: selected,
		included: true,
	});
	const refreshed = Model.reduce(state, {
		type: "loaded",
		snapshot: {
			...snapshot,
			files: [...snapshot.files, changedFile("new.ts")],
		},
		automatic: true,
	});

	expect(refreshed.includedFileIds).toEqual([selected]);
});

it.each([false, true])(
	"applies automatic inclusion to new worktrees and operation refreshes (enabled: %s)",
	(enabled) => {
		const snapshot = repositorySnapshot([changedFile("first.ts")]);

		let tabs = Tabs.reduce(Tabs.create(0), {
			type: "auto-include-changes",
			enabled,
		});

		tabs = Tabs.reduce(tabs, { type: "open-worktree", snapshot });
		const tab = tabs.tabs[0];

		if (!tab) throw new Error("Expected an open worktree");

		expect(tab.workspace.includedFileIds).toEqual(enabled ? ["first.ts"] : []);
		tabs = Tabs.reduce(tabs, {
			type: "workspace",
			id: tab.id,
			action: { type: "include-file", id: "first.ts", included: false },
		});
		const before = tabs.tabs[0]?.workspace;

		tabs = Tabs.reduce(tabs, {
			type: "auto-include-changes",
			enabled: !enabled,
		});
		expect(tabs.tabs[0]?.workspace).toBe(before);
		tabs = Tabs.reduce(tabs, { type: "auto-include-changes", enabled });
		tabs = Tabs.reduce(tabs, {
			type: "workspace",
			id: tab.id,
			action: {
				type: "sync-finished",
				error: null,
				fetchedAt: null,
				snapshot: repositorySnapshot([
					changedFile("first.ts"),
					changedFile("new.ts"),
				]),
			},
		});
		expect(tabs.tabs[0]?.workspace.includedFileIds).toEqual(
			enabled ? ["new.ts"] : []
		);
	}
);

it("retains branch totals through filters and automatic file refreshes, but invalidates them on explicit refresh or HEAD changes", () => {
	const snapshot = repositorySnapshot();
	const loaded = Model.reduce(Model.create(), { type: "loaded", snapshot });

	const counted = Model.reduce(loaded, {
		type: "history-count",
		root: snapshot.repository.root,
		head: snapshot.head.oid ?? "",
		metadataVersion: loaded.metadataVersion ?? 0,
		total: 1234,
		error: null,
	});

	expect(counted.historyCount?.total).toBe(1234);
	expect(
		Model.reduce(counted, { type: "history-search", value: "needle" })
			.historyCount
	).toBe(counted.historyCount);
	expect(
		Model.reduce(counted, { type: "history-file", file: { path: "file.ts" } })
			.historyCount
	).toBe(counted.historyCount);
	expect(
		Model.reduce(counted, { type: "loaded", snapshot, automatic: true })
			.historyCount
	).toBe(counted.historyCount);
	expect(
		Model.reduce(counted, { type: "loaded", snapshot }).historyCount
	).toBeUndefined();

	for (const changed of [
		{ ...snapshot, head: { ...snapshot.head, oid: "new-head" } },
		{ ...snapshot, repository: { ...snapshot.repository, root: "/other" } },
		{ ...snapshot, repository: { ...snapshot.repository, isShallow: true } },
	])
		expect(
			Model.reduce(counted, {
				type: "loaded",
				snapshot: changed,
				automatic: true,
			}).historyCount
		).toBeUndefined();
});

it("ignores totals from another repository, HEAD or refresh generation", () => {
	const snapshot = repositorySnapshot();
	const state = Model.reduce(Model.create(), { type: "loaded", snapshot });

	const counted = {
		type: "history-count" as const,
		root: snapshot.repository.root,
		head: snapshot.head.oid ?? "",
		metadataVersion: state.metadataVersion ?? 0,
		total: 28,
		error: null,
	};

	for (const obsolete of [
		{ ...counted, root: "/other" },
		{ ...counted, head: "other-head" },
		{ ...counted, metadataVersion: counted.metadataVersion - 1 },
	])
		expect(Model.reduce(state, obsolete)).toBe(state);
});

it("pins amend to its reviewed root/HEAD/branch, retains failed drafts and forbids cancel while writing", () => {
	const snapshot = repositorySnapshot();

	let state = Model.reduce(Model.create(), { type: "loaded", snapshot });

	state = Model.reduce(state, {
		type: "edit-commit-message",
		value: "Ordinary draft",
	});
	state = Model.reduce(state, {
		type: "amend-commit",
		head: snapshot.head.oid ?? "",
		branch: "main",
		message: "Original",
	});
	expect(Model.canCommit(state)).toBe(true);
	expect(state.amend?.previousMessage).toBe("Ordinary draft");
	const pending = Model.reduce(state, { type: "commit-started" });

	expect(Model.reduce(pending, { type: "cancel-amend" })).toBe(pending);
	const failed = Model.reduce(pending, {
		type: "commit-failed",
		message: "Hook failed",
	});

	expect(failed.amend).toEqual(state.amend);
	expect(failed.commitMessage).toBe("Original");

	for (const changed of [
		{ ...snapshot, head: { ...snapshot.head, oid: "new-head" } },
		{ ...snapshot, head: { ...snapshot.head, branch: "other" } },
		{ ...snapshot, repository: { ...snapshot.repository, root: "/other" } },
	]) {
		const moved = Model.reduce(failed, { type: "loaded", snapshot: changed });

		expect(Model.canCommit(moved)).toBe(false);
		expect(Model.commitBlockReason(moved)).toContain("Cancel amend");
		expect(Model.reduce(moved, { type: "cancel-amend" }).commitMessage).toBe(
			"Ordinary draft"
		);
	}

	const uncertain = Model.reduce(pending, {
		type: "commit-finished",
		submittedMessage: "Original",
		result: {
			outcome: "unknown",
			oid: "new-head",
			snapshot: null,
			warning: "Review History",
		},
	});

	expect(uncertain.amend).toEqual(state.amend);
	expect(uncertain.commitMessage).toBe("Original");
	expect(Model.canCommit(uncertain)).toBe(false);
});

it("keeps partial inclusion local, supports whole-file reset and protects it during writes", () => {
	const state = Model.reduce(Model.create(), {
		type: "loaded",
		snapshot: repositorySnapshot([changedFile("file.txt")]),
	});

	const partial = Model.reduce(state, {
		type: "include-lines",
		id: "file.txt",
		expectedPatch: "reviewed patch",
		includedLines: ["+:1"],
		total: 2,
	});

	expect(partial.includedFileIds).toEqual(["file.txt"]);
	expect(partial.partialFiles?.["file.txt"]?.includedLines).toEqual(["+:1"]);
	expect(state.partialFiles).toEqual({});
	const all = Model.reduce(partial, {
		type: "include-file",
		id: "file.txt",
		included: true,
	});

	expect(all.includedFileIds).toEqual(["file.txt"]);
	expect(all.partialFiles).toEqual({});
	expect(
		Model.reduce(partial, { type: "include-all", included: true }).partialFiles
	).toEqual({});
	expect(
		Model.reduce(partial, {
			type: "include-files",
			ids: ["file.txt"],
			included: false,
		}).includedFileIds
	).toEqual([]);
	const pending = Model.reduce(partial, { type: "operation-started" });

	expect(
		Model.reduce(pending, {
			type: "include-lines",
			id: "file.txt",
			expectedPatch: "new",
			includedLines: [],
			total: 2,
		})
	).toBe(pending);
});

it("retains partial choices for the same HEAD, but excludes them when HEAD changes", () => {
	const snapshot = repositorySnapshot([changedFile("file.txt")]);

	const state = Model.reduce(
		Model.reduce(Model.create(), { type: "loaded", snapshot }),
		{
			type: "include-lines",
			id: "file.txt",
			expectedPatch: "reviewed patch",
			includedLines: ["+:1"],
			total: 2,
		}
	);

	expect(
		Model.reduce(state, { type: "loaded", snapshot }).partialFiles
	).toEqual(state.partialFiles);
	const moved = Model.reduce(state, {
		type: "loaded",
		snapshot: {
			...snapshot,
			head: { ...snapshot.head, oid: "different-head" },
		},
	});

	expect(moved.includedFileIds).toEqual([]);
	expect(moved.partialFiles).toEqual({});
});

it("uses one checkbox and complete file metadata for an externally removed and recreated file", () => {
	const state = Model.reduce(Model.create(), {
		type: "loaded",
		snapshot: repositorySnapshot([
			changedFile("file.txt", {
				indexStatus: "deleted",
				worktreeStatus: "unmodified",
				headOid: "original",
			}),
			changedFile("file.txt", {
				recordType: "untracked",
				worktreeStatus: "untracked",
			}),
		]),
	});

	expect(state.entries.changes).toHaveLength(1);
	expect(state.includedFileIds).toEqual([]);
	expect(state.entries.changes[0]?.change).toMatchObject({
		headOid: "original",
		worktreeStatus: "modified",
	});
	expect(state.entries.changes[0]?.statusDescription).toBe("modified");
});

it("ranges over visible files only and resets a hidden range anchor", () => {
	const initial = Model.create(true);

	const visibleIds = [
		"src/styles/tokens.ts",
		"src/styles/layout.ts",
		"src/styles/colors.ts",
	];

	const start = Model.reduce(initial, {
		type: "select",
		view: "changes",
		id: "src/styles/tokens.ts",
	});

	const range = Model.reduce(start, {
		type: "select",
		view: "changes",
		id: "src/styles/colors.ts",
		mode: "range",
		visibleIds,
	});

	expect(range.views.changes.selectedIds).toEqual(visibleIds);
	expect(range.includedFileIds).toBe(initial.includedFileIds);
	const hidden = Model.reduce(range, {
		type: "select",
		view: "changes",
		id: "README.md",
	});

	const next = Model.reduce(hidden, {
		type: "select",
		view: "changes",
		id: "src/styles/layout.ts",
		mode: "range",
		visibleIds,
	});

	expect(next.views.changes.selectedIds).toEqual(["src/styles/layout.ts"]);
});

it("highlights ranges independently of commit inclusion and preserves context selections", () => {
	const initial = Model.create(true);
	const ids = sampleEntries.changes.slice(0, 3).map((entry) => entry.id);
	const first = ids[0]!;
	const last = ids[2]!;

	const clicked = Model.reduce(initial, {
		type: "select",
		view: "changes",
		id: first,
	});

	const range = Model.reduce(clicked, {
		type: "select",
		view: "changes",
		id: last,
		mode: "range",
	});

	expect(range.views.changes.selectedIds).toEqual(ids);
	expect(range.views.changes.selectedId).toBe(last);
	expect(range.includedFileIds).toBe(initial.includedFileIds);
	expect(
		Model.reduce(range, {
			type: "select",
			view: "changes",
			id: first,
			mode: "context",
		})
	).toBe(range);
	const excluded = Model.reduce(range, {
		type: "include-files",
		ids,
		included: false,
	});

	expect(excluded.views).toBe(range.views);

	for (const id of ids) expect(excluded.includedFileIds).not.toContain(id);

	const included = Model.reduce(excluded, {
		type: "include-files",
		ids,
		included: true,
	});

	expect(included.includedFileIds).toEqual(initial.includedFileIds);
	const toggled = Model.reduce(range, {
		type: "select",
		view: "changes",
		id: first,
		mode: "toggle",
	});

	expect(toggled.views.changes.selectedIds).toEqual(ids.slice(1));
});

it("preserves draft text verbatim and requires a first-line summary and included files for preview", () => {
	const initial = Model.create(true);
	const value = "Refine navigation\n\nKeep the composer visible.\n";
	const draft = Model.reduce(initial, { type: "edit-commit-message", value });

	expect(draft.commitMessage).toBe(value);
	expect(initial.commitMessage).toBe("");
	expect(draft.views).toBe(initial.views);
	expect(Model.reduce(draft, { type: "edit-commit-message", value })).toBe(
		draft
	);
	expect(Model.canPreviewCommit(draft)).toBe(true);
	expect(Model.canPreviewCommit(initial)).toBe(false);

	for (const emptySummary of [" ", "\nBody only", " \r\nBody only"]) {
		expect(
			Model.canPreviewCommit(
				Model.reduce(draft, {
					type: "edit-commit-message",
					value: emptySummary,
				})
			)
		).toBe(false);
	}

	const excluded = Model.reduce(draft, {
		type: "include-all",
		included: false,
	});

	expect(Model.canPreviewCommit(excluded)).toBe(false);
	expect(excluded.commitMessage).toBe(value);
	expect(
		Model.reduce(draft, { type: "view", view: "history" }).commitMessage
	).toBe(value);
});

it("includes sample files in the preview and changes inclusion independently of viewed files", () => {
	const initial = Model.create(true);

	const state = Model.reduce(initial, {
		type: "include-file",
		id: "src/app.tsx",
		included: false,
	});

	expect(initial.includedFileIds).toEqual(
		sampleEntries.changes.map((entry) => entry.id)
	);
	expect(state.includedFileIds).toHaveLength(29);
	expect(state.includedFileIds).not.toContain("src/app.tsx");
	expect(state.views).toBe(initial.views);
	expect(
		Model.reduce(state, { type: "include-file", id: "missing", included: true })
	).toBe(state);
	expect(
		Model.reduce(state, {
			type: "include-file",
			id: "src/app.tsx",
			included: false,
		})
	).toBe(state);
	expect(
		Model.reduce(state, { type: "include-all", included: true }).includedFileIds
	).toEqual(initial.includedFileIds);
	const empty = Model.reduce(state, { type: "include-all", included: false });

	expect(empty.includedFileIds).toEqual([]);
	expect(Model.reduce(empty, { type: "include-all", included: false })).toBe(
		empty
	);
	expect(
		Model.reduce(empty, {
			type: "include-file",
			id: "src/app.tsx",
			included: true,
		}).includedFileIds
	).toEqual(["src/app.tsx"]);
});

it("remembers independent view selections and offsets without mutating the previous state", () => {
	const initial = Model.create(true);

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
		selectedIds: ["src/app.tsx"],
		anchorId: "src/app.tsx",
		selectedId: "src/app.tsx",
		scrollY: -240,
	});
	expect(state.views.history.selectedId).toBe("commit-2");
	expect(state.views.stashes.selectedId).toBeNull();
	expect(initial.views.changes).toEqual({
		selectedId: null,
		scrollY: 0,
	});
	expect(Model.create(true).views).not.toBe(initial.views);
});

it("rejects invalid entries and scroll offsets and preserves identity for no-ops", () => {
	const state = Model.create(true);

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

	expect(Model.destination(sampleEntries.changes, first, "up", 10)).toBe(first);
	expect(Model.destination(sampleEntries.changes, first, "down", 10)).toBe(
		"src/styles/tokens.ts"
	);
	expect(Model.destination(sampleEntries.changes, first, "pagedown", 10)).toBe(
		sampleEntries.changes[10]?.id
	);
	expect(Model.destination(sampleEntries.changes, first, "pageup", 10)).toBe(
		first
	);
	expect(Model.destination(sampleEntries.changes, first, "end", 10)).toBe(last);
	expect(
		Model.destination(sampleEntries.changes, "tsconfig.json", "down", 10)
	).toBe(last);
	expect(
		Model.destination(sampleEntries.changes, "tsconfig.json", "home", 10)
	).toBe(first);
	expect(
		Model.destination(sampleEntries.changes, first, "tab", 10)
	).toBeUndefined();
	expect(
		Model.destination(sampleEntries.changes, "missing", "down", 10)
	).toBeUndefined();
});

it("scopes file selection and scrolling to the selected revision and resets them when it changes", () => {
	const initial = Model.create(true);

	expect(
		Model.reduce(initial, {
			type: "select-revision-file",
			view: "history",
			id: "src/app.tsx",
		})
	).toBe(initial);
	let state = Model.reduce(initial, {
		type: "select",
		view: "history",
		id: "commit-1",
	});

	state = Model.reduce(state, {
		type: "select-revision-file",
		view: "history",
		id: "src/app.tsx",
	});
	state = Model.reduce(state, {
		type: "scroll-revision-files",
		view: "history",
		revisionId: state.views.history.selectedId,
		y: -80,
	});
	expect(state.views.history.files).toEqual({
		selectedId: "src/app.tsx",
		scrollY: -80,
	});
	expect(state.views.history.selectedId).toBe("commit-1");
	expect(state.includedFileIds).toBe(initial.includedFileIds);
	expect(state.views.stashes).toBe(initial.views.stashes);
	expect(
		Model.reduce(state, {
			type: "select-revision-file",
			view: "history",
			id: "missing",
		})
	).toBe(state);
	expect(
		Model.reduce(state, {
			type: "scroll-revision-files",
			view: "history",
			revisionId: state.views.history.selectedId,
			y: Number.NaN,
		})
	).toBe(state);
	expect(
		Model.reduce(state, { type: "select", view: "history", id: "commit-1" })
	).toBe(state);

	const switched = Model.reduce(state, {
		type: "select",
		view: "history",
		id: "commit-2",
	});

	// A list unmounted mid-gesture must not write its settled offset into the new revision.
	expect(
		Model.reduce(switched, {
			type: "scroll-revision-files",
			view: "history",
			revisionId: "commit-1",
			y: -80,
		})
	).toBe(switched);

	expect(switched.views.history.files).toEqual({
		selectedId: sampleEntries.history[1]?.files[0]?.id ?? null,
		scrollY: 0,
	});
	expect(state.views.history.files.scrollY).toBe(-80);
	expect(
		Model.reduce(switched, {
			type: "select-revision-file",
			view: "history",
			id: "src/app.tsx",
		})
	).toBe(switched);
});

it("clamps split proportions independently per view without disturbing selections", () => {
	const initial = Model.create(true);

	const state = Model.reduce(initial, {
		type: "resize-revisions",
		view: "history",
		ratio: 2,
	});

	expect(state.views.history.splitRatio).toBe(0.75);
	expect(state.views.history.files).toBe(initial.views.history.files);
	expect(state.views.stashes.splitRatio).toBe(0.5);
	expect(
		Model.reduce(state, { type: "resize-revisions", view: "history", ratio: 1 })
	).toBe(state);
	expect(
		Model.reduce(state, {
			type: "resize-revisions",
			view: "history",
			ratio: Number.NaN,
		})
	).toBe(state);
	expect(
		Model.reduce(state, {
			type: "resize-revisions",
			view: "stashes",
			ratio: -1,
		}).views.stashes.splitRatio
	).toBe(0.25);
	expect(initial.views.history.splitRatio).toBe(0.5);
});

it("keeps state attached to tab IDs across activation and reorder and removes it on close", () => {
	let state = Tabs.create(2, true);

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
	expect(state.tabs.at(-1)?.workspace).toEqual(Model.create(true));
});
