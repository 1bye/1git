import type { FileChange } from "@1git/git";
import { isFileStaged } from "@/feature/workspace/lib/workspace-model.js";

export interface RepositoryFileGroups {
	readonly staged: readonly FileChange[];
	readonly unstaged: readonly FileChange[];
}

export interface RepositoryFilePath {
	readonly directory: string;
	readonly name: string;
}

const REPOSITORY_DIFF_ELEMENT_PREFIX = "repository-diff:";
const REPOSITORY_FILE_ROW_PREFIX = "repository-file:";

export const getRepositoryDiffElementId = (path: string): string =>
	`${REPOSITORY_DIFF_ELEMENT_PREFIX}${encodeURIComponent(path)}`;

export const getRepositoryFileRowId = (path: string): string =>
	`${REPOSITORY_FILE_ROW_PREFIX}${encodeURIComponent(path)}`;

export const filterRepositoryFiles = (
	files: readonly FileChange[],
	query: string
): readonly FileChange[] => {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) {
		return files;
	}
	return files.filter((file) =>
		file.path.toLocaleLowerCase().includes(normalizedQuery)
	);
};

export const groupRepositoryFiles = (
	files: readonly FileChange[]
): RepositoryFileGroups => {
	const staged: FileChange[] = [];
	const unstaged: FileChange[] = [];
	for (const file of files) {
		if (isFileStaged(file)) {
			staged.push(file);
		} else {
			unstaged.push(file);
		}
	}
	return { staged, unstaged };
};

export const splitRepositoryFilePath = (path: string): RepositoryFilePath => {
	const separatorIndex = path.lastIndexOf("/");
	if (separatorIndex < 0) {
		return { directory: "", name: path };
	}
	return {
		directory: path.slice(0, separatorIndex + 1),
		name: path.slice(separatorIndex + 1),
	};
};

export const getRepositoryFileAtOffset = (
	files: readonly FileChange[],
	currentPath: string | null,
	offset: number
): FileChange | null => {
	if (files.length === 0) {
		return null;
	}
	const currentIndex = files.findIndex((file) => file.path === currentPath);
	let startingIndex = currentIndex;
	if (currentIndex < 0) {
		startingIndex = offset < 0 ? 0 : -1;
	}
	const nextIndex = (startingIndex + offset + files.length * 2) % files.length;
	return files[nextIndex] ?? null;
};

export const getRepositoryFilePosition = (
	files: readonly FileChange[],
	path: string | null
): number | null => {
	const index = files.findIndex((file) => file.path === path);
	return index < 0 ? null : index + 1;
};
