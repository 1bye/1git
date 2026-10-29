/**
 * Covers: diff counts, binary and rename records, and filenames with embedded tabs.
 * Real: NUL-delimited numstat parser.
 * Doubles: none.
 * Requires: none.
 */
import { describe, expect, test } from "bun:test";

import { parseDiffStats } from "../src/parsers/diff.js";

describe("parseDiffStats", () => {
	test("parses ordinary text-file counts", () => {
		expect(parseDiffStats("12\t3\tsrc/app.ts\0")).toEqual([
			{
				addedLines: 12,
				deletedLines: 3,
				path: "src/app.ts",
			},
		]);
	});

	test("preserves tabs inside ordinary and renamed filenames", () => {
		expect(
			parseDiffStats("1\t2\ttab\tname.txt\0-\t-\t\0old\tname\0new\tname\0")
		).toEqual([
			{ addedLines: 1, deletedLines: 2, path: "tab\tname.txt" },
			{
				addedLines: null,
				deletedLines: null,
				originalPath: "old\tname",
				path: "new\tname",
			},
		]);
	});

	test("represents binary counts as null", () => {
		expect(parseDiffStats("-\t-\timage.png\0")[0]).toEqual({
			addedLines: null,
			deletedLines: null,
			path: "image.png",
		});
	});

	test("parses rename records with two paths", () => {
		expect(parseDiffStats("1\t2\t\0old name.ts\0new name.ts\0")).toEqual([
			{
				addedLines: 1,
				deletedLines: 2,
				originalPath: "old name.ts",
				path: "new name.ts",
			},
		]);
	});

	test("parses multiple mixed records", () => {
		const stats = parseDiffStats(
			["3\t0\tadded.ts", "-\t-\tasset.bin", "1\t1\tchanged.ts", ""].join("\0")
		);

		expect(stats).toHaveLength(3);
		expect(stats[1]?.path).toBe("asset.bin");
	});

	test("ignores malformed rename records", () => {
		expect(parseDiffStats("1\t2\t\0only-old\0")).toEqual([]);
	});
});
