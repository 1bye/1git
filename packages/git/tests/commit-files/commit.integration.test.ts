/**
 * Covers: selected whole-file commits, excluded staging, unborn/worktree repositories, hook failures and preflight safety.
 * Real: Git backend and isolated repositories, indexes and hooks.
 * Doubles: Git executable wrappers inject post-write process and refresh failures.
 * Requires: Git and writable temporary storage; no network.
 */
import { afterEach, expect, it } from "bun:test";
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GitRepository } from "../../src/repository.js";
import {
	RepositoryFixtures,
	type RepositoryFixture,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

afterEach(async () => {
	await fixtures.cleanup();
});

const input = async (fixture: RepositoryFixture, paths: readonly string[]) => {
	const snapshot = unwrapResult(await fixture.repository.getSnapshot());

	return {
		paths,
		message: "Selected files\n\nKeep excluded work staged.",
		expectedHead: snapshot.head.oid,
		expectedBranch: snapshot.head.branch,
	};
};

it("commits only checked tracked/new/deleted/renamed paths and retains excluded staged and working contents", async () => {
	const fixture = await fixtures.create();

	for (const path of [
		"selected.txt",
		"excluded.txt",
		"deleted.txt",
		"working-deleted.txt",
		"rename.txt",
	])
		await fixture.write(path, `base ${path}\n`);

	await fixture.commitAll("Base");
	await fixture.write("excluded.txt", "staged excluded\n");
	await fixture.git(["add", "excluded.txt"]);
	await fixture.write("excluded.txt", "working excluded\n");
	await fixture.write("selected.txt", "selected\n");
	await fixture.git(["rm", "deleted.txt"]);
	await fixture.remove("working-deleted.txt");
	await fixture.git(["mv", "rename.txt", "renamed.txt"]);
	const unusual = "new [file]\t\n:name.txt";

	await fixture.write(unusual, "new\n");
	const result = unwrapResult(
		await fixture.repository.commitFiles(
			await input(fixture, [
				"selected.txt",
				"deleted.txt",
				"working-deleted.txt",
				"renamed.txt",
				unusual,
			])
		)
	);

	expect(result.outcome).toBe("committed");
	expect(result.warning).toBeNull();
	expect(result.snapshot?.files.map((file) => file.path)).toEqual([
		"excluded.txt",
	]);
	expect(await fixture.git(["show", "HEAD:excluded.txt"])).toBe(
		"base excluded.txt"
	);
	expect(await fixture.git(["show", ":excluded.txt"])).toBe("staged excluded");
	expect(await fixture.read("excluded.txt")).toBe("working excluded\n");
	expect(await fixture.git(["show", "HEAD:selected.txt"])).toBe("selected");
	expect(await fixture.git(["show", `HEAD:${unusual}`])).toBe("new");
	expect(await fixture.git(["log", "-1", "--format=%B"])).toBe(
		"Selected files\n\nKeep excluded work staged."
	);
	expect(await readdir(fixture.repository.info.gitDirectory)).not.toContain(
		"index.lock"
	);
	expect(
		(await readdir(fixture.repository.info.gitDirectory)).filter((name) =>
			name.startsWith("1git-commit-")
		)
	).toEqual([]);
});

it("creates the first commit without including excluded additions", async () => {
	const fixture = await fixtures.create({ initialCommit: false });

	await fixture.write("selected.txt", "first\n");
	await fixture.write("excluded.txt", "excluded\n");
	await fixture.git(["add", "excluded.txt"]);
	const result = unwrapResult(
		await fixture.repository.commitFiles(await input(fixture, ["selected.txt"]))
	);

	expect(result.outcome).toBe("committed");
	expect(await fixture.git(["ls-tree", "--name-only", "HEAD"])).toBe(
		"selected.txt"
	);
	expect(await fixture.git(["diff", "--cached", "--name-only"])).toBe(
		"excluded.txt"
	);
});

it("rejects a file replaced by a directory instead of including unchecked descendants", async () => {
	const fixture = await fixtures.create();
	const head = await fixture.git(["rev-parse", "HEAD"]);

	await fixture.remove("README.md");
	await fixture.write("README.md/unchecked.txt", "keep outside commit\n");
	const indexPath = join(fixture.repository.info.gitDirectory, "index");
	const index = await readFile(indexPath);

	const result = await fixture.repository.commitFiles(
		await input(fixture, ["README.md"])
	);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.message).toContain("directory");

	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
	expect(await readFile(indexPath)).toEqual(index);
	expect(await fixture.read("README.md/unchecked.txt")).toBe(
		"keep outside commit\n"
	);
});

it("leaves the exact index and HEAD intact after a rejected hook, and honors hooks on success", async () => {
	const fixture = await fixtures.create();

	await fixture.write("README.md", "staged\n");
	await fixture.git(["add", "README.md"]);
	await fixture.write("new.txt", "new\n");
	const request = await input(fixture, ["new.txt"]);

	const index = await readFile(
		join(fixture.repository.info.gitDirectory, "index")
	);

	const hook = join(
		fixture.repository.info.gitDirectory,
		"hooks",
		"pre-commit"
	);

	await fixture.git([
		"config",
		"core.hooksPath",
		join(fixture.repository.info.gitDirectory, "hooks"),
	]);
	await writeFile(hook, "#!/bin/sh\necho commit-blocked >&2\nexit 1\n");
	await chmod(hook, 0o700);
	const result = await fixture.repository.commitFiles(request);

	expect(result.ok).toBe(false);

	if (!result.ok) expect(result.error.details).toContain("commit-blocked");

	expect(
		await readFile(join(fixture.repository.info.gitDirectory, "index"))
	).toEqual(index);
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(
		request.expectedHead ?? ""
	);
	expect(await fixture.read("new.txt")).toBe("new\n");
	await writeFile(hook, "#!/bin/sh\nexit 0\n");
	expect(
		unwrapResult(await fixture.repository.commitFiles(request)).outcome
	).toBe("committed");
	expect(await fixture.git(["diff", "--cached", "--name-only"])).toBe(
		"README.md"
	);
});

it("rejects partial staging, stale HEAD, broad paths, active operations and existing locks before changing the index", async () => {
	const fixture = await fixtures.create();

	await fixture.write("README.md", "staged\n");
	await fixture.git(["add", "README.md"]);
	await fixture.write("README.md", "working\n");
	const request = await input(fixture, ["README.md"]);

	const index = await readFile(
		join(fixture.repository.info.gitDirectory, "index")
	);

	const partial = await fixture.repository.commitFiles(request);

	expect(partial.ok).toBe(false);

	if (!partial.ok) expect(partial.error.message).toContain("partially staged");

	for (const invalid of [
		{ ...request, expectedHead: "obsolete" },
		{ ...request, paths: ["."] },
		{ ...request, paths: ["../outside"] },
		{ ...request, message: "\nMissing summary" },
	])
		expect((await fixture.repository.commitFiles(invalid)).ok).toBe(false);

	await writeFile(
		join(fixture.repository.info.gitDirectory, "MERGE_HEAD"),
		`${request.expectedHead}\n`
	);
	expect((await fixture.repository.commitFiles(request)).ok).toBe(false);
	expect(
		await readFile(join(fixture.repository.info.gitDirectory, "index"))
	).toEqual(index);
	await writeFile(
		join(fixture.repository.info.gitDirectory, "index.lock"),
		"another process"
	);
	const locked = await fixture.repository.commitFiles(request);

	expect(locked.ok).toBe(false);

	if (!locked.ok) expect(locked.error.code).toBe("repository-locked");

	expect(
		await readFile(
			join(fixture.repository.info.gitDirectory, "index.lock"),
			"utf8"
		)
	).toBe("another process");
});

it("uses a linked worktree's own index and branch, and supports detached HEAD", async () => {
	const fixture = await fixtures.create();
	const path = fixture.path("linked");

	await fixture.git(["worktree", "add", "-b", "linked", path]);
	const repository = unwrapResult(await GitRepository.open({ path }));
	const before = unwrapResult(await repository.getSnapshot());

	await writeFile(join(path, "linked.txt"), "linked\n");
	const result = unwrapResult(
		await repository.commitFiles({
			paths: ["linked.txt"],
			message: "Linked",
			expectedHead: before.head.oid,
			expectedBranch: "linked",
		})
	);

	expect(result.outcome).toBe("committed");
	expect(await fixture.git(["rev-parse", "HEAD"])).toBe(before.head.oid ?? "");
	await fixture.git(["checkout", "--detach"]);
	await fixture.write("detached.txt", "detached\n");
	expect(
		unwrapResult(
			await fixture.repository.commitFiles(
				await input(fixture, ["detached.txt"])
			)
		).snapshot?.head.detached
	).toBe(true);
});

it.each(["refresh", "outcome"] as const)(
	"does not report a retryable failure after a confirmed write with a %s failure",
	async (failure) => {
		const fixture = await fixtures.create();
		const executable = fixture.path("git-wrapper.sh");

		await writeFile(
			executable,
			[
				"#!/bin/sh",
				"if [ -f .git/fail-refresh ]; then exit 1; fi",
				'for argument in "$@"; do',
				'  if [ "$argument" = "commit" ]; then',
				'    git "$@" || exit "$?"',
				failure === "refresh" ? "    touch .git/fail-refresh" : "    exit 1",
				"    exit 0",
				"  fi",
				"done",
				'exec git "$@"',
				"",
			].join("\n")
		);
		await chmod(executable, 0o700);
		const repository = unwrapResult(
			await GitRepository.open({
				path: fixture.repositoryPath,
				runtime: { executable },
			})
		);

		await fixture.write("new.txt", "new\n");
		const request = await input(fixture, ["new.txt"]);
		const indexPath = join(fixture.repository.info.gitDirectory, "index");
		const index = await readFile(indexPath);
		const result = unwrapResult(await repository.commitFiles(request));

		expect(await fixture.git(["rev-parse", "HEAD"])).not.toBe(
			request.expectedHead
		);
		expect(await fixture.git(["show", "HEAD:new.txt"])).toBe("new");
		expect(result.outcome).toBe(
			failure === "refresh" ? "committed" : "unknown"
		);
		expect(result.warning).toContain(
			failure === "refresh" ? "refreshing" : "uncertain"
		);

		if (failure === "refresh") expect(result.snapshot).toBeNull();
		else {
			expect(await readFile(indexPath)).toEqual(index);
			expect(
				(await readdir(fixture.repository.info.gitDirectory)).filter((name) =>
					name.startsWith("1git-commit-")
				)
			).toHaveLength(1);
		}

		expect(await readdir(fixture.repository.info.gitDirectory)).not.toContain(
			"index.lock"
		);
	}
);
