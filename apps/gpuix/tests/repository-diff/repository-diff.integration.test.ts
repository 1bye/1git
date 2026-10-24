/**
 * Covers: complete patches, whitespace filtering/context, image versions, external staging, special paths and read-only execution.
 * Real: RepositoryDiff, shared Git backend and disposable Git repositories.
 * Doubles: none.
 * Requires: Git, Sharp and writable temporary storage; no network or graphics.
 */
import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { GitRepository } from "@1git/git";
import { execFile } from "node:child_process";
import {
	mkdtemp,
	readFile,
	realpath,
	symlink,
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
import { DiffContext } from "../../src/feature/repository-workspace/lib/diff-context";
import { RepositoryPreviewCache } from "../../src/feature/repository-workspace/lib/repository-preview-cache";
import {
	previewPixel,
	rasterContent,
	svgContent,
} from "../_shared/image-content";

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

const read = async (path: string, ignoreWhitespace = false) => {
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
		new AbortController().signal,
		ignoreWhitespace
	);

	if (!result.ok) throw new Error(result.error.message);

	return result.value;
};

it("reads complete unfiltered syntax context without changing visible hunks, selections or repository contents", async () => {
	const path = "context.ts";

	const source = [
		"import { oldName,",
		"} from 'module';",
		...Array.from({ length: 30 }, (_, index) => `// hidden ${index}`),
		"const old = 1;",
		"",
	].join("\n");

	await writeFile(join(repository, path), source);
	await git("add", path);
	await git("commit", "-m", "Base");
	const head = (await git("rev-parse", "HEAD")).trim();

	const changed = source
		.replace("oldName", "newName")
		.replace("const old = 1;", "const revised = 2;")
		.replace("// hidden 15", "//  hidden 15");

	await writeFile(join(repository, path), changed);
	await git("add", path);
	const index = await readFile(join(repository, ".git/index"));
	const sections = await read(path, true);
	const section = sections[0];

	expect(section?.syntaxPatch).toContain(" // hidden 10");
	expect(section?.syntaxPatch).toContain("+//  hidden 15");
	expect(section?.patch).not.toContain("hidden 10");
	expect(section?.patch).not.toContain("+//  hidden 15");
	expect(section?.patch).toContain("+const revised = 2;");
	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
	expect(await readFile(join(repository, path), "utf8")).toBe(changed);
	expect((await git("rev-parse", "HEAD")).trim()).toBe(head);

	await git("commit", "-m", "Change");
	const commit = (await git("rev-parse", "HEAD")).trim();
	const beforeOid = (await git("rev-parse", `${head}:${path}`)).trim();
	const afterOid = (await git("rev-parse", `${commit}:${path}`)).trim();

	for (const selection of [
		{ path, commit, beforeOid, afterOid, status: "M" as const },
		{ path, commit, base: head, beforeOid, afterOid, status: "M" as const },
	]) {
		const result = await RepositoryDiff.read(
			repository,
			selection,
			new AbortController().signal,
			true
		);

		expect(result.ok && result.value[0]?.syntaxPatch).toBe(
			section?.syntaxPatch
		);
		expect(result.ok && result.value[0]?.patch).toBe(section?.patch);
	}
});

it("keeps a small preview usable when complete syntax context exceeds its byte budget", async () => {
	const path = "large.ts";

	const source =
		`${"// hidden context ".repeat(8)}\n`.repeat(4000) + "const old = 1;\n";

	await writeFile(join(repository, path), source);
	await git("add", path);
	await git("commit", "-m", "Large base");
	await writeFile(
		join(repository, path),
		source.replace("const old", "const revised")
	);
	const section = (await read(path))[0];

	expect(section?.message).toBeNull();
	expect(section?.patch).toContain("+const revised = 1;");
	expect(section?.syntaxPatch).toBeUndefined();
});

it("does not attach failed or stale syntax context to a newer visible patch", async () => {
	const patch =
		"diff --git a/context.ts b/context.ts\nindex 1111111..2222222 100644\n--- a/context.ts\n+++ b/context.ts\n@@ -1 +1 @@\n-old\n+new\n";

	const getDiff = spyOn(GitRepository.prototype, "getDiff");
	const target = { kind: "commit" as const, revision: "HEAD" };

	try {
		for (const context of [
			{
				ok: true as const,
				value: {
					target,
					patch: patch.replace("2222222", "3333333"),
					stats: [],
				},
			},
			{
				ok: false as const,
				error: {
					code: "command-failed" as const,
					message: "No context",
					operation: "diff" as const,
					retryable: true,
				},
			},
		]) {
			getDiff.mockResolvedValueOnce({
				ok: true,
				value: { patch, stats: [], target },
			});
			getDiff.mockResolvedValueOnce(context);
			const result = await RepositoryDiff.read(
				repository,
				{
					path: "context.ts",
					commit: "HEAD",
					status: "M",
					beforeOid: "1111111",
					afterOid: "2222222",
				},
				new AbortController().signal
			);

			expect(result.ok && result.value[0]?.patch).toBe(patch);
			expect(result.ok && result.value[0]?.syntaxPatch).toBeUndefined();
		}
	} finally {
		getDiff.mockRestore();
	}
});

it("hides whitespace only in previews and context, retaining index, files and committed comparisons", async () => {
	const path = "example.ts";

	await writeFile(
		join(repository, path),
		"const value = 1;\nconst unchanged = 2;\n"
	);
	await git("add", path);
	await git("commit", "-m", "Base");
	const base = (await git("rev-parse", "HEAD")).trim();
	const contents = "const  value = 1;  \nconst unchanged = 2;\n";

	await writeFile(join(repository, path), contents);
	await git("add", path);
	const index = await readFile(join(repository, ".git/index"));

	expect((await read(path))[0]?.patch).toContain("+const  value = 1;");
	const filtered = (await read(path, true))[0];

	expect(filtered?.patch).toBe("");
	expect(filtered?.message).toBe(
		"No textual changes with whitespace changes hidden."
	);
	expect(filtered?.stats[0]?.addedLines).toBe(1);
	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
	expect(await readFile(join(repository, path), "utf8")).toBe(contents);
	expect((await git("rev-parse", "HEAD")).trim()).toBe(base);

	await git("commit", "-m", "Whitespace");
	const commit = (await git("rev-parse", "HEAD")).trim();
	const beforeOid = (await git("rev-parse", `${base}:${path}`)).trim();
	const afterOid = (await git("rev-parse", `${commit}:${path}`)).trim();
	const selection = { path, status: "M" as const, commit, beforeOid, afterOid };

	for (const change of [selection, { ...selection, base }]) {
		const result = await RepositoryDiff.read(
			repository,
			change,
			new AbortController().signal,
			true
		);

		expect(result.ok && result.value[0]?.patch).toBe("");
		expect(result.ok && result.value[0]?.message).toContain(
			"whitespace changes hidden"
		);
		expect(
			await RepositoryDiff.readContext(
				repository,
				change,
				20,
				new AbortController().signal,
				true
			)
		).toBe("");
	}

	await writeFile(
		join(repository, path),
		"const value = 3;\nconst  unchanged = 2;\n"
	);
	const snapshot = await RepositoryReader.read(
		repository,
		new AbortController().signal
	);

	if (!snapshot.ok || !snapshot.value.files[0])
		throw new Error("Missing whitespace fixture");

	const context = await RepositoryDiff.readContext(
		repository,
		snapshot.value.files[0],
		20,
		new AbortController().signal,
		true
	);

	expect(context).toContain("+const value = 3;");
	expect(context).not.toContain("+const  unchanged = 2;");
});

it("expands only a requested gap from real Git without writing HEAD, index, objects or files", async () => {
	const path = "context [literal].txt";
	const lines = Array.from({ length: 150 }, (_, index) => `line ${index + 1}`);

	await writeFile(join(repository, path), `${lines.join("\n")}\n`);
	await git("add", path);
	await git("commit", "-m", "Context fixture");
	lines[39] = "changed 40";
	lines[99] = "changed 100";
	const contents = `${lines.join("\n")}\n`;

	await writeFile(join(repository, path), contents);
	const head = await git("rev-parse", "HEAD");
	const index = await readFile(join(repository, ".git/index"));
	const objects = await git("count-objects", "-v");

	const snapshot = await RepositoryReader.read(
		repository,
		new AbortController().signal
	);

	if (!snapshot.ok || !snapshot.value.files[0])
		throw new Error("Missing context file.");

	const change = snapshot.value.files[0];
	let patch = (await read(path))[0]?.patch ?? "";

	for (const start of [97, 77, 57]) {
		const request = DiffContext.request(patch, start, start);

		if (!request) throw new Error("Missing context gap.");

		const source = await RepositoryDiff.readContext(
			repository,
			change,
			request.contextLines,
			new AbortController().signal
		);

		patch = DiffContext.expand(patch, source, request);
	}

	expect(patch.match(/^@@ /gm)).toHaveLength(1);
	expect(patch).toContain("@@ -37,67 +37,67 @@");
	expect(patch).toContain(" line 44\n");
	expect(patch).toContain(" line 96\n");
	expect(await git("rev-parse", "HEAD")).toBe(head);
	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
	expect(await git("count-objects", "-v")).toBe(objects);
	expect(await readFile(join(repository, path), "utf8")).toBe(contents);

	const original = (await read(path))[0]?.patch ?? "";
	const request = DiffContext.request(original, 97, 97);

	if (!request) throw new Error("Missing stale context gap.");

	lines[70] = "external edit";
	await writeFile(join(repository, path), `${lines.join("\n")}\n`);
	const stale = await RepositoryDiff.readContext(
		repository,
		change,
		request.contextLines,
		new AbortController().signal
	);

	expect(() => DiffContext.expand(original, stale, request)).toThrow(
		"changed outside"
	);
});

it("expands immutable commit and range context across a rename and unequal line numbers", async () => {
	const lines = Array.from({ length: 150 }, (_, index) => `line ${index + 1}`);

	await writeFile(join(repository, "old.txt"), `${lines.join("\n")}\n`);
	await git("add", "old.txt");
	await git("commit", "-m", "Before rename");
	const base = (await git("rev-parse", "HEAD")).trim();

	await git("mv", "old.txt", "new.txt");
	lines[39] = "changed 40";
	lines.splice(99, 0, "inserted 100");
	lines[119] = "changed 119";
	await writeFile(join(repository, "new.txt"), `${lines.join("\n")}\n`);
	await git("add", "new.txt");
	await git("commit", "-m", "Renamed edits");
	const commit = (await git("rev-parse", "HEAD")).trim();
	const opened = await GitRepository.open({ path: repository });

	if (!opened.ok) throw new Error(opened.error.message);

	const files = await opened.value.getCommitFiles(commit);

	if (!files.ok || !files.value[0]) throw new Error("Missing committed file.");

	expect(files.value[0].originalPath).toBe("old.txt");
	await writeFile(join(repository, "new.txt"), "unrelated working content\n");
	const index = await readFile(join(repository, ".git/index"));

	for (const from of [undefined, base]) {
		const selection = { ...files.value[0], commit, base: from };

		const read = await RepositoryDiff.read(
			repository,
			selection,
			new AbortController().signal
		);

		if (!read.ok) throw new Error(read.error.message);

		const patch = read.value[0]?.patch ?? "";
		const request = DiffContext.request(patch, 116, 117);

		if (!request) throw new Error("Missing shifted context gap.");

		expect(request.lines).toBe(13);
		const source = await RepositoryDiff.readContext(
			repository,
			selection,
			request.contextLines,
			new AbortController().signal
		);

		const expanded = DiffContext.expand(patch, source, request);

		expect(expanded).toContain(" line 103\n");
		expect(expanded).toContain("+inserted 100\n");
		expect(expanded).toContain("+changed 119\n");
		expect(expanded).not.toContain("unrelated working");
		expect(expanded.match(/^@@ /gm)).toHaveLength(2);
	}

	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
	expect(await readFile(join(repository, "new.txt"), "utf8")).toBe(
		"unrelated working content\n"
	);
	expect((await git("rev-parse", "HEAD")).trim()).toBe(commit);
});

it("reuses complete previews and replaces them after a working snapshot refresh without writing Git state", async () => {
	await writeFile(join(repository, "file.ts"), "first content\n");
	await git("add", "file.ts");
	await git("commit", "-m", "Fixture");
	await writeFile(join(repository, "file.ts"), "second content\n");
	const index = await readFile(join(repository, ".git/index"));
	const cache = new RepositoryPreviewCache();

	const snapshot = await RepositoryReader.read(
		repository,
		new AbortController().signal
	);

	if (!snapshot.ok || !snapshot.value.files[0])
		throw new Error("Missing working snapshot.");

	const request = {
		root: repository,
		change: snapshot.value.files[0],
		version: snapshot.value,
	};

	try {
		const cold = await cache.read(request, new AbortController().signal);

		if (!cold.ok) throw new Error(cold.error.message);

		expect(cold.value[0]?.patch).toContain("+second content");
		expect(cache.peek(request)).toBe(cold.value);
		await writeFile(join(repository, "file.ts"), "third content\n");
		const refreshed = await RepositoryReader.read(
			repository,
			new AbortController().signal
		);

		if (!refreshed.ok || !refreshed.value.files[0])
			throw new Error("Missing refreshed working snapshot.");

		const next = {
			root: repository,
			change: refreshed.value.files[0],
			version: refreshed.value,
		};

		cache.retain([next]);
		expect(cache.peek(request)).toBeUndefined();
		const current = await cache.read(next, new AbortController().signal);

		if (!current.ok) throw new Error(current.error.message);

		expect(current.value[0]?.patch).toContain("+third content");
		expect(current.value[0]?.patch).not.toContain("+second content");
		expect(await readFile(join(repository, ".git/index"))).toEqual(index);
		expect(await readFile(join(repository, "file.ts"), "utf8")).toBe(
			"third content\n"
		);
	} finally {
		cache.dispose();
	}
});

it("shows one complete file diff without changing HEAD, index content or working files", async () => {
	await writeFile(join(repository, "file.ts"), "const value = 1;\n");
	await git("add", "file.ts");
	await git("commit", "-m", "Fixture");
	await writeFile(join(repository, "file.ts"), "const value = 2;\n");
	await git("add", "file.ts");
	await writeFile(join(repository, "file.ts"), "const value = 3;\n");
	const head = await git("rev-parse", "HEAD");
	const index = await git("ls-files", "--stage", "-z");
	const sections = await read("file.ts");

	expect(sections.map((section) => section.target)).toEqual(["working"]);
	expect(sections[0]?.patch).toContain("-const value = 1;\n+const value = 3;");
	expect(sections[0]?.patch).not.toContain("const value = 2;");
	expect(sections[0]?.stats).toEqual([
		{ path: "file.ts", addedLines: 1, deletedLines: 1 },
	]);
	expect(await git("rev-parse", "HEAD")).toBe(head);
	expect(await git("ls-files", "--stage", "-z")).toBe(index);
	expect(await readFile(join(repository, "file.ts"), "utf8")).toBe(
		"const value = 3;\n"
	);
});

it("previews tab-indented untracked source without a false binary notice", async () => {
	await writeFile(join(repository, "base.txt"), "base\n");
	await git("add", "base.txt");
	await git("commit", "-m", "Fixture");
	const index = await readFile(join(repository, ".git/index"));
	const source = "export const value = {\n\tfirst: 1,\n\tsecond: 2,\n};\n";

	await writeFile(join(repository, "new.ts"), source);

	for (const ignoreWhitespace of [false, true]) {
		const section = (await read("new.ts", ignoreWhitespace))[0];

		expect(section?.message).toBeNull();
		expect(section?.patch).toContain("+\tsecond: 2,");
		expect(section?.stats).toEqual([
			{ path: "new.ts", addedLines: 4, deletedLines: 0 },
		]);
	}

	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
	expect(await readFile(join(repository, "new.ts"), "utf8")).toBe(source);
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
	expect((await read("new.txt"))[0]?.target).toBe("working");
	await writeFile(join(repository, "new.txt"), "latest first-commit content\n");
	expect((await read("new.txt"))[0]?.patch).toContain(
		"+latest first-commit content"
	);
	await git("add", "new.txt");
	await git("commit", "-m", "Fixture");
	await git("mv", "new.txt", "renamed.txt");
	const rename = (await read("renamed.txt"))[0];

	expect(rename?.target).toBe("working");
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
	expect((await read("renamed.txt"))[0]?.patch).toContain(
		"-latest first-commit content"
	);
});

it("compares removed and recreated files to HEAD, not a deletion plus an addition", async () => {
	await writeFile(join(repository, "file.txt"), "before\n");
	await git("add", "file.txt");
	await git("commit", "-m", "Fixture");
	await git("rm", "file.txt");
	await writeFile(join(repository, "file.txt"), "after\n");
	const index = await readFile(join(repository, ".git/index"));
	const objects = await git("count-objects", "-v");
	const section = (await read("file.txt"))[0];

	expect(section?.patch).toContain("-before\n+after");
	expect(section?.patch).not.toContain("deleted file mode");
	expect(section?.patch).not.toContain("new file mode");
	expect(section?.stats).toEqual([
		{ path: "file.txt", addedLines: 1, deletedLines: 1 },
	]);
	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
	expect(await git("count-objects", "-v")).toBe(objects);
});

it("previews the current image when an indexed deletion was recreated on disk", async () => {
	await writeFile(
		join(repository, "image.png"),
		(await rasterContent("png", "red")).content,
		"base64"
	);
	await git("add", "image.png");
	await git("commit", "-m", "Fixture");
	await git("rm", "image.png");
	await writeFile(
		join(repository, "image.png"),
		(await rasterContent("png", "blue")).content,
		"base64"
	);
	const index = await readFile(join(repository, ".git/index"));
	const preview = (await read("image.png"))[0]?.image;

	expect(await previewPixel(preview?.before?.image?.src ?? "")).toEqual([
		255, 0, 0, 255,
	]);
	expect(await previewPixel(preview?.after?.image?.src ?? "")).toEqual([
		0, 0, 255, 255,
	]);
	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
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

it("previews committed and current image bytes, ignoring intermediate index content", async () => {
	const headImage = await rasterContent("png", "red");
	const indexImage = await rasterContent("png", "lime");
	const workingImage = await rasterContent("png", "blue");

	await writeFile(
		join(repository, "image.png"),
		Buffer.from(headImage.content, "base64")
	);
	await git("add", "image.png");
	await git("commit", "-m", "Image fixture");
	await writeFile(
		join(repository, "image.png"),
		Buffer.from(indexImage.content, "base64")
	);
	await git("add", "image.png");
	await writeFile(
		join(repository, "image.png"),
		Buffer.from(workingImage.content, "base64")
	);
	const index = await git("ls-files", "--stage", "-z");
	const head = await git("rev-parse", "HEAD");
	const sections = await read("image.png");

	const working = sections.find(
		(section) => section.target === "working"
	)?.image;

	expect(await previewPixel(working?.before?.image?.src ?? "")).toEqual([
		255, 0, 0, 255,
	]);
	expect(await previewPixel(working?.after?.image?.src ?? "")).toEqual([
		0, 0, 255, 255,
	]);
	expect(sections).toHaveLength(1);
	expect(await git("ls-files", "--stage", "-z")).toBe(index);
	expect(await git("rev-parse", "HEAD")).toBe(head);
});

it("shows the available image side for additions, renames and deletions", async () => {
	const content = await rasterContent();

	await writeFile(
		join(repository, "new.png"),
		Buffer.from(content.content, "base64")
	);
	const untracked = (await read("new.png"))[0]?.image;

	expect(untracked?.before).toBeNull();
	expect(untracked?.after?.image?.width).toBe(32);
	await git("add", "new.png");
	expect((await read("new.png"))[0]?.image?.before).toBeNull();
	await git("commit", "-m", "Image fixture");
	await git("mv", "new.png", "renamed.png");
	const renamed = (await read("renamed.png"))[0]?.image;

	expect(renamed?.before?.image?.src).toBe(renamed?.after?.image?.src);
	await git("commit", "-m", "Rename image");
	await unlink(join(repository, "renamed.png"));
	const deleted = (await read("renamed.png"))[0]?.image;

	expect(deleted?.before?.image?.width).toBe(32);
	expect(deleted?.after).toBeNull();
	await git("add", "renamed.png");
	expect((await read("renamed.png"))[0]?.image?.after).toBeNull();
});

it("keeps SVG source diffs even when preview validation fails and rejects working symlinks", async () => {
	await writeFile(join(repository, "image.svg"), svgContent().content);
	const valid = (await read("image.svg"))[0];

	expect(valid?.image?.after?.image?.width).toBe(32);
	expect(valid?.patch).toContain("+<svg");
	await writeFile(
		join(repository, "image.svg"),
		'<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>'
	);
	const unsafe = (await read("image.svg"))[0];

	expect(unsafe?.image?.after?.error).toContain("external resources");
	expect(unsafe?.patch).toContain("file:///etc/passwd");
	await symlink("image.svg", join(repository, "link.svg"));
	expect((await read("link.svg"))[0]?.image?.after?.error).toContain(
		"Symbolic links"
	);
});
