import { describe, expect, test } from "bun:test";
import type { FileChange, FileStatus } from "@1git/git";
import {
	doesRepositoryFileContextMenuUseSelection,
	filterRepositoryFiles,
	getRepositoryDiffElementId,
	getRepositoryFileAtBoundedOffset,
	getRepositoryFileAtOffset,
	getRepositoryFilePosition,
	getRepositoryFileSelectionRunPaths,
	groupRepositoryFilesByStaging,
	hasRepositoryFileStageProjectionSettled,
	orderRepositoryFilesByPath,
	orderRepositoryFilesByStaging,
	shouldElevateRepositoryFileSelection,
	shouldStageRepositoryFileDrop,
	splitRepositoryFilePath,
	updateRepositoryFileSelection,
} from "../src/renderer/src/fixture/repository-workspace/lib/repository-navigation.js";

const fileChange = (
	path: string,
	indexStatus: FileStatus = "unmodified",
	worktreeStatus: FileStatus = "modified"
): FileChange => ({
	indexStatus,
	path,
	recordType: "ordinary",
	submodule: "N...",
	worktreeStatus,
});

const FILES = [
	fileChange("apps/desktop/app.tsx"),
	fileChange("packages/git/repository.ts", "modified", "unmodified"),
	fileChange("README.md"),
] as const;

describe("repository file navigation", () => {
	test("filters files without case sensitivity or surrounding whitespace", () => {
		expect(filterRepositoryFiles(FILES, " DESKTOP ")).toEqual([FILES[0]]);
		expect(filterRepositoryFiles(FILES, "")).toBe(FILES);
	});

	test("wraps forward and backward navigation", () => {
		expect(getRepositoryFileAtOffset(FILES, FILES[2].path, 1)).toBe(FILES[0]);
		expect(getRepositoryFileAtOffset(FILES, FILES[0].path, -1)).toBe(FILES[2]);
		expect(getRepositoryFileAtOffset(FILES, null, 1)).toBe(FILES[0]);
		expect(getRepositoryFileAtOffset([], null, 1)).toBeNull();
	});

	test("stops range navigation at the first and last visible file", () => {
		expect(
			getRepositoryFileAtBoundedOffset(FILES, FILES[0].path, -1)
		).toBeNull();
		expect(
			getRepositoryFileAtBoundedOffset(FILES, FILES[2].path, 1)
		).toBeNull();
		expect(getRepositoryFileAtBoundedOffset(FILES, FILES[1].path, -1)).toBe(
			FILES[0]
		);
		expect(getRepositoryFileAtBoundedOffset(FILES, FILES[1].path, 1)).toBe(
			FILES[2]
		);
	});

	test("reports one-based file positions", () => {
		expect(getRepositoryFilePosition(FILES, FILES[1].path)).toBe(2);
		expect(getRepositoryFilePosition(FILES, "missing.ts")).toBeNull();
	});

	test("orders files by path without grouping them by staging state", () => {
		const orderedPaths = orderRepositoryFilesByPath(FILES).map(
			(file) => file.path
		);
		const changedStaging = FILES.map((file) => ({
			...file,
			indexStatus:
				file.indexStatus === "unmodified"
					? ("modified" as const)
					: ("unmodified" as const),
		}));

		expect(orderedPaths).toEqual([
			"apps/desktop/app.tsx",
			"packages/git/repository.ts",
			"README.md",
		]);
		expect(
			orderRepositoryFilesByPath(changedStaging).map((file) => file.path)
		).toEqual(orderedPaths);
	});

	test("groups staged and unstaged files while sorting each group by path", () => {
		const groups = groupRepositoryFilesByStaging(FILES);

		expect(groups.conflicted).toEqual([]);
		expect(groups.staged.map((file) => file.path)).toEqual([
			"packages/git/repository.ts",
		]);
		expect(groups.unstaged.map((file) => file.path)).toEqual([
			"apps/desktop/app.tsx",
			"README.md",
		]);
		expect(
			orderRepositoryFilesByStaging(FILES).map((file) => file.path)
		).toEqual([
			"packages/git/repository.ts",
			"apps/desktop/app.tsx",
			"README.md",
		]);
	});

	test("keeps conflicted files in a distinct leading group", () => {
		const conflict = {
			...fileChange("src/conflicted.ts", "unmerged", "unmerged"),
			recordType: "unmerged" as const,
		};
		const groups = groupRepositoryFilesByStaging([...FILES, conflict]);

		expect(groups.conflicted).toEqual([conflict]);
		expect(groups.staged).toEqual([FILES[1]]);
		expect(
			orderRepositoryFilesByStaging([...FILES, conflict]).map(
				(file) => file.path
			)
		).toEqual([
			"src/conflicted.ts",
			"packages/git/repository.ts",
			"apps/desktop/app.tsx",
			"README.md",
		]);
	});

	test("only stages a dropped file when it changes groups", () => {
		expect(shouldStageRepositoryFileDrop(FILES[0], true)).toBe(true);
		expect(shouldStageRepositoryFileDrop(FILES[0], false)).toBeNull();
		expect(shouldStageRepositoryFileDrop(FILES[1], false)).toBe(false);
		expect(shouldStageRepositoryFileDrop(FILES[1], true)).toBeNull();
	});

	test("splits file names from their parent path", () => {
		expect(splitRepositoryFilePath("apps/desktop/app.tsx")).toEqual({
			directory: "apps/desktop/",
			name: "app.tsx",
		});
		expect(splitRepositoryFilePath("README.md")).toEqual({
			directory: "",
			name: "README.md",
		});
	});

	test("creates stable DOM identifiers for repository paths", () => {
		expect(getRepositoryDiffElementId("apps/desktop/app.tsx")).toBe(
			"repository-diff:apps%2Fdesktop%2Fapp.tsx"
		);
	});

	test("projects a file into its pending staging group", () => {
		const projectedStaged = groupRepositoryFilesByStaging(FILES, {
			path: FILES[0].path,
			staged: true,
		});
		const projectedUnstaged = groupRepositoryFilesByStaging(FILES, {
			path: FILES[1].path,
			staged: false,
		});

		expect(projectedStaged.staged.map((file) => file.path)).toEqual([
			"apps/desktop/app.tsx",
			"packages/git/repository.ts",
		]);
		expect(projectedStaged.unstaged.map((file) => file.path)).toEqual([
			"README.md",
		]);
		expect(projectedUnstaged.staged).toEqual([]);
		expect(projectedUnstaged.unstaged.map((file) => file.path)).toEqual([
			"apps/desktop/app.tsx",
			"packages/git/repository.ts",
			"README.md",
		]);
		expect(
			hasRepositoryFileStageProjectionSettled(FILES, {
				path: FILES[0].path,
				staged: true,
			})
		).toBe(false);
		expect(
			hasRepositoryFileStageProjectionSettled(projectedStaged.staged, {
				path: FILES[0].path,
				staged: true,
			})
		).toBe(false);
		expect(
			hasRepositoryFileStageProjectionSettled(
				[
					{
						...FILES[0],
						indexStatus: "modified",
						worktreeStatus: "unmodified",
					},
				],
				{ path: FILES[0].path, staged: true }
			)
		).toBe(true);
	});

	test("adds, removes, and ranges file selections in visual order", () => {
		const paths = FILES.map((file) => file.path);
		const added = updateRepositoryFileSelection({
			activePath: FILES[0].path,
			anchorPath: FILES[0].path,
			mode: "toggle",
			orderedPaths: paths,
			selectedPaths: new Set(),
			targetPath: FILES[2].path,
		});
		expect(added).toEqual({
			activePath: FILES[2].path,
			anchorPath: FILES[2].path,
			selectedPaths: [FILES[0].path, FILES[2].path],
		});

		const removed = updateRepositoryFileSelection({
			activePath: added.activePath,
			anchorPath: added.anchorPath,
			mode: "toggle",
			orderedPaths: paths,
			selectedPaths: new Set(added.selectedPaths),
			targetPath: FILES[2].path,
		});
		expect(removed).toEqual({
			activePath: FILES[0].path,
			anchorPath: FILES[2].path,
			selectedPaths: [],
		});

		const range = updateRepositoryFileSelection({
			activePath: FILES[0].path,
			anchorPath: FILES[0].path,
			mode: "range",
			orderedPaths: paths,
			selectedPaths: new Set(),
			targetPath: FILES[2].path,
		});
		expect(range.selectedPaths).toEqual(paths);
	});

	test("contracts and reverses a range around its fixed anchor", () => {
		const paths = FILES.map((file) => file.path);
		const expandedDown = updateRepositoryFileSelection({
			activePath: FILES[1].path,
			anchorPath: FILES[1].path,
			mode: "range",
			orderedPaths: paths,
			selectedPaths: new Set(),
			targetPath: FILES[2].path,
		});
		expect(expandedDown.selectedPaths).toEqual([FILES[1].path, FILES[2].path]);

		const contracted = updateRepositoryFileSelection({
			activePath: expandedDown.activePath,
			anchorPath: FILES[1].path,
			mode: "range",
			orderedPaths: paths,
			selectedPaths: new Set(expandedDown.selectedPaths),
			targetPath: FILES[1].path,
		});
		expect(contracted.selectedPaths).toEqual([]);

		const expandedUp = updateRepositoryFileSelection({
			activePath: contracted.activePath,
			anchorPath: FILES[1].path,
			mode: "range",
			orderedPaths: paths,
			selectedPaths: new Set(),
			targetPath: FILES[0].path,
		});
		expect(expandedUp.selectedPaths).toEqual([FILES[0].path, FILES[1].path]);
	});

	test("keeps a multi-selection only when its context menu target is selected", () => {
		const selectedPaths = new Set([FILES[0].path, FILES[2].path]);

		expect(
			doesRepositoryFileContextMenuUseSelection(FILES[2].path, selectedPaths)
		).toBe(true);
		expect(
			doesRepositoryFileContextMenuUseSelection(FILES[1].path, selectedPaths)
		).toBe(false);
		expect(
			doesRepositoryFileContextMenuUseSelection(
				FILES[0].path,
				new Set([FILES[0].path])
			)
		).toBe(false);
	});

	test("finds the contiguous selected run around a context-menu target", () => {
		const orderedPaths = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
		const selectedPaths = new Set(["a.ts", "c.ts", "d.ts", "e.ts"]);

		expect(
			getRepositoryFileSelectionRunPaths(orderedPaths, selectedPaths, "d.ts")
		).toEqual(["c.ts", "d.ts", "e.ts"]);
		expect(
			getRepositoryFileSelectionRunPaths(orderedPaths, selectedPaths, "b.ts")
		).toEqual([]);
	});

	test("elevates every selected row while its context menu is present", () => {
		expect(shouldElevateRepositoryFileSelection(true, true)).toBe(true);
		expect(shouldElevateRepositoryFileSelection(true, false)).toBe(false);
		expect(shouldElevateRepositoryFileSelection(false, true)).toBe(false);
	});
});
