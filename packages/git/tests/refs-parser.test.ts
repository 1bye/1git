/**
 * Covers: branch tracking destinations, tags and stash record parsing.
 * Real: Git output parsers.
 * Doubles: explicit NUL-delimited Git output strings.
 * Requires: none.
 */
import { describe, expect, test } from "bun:test";

import { parseBranches, parseStashes, parseTags } from "../src/parsers/refs.js";

const OID_A = "a".repeat(40);
const OID_B = "b".repeat(40);
const record = (fields: readonly string[]): string => `${fields.join("\0")}\n`;

describe("parseBranches", () => {
	test("parses the checked-out local branch", () => {
		const branches = parseBranches(
			record([
				"refs/heads/main",
				"main",
				OID_A,
				"*",
				"",
				"",
				"2026-01-02T03:04:05Z",
				"Initial",
				"/repo",
			])
		);

		expect(branches.current).toBe("main");
		expect(branches.branches[0]).toMatchObject({
			checkedOut: true,
			fullName: "refs/heads/main",
			name: "main",
			remote: null,
			type: "local",
			worktreePath: "/repo",
		});
	});

	test("records a linked worktree without treating it as the current branch", () => {
		const branches = parseBranches(
			record([
				"refs/heads/linked",
				"linked",
				OID_A,
				" ",
				"",
				"",
				"2026-01-02T03:04:05Z",
				"Linked",
				"/repo-linked",
			])
		);

		expect(branches.current).toBeNull();
		expect(branches.branches[0]).toMatchObject({
			checkedOut: false,
			name: "linked",
			worktreePath: "/repo-linked",
		});
	});

	test("parses upstream ahead and behind counts", () => {
		const branches = parseBranches(
			record([
				"refs/heads/main",
				"main",
				OID_A,
				"*",
				"origin/main",
				"ahead 2, behind 5",
				"2026-01-02T03:04:05Z",
				"Sync",
			])
		);

		expect(branches.branches[0]).toMatchObject({
			ahead: 2,
			behind: 5,
			upstream: "origin/main",
		});
	});

	test("parses ahead-only tracking", () => {
		const branches = parseBranches(
			record([
				"refs/heads/main",
				"main",
				OID_A,
				"*",
				"origin/main",
				"ahead 7",
				"",
				"",
			])
		);

		expect(branches.branches[0]?.ahead).toBe(7);
		expect(branches.branches[0]?.behind).toBe(0);
	});

	test("keeps the configured remote and full ref independent of the display label", () => {
		const branches = parseBranches(
			record([
				"refs/heads/topic/ui",
				"topic/ui",
				OID_A,
				"*",
				"custom/tracking/ui",
				"ahead 1",
				"",
				"",
				"/repo",
				"team/upstream",
				"refs/heads/release/ui",
			])
		);

		expect(branches.branches[0]).toMatchObject({
			upstream: "custom/tracking/ui",
			upstreamRemote: "team/upstream",
			upstreamRef: "refs/heads/release/ui",
		});
	});

	test("parses remote-tracking branch ownership", () => {
		const branches = parseBranches(
			record([
				"refs/remotes/upstream/feature",
				"upstream/feature",
				OID_B,
				" ",
				"",
				"",
				"",
				"Topic",
			])
		);

		expect(branches.branches[0]).toMatchObject({
			name: "upstream/feature",
			remote: "upstream",
			type: "remote",
		});
	});

	test("excludes symbolic remote HEAD records", () => {
		const branches = parseBranches(
			record([
				"refs/remotes/origin/HEAD",
				"origin/HEAD",
				OID_A,
				" ",
				"",
				"",
				"",
				"",
			])
		);

		expect(branches.branches).toEqual([]);
	});

	test("ignores malformed records", () => {
		expect(parseBranches("refs/heads/main\0main\n").branches).toEqual([]);
	});
});

describe("parseTags", () => {
	test("parses lightweight tags", () => {
		const tags = parseTags(
			record(["v1.0.0", OID_A, "commit", "", "", "Release"])
		);

		expect(tags[0]).toEqual({
			createdAt: null,
			message: "Release",
			name: "v1.0.0",
			oid: OID_A,
			targetOid: OID_A,
			type: "lightweight",
		});
	});

	test("parses annotated tags and peeled targets", () => {
		const tags = parseTags(
			record(["v2.0.0", OID_A, "tag", OID_B, "2026-01-02T03:04:05Z", "Major"])
		);

		expect(tags[0]).toMatchObject({
			createdAt: "2026-01-02T03:04:05Z",
			targetOid: OID_B,
			type: "annotated",
		});
	});

	test("ignores malformed tags", () => {
		expect(parseTags("v1\0\n")).toEqual([]);
	});
});

describe("parseStashes", () => {
	test("parses structured stash entries", () => {
		const stashes = parseStashes(
			record(["stash@{0}", OID_A, "2026-01-02T03:04:05Z", "On main: WIP"])
		);

		expect(stashes[0]).toEqual({
			createdAt: "2026-01-02T03:04:05Z",
			oid: OID_A,
			reference: "stash@{0}",
			summary: "On main: WIP",
		});
	});

	test("parses multiple stash records", () => {
		const stashes = parseStashes(
			[
				record(["stash@{0}", OID_A, "2026-01-02T03:04:05Z", "First"]).trimEnd(),
				record([
					"stash@{1}",
					OID_B,
					"2026-01-01T03:04:05Z",
					"Second",
				]).trimEnd(),
				"",
			].join("\n")
		);

		expect(stashes).toHaveLength(2);
	});
});
