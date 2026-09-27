/**
 * Covers: durable discard recovery, staged/unstaged separation, literal paths and failed backup safety.
 * Real: Git, backend and disposable repositories.
 * Doubles: none.
 * Requires: Git and temporary storage.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import {
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
	symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GitRepository } from "@1git/git";

const execute = promisify(execFile);
let root: string;
let repository: GitRepository;
let head: string;
const git = async (...args: string[]) =>
	(
		await execute("git", args, {
			cwd: root,
			env: {
				...process.env,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
			},
		})
	).stdout.trimEnd();

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "1git-discard-")));
	await git("init", "--initial-branch=main");
	await git("config", "user.name", "Test");
	await git("config", "user.email", "test@example.invalid");
	await git("config", "commit.gpgsign", "false");
	await git("config", "core.hooksPath", "/dev/null");
	await writeFile(join(root, "a.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
	head = await git("rev-parse", "HEAD");
	const opened = await GitRepository.open({ path: root });

	if (!opened.ok) throw new Error(opened.error.message);

	repository = opened.value;
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
const discard = (
	path: string,
	directory = join(root, ".git", "recovery"),
	expectedHead = head
) =>
	repository.discardFiles({
		paths: [path],
		allowDestructive: true,
		recovery: { directory, expectedHead, expectedBranch: "main" },
	});

it("backs up and restores both index and working changes without touching excluded files", async () => {
	await writeFile(join(root, "a.txt"), "staged\n");
	await git("add", "a.txt");
	await writeFile(join(root, "a.txt"), "working\n");
	await writeFile(join(root, "keep.txt"), "keep\n");
	expect((await discard("a.txt")).ok).toBe(true);
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe("base\n");
	expect(await git("show", ":a.txt")).toBe("base");
	await git("apply", "--cached", ".git/recovery/staged.patch");
	await git("apply", ".git/recovery/staged.patch");
	await git("apply", ".git/recovery/working.patch");
	expect(await git("show", ":a.txt")).toBe("staged");
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe("working\n");
	expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("keep\n");
});

it("recovers a binary untracked file with a literal metacharacter name", async () => {
	const path = "new[1].bin";
	const data = Buffer.from([0, 1, 255, 18]);

	await writeFile(join(root, path), data);
	const result = await discard(path);

	if (!result.ok) throw new Error(JSON.stringify(result.error));

	expect(result.ok).toBe(true);
	expect(await Bun.file(join(root, path)).exists()).toBe(false);
	await git("apply", ".git/recovery/working.patch");
	expect(await readFile(join(root, path))).toEqual(data);
});

it("leaves files untouched when backup creation or branch validation fails", async () => {
	await writeFile(join(root, "a.txt"), "keep edits\n");
	expect(
		(await discard("a.txt", join(root, ".git", "missing", "backup"))).ok
	).toBe(false);
	expect(
		(await discard("a.txt", join(root, ".git", "backup"), "stale")).ok
	).toBe(false);
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe("keep edits\n");
});

it("rejects symbolic links without changing their target", async () => {
	await symlink("a.txt", join(root, "link"));
	expect((await discard("link")).ok).toBe(false);
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe("base\n");
});
