import { describe, expect, test } from "bun:test";

import { parsePatchFiles } from "@pierre/diffs";

import {
	getRepositoryDiffPreviewKind,
	getRepositoryImageMimeType,
	getRepositoryImagePreviewSources,
} from "../src/renderer/src/fixture/repository-workspace/lib/repository-diff-preview.js";

const BINARY_IMAGE_PATCH = `diff --git a/image.png b/image.png
index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644
Binary files a/image.png and b/image.png differ
`;

const imageFile = parsePatchFiles(BINARY_IMAGE_PATCH, "image", true)[0]
	?.files[0];

describe("repository diff previews", () => {
	test("classifies useful non-text preview states", () => {
		expect(getRepositoryImageMimeType("assets/preview.PNG")).toBe("image/png");
		expect(getRepositoryImageMimeType("assets/vector.svg")).toBeNull();
		expect(
			getRepositoryDiffPreviewKind({
				file: imageFile ?? null,
				ignoreWhitespace: false,
				patchOmittedReason: undefined,
				path: "image.png",
				stat: { addedLines: null, deletedLines: null, path: "image.png" },
			})
		).toBe("image");
		expect(
			getRepositoryDiffPreviewKind({
				file: null,
				ignoreWhitespace: false,
				patchOmittedReason: undefined,
				path: "archive.bin",
				stat: { addedLines: null, deletedLines: null, path: "archive.bin" },
			})
		).toBe("binary");
		expect(
			getRepositoryDiffPreviewKind({
				file: null,
				ignoreWhitespace: false,
				patchOmittedReason: "too-large",
				path: "generated.txt",
				stat: { addedLines: 30_000, deletedLines: 0, path: "generated.txt" },
			})
		).toBe("large");
		expect(
			getRepositoryDiffPreviewKind({
				file: null,
				ignoreWhitespace: true,
				patchOmittedReason: undefined,
				path: "formatted.ts",
				stat: null,
			})
		).toBe("ignored-whitespace");
	});

	test("derives image versions from parsed objects and the worktree", () => {
		expect(imageFile).toBeDefined();
		expect(
			getRepositoryImagePreviewSources(
				imageFile ?? null,
				{ kind: "staged" },
				null
			)
		).toEqual({
			after: {
				kind: "object",
				objectId: "2222222222222222222222222222222222222222",
			},
			before: {
				kind: "object",
				objectId: "1111111111111111111111111111111111111111",
			},
		});
		expect(
			getRepositoryImagePreviewSources(
				imageFile ?? null,
				{ kind: "working" },
				null
			)
		).toMatchObject({ after: { kind: "working" } });
	});
});
