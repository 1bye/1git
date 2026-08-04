import { describe, expect, test } from "bun:test";
import type { FileChange, FileDiff } from "@1git/git";
import {
	createExpandableRepositoryDiffFile,
	createRepositoryDiffFileEntries,
} from "../src/renderer/src/fixture/workspace-content/lib/repository-diff-files.js";

const fullFilePatch = (
	replacement: string
): string => `diff --git a/app.ts b/app.ts
index 0000000..1111111 100644
--- a/app.ts
+++ b/app.ts
@@ -1,5 +1,5 @@
 one
 two
-three
+${replacement}
 four
 five
`;

const createDiff = (patch: string): FileDiff => ({
	patch,
	stats: [
		{
			addedLines: 1,
			deletedLines: 1,
			path: "app.ts",
		},
	],
	target: { kind: "working" },
});

const missingFile: FileChange = {
	indexStatus: "unmodified",
	path: "binary.png",
	recordType: "ordinary",
	submodule: "N...",
	worktreeStatus: "untracked",
};

describe("repository diff files", () => {
	test("creates entries with stable targets and missing binary files", () => {
		const entries = createRepositoryDiffFileEntries(
			[createDiff(fullFilePatch("THREE"))],
			[missingFile],
			undefined,
			"changes"
		);

		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			path: "app.ts",
			target: { kind: "working" },
			targetLabel: "Working tree",
		});
		expect(entries[1]).toMatchObject({
			file: null,
			path: "binary.png",
			target: { kind: "working" },
		});
	});

	test("invalidates parsed file keys when a working patch changes", () => {
		const first = createRepositoryDiffFileEntries(
			[createDiff(fullFilePatch("THREE"))],
			[],
			undefined,
			"changes"
		);
		const second = createRepositoryDiffFileEntries(
			[createDiff(fullFilePatch("OTHER"))],
			[],
			undefined,
			"changes"
		);

		expect(first[0]?.key).not.toBe(second[0]?.key);
	});

	test("upgrades a full-context patch for native hunk expansion", () => {
		const file = createExpandableRepositoryDiffFile(
			createDiff(fullFilePatch("THREE")),
			"app.ts",
			"app.ts:expanded"
		);

		expect(file).not.toBeNull();
		expect(file?.isPartial).toBe(false);
		expect(file?.additionLines).toHaveLength(5);
		expect(file?.deletionLines).toHaveLength(5);
	});
});
