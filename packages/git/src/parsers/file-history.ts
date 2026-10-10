import type { CommitFileChange } from "../contracts.js";
import { parseCommitFiles } from "./diff.js";

const objectId = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const renamed = / [RC]\d*$/u;

/** Parses NUL-framed `log --follow --raw --format=%H -z`, consuming paths by record shape rather than their contents. */
export function parseFileHistory(output: Buffer): readonly {
	oid: string;
	file: CommitFileChange;
}[] {
	if (!output.length) return [];

	const tokens = output.toString("utf8").split("\0");
	const records: { oid: string; file: CommitFileChange }[] = [];
	let index = 0;

	if (tokens.at(-1) !== "")
		throw new Error("Git returned incomplete file history.");

	while (index < tokens.length - 1) {
		if (!tokens[index]) {
			index += 1;
			continue;
		}

		const oid = tokens[index++];
		const header = tokens[index++]?.replace(/^\n/, "");

		if (!oid || !objectId.test(oid) || !header?.startsWith(":"))
			throw new Error("Git returned invalid file history.");

		const paths = tokens.slice(index, index + (renamed.test(header) ? 2 : 1));

		index += paths.length;
		const [file] = parseCommitFiles(
			Buffer.from([header, ...paths, ""].join("\0"))
		);

		if (!file)
			throw new Error("Git returned a file-history commit without a file.");

		records.push({ oid, file });
	}

	return records;
}
