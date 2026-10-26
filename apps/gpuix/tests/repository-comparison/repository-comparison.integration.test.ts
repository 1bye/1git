/**
 * Covers: immutable incoming/outgoing ranges, fetched upstream selection, file identities, diffs and read-only behavior.
 * Real: app readers, shared Git boundary and disposable Git repositories.
 * Doubles: none. Requires: Git and writable temporary storage; no network.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { RepositoryComparison } from "../../src/feature/repository-comparison/lib/repository-comparison";
import { RepositoryHistory } from "../../src/feature/repository-workspace/lib/repository-history";
import { RepositoryDiff } from "../../src/feature/repository-workspace/lib/repository-diff";
import { RepositoryBranches } from "../../src/feature/workspace-tabs/lib/repository-branches";

const execute = promisify(execFile);
let root: string;
const signal = () => new AbortController().signal;

const git = async (...args: string[]): Promise<string> => {
	const result = await execute(
		"git",
		[
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.invalid",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			...args,
		],
		{
			cwd: root,
			env: {
				...process.env,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
			},
		}
	);

	return result.stdout.trim();
};

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "gpuix-comparison-")));
	await git("init", "--initial-branch=main");
	await writeFile(join(root, "rename me.txt"), "unchanged contents\n");
	await writeFile(join(root, "deleted.txt"), "removed later\n");
	await writeFile(join(root, "modified.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

it("builds a sync review from real tracking metadata and reads both sides without integrating", async () => {
	await git("checkout", "-b", "incoming");
	await writeFile(join(root, "remote-only.txt"), "incoming work\n");
	await git("add", ".");
	await git("commit", "-m", "Incoming work");
	const remoteTip = await git("rev-parse", "HEAD");

	await git("checkout", "main");
	await writeFile(join(root, "local-only.txt"), "outgoing work\n");
	await git("add", ".");
	await git("commit", "-m", "Outgoing work");
	const localTip = await git("rev-parse", "HEAD");

	await git("remote", "add", "second", root);
	await git("update-ref", "refs/remotes/second/release/next", remoteTip);
	await git("config", "branch.main.remote", "second");
	await git("config", "branch.main.merge", "refs/heads/release/next");
	const branches = await RepositoryBranches.read(root, signal());

	if (!branches.ok) throw new Error(branches.error.message);

	const request = RepositoryComparison.syncRequest(
		root,
		localTip,
		"main",
		branches.value
	);

	const incoming = await RepositoryComparison.read(
		root,
		request.base,
		remoteTip,
		signal()
	);

	const outgoing = await RepositoryComparison.read(
		root,
		remoteTip,
		request.base,
		signal()
	);

	expect(request).toMatchObject({
		incoming: "refs/remotes/second/release/next",
		remote: "second",
		remoteRef: "refs/heads/release/next",
		ahead: 1,
		behind: 1,
	});
	expect(incoming.ok && incoming.value.files.map((file) => file.path)).toEqual([
		"remote-only.txt",
	]);
	expect(outgoing.ok && outgoing.value.files.map((file) => file.path)).toEqual([
		"local-only.txt",
	]);
	expect(await git("rev-parse", "HEAD")).toBe(localTip);
	expect(await git("status", "--porcelain=v1")).toBe("");
});

it("uses the common ancestor, excludes base-only commits, and preserves dirty staging", async () => {
	const ancestor = await git("rev-parse", "HEAD");

	await git("checkout", "-b", "feature");
	await git("mv", "rename me.txt", "renamed.txt");
	await git("rm", "deleted.txt");
	await writeFile(join(root, "modified.txt"), "incoming\n");
	await writeFile(join(root, "added.txt"), "new file\n");
	await git("add", ".");
	await git("commit", "-m", "Incoming");
	const incoming = await git("rev-parse", "HEAD");

	await git("checkout", "main");
	await writeFile(join(root, "base-only.txt"), "not incoming\n");
	await git("add", ".");
	await git("commit", "-m", "Base only");
	await writeFile(join(root, "modified.txt"), "staged\n");
	await git("add", "modified.txt");
	await writeFile(join(root, "modified.txt"), "unstaged\n");
	const before = await git("status", "--porcelain=v1");
	const index = await git("write-tree");

	const result = await RepositoryComparison.read(
		root,
		"main",
		"feature",
		signal()
	);

	expect(result.ok).toBe(true);

	if (!result.ok) throw new Error(result.error.message);

	expect(result.value.mergeBase).toBe(ancestor);
	expect(result.value.head).toBe(incoming);
	expect(result.value.files.map((file) => [file.path, file.status])).toEqual([
		["added.txt", "A"],
		["deleted.txt", "D"],
		["modified.txt", "M"],
		["renamed.txt", "R"],
	]);
	expect(result.value.files[3]?.originalPath).toBe("rename me.txt");
	const page = await RepositoryHistory.read(
		root,
		`${result.value.base}..${result.value.head}`,
		0,
		signal()
	);

	expect(page.ok && page.value.commits.map((commit) => commit.summary)).toEqual(
		["Incoming"]
	);
	// Moving the branch after loading does not alter the captured diff or image blob IDs.
	await git("branch", "-f", "feature", "main");
	const file = RepositoryComparison.files(result.value).find(
		(entry) => entry.id === "modified.txt"
	)?.commitFile;

	if (!file) throw new Error("Missing comparison file");

	const diff = await RepositoryDiff.read(root, file, signal());

	expect(diff.ok).toBe(true);

	if (!diff.ok) throw new Error(diff.error.message);

	expect(JSON.stringify(diff.value)).toContain("incoming");
	expect(JSON.stringify(diff.value)).not.toContain("unstaged");
	expect(await git("status", "--porcelain=v1")).toBe(before);
	expect(await git("write-tree")).toBe(index);
	expect(await git("branch", "--show-current")).toBe("main");
});

it("returns an empty comparison for identical commits and paginates incoming history", async () => {
	const same = await RepositoryComparison.read(root, "main", "HEAD", signal());

	expect(same.ok && same.value.files).toEqual([]);
	await git("checkout", "-b", "feature");

	for (let index = 0; index < 51; index += 1)
		await git("commit", "--allow-empty", "-m", `Commit ${index}`);

	const result = await RepositoryComparison.read(
		root,
		"main",
		"feature",
		signal()
	);

	if (!result.ok) throw new Error(result.error.message);

	const range = `${result.value.base}..${result.value.head}`;
	const first = await RepositoryHistory.read(root, range, 0, signal());

	if (!first.ok) throw new Error(first.error.message);

	expect(first.value.commits).toHaveLength(50);
	expect(first.value.hasMore).toBe(true);
	const second = await RepositoryHistory.read(
		root,
		range,
		first.value.nextOffset ?? 0,
		signal()
	);

	expect(second.ok && second.value.commits).toHaveLength(1);
	expect(second.ok && second.value.hasMore).toBe(false);
});

it("reports unrelated, missing and aborted comparisons without writes", async () => {
	await git("checkout", "--orphan", "unrelated");
	await git("commit", "-m", "Unrelated root");
	const result = await RepositoryComparison.read(
		root,
		"main",
		"unrelated",
		signal()
	);

	expect(!result.ok && result.error.message).toContain("common ancestor");
	const missing = await RepositoryComparison.read(
		root,
		"main",
		"missing",
		signal()
	);

	expect(missing.ok).toBe(false);
	const aborted = await RepositoryComparison.read(
		root,
		"main",
		"HEAD",
		AbortSignal.abort()
	);

	expect(!aborted.ok && aborted.error.code).toBe("aborted");
});
