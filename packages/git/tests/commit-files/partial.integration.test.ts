/**
 * Covers: line inclusion, partial deletion/addition, stale selections, excluded staging and hook failures.
 * Real: Git transactions, patches and isolated repositories.
 * Doubles: none.
 * Requires: Git and writable temporary storage; no network.
 */
import { afterEach, expect, it } from "bun:test";
import { chmod } from "node:fs/promises";
import {
	RepositoryFixtures,
	type RepositoryFixture,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

async function selection(
	fixture: RepositoryFixture,
	path: string,
	includedLines: readonly string[]
) {
	const snapshot = unwrapResult(await fixture.repository.getSnapshot());

	const { patch } = unwrapResult(
		await fixture.repository.getDiff({
			paths: [path],
			target: { kind: "changes" },
		})
	);

	return {
		paths: [path],
		message: "Partial commit",
		includePartialStaging: true,
		expectedHead: snapshot.head.oid,
		expectedBranch: snapshot.head.branch,
		partialFiles: [{ path, expectedPatch: patch, includedLines }],
	};
}

it("commits chosen replacement lines and a whole file, leaving excluded edits and staging intact", async () => {
	const fixture = await fixtures.create();

	await fixture.write("partial.txt", "one\ntwo\nthree\nfour\n");
	await fixture.write("excluded.txt", "base\n");
	await fixture.commitAll("Base");
	await fixture.write("partial.txt", "ONE\ntwo\nTHREE\nfour\n");
	await fixture.write("excluded.txt", "staged\n");
	await fixture.git(["add", "excluded.txt"]);
	await fixture.write("excluded.txt", "working\n");
	await fixture.write("whole.txt", "whole\n");
	const originalIndex = await fixture.git(["show", ":excluded.txt"]);
	const input = await selection(fixture, "partial.txt", ["-:1", "+:1"]);

	const result = unwrapResult(
		await fixture.repository.commitFiles({
			...input,
			paths: ["partial.txt", "whole.txt"],
		})
	);

	expect(result.outcome).toBe("committed");
	expect(await fixture.git(["show", "HEAD:partial.txt"])).toBe(
		"ONE\ntwo\nthree\nfour"
	);
	expect(await fixture.read("partial.txt")).toBe("ONE\ntwo\nTHREE\nfour\n");
	expect(await fixture.git(["show", "HEAD:whole.txt"])).toBe("whole");
	expect(await fixture.git(["show", ":excluded.txt"])).toBe(originalIndex);
	expect(await fixture.git(["diff", "--cached", "--", "partial.txt"])).toBe("");
	expect(await fixture.git(["diff", "--", "partial.txt"])).toContain("+THREE");
});

it("handles omitted additions and deletions across multiple hunks", async () => {
	const fixture = await fixtures.create();
	const base = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);

	await fixture.write("multi.txt", `${base.join("\n")}\n`);
	await fixture.commitAll("Base");
	await fixture.write(
		"multi.txt",
		`extra\n${base.slice(0, 27).join("\n")}\nLAST\n${base.slice(28).join("\n")}\n`
	);
	unwrapResult(
		await fixture.repository.commitFiles(
			await selection(fixture, "multi.txt", ["-:28", "+:29"])
		)
	);
	base[27] = "LAST";
	expect(await fixture.git(["show", "HEAD:multi.txt"])).toBe(base.join("\n"));
	expect(await fixture.read("multi.txt")).toStartWith("extra\n");
});

it("partially commits a new file without a final newline, including on an unborn branch", async () => {
	const fixture = await fixtures.create({ initialCommit: false });

	await fixture.write("new file.txt", "first\nsecond");
	unwrapResult(
		await fixture.repository.commitFiles(
			await selection(fixture, "new file.txt", ["+:2"])
		)
	);
	expect(await fixture.git(["show", "HEAD:new file.txt"])).toBe("second");
	expect(await fixture.read("new file.txt")).toBe("first\nsecond");
});

it("partially commits a deleted file without deleting it from the commit", async () => {
	const fixture = await fixtures.create();

	await fixture.write("deleted.txt", "one\ntwo\nthree\n");
	await fixture.commitAll("Base");
	await fixture.remove("deleted.txt");
	unwrapResult(
		await fixture.repository.commitFiles(
			await selection(fixture, "deleted.txt", ["-:2"])
		)
	);
	expect(await fixture.git(["show", "HEAD:deleted.txt"])).toBe("one\nthree");
	expect(await fixture.git(["diff", "--cached"])).toBe("");
});

it("rejects changed patches and unknown line keys before changing HEAD or the index", async () => {
	const fixture = await fixtures.create();

	await fixture.write("file.txt", "one\ntwo\n");
	await fixture.commitAll("Base");
	await fixture.write("file.txt", "ONE\nTWO\n");
	const input = await selection(fixture, "file.txt", ["+:1"]);
	const head = await fixture.git(["rev-parse", "HEAD"]);
	const index = await fixture.git(["ls-files", "--stage"]);

	await fixture.write("file.txt", "different\n");
	const stale = await fixture.repository.commitFiles(input);

	expect(stale.ok).toBe(false);

	if (!stale.ok) expect(stale.error.message).toContain("changed since");

	const invalid = await fixture.repository.commitFiles(
		await selection(fixture, "file.txt", ["+:999"])
	);

	expect(invalid.ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
	expect(await fixture.git(["ls-files", "--stage"])).toBe(index);
});

it("honors failing commit hooks without touching the working file or original index", async () => {
	const fixture = await fixtures.create();

	await fixture.write("file.txt", "base\n");
	await fixture.commitAll("Base");
	await fixture.write("file.txt", "first\nsecond\n");
	await fixture.write(".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
	await chmod(`${fixture.repositoryPath}/.git/hooks/pre-commit`, 0o755);
	const head = await fixture.git(["rev-parse", "HEAD"]);
	const index = await fixture.git(["ls-files", "--stage"]);

	const result = await fixture.repository.commitFiles(
		await selection(fixture, "file.txt", ["-:1", "+:1"])
	);

	expect(result.ok).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
	expect(await fixture.git(["ls-files", "--stage"])).toBe(index);
	expect(await fixture.read("file.txt")).toBe("first\nsecond\n");
});
