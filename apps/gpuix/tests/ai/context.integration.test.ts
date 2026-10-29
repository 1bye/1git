/**
 * Covers: exact selected files/lines, hidden whitespace changes, untracked files, stale patches and unchanged staging.
 * Real: commit context, partial patches, shared Git backend and a disposable repository.
 * Doubles: none.
 * Requires: Git and writable temporary storage; no network, credentials or graphics.
 */
import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GitRepository } from "@1git/git";
import { CommitContext } from "../../src/feature/ai/lib/commit-context";
import { RepositoryWorkspaceModel } from "../../src/feature/repository-workspace/lib/repository-workspace-model";
import { SelectedDiff } from "../../src/feature/ai/lib/selected-diff";

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

it("collects selected tracked and untracked filenames containing tabs", async () => {
	const tracked = "tracked\tfile.txt";
	const untracked = "new\tfile.txt";

	await writeFile(join(directory, tracked), "before\n");
	await git("add", tracked);
	await git("commit", "-m", "Tabbed filename");
	await writeFile(join(directory, tracked), "tracked-selection\n");
	await writeFile(join(directory, untracked), "new-selection\n");
	const captured = await state();
	const index = await readFile(join(directory, ".git/index"));

	const diff = await captured.repository.getDiff({
		target: { kind: "changes" },
		paths: [tracked, untracked],
	});

	if (!diff.ok) throw new Error(diff.error.message);

	expect(diff.value.stats.map((stat) => stat.path)).toEqual([
		tracked,
		untracked,
	]);
	const patch = await CommitContext.read(
		{ ...captured.state, includedFileIds: [tracked, untracked] },
		new AbortController().signal
	);

	expect(patch).toContain("+tracked-selection");
	expect(patch).toContain("+new-selection");
	expect(await readFile(join(directory, ".git/index"))).toEqual(index);
});

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
	const input = { ...captured.state, includedFileIds: ["selected.txt"] };

	await expect(
		CommitContext.read(input, new AbortController().signal)
	).rejects.toThrow("branch changed");
	const cancelled = new AbortController();

	cancelled.abort();
	await expect(CommitContext.read(input, cancelled.signal)).rejects.toThrow();
});

it("collects large file selections in bounded batches without exposing binary contents", async () => {
	const paths = Array.from({ length: 100 }, (_, index) => `file-${index}.txt`);

	await Promise.all(
		paths.map(
			async (path) => await writeFile(join(directory, path), "before\n")
		)
	);
	await writeFile(
		join(directory, 'binary "π".dat'),
		Buffer.from("\0PRIVATE_BINARY_BEFORE")
	);
	await git("add", ".");
	await git("commit", "-m", "Many files");
	await Promise.all(
		paths.map(
			async (path) => await writeFile(join(directory, path), `after-${path}\n`)
		)
	);
	await writeFile(
		join(directory, 'binary "π".dat'),
		Buffer.from("\0PRIVATE_BINARY_AFTER")
	);
	const captured = await state();
	const diff = spyOn(GitRepository.prototype, "getDiff");

	try {
		const patch = await CommitContext.read(
			{
				...captured.state,
				includedFileIds: captured.state.entries.changes.map(
					(entry) => entry.id
				),
			},
			new AbortController().signal
		);

		for (const path of paths) expect(patch).toContain(`+after-${path}`);

		expect(patch).toContain("Binary files");
		expect(patch).not.toContain("PRIVATE_BINARY");
		expect(diff.mock.calls.length).toBeLessThan(10);
	} finally {
		diff.mockRestore();
	}
});

it("collects a diff beyond the previous Git output limit and isolates a partial selection before paging", async () => {
	const original =
		Array.from({ length: 12000 }, (_, line) => `original-${line}`).join("\n") +
		"\n";

	await writeFile(join(directory, "selected.txt"), original);
	await git("add", "selected.txt");
	await git("commit", "-m", "Large base");
	await writeFile(
		join(directory, "selected.txt"),
		"FIRST_SELECTED\n" +
			Array.from(
				{ length: 11999 },
				(_, line) => `PRIVATE_UNSELECTED-${line}`
			).join("\n") +
			"\n"
	);
	await writeFile(join(directory, "unchecked.txt"), "PRIVATE_UNCHECKED_FILE\n");
	const captured = await state();

	const diff = await captured.repository.getDiff({
		target: { kind: "changes" },
		paths: ["selected.txt"],
		ignoreWhitespace: false,
	});

	if (!diff.ok) throw new Error(diff.error.message);

	expect(Buffer.byteLength(diff.value.patch)).toBeGreaterThan(192 * 1024);
	const limited = await GitRepository.open({
		path: directory,
		runtime: { maxOutputBytes: 192 * 1024 },
	});

	if (!limited.ok) throw new Error(limited.error.message);

	const omitted = await limited.value.getDiff({
		target: { kind: "changes" },
		paths: ["selected.txt"],
	});

	if (!omitted.ok) throw new Error(omitted.error.message);

	expect(omitted.value.patchOmittedReason).toBe("too-large");
	const index = await readFile(join(directory, ".git/index"));
	const input = { ...captured.state, includedFileIds: ["selected.txt"] };
	const full = await CommitContext.read(input, new AbortController().signal);

	expect(full).toContain("PRIVATE_UNSELECTED-11998");
	expect(full).not.toContain("PRIVATE_UNCHECKED_FILE");
	const partial = await CommitContext.read(
		{
			...input,
			partialFiles: {
				"selected.txt": {
					expectedPatch: diff.value.patch,
					includedLines: ["-:1", "+:1"],
				},
			},
		},
		new AbortController().signal
	);

	const pages = new SelectedDiff(partial);

	const reconstructed = pages.files
		.flatMap((file) =>
			Array.from(
				{ length: file.pages },
				(_, page) => pages.read(file.id, page).text
			)
		)
		.join("");

	expect(reconstructed).toBe(partial);
	expect(reconstructed).toContain("FIRST_SELECTED");
	expect(reconstructed).not.toContain("PRIVATE_UNSELECTED");
	expect(reconstructed).not.toContain("PRIVATE_UNCHECKED_FILE");
	expect(pages.search("PRIVATE_UNSELECTED").matches).toEqual([]);
	expect(pages.search("PRIVATE_UNCHECKED_FILE").matches).toEqual([]);
	expect(await readFile(join(directory, ".git/index"))).toEqual(index);
});
