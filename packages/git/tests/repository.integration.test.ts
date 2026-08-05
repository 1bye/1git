import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { GitRepository } from "../src/repository.js";
import {
	RepositoryFixtures,
	unwrapResult,
} from "./_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

describe("GitRepository local workflow", () => {
	test("opens a repository from a nested file path", async () => {
		const fixture = await fixtures.create();
		await fixture.write("src/nested.ts", "export const value = 1;\n");

		const repository = unwrapResult(
			await GitRepository.open({
				path: join(fixture.repositoryPath, "src/nested.ts"),
			})
		);

		expect(repository.info.root).toBe(fixture.repositoryPath);
		expect(repository.info.isBare).toBe(false);
		expect(repository.info.gitDirectory).toEndWith(".git");
	});

	test("returns a structured error outside a repository", async () => {
		const fixture = await fixtures.create();
		const result = await GitRepository.open({ path: fixture.sandboxPath });

		expect(result).toMatchObject({
			error: {
				code: "not-a-repository",
				operation: "open-repository",
			},
			ok: false,
		});
	});

	test("initializes a repository with a selected initial branch", async () => {
		const fixture = await fixtures.create();
		const initialized = unwrapResult(
			await GitRepository.initialize({
				initialBranch: "trunk",
				path: fixture.path("initialized"),
			})
		);
		const snapshot = unwrapResult(await initialized.getSnapshot());

		expect(snapshot.head).toMatchObject({
			branch: "trunk",
			oid: null,
			unborn: true,
		});
	});

	test("reports untracked, staged, and modified paths", async () => {
		const fixture = await fixtures.create();
		await fixture.write("README.md", "# Changed\n");
		await fixture.write("new file.txt", "new\n");
		await fixture.write("staged.txt", "staged\n");
		unwrapResult(await fixture.repository.stage({ paths: ["staged.txt"] }));

		const snapshot = unwrapResult(await fixture.repository.getSnapshot());
		const changes = new Map(snapshot.files.map((file) => [file.path, file]));

		expect(changes.get("README.md")?.worktreeStatus).toBe("modified");
		expect(changes.get("new file.txt")?.worktreeStatus).toBe("untracked");
		expect(changes.get("staged.txt")?.indexStatus).toBe("added");
	});

	test("includes ignored paths only when requested", async () => {
		const fixture = await fixtures.create();
		await fixture.write(".gitignore", "ignored.txt\n");
		await fixture.write("ignored.txt", "ignored\n");

		const normal = unwrapResult(await fixture.repository.getSnapshot());
		const withIgnored = unwrapResult(
			await fixture.repository.getSnapshot({ includeIgnored: true })
		);

		expect(normal.files.some((file) => file.path === "ignored.txt")).toBe(
			false
		);
		expect(
			withIgnored.files.find((file) => file.path === "ignored.txt")
		).toMatchObject({
			recordType: "ignored",
			worktreeStatus: "ignored",
		});
	});

	test("stages and unstages selected paths", async () => {
		const fixture = await fixtures.create();
		await fixture.write("one.txt", "one\n");
		await fixture.write("two.txt", "two\n");

		const staged = unwrapResult(
			await fixture.repository.stage({ paths: ["one.txt"] })
		);
		const unstaged = unwrapResult(
			await fixture.repository.unstage({ paths: ["one.txt"] })
		);

		expect(
			staged.files.find((file) => file.path === "one.txt")?.indexStatus
		).toBe("added");
		expect(
			staged.files.find((file) => file.path === "two.txt")?.worktreeStatus
		).toBe("untracked");
		expect(
			unstaged.files.find((file) => file.path === "one.txt")?.worktreeStatus
		).toBe("untracked");
	});

	test("stages, unstages, and discards individual hunks", async () => {
		const fixture = await fixtures.create();
		const originalLines = Array.from(
			{ length: 20 },
			(_, index) => `line ${index + 1}`
		);
		await fixture.write("hunks.txt", `${originalLines.join("\n")}\n`);
		await fixture.commitAll("add hunk fixture");
		const changedLines = [...originalLines];
		changedLines[1] = "line 2 changed";
		changedLines[17] = "line 18 changed";
		await fixture.write("hunks.txt", `${changedLines.join("\n")}\n`);

		unwrapResult(
			await fixture.repository.changeHunk({
				action: "stage",
				hunkIndex: 0,
				path: "hunks.txt",
			})
		);
		expect(
			await fixture.git(["diff", "--cached", "--", "hunks.txt"])
		).toContain("line 2 changed");
		expect(
			await fixture.git(["diff", "--cached", "--", "hunks.txt"])
		).not.toContain("line 18 changed");

		unwrapResult(
			await fixture.repository.changeHunk({
				action: "unstage",
				hunkIndex: 0,
				path: "hunks.txt",
			})
		);
		expect(await fixture.git(["diff", "--cached", "--", "hunks.txt"])).toBe("");

		unwrapResult(
			await fixture.repository.changeHunk({
				action: "discard",
				allowDestructive: true,
				hunkIndex: 1,
				path: "hunks.txt",
			})
		);
		const worktreeContent = await fixture.read("hunks.txt");
		expect(worktreeContent).toContain("line 2 changed");
		expect(worktreeContent).toContain("line 18\n");
		expect(worktreeContent).not.toContain("line 18 changed");
	});

	test("requires explicit consent before discarding a hunk", async () => {
		const fixture = await fixtures.create();
		await fixture.write("README.md", "# Changed\n");

		const result = await fixture.repository.changeHunk({
			action: "discard",
			hunkIndex: 0,
			path: "README.md",
		});

		expect(result).toMatchObject({
			error: { code: "invalid-input", operation: "change-hunk" },
			ok: false,
		});
		expect(await fixture.read("README.md")).toBe("# Changed\n");
	});

	test("stages and unstages all paths", async () => {
		const fixture = await fixtures.create();
		await fixture.write("one.txt", "one\n");
		await fixture.write("two.txt", "two\n");

		const staged = unwrapResult(await fixture.repository.stageAll());
		const unstaged = unwrapResult(await fixture.repository.unstageAll());

		expect(staged.files.every((file) => file.indexStatus === "added")).toBe(
			true
		);
		expect(
			unstaged.files.every((file) => file.worktreeStatus === "untracked")
		).toBe(true);
	});

	test("unstages paths in an unborn repository", async () => {
		const fixture = await fixtures.create({ initialCommit: false });
		await fixture.write("first.txt", "first\n");
		unwrapResult(await fixture.repository.stage({ paths: ["first.txt"] }));

		const snapshot = unwrapResult(
			await fixture.repository.unstage({ paths: ["first.txt"] })
		);

		expect(snapshot.files[0]).toMatchObject({
			path: "first.txt",
			worktreeStatus: "untracked",
		});
	});

	test("creates a structured commit and refreshes the snapshot", async () => {
		const fixture = await fixtures.create();
		await fixture.write("feature.txt", "feature\n");
		unwrapResult(await fixture.repository.stage({ paths: ["feature.txt"] }));

		const result = unwrapResult(
			await fixture.repository.commit({
				description: "Detailed description.",
				summary: "feat: add feature",
			})
		);

		expect(result.commit.summary).toBe("feat: add feature");
		expect(result.commit.body).toContain("Detailed description.");
		expect(result.snapshot.files).toEqual([]);
		expect(result.snapshot.head.oid).toBe(result.commit.oid);
	});

	test("rejects empty commit summaries before invoking Git", async () => {
		const fixture = await fixtures.create();
		const result = await fixture.repository.commit({ summary: "   " });

		expect(result).toMatchObject({
			error: { code: "invalid-input", operation: "commit" },
			ok: false,
		});
	});

	test("returns paginated history", async () => {
		const fixture = await fixtures.create();
		await fixture.write("one.txt", "one\n");
		await fixture.commitAll("second");
		await fixture.write("two.txt", "two\n");
		await fixture.commitAll("third");

		const firstPage = unwrapResult(
			await fixture.repository.getHistory({ limit: 2 })
		);
		const secondPage = unwrapResult(
			await fixture.repository.getHistory({
				limit: 2,
				offset: firstPage.nextOffset ?? 0,
			})
		);

		expect(firstPage.commits.map((commit) => commit.summary)).toEqual([
			"third",
			"second",
		]);
		expect(firstPage.hasMore).toBe(true);
		expect(secondPage.commits[0]?.summary).toBe("initial commit");
		expect(secondPage.hasMore).toBe(false);
	});

	test("returns empty history for an unborn repository", async () => {
		const fixture = await fixtures.create({ initialCommit: false });

		expect(unwrapResult(await fixture.repository.getHistory())).toEqual({
			commits: [],
			hasMore: false,
			nextOffset: null,
		});
	});

	test("loads one commit by revision", async () => {
		const fixture = await fixtures.create();
		const commit = unwrapResult(await fixture.repository.getCommit("HEAD"));

		expect(commit.summary).toBe("initial commit");
		expect(commit.oid).toHaveLength(40);
	});

	test("returns a working-tree diff and statistics", async () => {
		const fixture = await fixtures.create();
		await fixture.write("README.md", "# Updated\nSecond line\n");

		const diff = unwrapResult(
			await fixture.repository.getDiff({ target: { kind: "working" } })
		);

		expect(diff.patch).toContain("diff --git a/README.md b/README.md");
		expect(diff.patch).toContain("+Second line");
		expect(diff.stats[0]).toMatchObject({
			path: "README.md",
		});
	});

	test("returns a staged diff scoped to paths", async () => {
		const fixture = await fixtures.create();
		await fixture.write("staged.txt", "staged\n");
		await fixture.write("ignored-by-scope.txt", "other\n");
		unwrapResult(await fixture.repository.stageAll());

		const diff = unwrapResult(
			await fixture.repository.getDiff({
				paths: ["staged.txt"],
				target: { kind: "staged" },
			})
		);

		expect(diff.patch).toContain("staged.txt");
		expect(diff.patch).not.toContain("ignored-by-scope.txt");
	});

	test("returns commit and range diffs", async () => {
		const fixture = await fixtures.create();
		await fixture.write("feature.txt", "feature\n");
		await fixture.commitAll("feature");

		const commitDiff = unwrapResult(
			await fixture.repository.getDiff({
				target: { kind: "commit", revision: "HEAD" },
			})
		);
		const rangeDiff = unwrapResult(
			await fixture.repository.getDiff({
				target: { base: "HEAD~1", head: "HEAD", kind: "range" },
			})
		);

		expect(commitDiff.patch).toContain("feature.txt");
		expect(rangeDiff.patch).toContain("feature.txt");
	});

	test("loads UTF-8 file content at a revision", async () => {
		const fixture = await fixtures.create();
		const content = unwrapResult(
			await fixture.repository.getFileContent({
				path: "README.md",
				revision: "HEAD",
			})
		);

		expect(content).toMatchObject({
			content: "# Test repository\n",
			encoding: "utf8",
			path: "README.md",
		});
	});

	test("encodes binary file content as base64", async () => {
		const fixture = await fixtures.create();
		await fixture.write("binary.bin", new Uint8Array([0xff, 0xfe, 0x00, 0x81]));
		await fixture.commitAll("binary");

		const content = unwrapResult(
			await fixture.repository.getFileContent({
				path: "binary.bin",
				revision: "HEAD",
			})
		);

		expect(content.encoding).toBe("base64");
		expect(Buffer.from(content.content, "base64")).toEqual(
			Buffer.from([0xff, 0xfe, 0x00, 0x81])
		);
	});

	test("requires explicit consent before restoring worktree content", async () => {
		const fixture = await fixtures.create();
		await fixture.write("README.md", "discard me\n");

		const rejected = await fixture.repository.restore({
			allowDestructive: false,
			paths: ["README.md"],
		});
		const restored = unwrapResult(
			await fixture.repository.restore({
				allowDestructive: true,
				paths: ["README.md"],
			})
		);

		expect(rejected).toMatchObject({
			error: { code: "invalid-input" },
			ok: false,
		});
		expect(restored.files).toEqual([]);
		expect(await fixture.read("README.md")).toBe("# Test repository\n");
	});

	test("requires explicit consent before hard reset", async () => {
		const fixture = await fixtures.create();
		await fixture.write("README.md", "changed\n");
		await fixture.commitAll("changed");

		const rejected = await fixture.repository.reset({
			mode: "hard",
			target: "HEAD~1",
		});
		const reset = unwrapResult(
			await fixture.repository.reset({
				allowDestructive: true,
				mode: "hard",
				target: "HEAD~1",
			})
		);

		expect(rejected).toMatchObject({
			error: { code: "invalid-input" },
			ok: false,
		});
		expect(reset.files).toEqual([]);
		expect(await fixture.read("README.md")).toBe("# Test repository\n");
	});

	test("reads, writes, and removes local configuration", async () => {
		const fixture = await fixtures.create();

		const missing = unwrapResult(
			await fixture.repository.getConfig({ key: "onegit.test-value" })
		);
		const written = unwrapResult(
			await fixture.repository.setConfig({
				key: "onegit.test-value",
				value: "hello",
			})
		);
		const read = unwrapResult(
			await fixture.repository.getConfig({ key: "onegit.test-value" })
		);
		const removed = unwrapResult(
			await fixture.repository.unsetConfig({ key: "onegit.test-value" })
		);

		expect(missing.value).toBeNull();
		expect(written.value).toBe("hello");
		expect(read.value).toBe("hello");
		expect(removed.value).toBeNull();
	});

	test("returns aborted results without invoking Git", async () => {
		const fixture = await fixtures.create();
		const controller = new AbortController();
		controller.abort();

		const result = await fixture.repository.stageAll({
			signal: controller.signal,
		});

		expect(result).toMatchObject({
			error: { code: "aborted", operation: "stage-all" },
			ok: false,
		});
	});

	test("serializes concurrent mutations", async () => {
		const fixture = await fixtures.create();
		await fixture.write("one.txt", "one\n");
		await fixture.write("two.txt", "two\n");

		const [one, two] = await Promise.all([
			fixture.repository.stage({ paths: ["one.txt"] }),
			fixture.repository.stage({ paths: ["two.txt"] }),
		]);
		const snapshot = unwrapResult(await fixture.repository.getSnapshot());

		expect(one.ok).toBe(true);
		expect(two.ok).toBe(true);
		expect(
			snapshot.files.filter((file) => file.indexStatus === "added")
		).toHaveLength(2);
	});
});
