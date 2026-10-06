/**
 * Covers: full-path copying, deleted/newline paths and containment checks before OS opening.
 * Real: file-action owner and disposable filesystem paths.
 * Doubles: clipboard writer; no editor, Finder or default application is launched.
 * Requires: temporary storage; no native graphics or user data.
 */
import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepositoryFileActions } from "../../src/feature/repository-workspace/lib/repository-file-actions";
import { NativeClipboard } from "../../src/platform/clipboard";

let directory: string;
let root: string;
let clipboard: ReturnType<typeof spyOn<typeof NativeClipboard, "write">>;

beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "1git-file-paths-")));
	root = join(directory, "repository");
	await mkdir(root);
	clipboard = spyOn(NativeClipboard, "write").mockResolvedValue();
});
afterEach(async () => {
	clipboard.mockRestore();
	await rm(directory, { recursive: true, force: true });
});

it("copies canonical full paths for a batch, including deleted files", async () => {
	await RepositoryFileActions.open(
		root,
		["src/a.tsx", "deleted.txt"],
		"copy-full"
	);

	expect(clipboard).toHaveBeenCalledWith(
		`${root}/src/a.tsx\n${root}/deleted.txt`
	);
});

it("preserves a literal newline in a single filename instead of splitting it into paths", async () => {
	await RepositoryFileActions.open(root, "a\nb.txt", "copy-full");

	expect(clipboard).toHaveBeenCalledWith(`${root}/a\nb.txt`);
});

it("rejects an entire copy batch when any path escapes the repository", async () => {
	await expect(
		RepositoryFileActions.open(root, ["a.txt", "../outside.txt"], "copy-full")
	).rejects.toThrow("inside the repository");
	expect(clipboard).not.toHaveBeenCalled();
});

it("preserves repository-relative batch paths", async () => {
	await RepositoryFileActions.open(root, ["src/a.tsx", "deleted.txt"], "copy");

	expect(clipboard).toHaveBeenCalledWith("src/a.tsx\ndeleted.txt");
});

it("rejects external paths, directories and symlinks before launching the default app or Finder", async () => {
	await writeFile(join(directory, "outside.txt"), "keep");
	await symlink(join(directory, "outside.txt"), join(root, "link.txt"));
	await mkdir(join(root, "folder"));

	for (const kind of ["default", "finder"] as const) {
		await expect(
			RepositoryFileActions.open(root, "../outside.txt", kind)
		).rejects.toThrow("inside the repository");
		await expect(
			RepositoryFileActions.open(root, "link.txt", kind)
		).rejects.toThrow("regular files");
		await expect(
			RepositoryFileActions.open(root, "folder", kind)
		).rejects.toThrow("regular files");
	}
});
