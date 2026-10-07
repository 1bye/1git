/**
 * Covers: byte-exact, read-only history/stash exports, deleted versions and safe failure cleanup.
 * Real: Git readers, Git CLI and private temporary snapshots outside disposable repositories.
 * Doubles: external-editor launch; no application is opened.
 * Requires: Git and writable temporary storage; no network or graphics.
 */
import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { execFile } from "node:child_process";
import {
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { RepositoryFileActions } from "../../src/feature/repository-workspace/lib/repository-file-actions";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryStashes } from "../../src/feature/repository-workspace/lib/repository-stashes";
import { ExternalEditors } from "../../src/feature/editor-settings/external-editors";
import type { CommitFileSelection } from "../../src/feature/repository-workspace/types";

const execute = promisify(execFile);
let repository: string;
let exports: string[];
let editors: ExternalEditors;
let launch: ReturnType<typeof spyOn<ExternalEditors, "open">>;

const git = async (...args: string[]) => {
	const { stdout } = await execute(
		"git",
		[
			"--literal-pathspecs",
			"-c",
			"user.name=Saved File Test",
			"-c",
			"user.email=saved@example.invalid",
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

	return stdout.trimEnd();
};

beforeEach(async () => {
	repository = await realpath(
		await mkdtemp(join(tmpdir(), "1git-revision-action-"))
	);
	exports = [];
	editors = new ExternalEditors(
		join(repository, "unused-editor-settings.json")
	);
	launch = spyOn(editors, "open").mockImplementation(async (absolute) => {
		exports.push(dirname(absolute));
	});
	await git("init", "--initial-branch=main");
	await git("config", "core.fsmonitor", "false");
});
afterEach(async () => {
	launch.mockRestore();
	await rm(repository, { recursive: true, force: true });

	for (const directory of exports)
		await rm(directory, { recursive: true, force: true });
});

const committed = async (path: string): Promise<CommitFileSelection> => {
	const result = await RepositoryHistory.readFiles(
		repository,
		await git("rev-parse", "HEAD"),
		new AbortController().signal
	);

	if (!result.ok) throw new Error(result.error.message);

	const file = result.value.find(
		(entry) => entry.commitFile?.path === path
	)?.commitFile;

	if (!file) throw new Error(`Missing ${path}`);

	return file;
};

const state = async () =>
	await Promise.all([
		git("rev-parse", "HEAD"),
		git("status", "--porcelain=v1"),
		git("diff", "--cached", "--binary"),
		git("stash", "list"),
	]);

it.each([
	["Dockerfile", Buffer.from("\uFEFFFROM saved\r\n")],
	["binary.bin", Buffer.from([0xff, 0xfe, 0x00, 0x81])],
] as const)(
	"opens byte-exact %s from the selected commit, not newer HEAD, index or working contents",
	async (path, bytes) => {
		await writeFile(join(repository, path), bytes);
		await git("add", "--", path);
		await git("commit", "-m", "Saved version");
		const file = await committed(path);

		await writeFile(join(repository, path), "newer HEAD");
		await git("add", "--", path);
		await git("commit", "-m", "Newer version");
		await writeFile(join(repository, path), "staged version");
		await git("add", "--", path);
		await writeFile(join(repository, path), "working version");
		const before = await state();

		await RepositoryFileActions.openRevision(
			repository,
			file,
			"editor",
			null,
			editors
		);
		const absolute = launch.mock.calls[0]?.[0];

		if (!absolute) throw new Error("No snapshot opened");

		expect(basename(absolute)).toBe(path);
		expect(relative(repository, absolute).startsWith("../")).toBe(true);
		expect(await readFile(absolute)).toEqual(bytes);
		expect((await stat(absolute)).mode & 0o777).toBe(0o400);
		expect(launch).toHaveBeenCalledWith(absolute, null);
		expect(await readFile(join(repository, path), "utf8")).toBe(
			"working version"
		);
		expect(await state()).toEqual(before);
	}
);

it("opens the pre-deletion blob without recreating the working file", async () => {
	await writeFile(join(repository, "deleted.txt"), "Before deletion");
	await git("add", ".");
	await git("commit", "-m", "Add file");
	await git("rm", "--", "deleted.txt");
	await git("commit", "-m", "Delete file");
	const file = await committed("deleted.txt");
	const before = await state();

	await RepositoryFileActions.openRevision(
		repository,
		file,
		"editor",
		undefined,
		editors
	);
	const absolute = launch.mock.calls[0]?.[0];

	if (!absolute) throw new Error("No deleted version opened");

	expect(await readFile(absolute, "utf8")).toBe("Before deletion");
	expect(
		await stat(join(repository, "deleted.txt")).catch(() => null)
	).toBeNull();
	expect(await state()).toEqual(before);
});

it("opens tracked and untracked stash blobs without applying or deleting the stash", async () => {
	await writeFile(join(repository, "tracked.txt"), "Base");
	await git("add", ".");
	await git("commit", "-m", "Base");
	await writeFile(join(repository, "tracked.txt"), "Saved tracked");
	await writeFile(join(repository, "untracked.txt"), "Saved untracked");
	await git("stash", "push", "-u", "-m", "Saved files");
	const oid = await git("rev-parse", "stash@{0}");

	const result = await RepositoryStashes.readFiles(
		repository,
		oid,
		new AbortController().signal
	);

	if (!result.ok) throw new Error(result.error.message);

	await writeFile(join(repository, "tracked.txt"), "Current tracked");
	await writeFile(join(repository, "untracked.txt"), "Current untracked");
	const before = await state();

	for (const path of ["tracked.txt", "untracked.txt"]) {
		const file = result.value.find(
			(entry) => entry.commitFile?.path === path
		)?.commitFile;

		if (!file) throw new Error(`Missing saved ${path}`);

		await RepositoryFileActions.openRevision(
			repository,
			file,
			"editor",
			undefined,
			editors
		);
		const absolute = launch.mock.calls.at(-1)?.[0];

		if (!absolute) throw new Error("No stash snapshot opened");

		expect(await readFile(absolute, "utf8")).toBe(
			`Saved ${path === "tracked.txt" ? "tracked" : "untracked"}`
		);
		expect(await readFile(join(repository, path), "utf8")).toBe(
			`Current ${path === "tracked.txt" ? "tracked" : "untracked"}`
		);
	}

	expect(await state()).toEqual(before);
});

it("rejects escaped paths, mutable IDs and non-file objects before launching", async () => {
	await writeFile(join(repository, "file.txt"), "Keep");
	await git("add", ".");
	await git("commit", "-m", "Keep");
	const file = await committed("file.txt");
	const before = await state();

	await expect(
		RepositoryFileActions.openRevision(
			repository,
			{ ...file, path: "../outside.txt" },
			"editor",
			undefined,
			editors
		)
	).rejects.toThrow();
	await expect(
		RepositoryFileActions.openRevision(
			repository,
			{ ...file, afterOid: "HEAD" },
			"editor",
			undefined,
			editors
		)
	).rejects.toThrow("unavailable");
	await expect(
		RepositoryFileActions.openRevision(
			repository,
			{ ...file, afterOid: await git("rev-parse", "HEAD") },
			"editor",
			undefined,
			editors
		)
	).rejects.toThrow("not a file");
	expect(launch).not.toHaveBeenCalled();
	expect(await state()).toEqual(before);
});

it("removes its temporary export after an editor failure without touching the repository", async () => {
	await writeFile(join(repository, "file.txt"), "Keep");
	await git("add", ".");
	await git("commit", "-m", "Keep");
	const file = await committed("file.txt");
	const before = await state();

	launch.mockImplementation(async (absolute) => {
		exports.push(dirname(absolute));

		throw new Error("Editor unavailable");
	});
	await expect(
		RepositoryFileActions.openRevision(
			repository,
			file,
			"editor",
			undefined,
			editors
		)
	).rejects.toThrow("Editor unavailable");
	const absolute = launch.mock.calls[0]?.[0];

	if (!absolute) throw new Error("No failed export captured");

	expect(await stat(dirname(absolute)).catch(() => null)).toBeNull();
	expect(await state()).toEqual(before);
});
