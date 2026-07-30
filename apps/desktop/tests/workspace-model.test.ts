import { describe, expect, test } from "bun:test";
import type { FileChange, FileStatus } from "@1git/git";
import {
	areAllFilesStaged,
	formatRelativeTime,
	getFileChangeLabel,
	getRepositoryName,
	getWorkspaceLabel,
	isFilePartiallyStaged,
	isFileStaged,
	matchesFileFilter,
} from "../src/renderer/src/workspace-model.js";

const fileChange = (
	path: string,
	indexStatus: FileStatus,
	worktreeStatus: FileStatus,
	recordType: FileChange["recordType"] = "ordinary"
): FileChange => ({
	indexStatus,
	path,
	recordType,
	submodule: "N...",
	worktreeStatus,
});

describe("workspace file presentation", () => {
	test("distinguishes staged, unstaged, and partially staged files", () => {
		const unstaged = fileChange("src/unstaged.ts", "unmodified", "modified");
		const staged = fileChange("src/staged.ts", "modified", "unmodified");
		const partial = fileChange("src/partial.ts", "modified", "modified");

		expect(isFileStaged(unstaged)).toBe(false);
		expect(isFileStaged(staged)).toBe(true);
		expect(isFilePartiallyStaged(staged)).toBe(false);
		expect(isFilePartiallyStaged(partial)).toBe(true);
		expect(areAllFilesStaged([staged, partial])).toBe(true);
		expect(areAllFilesStaged([staged, unstaged])).toBe(false);
	});

	test("treats untracked files as unstaged until Git adds them", () => {
		const untracked = fileChange(
			"new-file.ts",
			"untracked",
			"untracked",
			"untracked"
		);

		expect(isFileStaged(untracked)).toBe(false);
		expect(getFileChangeLabel(untracked)).toBe("?");
	});

	test("prefers the working tree status for the visible change label", () => {
		expect(
			getFileChangeLabel(fileChange("src/file.ts", "modified", "deleted"))
		).toBe("D");
		expect(
			getFileChangeLabel(fileChange("src/file.ts", "added", "unmodified"))
		).toBe("A");
	});

	test("filters paths without case sensitivity or surrounding whitespace", () => {
		const file = fileChange("Apps/Desktop/App.tsx", "unmodified", "modified");

		expect(matchesFileFilter(file, " desktop ")).toBe(true);
		expect(matchesFileFilter(file, "packages")).toBe(false);
	});
});

describe("workspace labels", () => {
	test("finds repository names across POSIX and Windows paths", () => {
		expect(getRepositoryName("/Users/example/one-git/")).toBe("one-git");
		expect(getRepositoryName("C:\\Work\\one-git\\")).toBe("one-git");
	});

	test("labels workspace tabs with repository and branch identity", () => {
		expect(getWorkspaceLabel("/Users/example/one-git", "feature/tabs")).toBe(
			"one-git / feature/tabs"
		);
		expect(getWorkspaceLabel("/Users/example/one-git", null)).toBe("one-git");
	});

	test("formats nearby timestamps for compact desktop chrome", () => {
		const now = Date.parse("2026-07-29T18:00:00.000Z");

		expect(formatRelativeTime("2026-07-29T17:59:40.000Z", now)).toBe(
			"just now"
		);
		expect(formatRelativeTime("2026-07-29T16:00:00.000Z", now)).toBe(
			"2 hours ago"
		);
		expect(formatRelativeTime("2026-07-30T18:00:00.000Z", now)).toBe(
			"tomorrow"
		);
	});

	test("leaves invalid timestamp labels intact", () => {
		expect(formatRelativeTime("recently")).toBe("recently");
	});
});
