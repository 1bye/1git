/**
 * Covers: initialize/clone, existing repositories, destination safety and cancellation.
 * Real: setup boundary, Git CLI and disposable folders/local remotes.
 * Doubles: none.
 * Requires: Git and writable temporary storage; no hosted remote or credentials.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepositorySetup } from "../../src/feature/repository-workspace/lib/repository-setup";

let directory: string;
const signal = () => new AbortController().signal;

beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "1git-setup-")));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

it("initializes a folder without changing files and offers Open on repeat", async () => {
	const path = join(directory, "project");

	await mkdir(path);
	await writeFile(join(path, "draft.txt"), "keep me");
	expect(
		await RepositorySetup.write(
			{ kind: "create", path, branch: "topic" },
			signal()
		)
	).toEqual({ ok: true, path });
	expect(await readFile(join(path, "draft.txt"), "utf8")).toBe("keep me");
	expect(
		execFileSync("git", ["-C", path, "symbolic-ref", "--short", "HEAD"], {
			encoding: "utf8",
		}).trim()
	).toBe("topic");
	expect(
		await RepositorySetup.write(
			{ kind: "create", path, branch: "other" },
			signal()
		)
	).toMatchObject({ ok: false, openPath: path });
	expect(
		execFileSync("git", ["-C", path, "symbolic-ref", "--short", "HEAD"], {
			encoding: "utf8",
		}).trim()
	).toBe("topic");
});

it("clones a real local repository and refuses a nonempty destination", async () => {
	const source = join(directory, "source");

	await RepositorySetup.write(
		{ kind: "create", path: source, branch: "main" },
		signal()
	);
	await writeFile(join(source, "hello.txt"), "hello");
	execFileSync("git", ["-C", source, "add", "hello.txt"]);
	execFileSync("git", [
		"-C",
		source,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"-m",
		"Initial",
	]);
	const path = join(directory, "clone");

	expect(
		await RepositorySetup.write(
			{ kind: "clone", path, remoteUrl: source },
			signal()
		)
	).toEqual({ ok: true, path });
	expect(await readFile(join(path, "hello.txt"), "utf8")).toBe("hello");
	const occupied = join(directory, "occupied");

	await mkdir(occupied);
	await writeFile(join(occupied, "keep"), "untouched");
	expect(
		await RepositorySetup.write(
			{ kind: "clone", path: occupied, remoteUrl: source },
			signal()
		)
	).toMatchObject({
		ok: false,
		message: expect.stringContaining("empty folder"),
	});
	expect(await readFile(join(occupied, "keep"), "utf8")).toBe("untouched");
});

it("rejects nested destinations, symlinks, invalid branches and pre-cancelled writes", async () => {
	const path = join(directory, "project");

	await RepositorySetup.write(
		{ kind: "create", path, branch: "main" },
		signal()
	);
	expect(
		await RepositorySetup.write(
			{ kind: "create", path: join(path, "nested"), branch: "main" },
			signal()
		)
	).toMatchObject({ ok: false, message: expect.stringContaining("outside") });
	const link = join(directory, "linked");

	await symlink(path, link);
	expect(
		await RepositorySetup.write(
			{ kind: "create", path: link, branch: "main" },
			signal()
		)
	).toMatchObject({ ok: false });
	expect(
		await RepositorySetup.write(
			{ kind: "create", path: join(directory, "bad"), branch: "bad name" },
			signal()
		)
	).toMatchObject({ ok: false });
	const controller = new AbortController();

	controller.abort();
	expect(
		await RepositorySetup.write(
			{ kind: "create", path: join(directory, "cancelled"), branch: "main" },
			controller.signal
		)
	).toMatchObject({ ok: false });
	expect(
		await Bun.file(join(directory, "cancelled", ".git", "HEAD")).exists()
	).toBe(false);
});

it("rejects embedded HTTP credentials before cloning", async () => {
	expect(
		await RepositorySetup.write(
			{
				kind: "clone",
				path: join(directory, "private"),
				remoteUrl: "https://user:secret@example.invalid/repo.git",
			},
			signal()
		)
	).toMatchObject({
		ok: false,
		message: expect.stringContaining("credentials"),
	});
});
