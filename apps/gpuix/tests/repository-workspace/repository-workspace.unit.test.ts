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
	expect(state.includedFileIds).toEqual(["file.txt"]);
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

it("includes every changed file initially and changes inclusion independently of viewed files", () => {
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
