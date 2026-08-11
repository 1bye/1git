import type { FileChange } from "@1git/git";
import { isFileStaged } from "@/feature/workspace/lib/workspace-model.js";

export interface RepositoryFilePath {
	readonly directory: string;
	readonly name: string;
}

export type RepositoryFileSelectionMode = "range" | "replace" | "toggle";

export interface RepositoryFileSelection {
	readonly activePath: string;
	readonly anchorPath: string;
	readonly selectedPaths: readonly string[];
}

export interface RepositoryFileStageGroups {
	readonly staged: readonly FileChange[];
	readonly unstaged: readonly FileChange[];
}

export interface RepositoryFileStageProjection {
	readonly path: string;
	readonly staged: boolean;
}

interface UpdateRepositoryFileSelectionOptions {
	readonly activePath: string | null;
	readonly anchorPath: string | null;
	readonly mode: RepositoryFileSelectionMode;
	readonly orderedPaths: readonly string[];
	readonly selectedPaths: ReadonlySet<string>;
	readonly targetPath: string;
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

export const orderRepositoryFilesByPath = (
	files: readonly FileChange[]
): readonly FileChange[] =>
	files.toSorted((left, right) => left.path.localeCompare(right.path));

export const groupRepositoryFilesByStaging = (
	files: readonly FileChange[],
	projection?: RepositoryFileStageProjection | null
): RepositoryFileStageGroups => {
	const staged: FileChange[] = [];
	const unstaged: FileChange[] = [];
	for (const file of orderRepositoryFilesByPath(files)) {
		const stagedFile =
			projection?.path === file.path ? projection.staged : isFileStaged(file);
		(stagedFile ? staged : unstaged).push(file);
	}
	return { staged, unstaged };
};

export const hasRepositoryFileStageProjectionSettled = (
	files: readonly FileChange[],
	projection: RepositoryFileStageProjection
): boolean => {
	const projectedFile = files.find((file) => file.path === projection.path);
	return !projectedFile || isFileStaged(projectedFile) === projection.staged;
};

export const orderRepositoryFilesByStaging = (
	files: readonly FileChange[]
): readonly FileChange[] => {
	const groups = groupRepositoryFilesByStaging(files);
	return [...groups.staged, ...groups.unstaged];
};

export const shouldStageRepositoryFileDrop = (
	file: FileChange,
	targetShouldStage: boolean
): boolean | null =>
	isFileStaged(file) === targetShouldStage ? null : targetShouldStage;

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

export const getRepositoryFileAtBoundedOffset = (
	files: readonly FileChange[],
	currentPath: string | null,
	offset: number
): FileChange | null => {
	const currentIndex = files.findIndex((file) => file.path === currentPath);
	if (currentIndex < 0) {
		return files[offset < 0 ? files.length - 1 : 0] ?? null;
	}
	return files[currentIndex + offset] ?? null;
};

export const getRepositoryFilePosition = (
	files: readonly FileChange[],
	path: string | null
): number | null => {
	const index = files.findIndex((file) => file.path === path);
	return index < 0 ? null : index + 1;
};

export const doesRepositoryFileContextMenuUseSelection = (
	targetPath: string,
	selectedPaths: ReadonlySet<string>
): boolean => selectedPaths.size > 1 && selectedPaths.has(targetPath);

export const getRepositoryFileSelectionRunPaths = (
	orderedPaths: readonly string[],
	selectedPaths: ReadonlySet<string>,
	targetPath: string
): readonly string[] => {
	const targetIndex = orderedPaths.indexOf(targetPath);
	if (targetIndex < 0 || !selectedPaths.has(targetPath)) {
		return [];
	}
	let startIndex = targetIndex;
	let endIndex = targetIndex;
	while (startIndex > 0) {
		const previousPath = orderedPaths[startIndex - 1];
		if (!(previousPath && selectedPaths.has(previousPath))) {
			break;
		}
		startIndex -= 1;
	}
	while (endIndex < orderedPaths.length - 1) {
		const nextPath = orderedPaths[endIndex + 1];
		if (!(nextPath && selectedPaths.has(nextPath))) {
			break;
		}
		endIndex += 1;
	}
	return orderedPaths.slice(startIndex, endIndex + 1);
};

export const shouldElevateRepositoryFileSelection = (
	isContextMenuPresent: boolean,
	isSelected: boolean
): boolean => isContextMenuPresent && isSelected;

const orderedSelection = (
	orderedPaths: readonly string[],
	selectedPaths: ReadonlySet<string>
): readonly string[] => orderedPaths.filter((path) => selectedPaths.has(path));

export const updateRepositoryFileSelection = ({
	activePath,
	anchorPath,
	mode,
	orderedPaths,
	selectedPaths,
	targetPath,
}: UpdateRepositoryFileSelectionOptions): RepositoryFileSelection => {
	if (mode === "replace") {
		return {
			activePath: targetPath,
			anchorPath: targetPath,
			selectedPaths: [],
		};
	}

	if (mode === "range") {
		const rangeAnchor =
			anchorPath && orderedPaths.includes(anchorPath)
				? anchorPath
				: (activePath ?? targetPath);
		const anchorIndex = orderedPaths.indexOf(rangeAnchor);
		const targetIndex = orderedPaths.indexOf(targetPath);
		if (anchorIndex < 0 || targetIndex < 0) {
			return {
				activePath: targetPath,
				anchorPath: targetPath,
				selectedPaths: [],
			};
		}
		const startIndex = Math.min(anchorIndex, targetIndex);
		const endIndex = Math.max(anchorIndex, targetIndex);
		const range = orderedPaths.slice(startIndex, endIndex + 1);
		return {
			activePath: targetPath,
			anchorPath: rangeAnchor,
			selectedPaths: range.length > 1 ? range : [],
		};
	}

	const nextSelection = new Set(selectedPaths);
	if (nextSelection.size === 0 && activePath) {
		nextSelection.add(activePath);
	}
	if (nextSelection.has(targetPath)) {
		nextSelection.delete(targetPath);
	} else {
		nextSelection.add(targetPath);
	}
	const paths = orderedSelection(orderedPaths, nextSelection);
	return {
		activePath:
			nextSelection.has(targetPath) || paths.length === 0
				? targetPath
				: (paths[0] ?? targetPath),
		anchorPath: targetPath,
		selectedPaths: paths.length > 1 ? paths : [],
	};
};
