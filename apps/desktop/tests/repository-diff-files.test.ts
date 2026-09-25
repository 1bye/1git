import { describe, expect, test } from "bun:test";

import type { FileChange, FileDiff } from "@1git/git";
import { DiffHunksRenderer } from "@pierre/diffs";

import { REPOSITORY_DIFF_RENDER_OPTIONS } from "../src/renderer/src/fixture/repository-workspace/constants/repository-diff.js";
import {
	createExpandableRepositoryDiffFile,
	createRepositoryDiffFileEntries,
	getRepositoryRevisionFileStatus,
	getSelectedRepositoryDiffEntryKey,
} from "../src/renderer/src/fixture/repository-workspace/lib/repository-diff-files.js";

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

const fullFilePatchWithSeparatedChanges = `diff --git a/app.ts b/app.ts
index 0000000..1111111 100644
--- a/app.ts
+++ b/app.ts
@@ -1,16 +1,16 @@
 one
-two
+TWO
 three
 four
 five
 six
 seven
 eight
 nine
 ten
 eleven
 twelve
 thirteen
 fourteen
-fifteen
+FIFTEEN
 sixteen
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
			change: missingFile,
			file: null,
			path: "binary.png",
			target: { kind: "working" },
		});
	});

	test("keeps missing staged previews attached to the index", () => {
		const stagedFile = {
			...missingFile,
			indexStatus: "modified",
			worktreeStatus: "unmodified",
		} as const;
		const entries = createRepositoryDiffFileEntries(
			[
				{
					patch: "",
					patchOmittedReason: "too-large",
					stats: [],
					target: { kind: "staged" },
				},
			],
			[stagedFile],
			undefined,
			"changes"
		);

		expect(entries[0]).toMatchObject({
			patchOmittedReason: "too-large",
			target: { kind: "staged" },
			targetLabel: "Staged",
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

	test("keeps stash revision file keys scoped to the selected stash", () => {
		const diff = {
			...createDiff(fullFilePatch("THREE")),
			target: {
				base: "stash-one^1",
				head: "stash-one",
				kind: "range",
			},
		} as const;
		const first = createRepositoryDiffFileEntries(
			[diff],
			[],
			"stash-one",
			"stashes"
		);
		const second = createRepositoryDiffFileEntries(
			[diff],
			[],
			"stash-two",
			"stashes"
		);

		expect(first).toHaveLength(1);
		expect(first[0]?.key).not.toBe(second[0]?.key);
		expect(first[0]?.targetLabel).toBe("Stash");
		expect(first[0]?.target).toEqual({
			base: "stash-one^1",
			head: "stash-one",
			kind: "range",
		});
	});

	test("matches rename statistics by current and original path", () => {
		const diff = {
			patch: `diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
index 1111111..2222222 100644
--- a/old.ts
+++ b/new.ts
@@ -1 +1 @@
-old
+new
`,
			stats: [
				{
					addedLines: 1,
					deletedLines: 1,
					originalPath: "old.ts",
					path: "new.ts",
				},
			],
			target: { kind: "working" },
		} as const satisfies FileDiff;

		const [entry] = createRepositoryDiffFileEntries(
			[diff],
			[],
			undefined,
			"changes"
		);

		expect(entry?.stat).toBe(diff.stats[0]);
	});

	test("maps parsed revision changes to the shared file status language", () => {
		const modified = createRepositoryDiffFileEntries(
			[createDiff(fullFilePatch("THREE"))],
			[],
			"commit-one",
			"history"
		)[0]?.file;

		expect(getRepositoryRevisionFileStatus(modified ?? null)).toBe("modified");
		expect(getRepositoryRevisionFileStatus(null)).toBe("modified");
	});

	test("prioritizes only the selected diff entry", () => {
		const entries = createRepositoryDiffFileEntries(
			[createDiff(fullFilePatch("THREE"))],
			[],
			"commit-one",
			"history"
		);

		expect(getSelectedRepositoryDiffEntryKey(entries, "app.ts")).toBe(
			entries[0]?.key ?? null
		);
		expect(getSelectedRepositoryDiffEntryKey(entries, "missing.ts")).toBeNull();
		expect(getSelectedRepositoryDiffEntryKey(entries, null)).toBeNull();
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

	test("keeps full file contents collapsed for incremental expansion", () => {
		const file = createExpandableRepositoryDiffFile(
			createDiff(fullFilePatchWithSeparatedChanges),
			"app.ts",
			"app.ts:expanded"
		);

		expect(file).not.toBeNull();
		expect(file?.isPartial).toBe(false);
		expect(file?.additionLines).toHaveLength(16);
		expect(file?.hunks).toHaveLength(2);
		expect(file?.hunks[1]?.collapsedBefore).toBe(6);
		expect(REPOSITORY_DIFF_RENDER_OPTIONS).toMatchObject({
			expandUnchanged: false,
			expansionLineCount: 20,
		});
	});

	test("expands uncounted context twenty lines at a time", () => {
		const renderer = new DiffHunksRenderer(REPOSITORY_DIFF_RENDER_OPTIONS);

		renderer.expandHunk(1, "down");
		expect(renderer.getExpandedHunk(1)).toEqual({
			fromEnd: 20,
			fromStart: 0,
		});

		renderer.expandHunk(1, "down");
		expect(renderer.getExpandedHunk(1)).toEqual({
			fromEnd: 40,
			fromStart: 0,
		});
	});
});
