/**
 * Covers: real local/upstream/default branch resolution, read-only previews, SSH, unsupported destinations and provider failure recovery.
 * Real: disposable Git repositories, app reader, account metadata and provider remote parsing.
 * Doubles: hosting metadata requests and credential vault; no network or production accounts.
 * Requires: Git and writable temporary storage.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { RepositoryPullRequest } from "../../src/feature/repository-pull-request/repository-pull-request";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { RemoteAccounts } from "../../src/feature/accounts/lib/remote-accounts";

const execute = promisify(execFile);
let directory: string;
let root: string;
let accounts: Accounts;
let reader: RepositoryPullRequest;
let bindings: RemoteAccounts;
let head: string;
let base: string;
const signal = () => new AbortController().signal;

async function git(...args: string[]): Promise<string> {
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
}

beforeEach(async () => {
	directory = await realpath(
		await mkdtemp(join(tmpdir(), "gpuix-pull-request-"))
	);
	root = join(directory, "repo");
	await mkdir(root);
	await git("init", "--initial-branch=main");
	await git("commit", "--allow-empty", "-m", "Base");
	base = await git("rev-parse", "HEAD");
	await git("checkout", "-b", "feature/ui");
	await git("commit", "--allow-empty", "-m", "UI");
	head = await git("rev-parse", "HEAD");
	await git("remote", "add", "origin", "https://github.com/alice/demo.git");
	await git("update-ref", "refs/remotes/origin/main", base);
	await git("update-ref", "refs/remotes/origin/feature/ui", head);
	await git(
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
		"refs/remotes/origin/main"
	);
	const store = new AccountStore(join(directory, "accounts.json"));

	store.save([
		{
			provider: "github",
			webUrl: "https://github.com/",
			id: "1",
			username: "alice",
		},
	]);
	accounts = new Accounts(store, {
		async read() {
			throw new Error("No real credentials expected");
		},
		async write() {},
		async delete() {},
	});
	bindings = new RemoteAccounts(accounts, join(directory, "bindings.json"));
	reader = new RepositoryPullRequest(accounts, bindings);
	spyOn(accounts, "repositoryReviews").mockResolvedValue({
		repository: {
			id: "7",
			ref: { owner: "alice", name: "demo" },
			name: "demo",
			description: null,
			visibility: "private",
			defaultBranch: "main",
			browserUrl: "https://github.com/alice/demo",
			cloneUrls: { https: "https://github.com/alice/demo.git", ssh: null },
			permissions: { read: true, push: true, admin: null },
		},
		requests: [],
		complete: true,
	});
});

afterEach(async () => {
	mock.restore();
	await rm(directory, { recursive: true, force: true });
});

it("defaults to the provider target branch and excludes uncommitted edits without touching Git", async () => {
	await writeFile(join(root, "uncommitted.txt"), "Keep me\n");
	await git("add", "uncommitted.txt");
	await writeFile(join(root, "uncommitted.txt"), "Keep staged and unstaged\n");
	const status = await git("status", "--porcelain");
	const index = await git("write-tree");

	const value = await reader.read(root, signal());

	expect(value.branch).toBe("feature/ui");
	expect(value.comparison.base).toBe(base);
	expect(value.comparison.baseName).toBe("main");
	expect(value.publishedHead).toBe(head);
	expect(value.uploadKind).toBe("publish");
	expect(value.repositoryId).toBe("7");
	expect(
		value.comparison.branches.some((item) => item.label === "uncommitted.txt")
	).toBe(false);
	expect(await git("status", "--porcelain")).toBe(status);
	expect(await git("write-tree")).toBe(index);
	expect(await git("rev-parse", "HEAD")).toBe(head);
});

it("uses the exact differently named upstream branch instead of assuming local branch names", async () => {
	await git("update-ref", "refs/remotes/origin/review/ui", head);
	await git("config", "branch.feature/ui.remote", "origin");
	await git("config", "branch.feature/ui.merge", "refs/heads/review/ui");

	const value = await reader.read(root, signal());

	expect(value.remoteRef).toBe("refs/heads/review/ui");
	expect(value.uploadKind).toBe("push");
	expect(RepositoryPullRequest.browserUrl(value, "main")).toContain(
		"...review%2Fui"
	);
});

it("uses publish for an untracked existing branch and push for a tracked missing branch", async () => {
	await git("update-ref", "refs/remotes/origin/feature/ui", base);
	const untracked = await reader.read(root, signal());

	expect(RepositoryPullRequest.action(untracked)).toBe("publish");
	await git("config", "branch.feature/ui.remote", "origin");
	await git("config", "branch.feature/ui.merge", "refs/heads/feature/ui");
	await git("update-ref", "-d", "refs/remotes/origin/feature/ui");
	const tracked = await reader.read(root, signal());

	expect(tracked.publishedHead).toBeNull();
	expect(RepositoryPullRequest.action(tracked)).toBe("push");
});

it("supports SSH links but preserves System Git without reading app credentials", async () => {
	await git("remote", "set-url", "origin", "git@github.com:alice/demo.git");
	const directory = await git(
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir"
	);

	bindings.select(
		directory,
		"origin",
		"git@github.com:alice/demo.git",
		"system"
	);
	const value = await reader.read(root, signal());

	expect(value.identity.browserUrl).toBe("https://github.com/alice/demo");
	expect(value.notice).toContain("Could not check existing requests");
	expect(accounts.repositoryReviews).not.toHaveBeenCalled();
});

it("preserves local preview and gives a notice when hosting metadata is unavailable", async () => {
	spyOn(accounts, "repositoryReviews").mockRejectedValue(new Error("offline"));
	const value = await reader.read(root, signal());

	expect(value.comparison.base).toBe(base);
	expect(value.notice).toContain("Could not check existing requests");
	expect(RepositoryPullRequest.browserUrl(value, "main")).toContain(
		"/compare/main...feature%2Fui"
	);
});

it("rejects forked push URLs, unknown hosts and detached HEAD without any provider writes", async () => {
	await git(
		"remote",
		"set-url",
		"--push",
		"origin",
		"https://github.com/other/fork.git"
	);
	await expect(reader.read(root, signal())).rejects.toThrow(
		"different repositories"
	);
	await git(
		"remote",
		"set-url",
		"origin",
		"https://other.invalid/alice/demo.git"
	);
	await expect(reader.read(root, signal())).rejects.toThrow(
		"GitHub and GitLab"
	);
	await git("checkout", "--detach");
	await expect(reader.read(root, signal())).rejects.toThrow("committed branch");
	expect(accounts.repositoryReviews).not.toHaveBeenCalled();
});
