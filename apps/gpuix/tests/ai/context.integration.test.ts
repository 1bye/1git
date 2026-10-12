/**
 * Covers: exact selected files/lines, hidden whitespace changes, untracked files, stale patches and unchanged staging.
 * Real: commit context, partial patches, shared Git backend and a disposable repository.
 * Doubles: none.
 * Requires: Git and writable temporary storage; no network, credentials or graphics.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GitRepository } from "@1git/git";
import { CommitContext } from "../../src/feature/ai/lib/commit-context";
import { RepositoryWorkspaceModel } from "../../src/feature/repository-workspace/lib/repository-workspace-model";

const execute = promisify(execFile);
let directory: string;

async function git(...args: string[]): Promise<string> {
	const result = await execute(
		"git",
		[
			"-c",
			"user.name=AI Context Test",
			"-c",
			"user.email=ai@example.invalid",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			...args,
		],
		{
			cwd: directory,
			env: {
				...process.env,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
			},
		}
	);

	return result.stdout.trimEnd();
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "1git-ai-context-"));
	await git("init", "--initial-branch=main");
	await writeFile(join(directory, "selected.txt"), "one\ntwo\nthree\n");
	await writeFile(join(directory, "unchecked.txt"), "old\n");
	await git("add", ".");
	await git("commit", "-m", "Initial");
});
afterEach(async () => await rm(directory, { recursive: true, force: true }));

async function state() {
	const opened = await GitRepository.open({ path: directory });

	if (!opened.ok) throw new Error(opened.error.message);

	const snapshot = await opened.value.getSnapshot();

	if (!snapshot.ok) throw new Error(snapshot.error.message);

	return {
		repository: opened.value,
		state: RepositoryWorkspaceModel.reduce(RepositoryWorkspaceModel.create(), {
			type: "loaded",
			snapshot: snapshot.value,
		}),
	};
}

it("sends only selected changes including untracked files, without changing the index or working files", async () => {
	await writeFile(join(directory, "selected.txt"), "one\nchanged\nthree\n");
	await git("add", "selected.txt");
	await writeFile(
		join(directory, "unchecked.txt"),
		"unchecked-sensitive-data\n"
	);
	await writeFile(join(directory, "new.txt"), "selected-new-file\n");
	const index = await readFile(join(directory, ".git/index"));
	const captured = await state();

	const input = {
		...captured.state,
		includedFileIds: ["selected.txt", "new.txt"],
	};

	const patch = await CommitContext.read(input, new AbortController().signal);

	expect(patch).toContain("+changed");
	expect(patch).toContain("+selected-new-file");
	expect(patch).not.toContain("unchecked-sensitive-data");
	expect(patch).not.toContain("unchecked.txt");
	expect(await readFile(join(directory, ".git/index"))).toEqual(index);
	expect(await readFile(join(directory, "unchecked.txt"), "utf8")).toBe(
		"unchecked-sensitive-data\n"
	);
});

it("uses the canonical patch for partial lines and includes selected whitespace changes", async () => {
	await writeFile(
		join(directory, "selected.txt"),
		"one  \nsecond-selected\nthird-unselected\n"
	);
	const captured = await state();

	const full = await captured.repository.getDiff({
		target: { kind: "changes" },
		paths: ["selected.txt"],
		ignoreWhitespace: false,
	});

	if (!full.ok) throw new Error(full.error.message);

	const input = {
		...captured.state,
		includedFileIds: ["selected.txt"],
		partialFiles: {
			"selected.txt": {
				expectedPatch: full.value.patch,
				includedLines: ["+:1", "-:1", "+:2", "-:2"],
			},
		},
	};

	const patch = await CommitContext.read(input, new AbortController().signal);

	expect(patch).toContain("+one  \n");
	expect(patch).toContain("+second-selected");
	expect(patch).not.toContain("third-unselected");
	await writeFile(join(directory, "selected.txt"), "changed-after-review\n");
	await expect(
		CommitContext.read(input, new AbortController().signal)
	).rejects.toThrow("Selected lines changed");
});

it("rejects a changed branch and cancellation before collecting a prompt", async () => {
	await writeFile(join(directory, "selected.txt"), "changed\n");
	const captured = await state();

	await git("commit", "--allow-empty", "-m", "New tip");
	await expect(
		CommitContext.read(captured.state, new AbortController().signal)
	).rejects.toThrow("branch changed");
	const cancelled = new AbortController();

	cancelled.abort();
	await expect(
		CommitContext.read(captured.state, cancelled.signal)
	).rejects.toThrow();
});
