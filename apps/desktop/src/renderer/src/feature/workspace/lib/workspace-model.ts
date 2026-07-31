import type { FileChange, FileStatus } from "@1git/git";
import type { RecentRepositoryRecord } from "../../../../../shared/repository-session.js";

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat(undefined, {
	numeric: "auto",
});

const TRAILING_PATH_SEPARATOR = /[\\/]+$/;

const RELATIVE_TIME_UNITS = [
	{ milliseconds: 86_400_000, unit: "day" },
	{ milliseconds: 3_600_000, unit: "hour" },
	{ milliseconds: 60_000, unit: "minute" },
] as const;

const CHANGE_LABELS: Readonly<Record<FileStatus, string>> = {
	added: "A",
	copied: "C",
	deleted: "D",
	ignored: "I",
	modified: "M",
	renamed: "R",
	"type-changed": "T",
	unmerged: "U",
	unmodified: "—",
	untracked: "?",
};

export const getRepositoryName = (root: string): string => {
	const normalizedRoot = root.replace(TRAILING_PATH_SEPARATOR, "");
	const separatorIndex = Math.max(
		normalizedRoot.lastIndexOf("/"),
		normalizedRoot.lastIndexOf("\\")
	);
	return normalizedRoot.slice(separatorIndex + 1) || normalizedRoot;
};

export const recentRepositoryName = (
	repository: RecentRepositoryRecord
): string => getRepositoryName(repository.path);

export const getWorkspaceLabel = (
	root: string,
	branch: string | null
): string => {
	const repositoryName = getRepositoryName(root);
	return branch ? `${repositoryName} / ${branch}` : repositoryName;
};

export const isFileStaged = (file: FileChange): boolean =>
	file.indexStatus !== "unmodified" &&
	file.indexStatus !== "untracked" &&
	file.indexStatus !== "ignored";

export const isFilePartiallyStaged = (file: FileChange): boolean =>
	isFileStaged(file) && file.worktreeStatus !== "unmodified";

export const areAllFilesStaged = (files: readonly FileChange[]): boolean =>
	files.length > 0 && files.every(isFileStaged);

export const getFileChangeLabel = (file: FileChange): string => {
	if (file.recordType === "untracked") {
		return CHANGE_LABELS.untracked;
	}
	if (file.worktreeStatus !== "unmodified") {
		return CHANGE_LABELS[file.worktreeStatus];
	}
	return CHANGE_LABELS[file.indexStatus];
};

export const matchesFileFilter = (file: FileChange, filter: string): boolean =>
	file.path.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());

export const formatCommitDate = (date: string): string => {
	const value = new Date(date);
	return Number.isNaN(value.getTime()) ? date : DATE_TIME_FORMAT.format(value);
};

export const formatRelativeTime = (
	date: string,
	nowMilliseconds = Date.now()
): string => {
	const value = new Date(date).getTime();
	if (Number.isNaN(value)) {
		return date;
	}

	const differenceMilliseconds = value - nowMilliseconds;
	for (const { milliseconds, unit } of RELATIVE_TIME_UNITS) {
		const magnitude = Math.abs(differenceMilliseconds) / milliseconds;
		if (magnitude >= 1) {
			return RELATIVE_TIME_FORMAT.format(
				Math.round(differenceMilliseconds / milliseconds),
				unit
			);
		}
	}

	return "just now";
};
