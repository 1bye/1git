/**
 * Covers: NUL framing, literal control-character/object-ID paths and incomplete file-history records.
 * Real: file-history/raw diff parsers.
 * Doubles: Git output bytes.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { parseFileHistory } from "../../src/parsers/file-history.js";

it("consumes paths by record shape, including filenames resembling commit IDs", () => {
	const oid = "a".repeat(40);
	const before = "b".repeat(40);
	const after = "c".repeat(40);
	const path = "odd\tname\n\x1e.txt";

	expect(
		parseFileHistory(
			Buffer.from(
				`${oid}\0\n:100644 100644 ${before} ${after} R100\0${path}\0${oid}\0\0${before}\0\n:100644 100644 ${before} ${after} M\0${path}\0`
			)
		)
	).toEqual([
		{
			oid,
			file: {
				path: oid,
				originalPath: path,
				status: "R",
				beforeOid: before,
				afterOid: after,
			},
		},
		{
			oid: before,
			file: { path, status: "M", beforeOid: before, afterOid: after },
		},
	]);
	expect(parseFileHistory(Buffer.alloc(0))).toEqual([]);
});

it("rejects malformed and truncated records rather than presenting partial history", () => {
	const oid = "a".repeat(40);
	const header = `:100644 100644 ${oid} ${oid} M`;

	for (const output of [
		"bad",
		`${oid}\0`,
		`${oid}\0\n${header}\0`,
		`${oid}\0\n${header}\0path`,
		`bad\0\n${header}\0path\0`,
		`${oid}\0\n:invalid\0path\0`,
		`${oid}\0\n:100644 100644 ${oid} ${oid} R100\0old\0`,
	])
		expect(() => parseFileHistory(Buffer.from(output))).toThrow();
});
