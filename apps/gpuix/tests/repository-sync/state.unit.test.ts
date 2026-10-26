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
		id: "a.ts",
		included: true,
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

it("keeps account recovery only with its failed sync and clears it on retry, success or repository replacement", () => {
	const snapshot = repositorySnapshot();
	const loaded = Model.reduce(Model.create(), { type: "loaded", snapshot });

	const accountAccess = {
		message: "Check permissions.",
		accountKey: "fixture",
	};

	const failed = Model.reduce(loaded, {
		type: "sync-finished",
		error: accountAccess.message,
		accountAccess,
		fetchedAt: null,
	});

	expect(failed.sync.accountAccess).toEqual(accountAccess);
	const acknowledged = Model.reduce(failed, { type: "sync-error-dismissed" });

	expect(acknowledged.sync.error).toBeNull();
	expect(acknowledged.sync.accountAccess).toBeUndefined();
	expect(acknowledged.sync.version).toBe(failed.sync.version);
	expect(acknowledged.sync.notice).toBeNull();
	const pending = Model.reduce(failed, { type: "sync-started", kind: "fetch" });

	expect(Model.reduce(pending, { type: "sync-error-dismissed" })).toBe(pending);
	expect(
		Model.reduce(failed, { type: "loaded", snapshot, automatic: true }).sync
			.accountAccess
	).toEqual(accountAccess);
	expect(
		Model.reduce(failed, { type: "sync-started", kind: "fetch" }).sync
			.accountAccess
	).toBeUndefined();
	expect(
		Model.reduce(failed, {
			type: "sync-finished",
			error: null,
			accountAccess,
			fetchedAt: 1,
		}).sync.accountAccess
	).toBeUndefined();
	expect(
		Model.reduce(failed, {
			type: "loaded",
			snapshot: {
				...snapshot,
				repository: { ...snapshot.repository, root: "/test/other" },
			},
		}).sync.accountAccess
	).toBeUndefined();
});

it("accepts progress only while busy, deduplicates it, and drops it after completion or retry", () => {
	const loaded = Model.reduce(Model.create(), {
		type: "loaded",
		snapshot: repositorySnapshot(),
	});

	const progress = { phase: "sending", percent: 45 } as const;
	const action = { type: "sync-progress", progress } as const;

	expect(Model.reduce(loaded, action)).toBe(loaded);
	const pending = Model.reduce(loaded, { type: "sync-started", kind: "sync" });
	const updated = Model.reduce(pending, action);

	expect(updated.sync.progress).toEqual(progress);
	expect(Model.reduce(updated, action)).toBe(updated);
	expect(updated.entries).toBe(pending.entries);
	const finished = Model.reduce(updated, {
		type: "sync-finished",
		error: null,
		fetchedAt: 1,
	});

	expect(finished.sync.progress).toBeUndefined();
	expect(Model.reduce(finished, action)).toBe(finished);
	expect(
		Model.reduce(updated, { type: "sync-started", kind: "sync" }).sync.progress
	).toEqual({ phase: "connecting", percent: null });
});
