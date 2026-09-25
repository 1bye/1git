import type { CommitInfo } from "../contracts.js";

export const HISTORY_FIELD_SEPARATOR = "\x1f";
export const HISTORY_RECORD_SEPARATOR = "\x1e";
const LEADING_NEWLINE_PATTERN = /^\n/;

export const HISTORY_FORMAT = [
	"%H",
	"%P",
	"%an",
	"%ae",
	"%aI",
	"%cn",
	"%ce",
	"%cI",
	"%s",
	"%B",
].join("%x1f");

/** Parses records produced with `HISTORY_FORMAT`. */
export const parseHistory = (
	output: Buffer | string
): readonly CommitInfo[] => {
	const records = output
		.toString()
		.split(HISTORY_RECORD_SEPARATOR)
		.filter((record) => record.length > 0);

	const commits: CommitInfo[] = [];

	for (const record of records) {
		const fields = record
			.replace(LEADING_NEWLINE_PATTERN, "")
			.split(HISTORY_FIELD_SEPARATOR);

		if (fields.length < 10) {
			continue;
		}

		const [
			oid,
			parents,
			authorName,
			authorEmail,
			authoredAt,
			committerName,
			committerEmail,
			committedAt,
			summary,
			...bodyParts
		] = fields;

		if (
			!(
				oid &&
				parents !== undefined &&
				authorName !== undefined &&
				authorEmail !== undefined &&
				authoredAt &&
				committerName !== undefined &&
				committerEmail !== undefined &&
				committedAt &&
				summary !== undefined
			)
		) {
			continue;
		}

		commits.push({
			author: { email: authorEmail, name: authorName },
			authoredAt,
			body: bodyParts.join(HISTORY_FIELD_SEPARATOR).trimEnd(),
			committedAt,
			committer: { email: committerEmail, name: committerName },
			oid,
			parentOids: parents.split(" ").filter(Boolean),
			summary,
		});
	}

	return commits;
};
