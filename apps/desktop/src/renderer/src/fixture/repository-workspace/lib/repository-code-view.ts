import type { CodeViewItem } from "@pierre/diffs";

import type { RepositoryDiffFileEntry } from "@/fixture/repository-workspace/lib/repository-diff-files.js";
import {
	getRepositoryDiffPreviewKind,
	type RepositoryDiffPreviewKind,
} from "@/fixture/repository-workspace/lib/repository-diff-preview.js";

type RepositoryPreviewKind = Exclude<RepositoryDiffPreviewKind, "text">;

export interface RepositoryCodeViewAnnotation {
	readonly itemId: string;
	readonly kind: "preview";
	readonly previewKind: RepositoryPreviewKind;
}

export const createRepositoryCodeViewItems = (
	entries: readonly RepositoryDiffFileEntry[],
	ignoreWhitespace: boolean
): readonly CodeViewItem<RepositoryCodeViewAnnotation>[] =>
	entries.map((entry) => {
		const previewKind = getRepositoryDiffPreviewKind({
			file: entry.file,
			ignoreWhitespace,
			patchOmittedReason: entry.patchOmittedReason,
			path: entry.path,
			stat: entry.stat,
		});
		if (previewKind === "text" && entry.file) {
			return {
				fileDiff: entry.file,
				id: entry.key,
				type: "diff",
				version: 0,
			};
		}
		const repositoryPreviewKind =
			previewKind === "text" ? "unsupported" : previewKind;
		return {
			annotations: [
				{
					lineNumber: 0,
					metadata: {
						itemId: entry.key,
						kind: "preview",
						previewKind: repositoryPreviewKind,
					},
				},
			],
			file: {
				cacheKey: `${entry.key}:preview`,
				contents: " ",
				name: entry.path,
			},
			id: entry.key,
			type: "file",
			version: 0,
		};
	});

export const getNextRepositoryCodeViewItemVersion = (
	item: CodeViewItem<unknown>
): number => (item.version ?? 0) + 1;
