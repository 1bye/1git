/**
 * Covers: literal ignore rules, preserved contents/index, reviewed branch guards and unsafe ignore files.
 * Real: Git, filesystem and disposable repositories.
 * Doubles: none.
 * Requires: local Git and temporary storage; no remote or user-config writes.
 */
import { afterEach, expect, it } from "bun:test";
import { link, symlink } from "node:fs/promises";
import { join } from "node:path";
import { GitIgnore } from "../src/ignore.js";
import type { IgnoreRule } from "../src/contracts.js";
import {
	RepositoryFixtures,
	type RepositoryFixture,
	unwrapResult,
} from "./_shared/repository-fixture";

const fixtures = new RepositoryFixtures();

afterEach(async () => await fixtures.cleanup());

const ignore = async (
	fixture: RepositoryFixture,
	path: string,
	rule: IgnoreRule = { kind: "file" }
) => {
	const snapshot = unwrapResult(await fixture.repository.getSnapshot());

	return await fixture.repository.ignoreFile({
		path,
		rule,
		expectedHead: snapshot.head.oid,
		expectedBranch: snapshot.head.branch,
	});
};

it("ignores one literal path with glob characters, spaces and backslashes, not similarly named files", async () => {
	const fixture = await fixtures.create();
	const path = "src/#file[1]*?!\\ .tsx ";

	await fixture.write(path, "keep\n");
	await fixture.write("src/file1.tsx", "also keep\n");

	expect((await ignore(fixture, path)).ok).toBe(true);
	expect(
		await fixture.git(["check-ignore", "-z", "--stdin"], `${path}\0`)
	).toBe(`${path}\0`);
	expect(await fixture.read(path)).toBe("keep\n");
	expect(
		unwrapResult(await fixture.repository.getSnapshot()).files.map(
			(file) => file.path
		)
	).toEqual([".gitignore", "src/file1.tsx"]);
});

it("offers nearest-to-root folders and adds a root-anchored folder rule", async () => {
	const fixture = await fixtures.create();

	await fixture.write("src/cache/a.txt", "a");
	await fixture.write("src/cache/b.bin", "b");
	await fixture.write("other/src/cache/a.txt", "other");

	expect(GitIgnore.folders("src/cache/a.txt")).toEqual(["src/cache", "src"]);
	expect(
		(
			await ignore(fixture, "src/cache/a.txt", {
				kind: "folder",
				path: "src/cache",
			})
		).ok
	).toBe(true);
	expect(await fixture.read(".gitignore")).toBe("/src/cache/\n");
	expect(
		unwrapResult(await fixture.repository.getSnapshot()).files.map(
			(file) => file.path
		)
	).toEqual([".gitignore", "other/src/cache/a.txt"]);
});

it("ignores an extension at every depth, but not dotfiles or other extensions", async () => {
	const fixture = await fixtures.create();

	await fixture.write("one.tsx", "one");
	await fixture.write("nested/two.tsx", "two");
	await fixture.write("nested/two.ts", "keep");

	expect((await ignore(fixture, "one.tsx", { kind: "extension" })).ok).toBe(
		true
	);
	expect(await fixture.read(".gitignore")).toBe("*.tsx\n");
	expect(
		unwrapResult(await fixture.repository.getSnapshot()).files.map(
			(file) => file.path
		)
	).toEqual([".gitignore", "nested/two.ts"]);
	expect(GitIgnore.extension(".env")).toBeNull();
	expect(GitIgnore.extension("file.")).toBeNull();
});

it("preserves existing CRLF contents and missing final newline without repeated additions", async () => {
	const fixture = await fixtures.create();

	await fixture.write(".gitignore", "# existing\r\n*.log");
	await fixture.write("README.md", "changed\n");

	expect((await ignore(fixture, "README.md")).ok).toBe(true);
	expect((await ignore(fixture, "README.md")).ok).toBe(true);
	expect(await fixture.read(".gitignore")).toBe(
		"# existing\r\n*.log\r\n/README.md\r\n"
	);
});

it("keeps tracked files, their staged contents and worktree edits intact", async () => {
	const fixture = await fixtures.create();

	await fixture.write("README.md", "staged\n");
	await fixture.git(["add", "README.md"]);
	await fixture.write("README.md", "working\n");
	const index = await fixture.git(["write-tree"]);
	const head = await fixture.git(["rev-parse", "HEAD"]);

	expect((await ignore(fixture, "README.md")).ok).toBe(true);
	expect(await fixture.git(["write-tree"])).toBe(index);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
	expect(await fixture.git(["show", ":README.md"])).toBe("staged");
	expect(await fixture.read("README.md")).toBe("working\n");
	expect(
		unwrapResult(await fixture.repository.getSnapshot()).files.some(
			(file) => file.path === "README.md"
		)
	).toBe(true);
});

it("appends after an existing negation so the new rule takes precedence", async () => {
	const fixture = await fixtures.create();

	await fixture.write(".gitignore", "/new.txt\n!/new.txt\n");
	await fixture.write("new.txt", "keep");

	expect((await ignore(fixture, "new.txt")).ok).toBe(true);
	expect(await fixture.read(".gitignore")).toBe(
		"/new.txt\n!/new.txt\n/new.txt\n"
	);
	expect(await fixture.git(["check-ignore", "--", "new.txt"])).toBe("new.txt");
});

it("rejects stale branches, missing selections, newline injection and unrelated folders without writing", async () => {
	const fixture = await fixtures.create();

	await fixture.write("new.txt", "keep");
	const snapshot = unwrapResult(await fixture.repository.getSnapshot());

	expect(
		(
			await fixture.repository.ignoreFile({
				path: "new.txt",
				rule: { kind: "file" },
				expectedHead: "stale",
				expectedBranch: "main",
			})
		).ok
	).toBe(false);
	expect(
		(
			await fixture.repository.ignoreFile({
				path: "new.txt",
				rule: { kind: "file" },
				expectedHead: snapshot.head.oid,
				expectedBranch: "other",
			})
		).ok
	).toBe(false);
	expect((await ignore(fixture, "missing.txt")).ok).toBe(false);
	expect(
		(await ignore(fixture, "new.txt", { kind: "folder", path: "elsewhere" })).ok
	).toBe(false);
	expect(() => GitIgnore.pattern("a\n*.ts", { kind: "file" })).toThrow();
	expect(() => GitIgnore.pattern("../outside", { kind: "file" })).toThrow();
	expect(() => GitIgnore.pattern(".git/config", { kind: "file" })).toThrow();
	expect(
		unwrapResult(await fixture.repository.getSnapshot()).files.map(
			(file) => file.path
		)
	).toEqual(["new.txt"]);
});

it("refuses symlinked .gitignore without touching its target", async () => {
	const fixture = await fixtures.create();

	await fixture.write("target", "keep\n");
	await symlink("target", join(fixture.repositoryPath, ".gitignore"));
	await fixture.write("new.txt", "new");

	expect((await ignore(fixture, "new.txt")).ok).toBe(false);
	expect(await fixture.read("target")).toBe("keep\n");
});

it("refuses a hardlinked .gitignore without touching the other link", async () => {
	const fixture = await fixtures.create();

	await fixture.write("target", "keep\n");
	await link(
		join(fixture.repositoryPath, "target"),
		join(fixture.repositoryPath, ".gitignore")
	);
	await fixture.write("new.txt", "new");

	expect((await ignore(fixture, "new.txt")).ok).toBe(false);
	expect(await fixture.read("target")).toBe("keep\n");
});

it("supports unborn branches without creating a commit or staging .gitignore", async () => {
	const fixture = await fixtures.create({ initialCommit: false });

	await fixture.write("new.txt", "new");

	expect((await ignore(fixture, "new.txt")).ok).toBe(true);
	const snapshot = unwrapResult(await fixture.repository.getSnapshot());

	expect(snapshot.head.oid).toBeNull();
	expect(snapshot.files.map((file) => file.path)).toEqual([".gitignore"]);
	expect(await fixture.git(["ls-files"])).toBe("");
});
