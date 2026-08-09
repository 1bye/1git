import type { DiffFileStat, DiffTarget, FileChange, FileDiff } from "@1git/git";
import { type FileDiffMetadata, parsePatchFiles } from "@pierre/diffs";
import type { RepositoryTab } from "@/feature/workspace/types/git-workspace.js";
import { getRepositoryDiffElementId } from "@/fixture/repository-workspace/lib/repository-navigation.js";

export interface RepositoryDiffFileEntry {
	readonly change: FileChange | null;
	readonly file: FileDiffMetadata | null;
	readonly id: string | undefined;
	readonly key: string;
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

const hashRepositoryDiffPatch = (patch: string): string => {
	let hash = 0;
	for (const character of patch) {
		hash =
			(hash * REPOSITORY_DIFF_HASH_MULTIPLIER + character.charCodeAt(0)) %
			REPOSITORY_DIFF_HASH_MODULUS;
	}
	return hash.toString(36);
};

const diffTargetLabel = (diff: FileDiff): string => {
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

const statForFile = (
	stats: readonly DiffFileStat[],
	path: string
): DiffFileStat | null =>
	stats.find((stat) => stat.path === path || stat.originalPath === path) ??
	null;

const parseDiffFileEntries = (
	diffs: readonly FileDiff[],
	commitOid: string | undefined,
	tab: RepositoryTab
): readonly RepositoryDiffFileEntryWithoutId[] => {
	const entries: RepositoryDiffFileEntryWithoutId[] = [];
	for (const [diffIndex, diff] of diffs.entries()) {
		const patchKey = hashRepositoryDiffPatch(diff.patch);
		const parsedFiles = parsePatchFiles(
			diff.patch,
			tab === "history"
				? `${commitOid}:${patchKey}`
				: `${diff.target.kind}-${diffIndex}:${patchKey}`,
			true
		).flatMap((patch) => patch.files);
		for (const file of parsedFiles) {
			entries.push({
				file,
				key: `${diff.target.kind}:${diffIndex}:${file.cacheKey ?? file.name}`,
				path: file.name,
				stat: statForFile(diff.stats, file.name),
				target: diff.target,
				targetLabel: diffTargetLabel(diff),
			});
		}
	}
	return entries;
};

const addMissingFileEntries = (
	entries: readonly RepositoryDiffFileEntryWithoutId[],
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
		nextEntries.push({
			file: null,
			key: `empty:${file.path}`,
			path: file.path,
			stat: null,
			target: { kind: "working" },
			targetLabel: "Working tree",
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
			files,
			tab
		),
		files
	);

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
	return {
		...file,
		isPartial: false,
	};
};
