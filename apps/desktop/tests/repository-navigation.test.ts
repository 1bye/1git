import { describe, expect, test } from "bun:test";
import type { FileChange, FileStatus } from "@1git/git";
import {
	filterRepositoryFiles,
	getRepositoryDiffElementId,
	getRepositoryFileAtOffset,
	getRepositoryFilePosition,
	groupRepositoryFiles,
	splitRepositoryFilePath,
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

	test("reports one-based file positions", () => {
		expect(getRepositoryFilePosition(FILES, FILES[1].path)).toBe(2);
		expect(getRepositoryFilePosition(FILES, "missing.ts")).toBeNull();
	});

	test("groups staged and unstaged files in their original order", () => {
		const groups = groupRepositoryFiles(FILES);

		expect(groups.staged).toEqual([FILES[1]]);
		expect(groups.unstaged).toEqual([FILES[0], FILES[2]]);
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
});
