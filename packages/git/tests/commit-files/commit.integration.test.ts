/**
 * Covers: selected whole-file commits, excluded staging, unborn/worktree repositories, hook failures and preflight safety.
 * Real: Git backend and isolated repositories, indexes and hooks.
 * Doubles: Git executable wrappers inject post-write process and refresh failures.
 * Requires: Git and writable temporary storage; no network.
 */
import { afterEach, expect, it } from "bun:test";
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GitRepository } from "../../src/repository.js";
import {
	RepositoryFixtures,
	type RepositoryFixture,
	unwrapResult,
} from "../_shared/repository-fixture.js";

const fixtures = new RepositoryFixtures();

it("stages and unstages a reviewed hunk, then commits only the index", async () => {
	const fixture = await fixtures.create();
	const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`);

	await fixture.write("partial.txt", `${lines.join("\n")}\n`);
	await fixture.commitAll("Base");
	lines[1] = "first change";
	lines[28] = "second change";
	const working = `${lines.join("\n")}\n`;

	await fixture.write("partial.txt", working);
	const patch = unwrapResult(
		await fixture.repository.getDiff({
			paths: ["partial.txt"],
			target: { kind: "working" },
		})
	).patch;

	unwrapResult(
		await fixture.repository.changeHunk({
			path: "partial.txt",
			action: "stage",
			hunkIndex: 0,
			expectedPatch: patch,
		})
	);
	expect(await fixture.git(["show", ":partial.txt"])).toContain("first change");
	expect(await fixture.git(["show", ":partial.txt"])).not.toContain(
		"second change"
	);
	expect(
		(
			await fixture.repository.changeHunk({
				path: "partial.txt",
				action: "stage",
				hunkIndex: 0,
				expectedPatch: patch,
			})
		).ok
	).toBe(false);
	const staged = unwrapResult(
		await fixture.repository.getDiff({
			paths: ["partial.txt"],
			target: { kind: "staged" },
		})
	).patch;

	unwrapResult(
		await fixture.repository.changeHunk({
			path: "partial.txt",
			action: "unstage",
			hunkIndex: 0,
			expectedPatch: staged,
		})
	);
	expect(await fixture.git(["diff", "--cached"])).toBe("");
	unwrapResult(
		await fixture.repository.changeHunk({
			path: "partial.txt",
			action: "stage",
			hunkIndex: 0,
			expectedPatch: patch,
		})
	);
	const result = unwrapResult(
		await fixture.repository.commitFiles({
			...(await input(fixture, [])),
			mode: "staged",
		})
	);

	expect(result.outcome).toBe("committed");
	expect(await fixture.git(["show", "HEAD:partial.txt"])).toContain(
		"first change"
	);
	expect(await fixture.git(["show", "HEAD:partial.txt"])).not.toContain(
		"second change"
	);
	expect(await fixture.read("partial.txt")).toBe(working);
	expect(await fixture.git(["diff", "--cached"])).toBe("");
	expect(await fixture.git(["diff"])).toContain("second change");
});

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

it.each(["modified", "new", "renamed", "deleted", "recreated"] as const)(
	"can explicitly commit a complete %s file while preserving unchecked staging",
	async (kind) => {
		const fixture = await fixtures.create();

		const unchangedLines =
			kind === "renamed" ? "\nanchor one\nanchor two\nanchor three" : "";

		await fixture.write("selected.txt", `base selected${unchangedLines}\n`);
		await fixture.write("excluded.txt", "base excluded\n");
		await fixture.commitAll("Base");
		await fixture.write("excluded.txt", "prepared excluded\n");
		await fixture.git(["add", "excluded.txt"]);
		await fixture.write("excluded.txt", "current excluded\n");
		let path = "selected.txt";

		if (kind === "renamed") {
			await fixture.git(["mv", path, "renamed.txt"]);
			path = "renamed.txt";
		} else if (kind === "new") path = "new.txt";

		await fixture.write(path, `prepared selected${unchangedLines}\n`);
		await fixture.git(["add", path]);

		if (kind === "deleted") await fixture.remove(path);
		else {
			if (kind === "recreated") await fixture.git(["rm", "--force", path]);

			await fixture.write(path, `current selected${unchangedLines}\n`);
		}

		const result = unwrapResult(
			await fixture.repository.commitFiles({
				...(await input(fixture, [path])),
				includePartialStaging: true,
			})
		);

		expect(result.outcome).toBe("committed");

		if (kind === "deleted")
			expect(await fixture.git(["ls-tree", "--name-only", "HEAD", path])).toBe(
				""
			);
		else
			expect(await fixture.git(["show", `HEAD:${path}`])).toBe(
				`current selected${unchangedLines}`
			);

		expect(await fixture.git(["show", "HEAD:excluded.txt"])).toBe(
			"base excluded"
		);
		expect(await fixture.git(["show", ":excluded.txt"])).toBe(
			"prepared excluded"
		);
		expect(await fixture.read("excluded.txt")).toBe("current excluded\n");
		expect(result.snapshot?.files.map((file) => file.path)).toEqual([
			"excluded.txt",
		]);
	}
);

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
	await fixture.git(["add", "new.txt"]);
	await fixture.write("new.txt", "current new\n");
	const request = {
		...(await input(fixture, ["new.txt"])),
		includePartialStaging: true,
	};

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
	expect(await fixture.read("new.txt")).toBe("current new\n");
	await writeFile(hook, "#!/bin/sh\nexit 0\n");
	expect(
		unwrapResult(await fixture.repository.commitFiles(request)).outcome
	).toBe("committed");
	expect(await fixture.git(["show", "HEAD:new.txt"])).toBe("current new");
	expect(await fixture.git(["diff", "--cached", "--name-only"])).toBe(
		"README.md"
	);
});

it("streams hook output before exit and includes changes staged by a formatter", async () => {
	const fixture = await fixtures.create();

	await fixture.write("selected.txt", "unformatted\n");
	await fixture.write("excluded.txt", "keep staged\n");
	await fixture.git(["add", "excluded.txt"]);
	const hook = join(fixture.repository.info.gitDirectory, "hooks/pre-commit");

	await fixture.git([
		"config",
		"core.hooksPath",
		join(fixture.repository.info.gitDirectory, "hooks"),
	]);
	await writeFile(
		hook,
		"#!/bin/sh\nprintf 'formatter running\\n'\ntries=0\nwhile [ ! -f .hook-continue ]; do tries=$((tries + 1)); [ \"$tries\" -lt 100 ] || exit 1; /bin/sleep 0.01; done\nrm .hook-continue\nprintf 'checking hooks\\n' >&2\nprintf 'formatted\\n' > selected.txt\ngit add -- selected.txt\n",
		{ mode: 0o700 }
	);
	const output: string[] = [];
	const phases: string[] = [];

	const result = await fixture.repository.commitFiles({
		...(await input(fixture, ["selected.txt"])),
		onProgress: (progress) => {
			phases.push(progress.phase);

			if (progress.output) {
				output.push(progress.output);

				if (progress.output.includes("formatter running"))
					writeFileSync(
						join(fixture.repositoryPath, ".hook-continue"),
						"continue"
					);
			}
		},
	});

	expect(unwrapResult(result).outcome).toBe("committed");
	expect(output.join("")).toContain("formatter running");
	expect(output.join("")).toContain("checking hooks");
	expect(phases[0]).toBe("preparing");
	expect(phases.at(-1)).toBe("refreshing");
	expect(await fixture.git(["show", "HEAD:selected.txt"])).toBe("formatted");
	expect(await fixture.git(["diff", "--cached", "--name-only"])).toBe(
		"excluded.txt"
	);
});

it.each(["pre-commit", "post-commit"] as const)(
	"cancels a stuck %s process tree and checks HEAD before reporting the outcome",
	async (name) => {
		const fixture = await fixtures.create();

		await fixture.write("selected.txt", "selected\n");
		const request = await input(fixture, ["selected.txt"]);
		const indexPath = join(fixture.repository.info.gitDirectory, "index");
		const index = await readFile(indexPath);
		const controller = new AbortController();
		const hook = join(fixture.repository.info.gitDirectory, "hooks", name);

		await fixture.git([
			"config",
			"core.hooksPath",
			join(fixture.repository.info.gitDirectory, "hooks"),
		]);
		await writeFile(
			hook,
			"#!/bin/sh\ntrap '' TERM\nprintf 'hook waiting\\n' >&2\n/bin/sleep 60 &\nwait\n",
			{ mode: 0o700 }
		);
		const result = await fixture.repository.commitFiles({
			...request,
			signal: controller.signal,
			onProgress: (progress) => {
				if (progress.output?.includes("hook waiting")) controller.abort();
			},
		});

		expect(controller.signal.aborted).toBe(true);
		expect(await readFile(indexPath)).toEqual(index);
		const contents = await readdir(fixture.repository.info.gitDirectory);

		expect(contents).not.toContain("index.lock");

		if (name === "pre-commit") {
			expect(result.ok).toBe(false);

			if (!result.ok) expect(result.error.code).toBe("aborted");

			expect(await fixture.git(["rev-parse", "HEAD"])).toBe(
				request.expectedHead ?? ""
			);
			expect(contents.some((entry) => entry.startsWith("1git-commit-"))).toBe(
				false
			);
		} else {
			const committed = unwrapResult(result);

			expect(committed.outcome).toBe("unknown");
			expect(committed.oid).not.toBe(request.expectedHead);
			expect(committed.warning).toContain("Inspect History before retrying");
			expect(contents.some((entry) => entry.startsWith("1git-commit-"))).toBe(
				true
			);
		}
	},
	10000
);

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
				'if [ -f .git/fail-refresh ]; then for argument in "$@"; do [ "$argument" = "status" ] && exit 1; done; fi',
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
