/**
 * Covers: real staged/unstaged patches, special paths, renames/deletions, binary/large files and safe read-only execution.
 * Real: RepositoryDiff, shared Git backend and disposable Git repositories.
 * Doubles: none.
 * Requires: Git on PATH and writable temporary storage; no network or graphics.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import {
	mkdtemp,
	readFile,
	realpath,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	RepositoryDiff,
	diffLimits,
} from "../../src/feature/repository-workspace/lib/repository-diff";
import { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";

const execute = promisify(execFile);
let repository: string;

const git = async (...args: string[]): Promise<string> => {
	const result = await execute(
		"git",
		[
			"--literal-pathspecs",
			"-c",
			"user.name=GPUIX Test",
			"-c",
			"user.email=diff@example.invalid",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			...args,
		],
		{
			cwd: repository,
			env: {
				...process.env,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
			},
		}
	);

	return result.stdout;
};

beforeEach(async () => {
	repository = await realpath(await mkdtemp(join(tmpdir(), "gpuix-diff-")));
	await git("init", "--initial-branch=main");
	await git("config", "core.fsmonitor", "false");
});
afterEach(async () => {
	await rm(repository, { recursive: true, force: true });
});

const read = async (path: string) => {
	const status = await RepositoryReader.read(
		repository,
		new AbortController().signal
	);

	if (!status.ok) throw new Error(status.error.message);

	const change = status.value.files.find((file) => file.path === path);

	if (!change) throw new Error(`No changed file: ${path}`);

	const result = await RepositoryDiff.read(
		repository,
		change,
		new AbortController().signal
	);

	if (!result.ok) throw new Error(result.error.message);

	return result.value;
};

it("shows both stages of a file without changing HEAD, index content or working files", async () => {
	await writeFile(join(repository, "file.ts"), "const value = 1;\n");
	await git("add", "file.ts");
	await git("commit", "-m", "Fixture");
	await writeFile(join(repository, "file.ts"), "const value = 2;\n");
	await git("add", "file.ts");
	await writeFile(join(repository, "file.ts"), "const value = 3;\n");
	const head = await git("rev-parse", "HEAD");
	const index = await git("ls-files", "--stage", "-z");
	const sections = await read("file.ts");

	expect(sections.map((section) => section.target)).toEqual([
		"working",
		"staged",
	]);
	expect(sections[0]?.patch).toContain("-const value = 2;\n+const value = 3;");
	expect(sections[1]?.patch).toContain("-const value = 1;\n+const value = 2;");
	expect(sections[0]?.stats).toEqual([
		{ path: "file.ts", addedLines: 1, deletedLines: 1 },
	]);
	expect(sections[1]?.stats).toEqual([
		{ path: "file.ts", addedLines: 1, deletedLines: 1 },
	]);
	expect(await git("rev-parse", "HEAD")).toBe(head);
	expect(await git("ls-files", "--stage", "-z")).toBe(index);
	expect(await readFile(join(repository, "file.ts"), "utf8")).toBe(
		"const value = 3;\n"
	);
});

it("handles untracked and empty files on an unborn branch, deletions and pure renames", async () => {
	await writeFile(join(repository, "new.txt"), "new content");
	await writeFile(join(repository, "empty.txt"), "");
	expect((await read("new.txt"))[0]?.patch).toContain("+new content");
	expect((await read("new.txt"))[0]?.stats).toEqual([
		{ path: "new.txt", addedLines: 1, deletedLines: 0 },
	]);
	expect((await read("new.txt"))[0]?.patch).toContain(
		"No newline at end of file"
	);
	expect((await read("empty.txt"))[0]?.message).toBeNull();
	expect((await read("empty.txt"))[0]?.stats).toEqual([
		{ path: "empty.txt", addedLines: 0, deletedLines: 0 },
	]);
	await git("add", "new.txt", "empty.txt");
	expect((await read("new.txt"))[0]?.target).toBe("staged");
	await git("commit", "-m", "Fixture");
	await git("mv", "new.txt", "renamed.txt");
	const rename = (await read("renamed.txt"))[0];

	expect(rename?.target).toBe("staged");
	expect(rename?.patch).toContain("rename from new.txt");
	expect(rename?.patch).toContain("rename to renamed.txt");
	expect(rename?.stats).toEqual([
		{
			path: "renamed.txt",
			originalPath: "new.txt",
			addedLines: 0,
			deletedLines: 0,
		},
	]);
	await git("commit", "-m", "Rename fixture");
	await unlink(join(repository, "renamed.txt"));
	expect((await read("renamed.txt"))[0]?.patch).toContain("-new content");
});

it("treats special filenames literally and never invokes external diff or textconv drivers", async () => {
	await writeFile(join(repository, "[one].txt"), "literal before\n");
	await writeFile(join(repository, "o.txt"), "wrong file before\n");
	await git("add", "[one].txt", "o.txt");
	await git("commit", "-m", "Fixture");
	await writeFile(join(repository, "[one].txt"), "literal after\n");
	await writeFile(join(repository, "o.txt"), "WRONG FILE AFTER\n");
	await writeFile(join(repository, ".gitattributes"), "*.txt diff=preview\n");
	await git("config", "diff.preview.textconv", "false");
	await git("config", "diff.external", "false");
	const section = (await read("[one].txt"))[0];

	expect(section?.patch).toContain("+literal after");
	expect(section?.patch).not.toContain("WRONG FILE AFTER");
	const unusual = "café [new]\nfile.txt";

	await writeFile(join(repository, unusual), "unusual content\n");
	expect((await read(unusual))[0]?.patch).toContain("+unusual content");
});

it("reports binary and oversized files explicitly without handing partial patches to native rendering", async () => {
	await writeFile(join(repository, "binary.bin"), Buffer.from([0, 1, 2, 3]));
	await writeFile(
		join(repository, "large.txt"),
		"x\n".repeat(diffLimits.bytes)
	);
	await writeFile(
		join(repository, "many-lines.txt"),
		"x\n".repeat(diffLimits.lines)
	);
	const binary = (await read("binary.bin"))[0];

	expect(binary?.message).toContain("Binary file");
	expect(binary?.patch).toBe("");
	expect(binary?.stats).toEqual([
		{ path: "binary.bin", addedLines: null, deletedLines: null },
	]);

	for (const name of ["large.txt", "many-lines.txt"]) {
		const section = (await read(name))[0];

		expect(section?.message).toContain("too large");
		expect(section?.patch).toBe("");
	}
});
