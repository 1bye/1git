import { describe, expect, it } from "bun:test";
import type { FileChange } from "@1git/git";
import {
	combinePatches,
	groupChangedFiles,
	parseCliArguments,
	statusLabel,
} from "../src/model";

const fileChange = (
	path: string,
	indexStatus: FileChange["indexStatus"],
	worktreeStatus: FileChange["worktreeStatus"],
	recordType: FileChange["recordType"] = "ordinary"
): FileChange => ({
	indexStatus,
	path,
	recordType,
	submodule: "N...",
	worktreeStatus,
});

describe("parseCliArguments", () => {
	it("defaults to the current directory", () => {
		expect(parseCliArguments([], "/work/1git")).toEqual({
			repositoryPath: "/work/1git",
			screenshotPath: null,
		});
	});

	it("resolves a repository and screenshot path", () => {
		expect(
			parseCliArguments(
				["../fixture", "--screenshot", "shots/gpuix.png"],
				"/work/1git"
			)
		).toEqual({
			repositoryPath: "/work/fixture",
			screenshotPath: "/work/1git/shots/gpuix.png",
		});
	});

	it("rejects unknown options", () => {
		expect(() => parseCliArguments(["--wat"], "/work/1git")).toThrow(
			"Unknown option: --wat"
		);
	});
});

describe("groupChangedFiles", () => {
	it("keeps partially staged files in both groups", () => {
		const stagedOnly = fileChange("src/staged.ts", "modified", "unmodified");
		const unstagedOnly = fileChange(
			"src/unstaged.ts",
			"unmodified",
			"modified"
		);
		const partial = fileChange("src/partial.ts", "modified", "modified");
		const untracked = fileChange(
			"src/new.ts",
			"untracked",
			"untracked",
			"untracked"
		);

		expect(
			groupChangedFiles([stagedOnly, unstagedOnly, partial, untracked])
		).toEqual({
			stagedFiles: [stagedOnly, partial],
			unstagedFiles: [unstagedOnly, partial, untracked],
		});
	});
});

describe("native diff input", () => {
	it("joins staged and working patches without blank-only content", () => {
		expect(combinePatches(["staged\n\n", "", "working\n"])).toBe(
			"staged\nworking"
		);
	});

	it("maps Git statuses to compact labels", () => {
		expect(statusLabel("renamed")).toBe("R");
		expect(statusLabel("unmerged")).toBe("!");
	});
});
