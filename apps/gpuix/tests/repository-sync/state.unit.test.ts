/**
 * Covers: fetch locking, stale reads, draft/inclusion preservation, uncertainty and last-success status.
 * Real: workspace reducer.
 * Doubles: repository snapshots; no Git or native rendering.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { RepositoryWorkspaceModel as Model } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import {
	changedFile,
	repositorySnapshot,
} from "../_shared/repository-snapshot";

it("blocks competing updates while fetching and preserves drafts, inclusion and uncertain-commit guards afterward", () => {
	const snapshot = repositorySnapshot([
		changedFile("a.ts"),
		changedFile("b.ts"),
	]);

	let state = Model.reduce(Model.create(), { type: "loaded", snapshot });

	state = Model.reduce(state, { type: "edit-commit-message", value: "Draft" });
	state = Model.reduce(state, {
		type: "include-file",
		id: "b.ts",
		included: false,
	});
	state = Model.reduce(state, {
		type: "commit-failed",
		message: "Inspect History",
		uncertain: true,
	});
	const pending = Model.reduce(state, { type: "sync-started", kind: "fetch" });

	expect(Model.isBusy(pending)).toBe(true);
	expect(Model.canCommit(pending)).toBe(false);
	expect(
		Model.reduce(pending, { type: "loaded", snapshot: repositorySnapshot() })
	).toBe(pending);
	expect(
		Model.reduce(pending, { type: "load-error", message: "Old read failed" })
	).toBe(pending);
	const finished = Model.reduce(pending, {
		type: "sync-finished",
		snapshot,
		error: null,
		fetchedAt: 1000,
	});

	expect(Model.isBusy(finished)).toBe(false);
	expect(finished.commitMessage).toBe("Draft");
	expect(finished.includedFileIds).toEqual(["a.ts"]);
	expect(finished.commit.needsReview).toBe(true);
	expect(Model.canCommit(finished)).toBe(false);
	expect(finished.sync).toEqual({
		pending: null,
		notice: null,
		error: null,
		fetchedAt: 1000,
		version: 1,
	});
});

it("retains the last successful fetch time across failures, clears errors on retry and resets for a different repository", () => {
	const snapshot = repositorySnapshot();
	let state = Model.reduce(Model.create(), { type: "loaded", snapshot });

	state = Model.reduce(state, {
		type: "sync-finished",
		error: null,
		fetchedAt: 1000,
	});
	state = Model.reduce(state, { type: "sync-started", kind: "fetch" });
	state = Model.reduce(state, {
		type: "sync-finished",
		error: "Fetch failed",
		fetchedAt: null,
		refreshError: "Refresh failed",
	});
	expect(state.sync).toEqual({
		pending: null,
		notice: null,
		error: "Fetch failed",
		fetchedAt: 1000,
		version: 2,
	});
	expect(state.error).toBe("Refresh failed");
	state = Model.reduce(state, { type: "sync-started", kind: "fetch" });
	expect(state.sync.error).toBeNull();
	state = Model.reduce(state, {
		type: "sync-finished",
		error: null,
		fetchedAt: 2000,
		snapshot,
	});
	expect(state.error).toBeNull();
	state = Model.reduce(state, {
		type: "loaded",
		snapshot: {
			...snapshot,
			repository: { ...snapshot.repository, root: "/test/other" },
		},
	});
	expect(state.sync).toEqual({
		pending: null,
		notice: null,
		error: null,
		fetchedAt: null,
		version: 0,
	});
});
