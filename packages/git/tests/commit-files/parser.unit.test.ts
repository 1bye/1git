/**
 * Covers: NUL-delimited commit file records, renames and malformed output.
 * Real: raw diff parser.
 * Doubles: Git output strings.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { parseCommitFiles } from "../../src/parsers/diff.js";

it("preserves unusual paths and immutable before/after identities", () => {
	const before = "a".repeat(40);
	const after = "b".repeat(40);
	const records = `:100644 100644 ${before} ${after} R098\0old\tfile.txt\0new\nfile.txt\0:000000 100644 ${"0".repeat(40)} ${after} A\0added.txt\0`;

	expect(parseCommitFiles(Buffer.from(records))).toEqual([
		{
			path: "new\nfile.txt",
			originalPath: "old\tfile.txt",
			status: "R",
			beforeOid: before,
			afterOid: after,
		},
		{
			path: "added.txt",
			status: "A",
			beforeOid: "0".repeat(40),
			afterOid: after,
		},
	]);
	expect(parseCommitFiles(Buffer.alloc(0))).toEqual([]);
	expect(() => parseCommitFiles(Buffer.from("malformed\0"))).toThrow(
		"invalid committed file"
	);
	expect(() =>
		parseCommitFiles(
			Buffer.from(`:100644 100644 ${before} ${after} R100\0one-path\0`)
		)
	).toThrow("incomplete committed file");
});
