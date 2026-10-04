/**
 * Covers: stash identity, automatic file selection, cache/scroll preservation and refresh invalidation.
 * Real: workspace reducer and stash presentation mapping.
 * Doubles: explicit snapshots and saved file lists.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { RepositoryWorkspaceModel as Model } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { repositorySnapshot } from "../_shared/repository-snapshot";
import { committedFiles } from "../_shared/history-page";
import { stashList } from "../_shared/stash-list";

it("keeps cached files and selection by OID after renumbering, selects the next stash after removal, and clears an empty list", () => {
	const snapshot = repositorySnapshot();
	const root = snapshot.repository.root;
	const stashes = stashList();
	const oid = stashes[0]?.oid ?? "";
	let state = Model.reduce(Model.create(), { type: "loaded", snapshot });
	const generation = state.stashes.generation;

	state = Model.reduce(state, {
		type: "stashes-loaded",
		root,
		generation,
		stashes,
	});
	state = Model.reduce(state, {
		type: "stash-files",
		root,
		generation,
		oid,
		files: committedFiles(oid),
	});
	expect(state.views.stashes.files.selectedId).toBe("src/file-0.ts");
	state = Model.reduce(state, {
		type: "select-revision-file",
		view: "stashes",
		id: "src/file-3.ts",
	});
	state = Model.reduce(state, {
		type: "scroll-revision-files",
		view: "stashes",
		revisionId: state.views.stashes.selectedId,
		y: -90,
	});
	state = Model.reduce(state, { type: "scroll", view: "stashes", y: -120 });
	const previous = state.views.stashes;

	state = Model.reduce(state, { type: "loaded", snapshot });
	expect(state.stashes.loaded).toBe(false);
	expect(
		Model.reduce(state, {
			type: "stashes-loaded",
			root,
			generation,
			stashes: [],
		})
	).toBe(state);
	expect(
		Model.reduce(state, {
			type: "stash-files",
			root,
			generation,
			oid,
			files: [],
		})
	).toBe(state);
	state = Model.reduce(state, {
		type: "stashes-loaded",
		root,
		generation: state.stashes.generation,
		stashes: stashes.map((stash, index) => ({
			...stash,
			reference: `stash@{${index + 1}}`,
		})),
	});
	expect(state.views.stashes).toEqual(previous);
	expect(Model.revision(state, "stashes")?.filesLoaded).toBe(true);
	expect(Model.revision(state, "stashes")?.detail).toContain("stash@{1}");
	expect(Model.revision(state, "stashes")?.title).toContain("feature/tabs");

	state = Model.reduce(state, {
		type: "select",
		view: "stashes",
		id: stashes[1]?.oid ?? "",
	});
	expect(state.views.stashes.files.selectedId).toBeNull();
	state = Model.reduce(state, { type: "select", view: "stashes", id: oid });
	expect(state.views.stashes.files).toEqual({
		selectedId: "src/file-0.ts",
		scrollY: 0,
	});
	state = Model.reduce(state, {
		type: "stashes-loaded",
		root,
		generation: state.stashes.generation,
		stashes: stashes.slice(1),
	});
	expect(state.views.stashes.selectedId).toBe(stashes[1]?.oid ?? "");
	expect(state.views.stashes.files.selectedId).toBeNull();
	state = Model.reduce(state, {
		type: "stashes-loaded",
		root,
		generation: state.stashes.generation,
		stashes: [],
	});
	expect(state.views.stashes.selectedId).toBeNull();
	expect(state.views.stashes.scrollY).toBe(0);
});

it("isolates file failures and late reads, and drops another repository's stash cache", () => {
	const snapshot = repositorySnapshot();
	const root = snapshot.repository.root;
	const stashes = stashList();
	const oid = stashes[0]?.oid ?? "";
	const other = stashes[1]?.oid ?? "";
	let state = Model.reduce(Model.create(), { type: "loaded", snapshot });
	const generation = state.stashes.generation;

	state = Model.reduce(state, {
		type: "stashes-loaded",
		root,
		generation,
		stashes,
	});
	state = Model.reduce(state, { type: "select", view: "stashes", id: other });
	state = Model.reduce(state, {
		type: "stash-files",
		root,
		generation,
		oid,
		files: committedFiles(oid),
	});
	expect(state.views.stashes.files.selectedId).toBeNull();
	state = Model.reduce(state, {
		type: "stash-files-error",
		root,
		generation,
		oid: other,
		message: "Read failed",
	});
	expect(Model.revision(state, "stashes")?.filesError).toBe("Read failed");
	state = Model.reduce(state, {
		type: "stash-files",
		root,
		generation,
		oid: other,
		files: [],
	});
	expect(Model.revision(state, "stashes")?.filesError).toBeUndefined();
	expect(state.views.stashes.files.selectedId).toBeNull();
	state = Model.reduce(state, { type: "loading" });
	expect(
		Model.reduce(state, {
			type: "stashes-loaded",
			root,
			generation,
			stashes: [],
		})
	).toBe(state);
	state = Model.reduce(state, {
		type: "loaded",
		snapshot: {
			...snapshot,
			repository: { ...snapshot.repository, root: "/another" },
		},
	});
	expect(state.entries.stashes).toEqual([]);
	expect(state.views.stashes.selectedId).toBeNull();
	expect(
		Model.reduce(state, {
			type: "stashes-error",
			root,
			generation: state.stashes.generation,
			message: "Obsolete",
		})
	).toBe(state);
});
