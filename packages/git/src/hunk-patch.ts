import { invalidInput } from "./result.js";

const FILE_HEADER_PATTERN = /^diff --git /gm;
const HUNK_HEADER_PATTERN = /^@@ /gm;

const matchIndexes = (value: string, pattern: RegExp): number[] => {
	const indexes: number[] = [];
	for (const match of value.matchAll(pattern)) {
		if (match.index !== undefined) {
			indexes.push(match.index);
		}
	}
	return indexes;
};

/** Selects one hunk while preserving the authoritative file patch header. */
export const selectHunkPatch = (patch: string, hunkIndex: number): string => {
	const fileStarts = matchIndexes(patch, FILE_HEADER_PATTERN);
	if (fileStarts.length !== 1 || fileStarts[0] !== 0) {
		throw invalidInput(
			"change-hunk",
			"The selected path must resolve to exactly one diff."
		);
	}

	const hunkStarts = matchIndexes(patch, HUNK_HEADER_PATTERN);
	const [firstHunkStart] = hunkStarts;
	const selectedStart = hunkStarts[hunkIndex];
	if (firstHunkStart === undefined || selectedStart === undefined) {
		throw invalidInput("change-hunk", "The selected hunk no longer exists.");
	}
	const selectedEnd = hunkStarts[hunkIndex + 1] ?? patch.length;
	const selectedPatch = `${patch.slice(0, firstHunkStart)}${patch.slice(
		selectedStart,
		selectedEnd
	)}`;
	return selectedPatch.endsWith("\n") ? selectedPatch : `${selectedPatch}\n`;
};
