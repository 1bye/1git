/**
 * Covers: hosted creation, owner/provider routing, guarded remote connection, upload recovery and uncertain writes.
 * Real: Accounts/hosting adapters, publish workflow, temporary Git repositories/config and local push transport.
 * Doubles: provider HTTP, credential vault and HTTPS network command; uploads go to a disposable bare repository.
 * Requires: built Git/hosting packages, Git and writable temporary storage; no live accounts.
 */
import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { execFile } from "node:child_process";
import {
	mkdtemp,
	mkdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { GitRepository, type SyncBranchInput } from "@1git/git";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import {
	AccountStore,
	type SavedAccount,
} from "../../src/feature/accounts/lib/account-store";
import { RemoteAccounts } from "../../src/feature/accounts/lib/remote-accounts";
import {
	RepositoryPublish,
	type PublishedRepository,
	type PublishRepositoryRequest,
} from "../../src/feature/repository-publish/repository-publish";
import { RepositoryReader } from "../../src/feature/repository-workspace/lib/repository-reader";

const execute = promisify(execFile);
let directory: string;
let root: string;
let bare: string;
const secret = "fixture-publish-secret";

const git = async (cwd: string, ...args: string[]) =>
	(
		await execute(
			"git",
			[
				"-c",
				"user.name=Publishing Test",
				"-c",
				"user.email=publish@example.invalid",
				"-c",
				"commit.gpgsign=false",
				"-c",
				"core.hooksPath=/dev/null",
				...args,
			],
			{
				cwd,
				env: {
					...process.env,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
				},
			}
		)
	).stdout.trim();

beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "gpuix-publish-")));
	root = join(directory, "local project");
	bare = join(directory, "hosted.git");
	await mkdir(root);
	await git(root, "init", "--initial-branch=main");
	await git(root, "config", "core.hooksPath", "/dev/null");
	await writeFile(join(root, "file.txt"), "committed\n");
	await git(root, "add", "file.txt");
	await git(root, "commit", "-m", "First");
	await git(directory, "init", "--bare", bare);
});
afterEach(async () => {
	mock.restore();
	await rm(directory, { recursive: true, force: true });
});

async function fixture(provider: SavedAccount["provider"] = "github") {
	const account: SavedAccount = {
		provider,
		id: "7",
		username: "alice",
		webUrl:
			provider === "github" ? "https://github.com/" : "https://gitlab.com/",
	};

	const owner = {
		id: "7",
		path: "alice",
		kind: "user" as const,
		canCreateRepository: null,
	};

	const store = new AccountStore(join(directory, "accounts.json"));

	store.save([account]);
	const posts: Record<string, unknown>[] = [];
	const uploads: SyncBranchInput[] = [];
	let denyPush = false;
	let creationFailure = false;
	let unexpectedHost = false;
	let afterCreation: (() => Promise<void>) | undefined;
	const url = `${account.webUrl}alice/project.git`;

	const wire = () =>
		provider === "github"
			? {
					id: 88,
					name: "project",
					full_name: "alice/project",
					owner: { id: 7, login: "alice" },
					private: true,
					html_url: "https://github.com/alice/project",
					clone_url: unexpectedHost
						? "https://evil.invalid/alice/project.git"
						: url,
					ssh_url: "git@github.com:alice/project.git",
					default_branch: "main",
					permissions: { pull: true, push: true, admin: true },
					description: "Example",
				}
			: {
					id: 88,
					name: "project",
					path: "project",
					path_with_namespace: "alice/project",
					visibility: "private",
					web_url: "https://gitlab.com/alice/project",
					http_url_to_repo: url,
					ssh_url_to_repo: "git@gitlab.com:alice/project.git",
					default_branch: "main",
					description: "Example",
					permissions: { project_access: { access_level: 40 } },
				};

	const accounts = new Accounts(
		store,
		{
			async read() {
				return secret;
			},
			async write() {},
			async delete() {},
		},
		async (destination, init) => {
			const endpoint = new URL(destination).pathname;

			expect(new Headers(init?.headers).get("authorization")).toContain(secret);

			if (init?.method === "POST") {
				posts.push(JSON.parse(String(init.body)));
				await afterCreation?.();

				if (creationFailure) throw new Error(`${secret} network failed`);

				return Response.json(wire(), { status: 201 });
			}

			if (endpoint.endsWith("user/orgs")) return Response.json([]);

			if (endpoint.endsWith("namespaces"))
				return Response.json([{ id: 7, full_path: "alice", kind: "user" }]);

			if (endpoint.endsWith("/user"))
				return Response.json(
					provider === "github"
						? { id: 7, login: "alice", html_url: "https://github.com/alice" }
						: {
								id: 7,
								username: "alice",
								name: "Alice",
								web_url: "https://gitlab.com/alice",
							}
				);

			return Response.json(wire());
		}
	);

	const bindings = new RemoteAccounts(
		accounts,
		join(directory, "bindings.json")
	);

	const service = new RepositoryPublish(accounts, bindings);

	const snapshot = await RepositoryReader.read(
		root,
		new AbortController().signal
	);

	if (!snapshot.ok || !snapshot.value.head.oid)
		throw new Error("Missing fixture commit");

	const identity = {
		expectedHead: snapshot.value.head.oid,
		expectedBranch: "main",
	};

	let created: PublishedRepository | undefined;
	let uncertain = false;

	const input: PublishRepositoryRequest = {
		account,
		owner,
		name: "project",
		description: "Example",
		visibility: "private",
	};

	spyOn(GitRepository.prototype, "syncBranch").mockImplementation(
		async (request) => {
			uploads.push(request);

			if (denyPush)
				return {
					ok: false,
					error: {
						code: "command-failed",
						operation: "push",
						message: "Push denied",
						retryable: true,
					},
				};

			await git(
				root,
				"push",
				"--no-force",
				"--",
				bare,
				"refs/heads/main:refs/heads/main"
			);
			await git(root, "config", "branch.main.remote", "origin");
			await git(root, "config", "branch.main.merge", "refs/heads/main");
			await git(
				root,
				"update-ref",
				"refs/remotes/origin/main",
				identity.expectedHead
			);
			const fresh = await RepositoryReader.read(
				root,
				new AbortController().signal
			);

			if (!fresh.ok) return fresh;

			return {
				ok: true,
				value: {
					operation: "push",
					remote: "origin",
					branch: "main",
					snapshot: fresh.value,
				},
			};
		}
	);

	return {
		input,
		account,
		bindings,
		identity,
		posts,
		uploads,
		url,
		created: () => created,
		uncertain: () => uncertain,
		failPush: () => {
			denyPush = true;
		},
		allowPush: () => {
			denyPush = false;
		},
		failCreate: () => {
			creationFailure = true;
		},
		wrongHost: () => {
			unexpectedHost = true;
		},
		afterCreate: (run: () => Promise<void>) => {
			afterCreation = run;
		},
		run: (request = input) =>
			service.write(
				root,
				request,
				identity,
				new AbortController().signal,
				(receipt) => {
					created = receipt;
				},
				() => {
					uncertain = true;
				}
			),
	};
}

it("publishes private GitHub history, remembers the account and leaves dirty/staged/untracked files untouched", async () => {
	const f = await fixture();

	await writeFile(join(root, "file.txt"), "checked but uncommitted\n");
	await git(root, "add", "file.txt");
	await writeFile(join(root, "note.txt"), "untracked\n");
	const before = await git(root, "status", "--porcelain=v1");

	const result = await f.run();

	expect(result.ok).toBe(true);
	expect(f.posts).toEqual([
		{
			name: "project",
			description: "Example",
			private: true,
			auto_init: false,
		},
	]);
	expect(f.uploads[0]?.httpAuthentication).toEqual({
		url: f.url,
		username: "x-access-token",
		password: secret,
	});
	expect(await git(bare, "show", "main:file.txt")).toBe("committed");
	expect(await git(root, "status", "--porcelain=v1")).toBe(before);
	expect(await git(root, "config", "branch.main.remote")).toBe("origin");
	expect(await readFile(join(root, ".git", "config"), "utf8")).not.toContain(
		secret
	);
	expect(
		f.bindings.choice(f.created()?.commonDirectory ?? "", "origin", f.url)
	).toBe(AccountStore.key(f.account));
});

it("uses GitLab namespace creation and oauth2 Git authentication", async () => {
	const f = await fixture("gitlab");

	expect((await f.run()).ok).toBe(true);
	expect(f.posts).toEqual([
		{
			name: "project",
			path: "project",
			namespace_id: "7",
			visibility: "private",
			description: "Example",
			initialize_with_readme: false,
		},
	]);
	expect(f.uploads[0]?.httpAuthentication?.username).toBe("oauth2");
});

it("retries a failed initial push without creating another hosted repository", async () => {
	const f = await fixture();

	f.failPush();

	expect((await f.run()).ok).toBe(false);
	expect(f.created()).toBeDefined();
	expect(await git(root, "remote", "get-url", "origin")).toBe(f.url);
	f.allowPush();

	expect((await f.run({ ...f.input, created: f.created() })).ok).toBe(true);
	expect(f.posts).toHaveLength(1);
	expect(f.uploads).toHaveLength(2);
});

it("does not create or overwrite anything when a remote is already configured", async () => {
	const f = await fixture();

	await git(root, "remote", "add", "upstream", bare);

	const result = await f.run();

	expect(result.ok).toBe(false);
	expect(f.posts).toHaveLength(0);
	expect(await git(root, "remote", "get-url", "upstream")).toBe(bare);
});

it("retains a receipt but refuses a remote configured by another application during creation", async () => {
	const f = await fixture();

	f.afterCreate(async () => {
		await git(root, "remote", "add", "origin", bare);
	});

	expect((await f.run()).ok).toBe(false);
	expect(f.created()).toBeDefined();
	expect(f.uploads).toHaveLength(0);
	expect(await git(root, "remote", "get-url", "origin")).toBe(bare);
});

it("blocks unexpected clone hosts before connecting or forwarding credentials", async () => {
	const f = await fixture();

	f.wrongHost();

	expect((await f.run()).ok).toBe(false);
	expect(f.created()).toBeUndefined();
	expect(f.uncertain()).toBe(true);
	expect(await git(root, "remote")).toBe("");
	expect(f.uploads).toHaveLength(0);
});

it("marks uncertain creation without leaking credentials or performing an automatic second POST", async () => {
	const f = await fixture();

	f.failCreate();

	const result = await f.run();

	expect(result.ok).toBe(false);
	expect(JSON.stringify(result)).not.toContain(secret);
	expect(f.uncertain()).toBe(true);
	expect(f.created()).toBeUndefined();
	expect(f.posts).toHaveLength(1);
	expect(f.uploads).toHaveLength(0);
});

it("rejects a stale reviewed branch and unknown owners before creating a repository", async () => {
	const f = await fixture();

	expect(
		(await f.run({ ...f.input, owner: { ...f.input.owner, id: "999" } })).ok
	).toBe(false);
	expect(f.posts).toHaveLength(0);
	await git(root, "switch", "-c", "other");
	expect((await f.run()).ok).toBe(false);
	expect(f.posts).toHaveLength(0);
});
