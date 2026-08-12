import { describe, expect, test } from "bun:test";
import type { FileDiff } from "@1git/git";
import { getRepositoryRevisionPresentation } from "../src/renderer/src/feature/workspace/lib/repository-revision-presentation.js";

const DIFF: FileDiff = {
	patch: "",
	stats: [
		{
			addedLines: 2,
			deletedLines: 1,
			path: "src/app.ts",
		},
	],
	target: { kind: "commit", revision: "commit-1" },
};

describe("repository revision presentation", () => {
	test("keeps the current presentation when a requested diff is stale", () => {
		expect(getRepositoryRevisionPresentation("commit", "commit-2", null)).toBe(
			null
		);
	});

	test("publishes revision ownership and its first file together", () => {
		expect(
			getRepositoryRevisionPresentation("commit", "commit-1", DIFF)
		).toEqual({
			diff: DIFF,
			selectedCommitOid: "commit-1",
			selectedFilePath: "src/app.ts",
			selectedStashOid: null,
		});
		expect(getRepositoryRevisionPresentation("stash", "stash-1", DIFF)).toEqual(
			{
				diff: DIFF,
				selectedCommitOid: null,
				selectedFilePath: "src/app.ts",
				selectedStashOid: "stash-1",
			}
		);
	});
});
