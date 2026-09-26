import type { FileChange, RepositorySnapshot } from "@1git/git";

export const changedFile = (
	path: string,
	overrides: Partial<FileChange> = {}
): FileChange => ({
	path,
	indexStatus: "unmodified",
	worktreeStatus: "modified",
	recordType: "ordinary",
	submodule: "N...",
	...overrides,
});

export const repositorySnapshot = (
	files: readonly FileChange[] = []
): RepositorySnapshot => ({
	files,
	head: {
		branch: "main",
		oid: "1234567890abcdef",
		detached: false,
		unborn: false,
		upstream: null,
		ahead: 0,
		behind: 0,
	},
	repository: {
		root: "/test/project",
		gitDirectory: "/test/project/.git",
		commonDirectory: "/test/project/.git",
		isBare: false,
		isShallow: false,
	},
	operationState: "normal",
	stashCount: 0,
});
