/**
 * Covers: local annotated tag creation/reading, Graph commits from other refs, explicit single-tag publication and push-account routing/permission failures.
 * Real: app graph/Git boundaries and disposable repositories/local bare remote.
 * Doubles: HTTP push result and account token lookup only in authentication scenarios; no provider acceptance claimed.
 * Requires: Git and temporary storage; no network, vault or user repository access.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GitRepository, type PushTagInput } from "@1git/git";
import { RepositoryTags } from "../../src/feature/repository-workspace/lib/repository-tags";
import { RepositorySync } from "../../src/feature/repository-workspace/lib/repository-sync";
import { RemoteAccounts } from "../../src/feature/accounts/lib/remote-accounts";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { RepositoryGraphReader } from "../../src/feature/repository-graph/repository-graph-reader";

const execute = promisify(execFile);
let directory: string;
let root: string;
let head: string;
let remote: string;
const signal = () => new AbortController().signal;

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
	directory = await realpath(await mkdtemp(join(tmpdir(), "1git-tags-")));
	root = join(directory, "repository");
	remote = join(directory, "remote.git");
	await mkdir(root);
	await git("init", "--initial-branch=main");
	await git("config", "user.name", "Tag Test");
	await git("config", "user.email", "tags@example.invalid");
	await git("config", "commit.gpgSign", "false");
	await git("config", "tag.gpgSign", "false");
	await git("config", "core.hooksPath", "/dev/null");
	await writeFile(join(root, "a.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "Base");
	head = await git("rev-parse", "HEAD");
	await git("init", "--bare", remote);
	await git("remote", "add", "origin", remote);
});
afterEach(async () => {
	mock.restore();
	await rm(directory, { recursive: true, force: true });
});

async function create(): Promise<PushTagInput> {
	const created = await RepositoryTags.create(root, {
		name: "v1.0.0",
		message: "Release v1.0.0",
		commit: head,
		expectedHead: head,
		expectedBranch: "main",
	});

	if (!created.ok) throw new Error(created.error.message);

	const tags = await RepositoryTags.read(root, signal());

	if (!tags.ok || !tags.value[0]) throw new Error("Missing tag");

	const tag = tags.value[0];

	return {
		name: tag.name,
		expectedOid: tag.oid,
		expectedTarget: tag.targetOid,
		remote: "origin",
		expectedUrl: remote,
		expectedHead: head,
		expectedBranch: "main",
	};
}

function bindings(): RemoteAccounts {
	return new RemoteAccounts(
		new Accounts(new AccountStore(join(directory, "accounts.json")), {
			async read() {
				throw new Error("No vault access allowed");
			},
			async write() {},
			async delete() {},
		}),
		join(directory, "choices.json")
	);
}

it("creates locally, reads annotated and lightweight labels, and pushes only after an explicit call", async () => {
	await writeFile(join(root, "dirty.txt"), "keep\n");
	const request = await create();

	expect(
		await git("--git-dir", remote, "for-each-ref", "--format=%(refname)")
	).toBe("");
	await git("tag", "legacy", head);
	const tags = await RepositoryTags.read(root, signal());

	expect(tags.ok && tags.value.map((tag) => tag.type).sort()).toEqual([
		"annotated",
		"lightweight",
	]);
	const result = await RepositorySync.pushTag(root, request, signal());

	expect(result.ok).toBe(true);
	expect(
		await git("--git-dir", remote, "for-each-ref", "--format=%(refname)")
	).toBe("refs/tags/v1.0.0");
	expect(await git("rev-parse", "HEAD")).toBe(head);
	expect(await git("status", "--porcelain")).toBe("?? dirty.txt");
});

it.each(["local", "remote", "tag"] as const)(
	"creates a release tag on a Graph commit reachable only from another %s ref",
	async (kind) => {
		await git("checkout", "-b", "feature");
		await writeFile(join(root, "feature.txt"), "selected feature work\n");
		await git("add", ".");
		await git("commit", "-m", "Feature work");
		const feature = await git("rev-parse", "HEAD");

		await git("checkout", "main");
		await writeFile(join(root, "main.txt"), "viewed branch work\n");
		await git("add", ".");
		await git("commit", "-m", "Viewed branch work");
		head = await git("rev-parse", "HEAD");

		if (kind === "remote")
			await git("update-ref", "refs/remotes/origin/feature", feature);

		if (kind === "tag") await git("tag", "feature-source", feature);

		if (kind !== "local") await git("branch", "-D", "feature");

		const refs = await RepositoryGraphReader.references(root, head, signal());

		if (!refs.ok) throw new Error(refs.error.message);

		const page = await RepositoryGraphReader.page(
			root,
			refs.value.references.map((ref) => ref.oid),
			0,
			signal()
		);

		if (!page.ok) throw new Error(page.error.message);

		const selected = page.value.commits.find(
			(commit) => commit.oid === feature
		);

		if (!selected)
			throw new Error("Missing commit from the other ref in Graph");

		await writeFile(join(root, "keep.txt"), "untracked stays\n");
		const result = await RepositoryTags.create(root, {
			name: "feature-v1",
			message: "Feature release",
			commit: selected.oid,
			expectedHead: head,
			expectedBranch: "main",
		});

		expect(result.ok).toBe(true);
		expect(await git("rev-parse", "feature-v1^{commit}")).toBe(feature);
		expect(await git("cat-file", "-t", "feature-v1")).toBe("tag");
		expect(await git("branch", "--show-current")).toBe("main");
		expect(await git("rev-parse", "HEAD")).toBe(head);
		expect(await git("status", "--porcelain")).toBe("?? keep.txt");
		expect(
			await git("--git-dir", remote, "for-each-ref", "--format=%(refname)")
		).toBe("");
	}
);

it("uses the push destination's account, not the fetch destination, without storing the credential", async () => {
	const request = await create();
	const fetchUrl = "https://github.com/team/repo.git";
	const pushUrl = "https://gitlab.com/team/repo.git";

	await git("remote", "set-url", "origin", fetchUrl);
	await git("remote", "set-url", "--push", "origin", pushUrl);
	const accounts = bindings();

	const credential = {
		url: pushUrl,
		username: "fixture",
		password: "synthetic-test-only",
	};

	const authenticate = spyOn(accounts, "authentication").mockResolvedValue(
		credential
	);

	const opened = await GitRepository.open({ path: root });

	if (!opened.ok) throw new Error(opened.error.message);

	const snapshot = await opened.value.getSnapshot();

	if (!snapshot.ok) throw new Error(snapshot.error.message);

	const push = spyOn(GitRepository.prototype, "pushTag").mockResolvedValue({
		ok: true,
		value: {
			name: request.name,
			oid: request.expectedOid,
			remote: "origin",
			snapshot: snapshot.value,
		},
	});

	const result = await RepositorySync.pushTag(
		root,
		{ ...request, expectedUrl: pushUrl },
		signal(),
		{ accounts }
	);

	expect(result.ok).toBe(true);
	expect(authenticate.mock.calls[0]?.[2]).toBe(pushUrl);
	expect(push.mock.calls[0]?.[0]).toMatchObject({
		...request,
		expectedUrl: pushUrl,
		httpAuthentication: credential,
	});
	expect(await git("config", "--local", "--list")).not.toContain(
		credential.password
	);
});

it("keeps SSH/system authentication and returns account permission help when an authenticated tag push is denied", async () => {
	const request = await create();
	const accounts = bindings();

	const authenticate = spyOn(accounts, "authentication").mockResolvedValue(
		undefined
	);

	const result = await RepositorySync.pushTag(root, request, signal(), {
		accounts,
	});

	expect(result.ok).toBe(true);
	expect(authenticate.mock.calls[0]?.[2]).toBe(remote);
	const url = "https://github.com/team/repo.git";

	await git("remote", "set-url", "origin", url);
	authenticate.mockResolvedValue({
		url,
		username: "fixture",
		password: "synthetic-test-only",
	});
	spyOn(GitRepository.prototype, "pushTag").mockResolvedValue({
		ok: false,
		error: {
			operation: "push-tag",
			code: "authentication-required",
			retryable: true,
			message: "Denied",
		},
	});
	spyOn(accounts, "permissionHelp").mockResolvedValue({
		message: "Reconnect with repository access.",
	});
	const denied = await RepositorySync.pushTag(
		root,
		{ ...request, expectedUrl: url },
		signal(),
		{ accounts }
	);

	expect(denied.ok).toBe(false);

	if (!denied.ok)
		expect(denied.error.message).toBe("Reconnect with repository access.");
});

it("refuses cancelled creation/push without any tag writes", async () => {
	const cancelled = AbortSignal.abort();

	const result = await RepositoryTags.create(root, {
		name: "v1",
		message: "Release v1",
		commit: head,
		expectedHead: head,
		expectedBranch: "main",
		signal: cancelled,
	});

	expect(result.ok).toBe(false);
	expect(await git("tag", "--list")).toBe("");
	const request = await create();

	expect((await RepositorySync.pushTag(root, request, cancelled)).ok).toBe(
		false
	);
	expect(
		await git("--git-dir", remote, "for-each-ref", "--format=%(refname)")
	).toBe("");
});
