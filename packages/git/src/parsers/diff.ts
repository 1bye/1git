import type { DiffFileStat } from "../contracts.js";

const parseCount = (value: string | undefined): number | null => {
	if (!value || value === "-") {
		return null;
	}

	const parsed = Number.parseInt(value, 10);

	return Number.isNaN(parsed) ? null : parsed;
};

/** Parses `git diff --numstat -z`, including rename/copy records. */
export const parseDiffStats = (
	output: Buffer | string
): readonly DiffFileStat[] => {
	const segments = output.toString().split("\0");
	const stats: DiffFileStat[] = [];

	for (let index = 0; index < segments.length; index += 1) {
		const header = segments[index];

		if (!header) {
			continue;
		}

		const [added, deleted, inlinePath] = header.split("\t");

		if (inlinePath) {
			stats.push({
				addedLines: parseCount(added),
				deletedLines: parseCount(deleted),
				path: inlinePath,
			});
			continue;
		}

		const originalPath = segments[index + 1];
		const path = segments[index + 2];

		index += 2;

		if (!(originalPath && path)) {
			continue;
		}

		stats.push({
			addedLines: parseCount(added),
			deletedLines: parseCount(deleted),
			originalPath,
			path,
		});
	}

	return stats;
};
