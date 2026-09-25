import type {
	DiffFileStat,
	DiffTarget,
	FileChange,
	FileDiff,
	FileStatus,
} from "@1git/git";
import {
	type ChangeTypes,
	type FileDiffMetadata,
	parseDiffFromFile,
	parsePatchFiles,
} from "@pierre/diffs";

import type { RepositoryTab } from "@/feature/workspace/types/git-workspace.js";
import { getRepositoryDiffElementId } from "@/fixture/repository-workspace/lib/repository-navigation.js";

export interface RepositoryDiffFileEntry {
	readonly change: FileChange | null;
	readonly file: FileDiffMetadata | null;
	readonly id: string | undefined;
	readonly key: string;
	readonly patchOmittedReason: FileDiff["patchOmittedReason"];
	readonly path: string;
	readonly stat: DiffFileStat | null;
	readonly target: DiffTarget;
	readonly targetLabel: string;
}

type RepositoryDiffFileEntryWithoutId = Omit<
	RepositoryDiffFileEntry,
	"change" | "id"
>;

const REPOSITORY_DIFF_HASH_MODULUS = 2_147_483_647;
const REPOSITORY_DIFF_HASH_MULTIPLIER = 31;
const REPOSITORY_DIFF_CONTEXT_LINES = 3;

const REVISION_FILE_STATUS_BY_CHANGE_TYPE: Readonly<
	Record<ChangeTypes, FileStatus>
> = {
	change: "modified",
	deleted: "deleted",
	new: "added",
	"rename-changed": "renamed",
	"rename-pure": "renamed",
};

export const getRepositoryRevisionFileStatus = (
	file: FileDiffMetadata | null
): FileStatus =>
	file ? REVISION_FILE_STATUS_BY_CHANGE_TYPE[file.type] : "modified";

const hashRepositoryDiffPatch = (patch: string): string => {
	let hash = 0;

	for (const character of patch) {
		hash =
			(hash * REPOSITORY_DIFF_HASH_MULTIPLIER + character.charCodeAt(0)) %
			REPOSITORY_DIFF_HASH_MODULUS;
	}

	return hash.toString(36);
};

const diffTargetLabel = (diff: FileDiff, tab: RepositoryTab): string => {
	if (tab === "stashes") {
		return "Stash";
	}

	if (tab === "history") {
		return "Commit";
	}

	if (diff.target.kind === "staged") {
		return "Staged";
	}

	if (diff.target.kind === "working") {
		return "Working tree";
	}

	if (diff.target.kind === "commit") {
		return "Commit";
	}

	return "Comparison";
};

const createStatsByPath = (
	stats: readonly DiffFileStat[]
): ReadonlyMap<string, DiffFileStat> => {
	const statsByPath = new Map<string, DiffFileStat>();

	for (const stat of stats) {
		statsByPath.set(stat.path, stat);

		if (stat.originalPath) {
			statsByPath.set(stat.originalPath, stat);
		}
	}

	return statsByPath;
};

const parseDiffFileEntries = (
	diffs: readonly FileDiff[],
	commitOid: string | undefined,
	tab: RepositoryTab
): readonly RepositoryDiffFileEntryWithoutId[] => {
	const entries: RepositoryDiffFileEntryWithoutId[] = [];

	for (const [diffIndex, diff] of diffs.entries()) {
		const patchKey = hashRepositoryDiffPatch(diff.patch);
		const statsByPath = createStatsByPath(diff.stats);

		const parsedFiles = parsePatchFiles(
			diff.patch,
			tab === "changes"
				? `${diff.target.kind}-${diffIndex}:${patchKey}`
				: `${commitOid}:${patchKey}`,
			true
		).flatMap((patch) => patch.files);

		for (const file of parsedFiles) {
			entries.push({
				file,
				key: `${diff.target.kind}:${diffIndex}:${file.cacheKey ?? file.name}`,
				patchOmittedReason: diff.patchOmittedReason,
				path: file.name,
				stat: statsByPath.get(file.name) ?? null,
				target: diff.target,
				targetLabel: diffTargetLabel(diff, tab),
			});
		}

		const parsedPaths = new Set(
			parsedFiles.flatMap((file) => [file.name, file.prevName].filter(Boolean))
		);

		for (const stat of diff.stats) {
			if (
				parsedPaths.has(stat.path) ||
				parsedPaths.has(stat.originalPath ?? "")
			) {
				continue;
			}

			entries.push({
				file: null,
				key: `${diff.target.kind}:${diffIndex}:stat:${stat.path}`,
				patchOmittedReason: diff.patchOmittedReason,
				path: stat.path,
				stat,
				target: diff.target,
				targetLabel: diffTargetLabel(diff, tab),
			});
		}
	}

	return entries;
};

const addMissingFileEntries = (
	entries: readonly RepositoryDiffFileEntryWithoutId[],
	diffs: readonly FileDiff[],
	files: readonly FileChange[],
	tab: RepositoryTab
): readonly RepositoryDiffFileEntryWithoutId[] => {
	if (tab !== "changes") {
		return entries;
	}

	const knownPaths = new Set(entries.map((entry) => entry.path));
	const nextEntries = [...entries];

	for (const file of files) {
		if (knownPaths.has(file.path)) {
			continue;
		}

		const target = {
			kind: file.worktreeStatus === "unmodified" ? "staged" : "working",
		} as const;

		nextEntries.push({
			file: null,
			key: `empty:${file.path}`,
			patchOmittedReason: diffs.find((diff) => diff.target.kind === target.kind)
				?.patchOmittedReason,
			path: file.path,
			stat: null,
			target,
			targetLabel: target.kind === "working" ? "Working tree" : "Staged",
		});
	}

	return nextEntries;
};

const assignDiffElementIds = (
	entries: readonly RepositoryDiffFileEntryWithoutId[],
	files: readonly FileChange[]
): readonly RepositoryDiffFileEntry[] => {
	const seenPaths = new Set<string>();
	const changesByPath = new Map(files.map((file) => [file.path, file]));

	return entries.map((entry) => {
		const isFirstOccurrence = !seenPaths.has(entry.path);

		seenPaths.add(entry.path);

		return {
			...entry,
			change: changesByPath.get(entry.path) ?? null,
			id: isFirstOccurrence
				? getRepositoryDiffElementId(entry.path)
				: undefined,
		};
	});
};

export const createRepositoryDiffFileEntries = (
	diffs: readonly FileDiff[],
	files: readonly FileChange[],
	commitOid: string | undefined,
	tab: RepositoryTab
): readonly RepositoryDiffFileEntry[] =>
	assignDiffElementIds(
		addMissingFileEntries(
			parseDiffFileEntries(diffs, commitOid, tab),
			diffs,
			files,
			tab
		),
		files
	);

export const getSelectedRepositoryDiffEntryKey = (
	entries: readonly RepositoryDiffFileEntry[],
	selectedPath: string | null
): string | null =>
	selectedPath
		? (entries.find((entry) => entry.path === selectedPath)?.key ?? null)
		: null;

export const createExpandableRepositoryDiffFile = (
	diff: FileDiff,
	path: string,
	cacheKeyPrefix: string
): FileDiffMetadata | null => {
	const parsedFiles = parsePatchFiles(diff.patch, cacheKeyPrefix, true).flatMap(
		(patch) => patch.files
	);

	const file =
		parsedFiles.find(
			(candidate) => candidate.name === path || candidate.prevName === path
		) ?? parsedFiles[0];

	if (!file) {
		return null;
	}

	return parseDiffFromFile(
		{
			cacheKey: `${cacheKeyPrefix}:old`,
			contents: file.deletionLines.join(""),
			name: file.prevName ?? file.name,
		},
		{
			cacheKey: `${cacheKeyPrefix}:new`,
			contents: file.additionLines.join(""),
			name: file.name,
		},
		{ context: REPOSITORY_DIFF_CONTEXT_LINES },
		true
	);
};
