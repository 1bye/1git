import { describe, expect, test } from "bun:test";

import { parseStatus } from "../src/parsers/status.js";

const OID_A = "a".repeat(40);
const OID_B = "b".repeat(40);

describe("parseStatus", () => {
	test("returns an unborn detached-neutral state for empty output", () => {
		const status = parseStatus("");

		expect(status.files).toEqual([]);
		expect(status.head).toEqual({
			ahead: 0,
			behind: 0,
			branch: null,
			detached: false,
			oid: null,
			unborn: true,
			upstream: null,
		});
	});

	test("parses branch and tracking headers", () => {
		const status = parseStatus(
			[
				`# branch.oid ${OID_A}`,
				"# branch.head feature/parser",
				"# branch.upstream origin/feature/parser",
				"# branch.ab +12 -3",
				"# stash 4",
				"",
			].join("\0")
		);

		expect(status.head).toEqual({
			ahead: 12,
			behind: 3,
			branch: "feature/parser",
			detached: false,
			oid: OID_A,
			unborn: false,
			upstream: "origin/feature/parser",
		});
		expect(status.stashCount).toBe(4);
	});

	test("parses an unborn named branch", () => {
		const status = parseStatus("# branch.oid (initial)\0# branch.head main\0");

		expect(status.head.branch).toBe("main");
		expect(status.head.oid).toBeNull();
		expect(status.head.unborn).toBe(true);
	});

	test("parses detached HEAD", () => {
		const status = parseStatus(
			`# branch.oid ${OID_A}\0# branch.head (detached)\0`
		);

		expect(status.head.branch).toBeNull();
		expect(status.head.detached).toBe(true);
	});

	test("parses ordinary staged and worktree statuses", () => {
		const status = parseStatus(
			`1 AM N... 100644 100644 100644 ${OID_A} ${OID_B} source file.ts\0`
		);

		expect(status.files).toEqual([
			{
				headOid: OID_A,
				indexOid: OID_B,
				indexStatus: "added",
				path: "source file.ts",
				recordType: "ordinary",
				submodule: "N...",
				worktreeStatus: "modified",
			},
		]);
	});

	test("parses deletion and type changes", () => {
		const status = parseStatus(
			`1 DT N... 100644 000000 120000 ${OID_A} ${OID_B} script\0`
		);

		expect(status.files[0]?.indexStatus).toBe("deleted");
		expect(status.files[0]?.worktreeStatus).toBe("type-changed");
	});

	test("parses rename records and consumes the original path", () => {
		const status = parseStatus(
			`2 R. N... 100644 100644 100644 ${OID_A} ${OID_B} R087 new name.ts\0old name.ts\0`
		);

		expect(status.files).toEqual([
			{
				headOid: OID_A,
				indexOid: OID_B,
				indexStatus: "renamed",
				originalPath: "old name.ts",
				path: "new name.ts",
				recordType: "renamed",
				renameScore: 87,
				submodule: "N...",
				worktreeStatus: "unmodified",
			},
		]);
	});

	test("parses unmerged records", () => {
		const status = parseStatus(
			`u UU N... 100644 100644 100644 100644 ${OID_A} ${OID_B} ${OID_A} conflicted.ts\0`
		);

		expect(status.files[0]).toMatchObject({
			indexStatus: "unmerged",
			path: "conflicted.ts",
			recordType: "unmerged",
			worktreeStatus: "unmerged",
		});
	});

	test("preserves untracked filenames with spaces and unicode", () => {
		const status = parseStatus("? docs/été notes.md\0");

		expect(status.files[0]).toEqual({
			indexStatus: "unmodified",
			path: "docs/été notes.md",
			recordType: "untracked",
			submodule: "N...",
			worktreeStatus: "untracked",
		});
	});

	test("preserves newlines in NUL-delimited filenames", () => {
		const status = parseStatus("? unusual\nname.txt\0");

		expect(status.files[0]?.path).toBe("unusual\nname.txt");
	});

	test("parses ignored records", () => {
		const status = parseStatus("! build/output.js\0");

		expect(status.files[0]?.recordType).toBe("ignored");
		expect(status.files[0]?.worktreeStatus).toBe("ignored");
	});

	test("ignores malformed and unknown records", () => {
		const status = parseStatus("1 invalid\0x future record\0");

		expect(status.files).toEqual([]);
	});
});
