/**
 * Covers: working repositories, worktrees, nested/hidden projects, exclusions, cancellation and unreadable roots.
 * Real: filesystem traversal, Git CLI and disposable repositories.
 * Doubles: none.
 * Requires: Git on PATH and writable temporary storage; no network or user folders.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
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
import { promisify } from "node:util";
import { RepositoryDiscovery } from "../../src/feature/repository-discovery/repository-discovery";

const execute = promisify(execFile);
let sandbox: string;

beforeEach(async () => {
	sandbox = await realpath(await mkdtemp(join(tmpdir(), "gpuix-discovery-")));
});
afterEach(async () => {
	await rm(sandbox, { recursive: true, force: true });
});

async function git(path: string, ...args: string[]): Promise<void> {
	await execute(
		"git",
		[
			"-c",
			"user.name=Discovery Test",
			"-c",
			"user.email=discovery@example.invalid",
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"commit.gpgsign=false",
			"-C",
			path,
			...args,
		],
		{
			env: {
				...process.env,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
			},
		}
	);
}
async function repository(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
	await git(path, "init", "--initial-branch=main");
}

it("finds unopened, nested and hidden repos plus linked worktrees without reading status or modifying files", async () => {
	const home = join(sandbox, "home");
	const parent = join(home, "Projects", "repo with spaces");
	const nested = join(parent, "nested");
	const hidden = join(home, ".dotfiles");
	const worktree = join(home, "linked");

	for (const path of [parent, nested, hidden]) await repository(path);

	await git(parent, "commit", "--allow-empty", "-m", "Initial");
	await git(parent, "worktree", "add", "-b", "linked", worktree);
	const result = await RepositoryDiscovery.scan(
		[home, parent],
		new AbortController().signal,
		() => {}
	);

	expect([...result.paths].sort()).toEqual(
		[parent, nested, hidden, worktree].sort()
	);
	expect(result.skipped).toBe(0);
	expect(result.limited).toBe(false);
	const status = await execute("git", ["-C", parent, "status", "--porcelain"]);

	expect(status.stdout.trim()).toBe("?? nested/");
});

it("skips dependency/cache trees, invalid Git markers, bare repos and symlink escapes or cycles", async () => {
	const home = join(sandbox, "home");
	const project = join(home, "project");
	const external = join(sandbox, "external");

	for (const path of [
		project,
		external,
		join(home, "node_modules", "dependency"),
		join(home, "Library", "cached"),
	])
		await repository(path);

	await mkdir(join(home, "invalid"));
	await writeFile(
		join(home, "invalid", ".git"),
		"gitdir: /missing/discovery/git\n"
	);
	await git(home, "init", "--bare", "bare.git");
	await symlink(home, join(project, "cycle"));
	await symlink(external, join(home, "outside"));
	const result = await RepositoryDiscovery.scan(
		[home],
		new AbortController().signal,
		() => {}
	);

	expect(result.paths).toEqual([project]);
	expect(result.skipped).toBe(1);
	expect(result.scanned).toBeLessThan(20);
	expect(result.limited).toBe(false);

	const explicit = await RepositoryDiscovery.scan(
		[join(home, "Library"), external],
		new AbortController().signal,
		() => {}
	);

	expect([...explicit.paths].sort()).toEqual(
		[external, join(home, "Library", "cached")].sort()
	);
});

it("reports unavailable roots, continues scanning other roots and honors cancellation before and during traversal", async () => {
	const project = join(sandbox, "project");

	await repository(project);
	const result = await RepositoryDiscovery.scan(
		[join(sandbox, "missing"), project],
		new AbortController().signal,
		() => {}
	);

	expect(result.paths).toEqual([project]);
	expect(result.skipped).toBe(1);
	const before = new AbortController();

	before.abort();
	await expect(
		RepositoryDiscovery.scan([sandbox], before.signal, () => {})
	).rejects.toThrow();
	const during = new AbortController();
	let updates = 0;

	await expect(
		RepositoryDiscovery.scan([sandbox], during.signal, () => {
			updates++;
			during.abort();
		})
	).rejects.toThrow();
	expect(updates).toBe(1);
});

it("shallow search checks matching immediate children and worktrees without descending or revalidating cached paths", async () => {
	const home = join(sandbox, "home");
	const fresh = join(home, "Project-new");
	const known = join(home, "project-cached");
	const nested = join(home, "project-group", "project-deep");
	const worktree = join(home, "project-linked");

	for (const path of [
		fresh,
		known,
		nested,
		join(home, "other"),
		join(home, "node_modules", "project-dependency"),
	])
		await repository(path);

	await git(fresh, "commit", "--allow-empty", "-m", "Initial");
	await git(fresh, "worktree", "add", "-b", "linked", worktree);
	await symlink(fresh, join(home, "project-alias"));
	// A cached path must not be revalidated, even when its marker is now invalid.
	await rm(join(known, ".git"), { recursive: true });
	await writeFile(join(known, ".git"), "gitdir: /missing/discovery/git\n");
	const result = await RepositoryDiscovery.scan(
		[home],
		new AbortController().signal,
		() => {},
		{
			shallow: true,
			query: "PROJECT",
			knownPaths: [known],
		}
	);

	expect([...result.paths].sort()).toEqual([fresh, worktree].sort());
	expect(result.scanned).toBe(4);
	expect(result.skipped).toBe(0);
	expect(result.limited).toBe(false);
	const root = await RepositoryDiscovery.scan(
		[fresh],
		new AbortController().signal,
		() => {},
		{ shallow: true, query: "project-new" }
	);

	expect(root.paths).toEqual([fresh]);
	const controller = new AbortController();

	await expect(
		RepositoryDiscovery.scan(
			[home],
			controller.signal,
			() => controller.abort(),
			{ shallow: true, query: "project" }
		)
	).rejects.toThrow();
});
