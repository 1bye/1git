import { describe, expect, it } from "bun:test";

import { parsePatchFiles } from "@pierre/diffs";

import {
	createRepositoryCodeViewItems,
	getNextRepositoryCodeViewItemVersion,
} from "@/fixture/repository-workspace/lib/repository-code-view.js";
import type { RepositoryDiffFileEntry } from "@/fixture/repository-workspace/lib/repository-diff-files.js";

const textFile = parsePatchFiles(
	`diff --git a/app.ts b/app.ts
index 1111111..2222222 100644
--- a/app.ts
+++ b/app.ts
@@ -1 +1 @@
-const value = 1;
+const value = 2;
`
)[0]?.files[0];

const createEntry = (
	path: string,
	file: RepositoryDiffFileEntry["file"]
): RepositoryDiffFileEntry => ({
	change: null,
	file,
	id: undefined,
	key: path,
	patchOmittedReason: undefined,
	path,
	stat: file
		? { addedLines: 1, deletedLines: 1, path }
		: { addedLines: null, deletedLines: null, path },
	target: { kind: "working" },
	targetLabel: "Working tree",
});

describe("repository CodeView items", () => {
	it("maps text entries to native diff items", () => {
		if (!textFile) {
			throw new Error("Expected the fixture patch to contain a file");
		}

		const [item] = createRepositoryCodeViewItems(
			[createEntry("app.ts", textFile)],
			false
		);

		expect(item?.type).toBe("diff");

		if (item?.type === "diff") {
			expect(item.fileDiff).toBe(textFile);
		}
	});

	it("maps non-text entries to file-level preview annotations", () => {
		const [item] = createRepositoryCodeViewItems(
			[createEntry("asset.bin", null)],
			false
		);

		expect(item?.type).toBe("file");

		if (item?.type === "file") {
			expect(item.annotations?.[0]).toMatchObject({
				lineNumber: 0,
				metadata: { kind: "preview", previewKind: "binary" },
			});
		}
	});

	it("increments item versions for imperative updates", () => {
		expect(
			getNextRepositoryCodeViewItemVersion({
				file: { contents: "", name: "app.ts" },
				id: "app.ts",
				type: "file",
			})
		).toBe(1);
		expect(
			getNextRepositoryCodeViewItemVersion({
				file: { contents: "", name: "app.ts" },
				id: "app.ts",
				type: "file",
				version: 4,
			})
		).toBe(5);
	});
});
