import type { CommitInfo, CommitPage } from "@1git/git";
import type { WorkspaceEntry } from "../../src/feature/repository-workspace/types";

export const commitInfo = (index = 0): CommitInfo => ({
	oid: index.toString(16).padStart(40, "a"),
	summary: `Commit ${index}`,
	body: `Commit ${index}\n\nDetails for commit ${index}`,
	author: { name: "Test Author", email: "author@example.invalid" },
	committer: { name: "Test Author", email: "author@example.invalid" },
	authoredAt: "2026-09-26T12:00:00Z",
	committedAt: "2026-09-26T12:00:00Z",
	parentOids: [],
});

export const historyPage = (
	offset = 0,
	count = 12,
	hasMore = false
): CommitPage => ({
	commits: Array.from({ length: count }, (_, index) =>
		commitInfo(offset + index)
	),
	hasMore,
	nextOffset: hasMore ? offset + count : null,
});

export const committedFiles = (
	commit: string,
	count = 18
): readonly WorkspaceEntry[] =>
	Array.from({ length: count }, (_, index) => {
		const path = `src/file-${index}.ts`;

		return {
			id: path,
			title: path,
			status: "M",
			commitFile: {
				path,
				status: "M",
				beforeOid: "b".repeat(40),
				afterOid: "c".repeat(40),
				commit,
			},
		};
	});

export const emptyHistory = async () => ({
	ok: true as const,
	value: historyPage(0, 0),
});
