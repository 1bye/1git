import { resolve } from "node:path";
import type {
	FileChange,
	FileStatus,
	GitResult,
	RepositorySnapshot,
} from "@1git/git";
import { GitRepository } from "@1git/git";

const INACTIVE_STATUSES = new Set<FileStatus>(["ignored", "unmodified"]);

export interface CliOptions {
	readonly repositoryPath: string;
	readonly screenshotPath: string | null;
}

export interface RepositoryView {
	readonly patch: string;
	readonly selectedPath: string | null;
	readonly snapshot: RepositorySnapshot;
	readonly stagedFiles: readonly FileChange[];
	readonly unstagedFiles: readonly FileChange[];
}

export const parseCliArguments = (
	args: readonly string[],
	cwd: string
): CliOptions => {
	let repositoryPath: string | null = null;
	let screenshotPath: string | null = null;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === undefined) {
			continue;
		}
		if (argument === "--screenshot") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--screenshot requires an output path.");
			}
			screenshotPath = resolve(cwd, value);
			index += 1;
			continue;
		}
		if (argument.startsWith("--screenshot=")) {
			const value = argument.slice("--screenshot=".length);
			if (value.length === 0) {
				throw new Error("--screenshot requires an output path.");
			}
			screenshotPath = resolve(cwd, value);
			continue;
		}
		if (argument.startsWith("--")) {
			throw new Error(`Unknown option: ${argument}`);
		}
		if (repositoryPath !== null) {
			throw new Error("Only one repository path can be opened at a time.");
		}
		repositoryPath = resolve(cwd, argument);
	}

	return {
		repositoryPath: repositoryPath ?? cwd,
		screenshotPath,
	};
};

export const unwrapGitResult = <T>(result: GitResult<T>): T => {
	if (result.ok) {
		return result.value;
	}
	const details = result.error.details?.trim();
	throw new Error(
		details ? `${result.error.message} ${details}` : result.error.message
	);
};

export const isStagedFile = (file: FileChange): boolean =>
	!INACTIVE_STATUSES.has(file.indexStatus) && file.indexStatus !== "untracked";

export const isUnstagedFile = (file: FileChange): boolean =>
	file.recordType === "untracked" ||
	(!INACTIVE_STATUSES.has(file.worktreeStatus) &&
		file.worktreeStatus !== "untracked");

export const groupChangedFiles = (
	files: readonly FileChange[]
): Pick<RepositoryView, "stagedFiles" | "unstagedFiles"> => ({
	stagedFiles: files.filter(isStagedFile),
	unstagedFiles: files.filter(isUnstagedFile),
});

export const combinePatches = (patches: readonly string[]): string =>
	patches
		.map((patch) => patch.trimEnd())
		.filter((patch) => patch.length > 0)
		.join("\n");

const hasPath = (files: readonly FileChange[], path: string): boolean =>
	files.some((file) => file.path === path || file.originalPath === path);

export const loadRepositoryView = async (
	repository: GitRepository,
	requestedPath: string | null
): Promise<RepositoryView> => {
	const snapshot = unwrapGitResult(await repository.getSnapshot());
	const selectedPath =
		requestedPath && hasPath(snapshot.files, requestedPath)
			? requestedPath
			: null;
	const paths = selectedPath ? [selectedPath] : undefined;
	const [stagedDiff, workingDiff] = await Promise.all([
		repository.getDiff({ paths, target: { kind: "staged" } }),
		repository.getDiff({ paths, target: { kind: "working" } }),
	]);
	const groupedFiles = groupChangedFiles(snapshot.files);

	return {
		...groupedFiles,
		patch: combinePatches([
			unwrapGitResult(stagedDiff).patch,
			unwrapGitResult(workingDiff).patch,
		]),
		selectedPath,
		snapshot,
	};
};

export const openRepository = async (
	repositoryPath: string
): Promise<GitRepository> =>
	unwrapGitResult(await GitRepository.open({ path: repositoryPath }));

const STATUS_LABELS: Readonly<Record<FileStatus, string>> = {
	added: "A",
	copied: "C",
	deleted: "D",
	ignored: "·",
	modified: "M",
	renamed: "R",
	"type-changed": "T",
	unmerged: "!",
	unmodified: "·",
	untracked: "U",
};

export const statusLabel = (status: FileStatus): string =>
	STATUS_LABELS[status];
