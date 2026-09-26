/**
 * Covers: saved staged/unstaged/untracked files, renames/deletions, immutable text/image/SVG previews and read-only safety.
 * Real: shared Git backend, stash/diff readers, Sharp and disposable Git repositories.
 * Doubles: none.
 * Requires: Git, Sharp and writable temporary storage; no network or graphics.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { RepositoryStashes } from "../../src/feature/repository-workspace/lib/repository-stashes";
import { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import type { WorkspaceEntry } from "../../src/feature/repository-workspace/types";
import {
	previewPixel,
	rasterContent,
	svgContent,
} from "../_shared/image-content";

const execute = promisify(execFile);
let repository: string;
const signal = (): AbortSignal => new AbortController().signal;

const git = async (...args: string[]): Promise<string> => {
	const result = await execute(
		"git",
		[
			"--literal-pathspecs",
			"-c",
			"user.name=Stash Test",
			"-c",
			"user.email=stash@example.invalid",
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

	return result.stdout.trimEnd();
};

beforeEach(async () => {
	repository = await realpath(await mkdtemp(join(tmpdir(), "gpuix-stashes-")));
	await git("init", "--initial-branch=main");
	await git("config", "core.fsmonitor", "false");
});
afterEach(async () => {
	await rm(repository, { recursive: true, force: true });
});

const files = async (oid: string) => {
	const result = await RepositoryStashes.readFiles(repository, oid, signal());

	if (!result.ok) throw new Error(result.error.message);

	return result.value;
};

const diff = async (file: WorkspaceEntry | undefined) => {
	if (!file?.commitFile) throw new Error("Missing saved file");

	const result = await RepositoryDiff.read(
		repository,
		file.commitFile,
		signal()
	);

	if (!result.ok) throw new Error(result.error.message);

	return result.value[0];
};

it("reads both tracked and saved untracked snapshots without changing HEAD, index, working files or stashes", async () => {
	expect(await RepositoryStashes.read(repository, signal())).toEqual({
		ok: true,
		value: [],
	});

	for (const path of ["staged.txt", "working.txt", "rename.txt", "deleted.txt"])
		await writeFile(join(repository, path), `original ${path}\n`);

	await git("add", ".");
	await git("commit", "-m", "Base");
	await writeFile(join(repository, "staged.txt"), "staged snapshot\n");
	await git("add", "staged.txt");
	await writeFile(join(repository, "working.txt"), "working snapshot\n");
	await git("mv", "rename.txt", "renamed.txt");
	await git("rm", "deleted.txt");
	const unusual = "café [one]\tline\nfile.txt";

	await writeFile(join(repository, unusual), "untracked snapshot\n");
	await git("stash", "push", "-u", "-m", "Saved work");
	const oid = await git("rev-parse", "refs/stash");

	await writeFile(join(repository, "staged.txt"), "later staged\n");
	await git("add", "staged.txt");
	await writeFile(join(repository, "staged.txt"), "later working\n");
	const head = await git("rev-parse", "HEAD");
	const index = await readFile(join(repository, ".git/index"));
	const reflog = await readFile(join(repository, ".git/logs/refs/stash"));
	const list = await RepositoryStashes.read(repository, signal());

	if (!list.ok) throw new Error(list.error.message);

	expect(list.value[0]).toMatchObject({
		oid,
		reference: "stash@{0}",
		summary: "On main: Saved work",
	});
	expect(list.value[0]?.createdAt).toMatch(/^\d{4}-/u);
	const entries = await files(oid);
	const find = (path: string) => entries.find((file) => file.title === path);

	expect(entries).toHaveLength(5);
	expect((await diff(find("staged.txt")))?.patch).toContain("+staged snapshot");
	expect((await diff(find("working.txt")))?.patch).toContain(
		"+working snapshot"
	);
	expect(find("renamed.txt")?.commitFile?.originalPath).toBe("rename.txt");
	expect((await diff(find("deleted.txt")))?.patch).toContain("-original");
	expect((await diff(find(unusual)))?.patch).toContain("+untracked snapshot");
	expect(find(unusual)?.status).toBe("A");
	expect(find(unusual)?.commitFile?.commit).toBe(
		await git("rev-parse", `${oid}^3`)
	);
	expect(await readFile(join(repository, ".git/index"))).toEqual(index);
	expect(await readFile(join(repository, ".git/logs/refs/stash"))).toEqual(
		reflog
	);
	expect(await git("rev-parse", "HEAD")).toBe(head);
	expect(await git("rev-parse", "refs/stash")).toBe(oid);
	expect(await readFile(join(repository, "staged.txt"), "utf8")).toBe(
		"later working\n"
	);
});

it("previews saved image versions and untracked SVG source even after stash references are renumbered", async () => {
	const red = await rasterContent("png", "red");
	const green = await rasterContent("png", "lime");

	await writeFile(
		join(repository, "image.png"),
		Buffer.from(red.content, "base64")
	);
	await git("add", ".");
	await git("commit", "-m", "Image");
	await writeFile(
		join(repository, "image.png"),
		Buffer.from(green.content, "base64")
	);
	await writeFile(join(repository, "icon.svg"), svgContent().content);
	await git("stash", "push", "-u", "-m", "Image snapshots");
	const oid = await git("rev-parse", "refs/stash");

	await git("rm", "image.png");
	await git("stash", "push", "-m", "Deleted image");
	const deleted = await git("rev-parse", "refs/stash");
	const entries = await files(oid);

	const comparison = (
		await diff(entries.find((file) => file.title === "image.png"))
	)?.image;

	expect(await previewPixel(comparison?.before?.image?.src ?? "")).toEqual([
		255, 0, 0, 255,
	]);
	expect(await previewPixel(comparison?.after?.image?.src ?? "")).toEqual([
		0, 255, 0, 255,
	]);
	const svg = await diff(entries.find((file) => file.title === "icon.svg"));

	expect(svg?.image?.svg).toBe(true);
	expect(svg?.image?.before).toBeNull();
	expect(svg?.patch).toContain("+<svg");
	expect((await diff((await files(deleted))[0]))?.image?.after).toBeNull();
	expect(await git("rev-parse", "stash@{1}")).toBe(oid);
});

it("keeps distinct tracked and untracked snapshots with the same path and reports invalid or cancelled reads", async () => {
	await writeFile(join(repository, "same.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
	await git("rm", "--cached", "same.txt");
	await writeFile(join(repository, "same.txt"), "untracked\n");
	await git("stash", "push", "-u", "-m", "Untrack file");
	const entries = await files(await git("rev-parse", "refs/stash"));

	expect(entries.map((file) => file.status)).toEqual(["M", "A"]);
	expect(new Set(entries.map((file) => file.id)).size).toBe(2);
	expect((await diff(entries[0]))?.patch).toContain("-base");
	expect((await diff(entries[1]))?.patch).toContain("+untracked");
	expect(
		(await RepositoryStashes.readFiles(repository, "missing-ref", signal())).ok
	).toBe(false);
	const controller = new AbortController();

	controller.abort();
	expect((await RepositoryStashes.read(repository, controller.signal)).ok).toBe(
		false
	);
});
