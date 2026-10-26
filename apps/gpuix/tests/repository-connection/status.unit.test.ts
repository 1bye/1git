/**
 * Covers: live status projection, refresh reconciliation, branch labels and preview boundaries.
 * Real: workspace and tab reducers.
 * Doubles: explicit repository snapshots.
 * Requires: none.
 */
import { expect, it } from "bun:test";

import { RepositoryWorkspaceModel as Model } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { WorkspaceTabsModel as Tabs } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";

it("starts empty unless sample preview is explicitly requested", () => {
	expect(Model.create().entries).toEqual({
		changes: [],
		history: [],
		stashes: [],
	});
	expect(Model.create().includedFileIds).toEqual([]);
	expect(Tabs.create().tabs[0]?.name).toBe("Open repository");
	expect(Model.create(true).entries.changes.length).toBeGreaterThan(0);
});

it("reconciles paths without losing manual inclusion, selected files, scroll or drafts", () => {
	let state = Model.reduce(Model.create(), {
		type: "loaded",
		snapshot: repositorySnapshot([
			changedFile("src/keep.ts"),
			changedFile("src/remove.ts"),
		]),
	});

	state = Model.reduce(state, {
		type: "include-file",
		id: "src/keep.ts",
		included: true,
	});
	state = Model.reduce(state, {
		type: "select",
		view: "changes",
		id: "src/keep.ts",
	});
	state = Model.reduce(state, { type: "scroll", view: "changes", y: -60 });
	state = Model.reduce(state, {
		type: "edit-commit-message",
		value: "Draft\n\nDetails",
	});
	state = Model.reduce(state, {
		type: "loaded",
		snapshot: repositorySnapshot([
			changedFile("src/keep.ts"),
			changedFile("new file.ts", {
				recordType: "untracked",
				worktreeStatus: "untracked",
			}),
		]),
	});

	expect(state.includedFileIds).toEqual(["src/keep.ts"]);
	expect(state.views.changes).toEqual({
		selectedId: "src/keep.ts",
		selectedIds: ["src/keep.ts"],
		anchorId: "src/keep.ts",
		scrollY: -60,
	});
	expect(state.commitMessage).toBe("Draft\n\nDetails");
	expect(state.entries.history).toEqual([]);
	expect(state.entries.stashes).toEqual([]);
	expect(Model.canPreviewCommit(state)).toBe(true);
	expect(Model.canPreviewCommit(Model.reduce(state, { type: "loading" }))).toBe(
		false
	);
	const failed = Model.reduce(state, {
		type: "load-error",
		message: "Repository unavailable",
	});

	expect(failed.entries).toBe(state.entries);
	expect(Model.canPreviewCommit(failed)).toBe(false);
	const clean = Model.reduce(failed, {
		type: "loaded",
		snapshot: repositorySnapshot(),
	});

	expect(clean.views.changes).toEqual({
		selectedId: null,
		selectedIds: [],
		anchorId: undefined,
		scrollY: 0,
	});
	expect(clean.includedFileIds).toEqual([]);
	expect(clean.commitMessage).toBe(state.commitMessage);
	expect(clean.error).toBeNull();
});

it("retains both index and worktree status, conflicts, renames, copies and type changes", () => {
	const snapshot = repositorySnapshot([
		changedFile("both.ts", { indexStatus: "modified" }),
		changedFile("renamed.ts", {
			indexStatus: "renamed",
			worktreeStatus: "unmodified",
			recordType: "renamed",
			originalPath: "old.ts",
		}),
		changedFile("conflict.ts", {
			indexStatus: "unmerged",
			worktreeStatus: "unmerged",
			recordType: "unmerged",
		}),
		changedFile("deleted.ts", { worktreeStatus: "deleted" }),
		changedFile("copied.ts", {
			indexStatus: "copied",
			worktreeStatus: "unmodified",
		}),
		changedFile("link", { worktreeStatus: "type-changed" }),
		changedFile("ignored", {
			recordType: "ignored",
			worktreeStatus: "ignored",
		}),
	]);

	const state = Model.reduce(Model.create(), { type: "loaded", snapshot });

	expect(state.entries.changes.map((file) => file.status)).toEqual([
		"M",
		"R",
		"U",
		"D",
		"C",
		"T",
	]);
	expect(state.entries.changes[0]?.statusDescription).toBe("modified");
	expect(state.entries.changes[1]?.statusDescription).toContain(
		"renamed from old.ts"
	);
	expect(state.includedFileIds).toEqual([]);
});

it("updates the requesting tab metadata for unborn and detached HEAD without moving activation", () => {
	const snapshot = repositorySnapshot();
	let state = Tabs.create(2);

	state = Tabs.reduce(state, {
		type: "workspace",
		id: "workspace-2",
		action: {
			type: "loaded",
			snapshot: {
				...snapshot,
				head: {
					...snapshot.head,
					branch: "new-branch",
					unborn: true,
					oid: null,
				},
			},
		},
	});
	expect(state.tabs[1]?.name).toBe("project");
	expect(state.tabs[1]?.branch).toBe("new-branch");
	expect(state.activeId).toBe("workspace-1");
	state = Tabs.reduce(state, {
		type: "workspace",
		id: "workspace-2",
		action: {
			type: "loaded",
			snapshot: {
				...snapshot,
				head: { ...snapshot.head, detached: true, branch: null },
			},
		},
	});
	expect(state.tabs[1]?.branch).toBe("detached 1234567");
});
