/**
 * Covers: folder ownership, path boundaries, favorites and backward-compatible session intent.
 * Real: library grouping/preferences and session serializer.
 * Doubles: none.
 * Requires: Bun; no filesystem, network or native renderer.
 */
import { expect, it } from "bun:test";
import { RepositoryLibrary } from "../../src/feature/repository-discovery/repository-library";
import { WorkspaceSession } from "../../src/feature/workspace-tabs/lib/workspace-session";
import { WorkspaceTabsModel } from "../../src/feature/workspace-tabs/lib/workspace-tabs-model";

it("assigns overlapping roots to the deepest folder without duplicates or prefix collisions", () => {
	const groups = RepositoryLibrary.groups(
		[
			"/Work/api",
			"/Work/personal/site",
			"/Work/api",
			"/Work2/app",
			"/elsewhere/repo",
			"/Work",
		],
		[
			{ path: "/Work", canonicalPath: "/Work" },
			{ path: "/Work/personal", canonicalPath: "/Work/personal" },
			{ path: "/Volumes/Offline", canonicalPath: "/Volumes/Offline" },
		]
	);

	expect(groups.map(({ id, paths }) => [id, paths])).toEqual([
		["/Work", ["/Work/api", "/Work"]],
		["/Work/personal", ["/Work/personal/site"]],
		["/Volumes/Offline", []],
		["other", ["/Work2/app", "/elsewhere/repo"]],
	]);
});

it("uses canonical roots but keeps the saved folder identity and name", () => {
	expect(
		RepositoryLibrary.groups(
			["/real/work/repo"],
			[{ path: "/alias/Work", canonicalPath: "/real/work" }]
		)
	).toEqual([
		{
			id: "/alias/Work",
			path: "/alias/Work",
			name: "Work",
			paths: ["/real/work/repo"],
		},
	]);
});

it("validates local intent and adds/removes favorites idempotently", () => {
	expect(
		RepositoryLibrary.preferences({
			starred: ["relative", "/bad\0", "/Work/repo/", "/Work/repo/"],
			view: "oops",
			folder: "relative",
		})
	).toEqual({ starred: ["/Work/repo/"], view: "tiles" });
	const prefs = RepositoryLibrary.preferences(undefined);
	const added = RepositoryLibrary.star(prefs, "/Work/repo", true);

	expect(RepositoryLibrary.star(added, "/Work/repo", true).starred).toEqual([
		"/Work/repo",
	]);
	expect(RepositoryLibrary.star(added, "/Work/repo", false)).toEqual(prefs);
});

it("round-trips stars/view/location without scan results or changing legacy defaults", () => {
	const state = WorkspaceTabsModel.create(0, false);
	const capture = WorkspaceSession.capture(state);

	expect(capture.repositoryLibrary).toBeUndefined();
	expect(
		WorkspaceSession.parse(JSON.stringify(capture)).repositoryLibrary
	).toBeUndefined();
	const library = {
		starred: ["/Work/repo"],
		view: "list" as const,
		folder: "/Work",
	};

	const saved = WorkspaceSession.capture(
		state,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		library
	);

	expect(
		WorkspaceSession.parse(JSON.stringify(saved)).repositoryLibrary
	).toEqual(library);
	expect(JSON.stringify(saved)).not.toContain("scanned");
});

it("migrates the former repository filters to tiles without dropping stars or folder selection", () => {
	for (const view of ["listed", "starred"]) {
		expect(
			RepositoryLibrary.preferences({
				view,
				starred: ["/Work/api"],
				folder: "/Work",
			})
		).toEqual({ view: "tiles", starred: ["/Work/api"], folder: "/Work" });
	}
});

it("retains a saved list layout even without stars or a selected folder", () => {
	const library = RepositoryLibrary.preferences({ view: "list" });

	expect(RepositoryLibrary.isDefault(library)).toBe(false);
	expect(
		WorkspaceSession.parse(
			JSON.stringify({
				version: 1,
				tabs: [],
				activeId: null,
				repositoryLibrary: library,
			})
		).repositoryLibrary
	).toEqual({ view: "list", starred: [] });
});
