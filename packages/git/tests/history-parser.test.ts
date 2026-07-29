import { describe, expect, test } from "bun:test";
import {
	HISTORY_FIELD_SEPARATOR,
	HISTORY_RECORD_SEPARATOR,
	parseHistory,
} from "../src/parsers/history.js";

const OID_A = "a".repeat(40);
const OID_B = "b".repeat(40);

const record = (fields: readonly string[]): string =>
	`${HISTORY_RECORD_SEPARATOR}${fields.join(HISTORY_FIELD_SEPARATOR)}`;

describe("parseHistory", () => {
	test("parses complete commit metadata", () => {
		const commits = parseHistory(
			record([
				OID_A,
				"",
				"Ada",
				"ada@example.com",
				"2026-01-02T03:04:05Z",
				"Grace",
				"grace@example.com",
				"2026-01-02T04:05:06Z",
				"feat: parser",
				"Detailed body\n",
			])
		);

		expect(commits[0]).toEqual({
			author: { email: "ada@example.com", name: "Ada" },
			authoredAt: "2026-01-02T03:04:05Z",
			body: "Detailed body",
			committedAt: "2026-01-02T04:05:06Z",
			committer: { email: "grace@example.com", name: "Grace" },
			oid: OID_A,
			parentOids: [],
			summary: "feat: parser",
		});
	});

	test("parses multiple parents", () => {
		const commits = parseHistory(
			record([
				OID_A,
				`${OID_B} ${"c".repeat(40)}`,
				"A",
				"a@x",
				"2026-01-01T00:00:00Z",
				"C",
				"c@x",
				"2026-01-01T00:00:00Z",
				"merge",
				"merge",
			])
		);

		expect(commits[0]?.parentOids).toHaveLength(2);
	});

	test("preserves multiline bodies while trimming record terminators", () => {
		const commits = parseHistory(
			record([
				OID_A,
				"",
				"A",
				"a@x",
				"2026-01-01T00:00:00Z",
				"A",
				"a@x",
				"2026-01-01T00:00:00Z",
				"summary",
				"line one\n\nline two\n\n",
			])
		);

		expect(commits[0]?.body).toBe("line one\n\nline two");
	});

	test("parses multiple records", () => {
		const baseFields = [
			"",
			"A",
			"a@x",
			"2026-01-01T00:00:00Z",
			"A",
			"a@x",
			"2026-01-01T00:00:00Z",
			"summary",
			"body",
		] as const;
		const commits = parseHistory(
			`${record([OID_A, ...baseFields])}${record([OID_B, ...baseFields])}`
		);

		expect(commits.map((commit) => commit.oid)).toEqual([OID_A, OID_B]);
	});

	test("joins field separators that occur in the body", () => {
		const commits = parseHistory(
			record([
				OID_A,
				"",
				"A",
				"a@x",
				"2026-01-01T00:00:00Z",
				"A",
				"a@x",
				"2026-01-01T00:00:00Z",
				"summary",
				`before${HISTORY_FIELD_SEPARATOR}after`,
			])
		);

		expect(commits[0]?.body).toBe(`before${HISTORY_FIELD_SEPARATOR}after`);
	});

	test("ignores malformed records", () => {
		expect(parseHistory(`${HISTORY_RECORD_SEPARATOR}too few fields`)).toEqual(
			[]
		);
	});
});
