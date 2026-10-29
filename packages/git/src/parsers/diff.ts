import type { CommitFileChange, DiffFileStat } from "../contracts.js";

const rawHeader = /^:\d{6} \d{6} ([a-f0-9]+) ([a-f0-9]+) ([ADMRCT])\d*$/u;

/** NUL-delimited raw diffs preserve spaces, tabs, newlines, and both rename paths. */
export const parseCommitFiles = (
	output: Buffer
): readonly CommitFileChange[] => {
	const segments = output.toString("utf8").split("\0");
	const files: CommitFileChange[] = [];

	if (segments.at(-1) !== "")
		throw new Error("Git returned an incomplete committed file record.");

	for (let index = 0; index < segments.length - 1; index += 1) {
		const match = rawHeader.exec(segments[index] ?? "");

		if (!match)
			throw new Error("Git returned an invalid committed file record.");

		const [, beforeOid, afterOid, status] = match;
		const firstPath = segments[++index];
		const renamed = status === "R" || status === "C";
		const path = renamed ? segments[++index] : firstPath;

		if (
			!beforeOid ||
			!afterOid ||
			!path ||
			!firstPath ||
			!(
				status === "A" ||
				status === "D" ||
				status === "M" ||
				status === "R" ||
				status === "C" ||
				status === "T"
			)
		)
			throw new Error("Git returned an incomplete committed file record.");

		files.push({
			path,
			status,
			beforeOid,
			afterOid,
			...(renamed && { originalPath: firstPath }),
		});
	}

	return files;
};

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

		const firstTab = header.indexOf("\t");
		const secondTab = header.indexOf("\t", firstTab + 1);

		if (firstTab < 0 || secondTab < 0) continue;

		const added = header.slice(0, firstTab);
		const deleted = header.slice(firstTab + 1, secondTab);
		const inlinePath = header.slice(secondTab + 1);

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
