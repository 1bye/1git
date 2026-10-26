/**
 * Covers: streamed recovery over 64 MiB, symlink isolation, staged/unstaged separation, Undo and failed backup safety.
 * Real: Git, backend and disposable repositories.
 * Doubles: home directory for app recovery paths, failed flush and Git failures for recovery-location reporting.
 * Requires: Git and temporary storage.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	mkdtemp,
	mkdir,
	lstat,
	readFile,
	readlink,
	realpath,
	rm,
	writeFile,
	symlink,
	stat,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GitRepository } from "@1git/git";
import { RepositoryFileActions } from "../../src/feature/repository-workspace/lib/repository-file-actions";

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
	mock.restore();
	await rm(root, { recursive: true, force: true });
});
const discard = (
	path: string | readonly string[],
	directory = join(root, ".git", "recovery"),
	expectedHead = head
) =>
	repository.discardFiles({
		paths: typeof path === "string" ? [path] : path,
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

it("discards and recovers binary patch output larger than 64 MiB without changing excluded files or staging", async () => {
	const path = "large[1].bin";
	const sizeBytes = 54 * 1024 * 1024;
	const data = randomBytes(sizeBytes);
	const expected = createHash("sha256").update(data).digest("hex");

	await writeFile(join(root, path), data);
	await writeFile(join(root, "a.txt"), "excluded staging\n");
	await git("add", "a.txt");
	await writeFile(join(root, "a.txt"), "excluded working\n");
	const index = await readFile(join(root, ".git/index"));
	const result = await discard(path);

	if (!result.ok) throw new Error(JSON.stringify(result.error));

	expect(
		(await stat(join(root, ".git/recovery/working.patch"))).size
	).toBeGreaterThan(64 * 1024 * 1024);
	expect(
		(await stat(join(root, ".git/recovery/working.patch"))).mode & 0o777
	).toBe(0o600);
	expect(await Bun.file(join(root, path)).exists()).toBe(false);
	expect(await readFile(join(root, ".git/index"))).toEqual(index);
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe(
		"excluded working\n"
	);
	await git("apply", "--check", ".git/recovery/working.patch");
	await git("apply", ".git/recovery/working.patch");
	const recovered = createHash("sha256");

	for await (const chunk of createReadStream(join(root, path)))
		recovered.update(chunk);

	expect(recovered.digest("hex")).toBe(expected);
	expect(await readFile(join(root, ".git/index"))).toEqual(index);
}, 30000);

it("streams large staged and working patches and restores their separate states with Undo", async () => {
	const path = "large-staged.bin";

	await writeFile(join(root, path), randomBytes(54 * 1024 * 1024));
	await git("add", path);
	const stagedOid = await git("rev-parse", `:${path}`);

	await writeFile(join(root, path), "working version\n");
	await writeFile(join(root, "keep.txt"), "excluded\n");
	const result = await discard(path);

	if (!result.ok) throw new Error(JSON.stringify(result.error));

	for (const patch of ["staged.patch", "working.patch"]) {
		expect(
			(await stat(join(root, ".git/recovery", patch))).size
		).toBeGreaterThan(64 * 1024 * 1024);
	}

	expect(await Bun.file(join(root, path)).exists()).toBe(false);
	const undone = await repository.undoDiscard({
		token: result.value.undo.token,
	});

	if (!undone.ok) throw new Error(JSON.stringify(undone.error));

	expect(await git("rev-parse", `:${path}`)).toBe(stagedOid);
	expect(await readFile(join(root, path), "utf8")).toBe("working version\n");
	expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("excluded\n");
}, 30000);

it("leaves the index and working files untouched if a streamed backup cannot be flushed", async () => {
	await writeFile(join(root, "a.txt"), "staged\n");
	await git("add", "a.txt");
	await writeFile(join(root, "a.txt"), "working\n");
	const originalIndex = await readFile(join(root, ".git/index"));
	const filesystem = await import("@1git/git/runtime");
	const originalOpen = filesystem.open;

	spyOn(filesystem, "open").mockImplementation(async (...args) => {
		const file = await originalOpen(...args);

		if (args[0] === join(root, ".git/recovery/working.patch"))
			spyOn(file, "sync").mockRejectedValue(
				new Error("Injected disk flush failure")
			);

		return file;
	});
	const result = await discard("a.txt");

	expect(filesystem.open).toHaveBeenCalledWith(
		join(root, ".git/recovery/working.patch"),
		"wx",
		0o600
	);
	expect(result.ok).toBe(false);
	expect(await readFile(join(root, ".git/index"))).toEqual(originalIndex);
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe("working\n");
	expect(await Bun.file(join(root, ".git/recovery/README.txt")).exists()).toBe(
		false
	);
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

it("discards and recovers untracked links themselves, including dangling and external targets", async () => {
	const outside = join(root, ".git", "outside.txt");

	await writeFile(outside, "external content\n");
	const links = new Map([
		["link", "a.txt"],
		["dangling", "missing.txt"],
		["external", outside],
		["directory-link", ".git"],
		['link [1]\n"rose☃', 'missing\n"target'],
	]);

	for (const [path, target] of links) await symlink(target, join(root, path));

	const result = await discard([...links.keys()]);

	if (!result.ok) throw new Error(JSON.stringify(result.error));

	for (const path of links.keys()) {
		const remaining = await lstat(join(root, path)).then(
			() => path,
			(error: unknown) => {
				if (
					error instanceof Error &&
					"code" in error &&
					error.code === "ENOENT"
				)
					return null;

				throw error;
			}
		);

		expect(remaining).toBeNull();
	}

	const patch = await readFile(
		join(root, ".git/recovery/working.patch"),
		"utf8"
	);

	expect(patch).toContain("new file mode 120000");
	expect(patch).not.toContain("external content");
	await git("apply", ".git/recovery/working.patch");

	for (const [path, target] of links) {
		expect((await lstat(join(root, path))).isSymbolicLink()).toBe(true);
		expect(await readlink(join(root, path))).toBe(target);
	}

	expect(await readFile(outside, "utf8")).toBe("external content\n");
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe("base\n");
});

it("restores tracked staged and working link destinations independently, with undo", async () => {
	await symlink("base-target", join(root, "tracked-link"));
	await git("add", "tracked-link");
	await git("commit", "-m", "Track link");
	head = await git("rev-parse", "HEAD");
	await rm(join(root, "tracked-link"));
	await symlink("staged-target", join(root, "tracked-link"));
	await git("add", "tracked-link");
	await rm(join(root, "tracked-link"));
	await symlink("working-target", join(root, "tracked-link"));
	const result = await discard("tracked-link");

	if (!result.ok) throw new Error(JSON.stringify(result.error));

	expect(await readlink(join(root, "tracked-link"))).toBe("base-target");
	expect(await git("show", ":tracked-link")).toBe("base-target");
	expect(
		(await repository.undoDiscard({ token: result.value.undo.token })).ok
	).toBe(true);
	expect(await readlink(join(root, "tracked-link"))).toBe("working-target");
	expect(await git("show", ":tracked-link")).toBe("staged-target");
});

it("restores deleted links even when their parent directory was removed", async () => {
	await mkdir(join(root, "nested"));
	await symlink("../a.txt", join(root, "nested", "link"));
	await git("add", "nested/link");
	await git("commit", "-m", "Track nested link");
	head = await git("rev-parse", "HEAD");
	await rm(join(root, "nested"), { recursive: true });
	const result = await discard("nested/link");

	if (!result.ok) throw new Error(JSON.stringify(result.error));

	expect(await readlink(join(root, "nested", "link"))).toBe("../a.txt");
	await git("apply", ".git/recovery/working.patch");
	await expect(lstat(join(root, "nested", "link"))).rejects.toMatchObject({
		code: "ENOENT",
	});
});

it("backs up the entire batch and restores tracked, staged and new files together", async () => {
	await writeFile(join(root, "a.txt"), "staged\n");
	await git("add", "a.txt");
	await writeFile(join(root, "a.txt"), "working\n");
	const data = Buffer.from([0, 255, 10, 3]);

	await writeFile(join(root, "new.bin"), data);
	await writeFile(join(root, "keep.txt"), "keep\n");
	const result = await discard(["a.txt", "new.bin"]);

	if (!result.ok) throw new Error(JSON.stringify(result.error));

	expect(result.ok).toBe(true);
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe("base\n");
	expect(await Bun.file(join(root, "new.bin")).exists()).toBe(false);
	const manifest = JSON.parse(
		await readFile(join(root, ".git/recovery/recovery.json"), "utf8")
	);

	expect(manifest.paths.sort()).toEqual(["a.txt", "new.bin"]);
	await git("apply", "--cached", ".git/recovery/staged.patch");
	await git("apply", ".git/recovery/staged.patch");
	await git("apply", ".git/recovery/working.patch");
	expect(await git("show", ":a.txt")).toBe("staged");
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe("working\n");
	expect(await readFile(join(root, "new.bin"))).toEqual(data);
	expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("keep\n");
});

it("backs up and recovers a 1148-file app bundle without touching the real index", async () => {
	const bundle = "Build.app/Contents";
	const framework = `${bundle}/Frameworks/Example.framework`;

	await mkdir(join(root, framework, "Versions/A"), { recursive: true });
	await mkdir(join(root, bundle, "Resources"), { recursive: true });
	const paths: string[] = [];

	for (let index = 0; index < 1144; index++) {
		const path = `${bundle}/Resources/locale-${index}.pak`;

		await writeFile(join(root, path), `file ${index}\n`);
		paths.push(path);
	}

	const binaryPath = `${framework}/Versions/A/Example`;
	const data = Buffer.from([0, 1, 255, 18]);

	await writeFile(join(root, binaryPath), data);
	await writeFile(join(root, bundle, "Resources/empty"), "");
	await symlink("A", join(root, framework, "Versions/Current"));
	await symlink("Versions/Current/Example", join(root, framework, "Example"));
	paths.push(
		binaryPath,
		`${bundle}/Resources/empty`,
		`${framework}/Versions/Current`,
		`${framework}/Example`
	);
	const originalIndex = await readFile(join(root, ".git/index"));
	const result = await discard(paths);

	if (!result.ok) throw new Error(JSON.stringify(result.error));

	expect(paths).toHaveLength(1148);
	expect(result.value.snapshot.files).toEqual([]);
	expect(await readFile(join(root, ".git/index"))).toEqual(originalIndex);
	await git("apply", "--check", ".git/recovery/working.patch");
	await git("apply", ".git/recovery/working.patch");

	for (let index = 0; index < 1144; index++) {
		expect(
			await readFile(
				join(root, bundle, `Resources/locale-${index}.pak`),
				"utf8"
			)
		).toBe(`file ${index}\n`);
	}

	expect(await readFile(join(root, binaryPath))).toEqual(data);
	expect(await readFile(join(root, bundle, "Resources/empty"), "utf8")).toBe(
		""
	);
	expect(await readlink(join(root, framework, "Versions/Current"))).toBe("A");
	expect(await readlink(join(root, framework, "Example"))).toBe(
		"Versions/Current/Example"
	);
	expect(await readFile(join(root, ".git/index"))).toEqual(originalIndex);
});

it("rejects the entire batch if any path is stale or unsupported", async () => {
	await writeFile(join(root, "a.txt"), "preserve\n");
	await writeFile(join(root, "replaced.txt"), "base\n");
	await git("add", "replaced.txt");
	await git("commit", "-m", "Track replaced file");
	head = await git("rev-parse", "HEAD");
	await rm(join(root, "replaced.txt"));
	await mkdir(join(root, "replaced.txt"));
	expect((await discard(["a.txt", "missing.txt"])).ok).toBe(false);
	expect((await discard(["a.txt", "replaced.txt"])).ok).toBe(false);
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe("preserve\n");
	expect(await git("show", ":a.txt")).toBe("base");
	expect(
		await Bun.file(join(root, ".git/recovery/recovery.json")).exists()
	).toBe(false);
});

it("rejects symlinked ancestors before writing any backup or changing a target", async () => {
	await mkdir(join(root, "nested"));
	await writeFile(join(root, "nested", "tracked.txt"), "base\n");
	await git("add", "nested/tracked.txt");
	await git("commit", "-m", "Track nested file");
	head = await git("rev-parse", "HEAD");
	await rm(join(root, "nested"), { recursive: true });
	await mkdir(join(root, ".git", "outside"));
	await writeFile(join(root, ".git", "outside", "tracked.txt"), "untouched\n");
	await symlink(join(root, ".git", "outside"), join(root, "nested"));
	const result = await discard("nested/tracked.txt");

	expect(result.ok).toBe(false);
	expect(
		await readFile(join(root, ".git", "outside", "tracked.txt"), "utf8")
	).toBe("untouched\n");
	expect(await readlink(join(root, "nested"))).toBe(
		join(root, ".git", "outside")
	);
	expect(
		await Bun.file(join(root, ".git/recovery/recovery.json")).exists()
	).toBe(false);
});

it("does not advertise a recovery folder when preflight fails before creating a backup", async () => {
	spyOn(await import("node:os"), "homedir").mockReturnValue(root);
	expect(homedir()).toBe(root);
	await writeFile(join(root, "a.txt"), "preserve\n");
	const result = await RepositoryFileActions.discard(root, {
		kind: "discard",
		paths: ["a.txt"],
		expectedHead: "stale",
		expectedBranch: "main",
	});

	expect(result.ok).toBe(false);

	if (result.ok) throw new Error("Expected preflight rejection");

	expect(result.error.message).not.toContain("Recovery");
	expect("recoveryDirectory" in result).toBe(false);
	expect(await readFile(join(root, "a.txt"), "utf8")).toBe("preserve\n");
});

it.each(["empty", "empty-patch", "partial", "complete"] as const)(
	"reports only existing %s recovery data after a later failure",
	async (backup) => {
		spyOn(await import("node:os"), "homedir").mockReturnValue(root);
		expect(homedir()).toBe(root);
		spyOn(GitRepository, "open").mockResolvedValue({
			ok: true,
			value: repository,
		});
		let directory: string | undefined;

		spyOn(repository, "discardFiles").mockImplementation(async (input) => {
			directory = input.recovery?.directory;

			if (!directory?.startsWith(`${root}/`))
				throw new Error("Recovery must stay in this fixture");

			await mkdir(directory);

			if (backup === "empty-patch")
				await writeFile(join(directory, "staged.patch"), "");

			if (backup === "partial" || backup === "complete")
				await writeFile(join(directory, "working.patch"), "saved edits");

			if (backup === "complete")
				await writeFile(join(directory, "README.txt"), "instructions");

			return {
				ok: false,
				error: {
					code: "command-failed",
					message: "Discard failed.",
					operation: "discard-files",
					retryable: false,
				},
			};
		});
		const result = await RepositoryFileActions.discard(root, {
			kind: "discard",
			paths: ["a.txt"],
			expectedHead: head,
			expectedBranch: "main",
		});

		if (result.ok) throw new Error("Expected injected failure");

		if (!directory) throw new Error("Expected an attempted backup directory");

		if (backup === "empty" || backup === "empty-patch") {
			expect(result.error.message).toBe("Discard failed.");
			expect("recoveryDirectory" in result).toBe(false);
		} else {
			expect(result.error.message).toBe(
				`Discard failed. ${backup === "complete" ? "Recovery backup" : "Partial recovery files"} saved at ${directory}.`
			);
			expect("recoveryDirectory" in result && result.recoveryDirectory).toBe(
				directory
			);
		}
	}
);
