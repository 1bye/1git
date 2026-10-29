/**
 * Covers: literal file history, rename/deletion tracking, anchored pagination, merge parents and read-only guards.
 * Real: Git and disposable repositories/worktrees.
 * Doubles: none.
 * Requires: Git and temporary storage; no network or user repositories.
 */
import { afterEach, expect, it } from "bun:test";
import {
	RepositoryFixtures,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

it("filters ordinary history by exact filenames instead of Git pathspec patterns", async () => {
	const fixture = await fixtures.create();
	const paths = ["[id].txt", ":(glob)*.txt"];

	for (const path of [...paths, "i.txt"]) await fixture.write(path, "base\n");

	const wanted = await fixture.commitAll("Add files");

	await fixture.write("i.txt", "unrelated edit\n");
	await fixture.commitAll("Other file");
	const head = await fixture.git(["rev-parse", "HEAD"]);
	const index = await fixture.git(["write-tree"]);

	for (const path of paths) {
		const result = unwrapResult(
			await fixture.repository.getHistory({ paths: [path], limit: 1 })
		);

		expect(result.commits.map((commit) => commit.oid)).toEqual([wanted]);
		expect(result.hasMore).toBe(false);
	}

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
	expect(await fixture.git(["write-tree"])).toBe(index);
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
});

it("follows renames through paginated edits and deletion without changing HEAD, index or files", async () => {
	const fixture = await fixtures.create();
	const oldPath = "old\tname\n\x1e.txt";
	const path = "renamed[1].txt";

	await fixture.write(oldPath, "original\n");
	const added = await fixture.commitAll("Add file");

	await fixture.git(["mv", oldPath, path]);
	const renamed = await fixture.commitAll("Rename file");

	await fixture.write(path, "original\nedited\n");
	await fixture.write("other.txt", "unrelated file in the same commit\n");
	const edited = await fixture.commitAll("Edit file");

	await fixture.remove(path);
	const deleted = await fixture.commitAll("Delete file");

	await fixture.write("unrelated.txt", "later\n");
	const head = await fixture.commitAll("Unrelated later commit");
	const index = await fixture.git(["write-tree"]);

	const first = unwrapResult(
		await fixture.repository.getHistory({
			revision: head,
			filePath: path,
			limit: 2,
		})
	);

	expect(first.commits.map((commit) => commit.oid)).toEqual([deleted, edited]);
	expect(first.nextOffset).toBe(2);
	expect(first.commits[0]?.historyFile?.status).toBe("D");
	expect(first.commits[0]?.parentOids).toEqual([edited]);
	await fixture.write("new.txt", "new commit after the anchored read\n");
	const newest = await fixture.commitAll("New HEAD");

	const second = unwrapResult(
		await fixture.repository.getHistory({
			revision: head,
			filePath: path,
			limit: 2,
			offset: 2,
		})
	);

	expect(second.commits.map((commit) => commit.oid)).toEqual([renamed, added]);
	expect(second.hasMore).toBe(false);
	expect(second.commits[0]?.historyFile).toMatchObject({
		path,
		originalPath: oldPath,
		status: "R",
	});
	expect(second.commits[1]?.historyFile?.path).toBe(oldPath);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(newest);
	const historical = unwrapResult(
		await fixture.repository.getHistory({ revision: added, filePath: oldPath })
	);

	expect(historical.commits.map((commit) => commit.oid)).toEqual([added]);
	expect(await fixture.git(["rev-parse", `${head}^{tree}`])).toBe(index);
	expect(await fixture.read("new.txt")).toContain("new commit");
	expect(await fixture.git(["status", "--porcelain"])).toBe("");
});

it("uses literal pathspecs and returns no commits for a file that was never committed", async () => {
	const fixture = await fixtures.create();
	const path = ":(glob)*.txt";

	await fixture.write(path, "literal\n");
	const wanted = await fixture.commitAll("Literal filename");

	await fixture.write("other.txt", "not the requested file\n");
	await fixture.commitAll("Other file");
	const head = await fixture.git(["rev-parse", "HEAD"]);

	const result = unwrapResult(
		await fixture.repository.getHistory({ revision: head, filePath: path })
	);

	expect(result.commits.map((commit) => commit.oid)).toEqual([wanted]);
	expect(result.commits[0]?.historyFile?.path).toBe(path);
	expect(
		unwrapResult(await fixture.repository.getHistory({ filePath: "new.txt" }))
			.commits
	).toEqual([]);

	for (const filePath of ["", "../outside", "/absolute", "nul\0.txt"])
		expect((await fixture.repository.getHistory({ filePath })).ok).toBe(false);

	expect(
		(await fixture.repository.getHistory({ filePath: path, paths: [path] })).ok
	).toBe(false);
	expect(
		(
			await fixture.repository.getHistory({
				filePath: path,
				signal: AbortSignal.abort(),
			})
		).ok
	).toBe(false);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
});

it("shows a merge's first-parent file change while retaining the commit's real parents", async () => {
	const fixture = await fixtures.create();

	await fixture.git(["checkout", "-b", "side"]);
	await fixture.write("file.txt", "from side\n");
	const side = await fixture.commitAll("Side file");

	await fixture.git(["checkout", "main"]);
	await fixture.write("main.txt", "main\n");
	const main = await fixture.commitAll("Main work");

	await fixture.git(["merge", "--no-ff", "side", "-m", "Merge side"]);
	const merge = await fixture.git(["rev-parse", "HEAD"]);

	const result = unwrapResult(
		await fixture.repository.getHistory({
			revision: merge,
			filePath: "file.txt",
		})
	);

	expect(result.commits[0]?.oid).toBe(merge);
	expect(result.commits[0]?.parentOids).toEqual([main, side]);
	expect(result.commits[0]?.historyFile).toMatchObject({
		path: "file.txt",
		status: "A",
	});
	expect(result.commits.some((commit) => commit.oid === side)).toBe(false);
});
