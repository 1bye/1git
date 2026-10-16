/**
 * Covers: CLI discovery, pinned identity, rotated credentials, method changes and disconnect/rollback.
 * Real: GitHubCli, Accounts, hosting transport and disposable AccountStore files.
 * Doubles: gh process, HTTP and OS vault; no personal credentials or network.
 * Requires: built @1git/hosting.
 */
import { afterEach, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import {
	GitHubCli,
	type GitHubCliAccount,
} from "../../src/feature/accounts/lib/github-cli";
import type { CredentialVault } from "../../src/feature/accounts/lib/native-credentials";
import type { HostingFetch } from "@1git/hosting/contracts";

const directories: string[] = [];

const selected: GitHubCliAccount = {
	host: "github.com",
	username: "tester",
	active: false,
};

afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });

	mock.restore();
});

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "1git-cli-test-"));

	directories.push(directory);
	const store = new AccountStore(join(directory, "accounts.json"));
	const secrets = new Map<string, string>();

	const vault: CredentialVault = {
		read: mock(async (key: string) => secrets.get(key) ?? null),
		write: mock(async (key: string, token: string) => {
			secrets.set(key, token);
		}),
		delete: mock(async (key: string) => {
			secrets.delete(key);
		}),
	};

	let token = "cli-secret-one";
	let login = "tester";
	let response: HostingFetch | undefined;
	const calls: (readonly string[])[] = [];

	const cli = new GitHubCli(async (args) => {
		calls.push(args);

		if (args[1] === "status")
			return JSON.stringify({
				hosts: {
					"github.com": [
						{ login: "other", active: true, state: "success", token: "masked" },
						{
							login: "tester",
							active: false,
							state: "success",
							token: "masked",
						},
					],
				},
			});

		return token;
	});

	const headers: (string | null)[] = [];

	const fetch: HostingFetch = async (url, init) => {
		headers.push(new Headers(init?.headers).get("authorization"));

		if (response) return await response(url, init);

		return Response.json({
			id: login === "tester" ? 7 : 8,
			login,
			name: null,
			html_url: `https://github.com/${login}`,
		});
	};

	const accounts = new Accounts(store, vault, fetch, undefined, cli);

	return {
		store,
		secrets,
		vault,
		cli,
		calls,
		accounts,
		headers,
		rotate: (next: string) => {
			token = next;
		},
		identity: (next: string) => {
			login = next;
		},
		respond: (next: HostingFetch) => {
			response = next;
		},
	};
}

it("discovers multiple accounts and enterprise hosts without exposing token fields", async () => {
	const cli = new GitHubCli(async () =>
		JSON.stringify({
			hosts: {
				"github.com": [
					{
						login: "personal",
						active: true,
						state: "success",
						token: "never-render",
					},
					{
						login: "work",
						active: false,
						state: "success",
						token: "never-render",
					},
					{ login: "expired", active: false, state: "error" },
				],
				"code.example.test": [
					{ login: "employee", active: true, state: "success" },
				],
			},
		})
	);

	expect(await cli.accounts()).toEqual([
		{ host: "github.com", username: "personal", active: true },
		{ host: "github.com", username: "work", active: false },
		{ host: "code.example.test", username: "employee", active: true },
	]);
});

it("keeps credentials in gh and pins the chosen inactive account across rotation and reload", async () => {
	const f = fixture();

	expect(await f.accounts.cliAccounts()).toHaveLength(2);
	const [account] = await f.accounts.connectCli(selected);

	if (!account) throw new Error("Missing saved account");

	expect(f.store.load()).toEqual([account]);
	expect(account.credentialSource).toBe("github-cli");
	expect(readFileSync(f.store.path, "utf8")).not.toContain("cli-secret");
	expect(f.vault.read).not.toHaveBeenCalled();
	expect(f.vault.write).not.toHaveBeenCalled();
	f.rotate("cli-secret-two");
	const reloaded = new Accounts(
		f.store,
		f.vault,
		async (_url, init) => {
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer cli-secret-two"
			);

			return Response.json({
				id: 7,
				login: "tester",
				name: null,
				html_url: "https://github.com/tester",
			});
		},
		undefined,
		f.cli
	);

	expect(await reloaded.check(account)).toBe("Connected");
	const auth = await f.accounts.remoteAuthentication(
		account,
		"https://github.com/team/repo.git",
		new AbortController().signal
	);

	expect(auth.password).toBe("cli-secret-two");
	expect(f.calls.filter((args) => args[1] === "token")).toEqual(
		Array.from({ length: 3 }, () => [
			"auth",
			"token",
			"--hostname",
			"github.com",
			"--user",
			"tester",
		])
	);
	expect(await f.accounts.repositoryAccess(account)).toBeNull();
	expect(await f.accounts.registration(account)).toBeUndefined();
	expect(await f.accounts.disconnect(account)).toEqual([]);
	expect(await f.accounts.check(account)).toBe("Reconnect — no saved token");
	expect(await f.accounts.disconnect(account)).toEqual([]);
	expect(f.vault.read).not.toHaveBeenCalled();
	expect(f.vault.delete).not.toHaveBeenCalled();
	expect(
		f.calls.every((args) => args[1] === "token" || args[1] === "status")
	).toBe(true);
});

it("uses CLI credentials for repository browsing and PR previews through the existing hosting client", async () => {
	const f = fixture();
	const [account] = await f.accounts.connectCli(selected);

	if (!account) throw new Error("Missing account");

	const repository = {
		id: 10,
		name: "project",
		full_name: "tester/project",
		owner: { login: "tester" },
		description: null,
		private: true,
		default_branch: "main",
		html_url: "https://github.com/tester/project",
		clone_url: "https://github.com/tester/project.git",
		ssh_url: "git@github.com:tester/project.git",
		permissions: { pull: true, push: true, admin: false },
	};

	f.respond(async (url) => {
		const path = new URL(url).pathname;

		if (path === "/user")
			return Response.json({
				id: 7,
				login: "tester",
				html_url: "https://github.com/tester",
			});

		if (path === "/user/repos") return Response.json([repository]);

		if (path === "/repos/tester/project") return Response.json(repository);

		return Response.json([
			{
				id: 100,
				number: 1,
				title: "CLI preview",
				body: "Review this change",
				state: "open",
				draft: false,
				merged_at: null,
				head: { ref: "feature", repo: { id: 10 } },
				base: { ref: "main" },
				html_url: "https://github.com/tester/project/pull/1",
			},
		]);
	});
	f.rotate("cli-secret-two");
	const repositories = await f.accounts.repositories(account, "");

	const reviews = await f.accounts.repositoryReviews(
		account,
		{ owner: "tester", name: "project" },
		new AbortController().signal
	);

	expect(repositories.items[0]?.ref.name).toBe("project");
	expect(reviews.requests[0]?.title).toBe("CLI preview");
	expect(reviews.complete).toBe(true);
	expect(
		f.headers.slice(1).every((header) => header === "Bearer cli-secret-two")
	).toBe(true);
	expect(f.secrets.size).toBe(0);
});

it("reports signed-out CLI credentials without falling back to the app vault or deleting the account", async () => {
	const f = fixture();
	const [account] = await f.accounts.connectCli(selected);

	if (!account) throw new Error("Missing account");

	f.rotate("");
	await expect(f.accounts.check(account)).rejects.toThrow("gh auth login");
	expect(f.store.load()).toEqual([account]);
	expect(f.vault.read).not.toHaveBeenCalled();
});

it("rejects a credential belonging to another identity before saving or sending it to Git", async () => {
	const f = fixture();

	f.identity("other");
	await expect(f.accounts.connectCli(selected)).rejects.toThrow(
		"different account"
	);
	expect(f.store.load()).toEqual([]);
	f.identity("tester");
	const [account] = await f.accounts.connectCli(selected);

	if (!account) throw new Error("Missing account");

	f.identity("other");
	await expect(
		f.accounts.remoteAuthentication(
			account,
			"https://github.com/team/repo.git",
			new AbortController().signal
		)
	).rejects.toThrow("identity could not be verified");
	expect(f.store.load()).toEqual([account]);
});

it("connects an existing app account through CLI even when its old OS credential is inaccessible", async () => {
	const f = fixture();

	const existing = {
		provider: "github" as const,
		webUrl: "https://github.com/",
		id: "7",
		username: "tester",
	};

	f.store.save([existing]);

	for (const method of ["read", "write", "delete"] as const)
		spyOn(f.vault, method).mockRejectedValue(
			new Error("OS credential store is unavailable or access was denied")
		);

	const next = await f.accounts.connectCli(selected, { replacing: existing });

	expect(next[0]?.credentialSource).toBe("github-cli");
	expect(await f.accounts.check(existing)).toBe("Connected");
	expect(f.vault.read).not.toHaveBeenCalled();
	expect(f.vault.write).not.toHaveBeenCalled();
	expect(f.vault.delete).not.toHaveBeenCalled();
});

it("changes credential sources without accessing the previous app token and preserves metadata on failure", async () => {
	const f = fixture();

	const input = {
		provider: "github" as const,
		webUrl: "https://github.com/",
		token: "app-secret",
	};

	const [appAccount] = await f.accounts.connect(input);

	if (!appAccount) throw new Error("Missing account");

	const save = spyOn(f.store, "save").mockImplementation(() => {
		throw new Error("disk unavailable");
	});

	await expect(f.accounts.connectCli(selected)).rejects.toThrow(
		"left unchanged"
	);
	expect(f.secrets.get(AccountStore.key(appAccount))).toBe("app-secret");
	expect(f.store.load()).toEqual([appAccount]);
	save.mockRestore();
	await f.accounts.connectCli(selected, { replacing: appAccount });
	expect(f.secrets.get(AccountStore.key(appAccount))).toBe("app-secret");
	expect(await f.accounts.check(appAccount)).toBe("Connected");
	expect(f.headers.at(-1)).toBe("Bearer cli-secret-one");
	const [restored] = await f.accounts.connect(input);

	expect(restored?.credentialSource).toBeUndefined();
	expect(f.secrets.get(AccountStore.key(appAccount))).toBe("app-secret");
});

it("preserves CLI metadata if disconnect persistence fails without touching gh or the vault", async () => {
	const f = fixture();
	const [account] = await f.accounts.connectCli(selected);

	if (!account) throw new Error("Missing account");

	spyOn(f.store, "save").mockImplementation(() => {
		throw new Error("disk unavailable");
	});
	await expect(f.accounts.disconnect(account)).rejects.toThrow(
		"Could not remove"
	);
	expect(f.store.load()).toEqual([account]);
	expect(f.vault.read).not.toHaveBeenCalled();
});

it("sanitizes process/JSON failures, handles empty accounts and rejects unsafe selections", async () => {
	const failing = new GitHubCli(async () => {
		throw new Error("raw-secret-stderr");
	});

	await expect(failing.accounts()).rejects.toThrow("GitHub CLI is unavailable");
	await expect(
		new GitHubCli(async () => "raw-secret-json").accounts()
	).rejects.toThrow("Could not read GitHub CLI accounts");
	expect(await new GitHubCli(async () => '{"hosts":{}}').accounts()).toEqual(
		[]
	);
	const run = mock(async () => "never-request");
	const cli = new GitHubCli(run);

	await expect(
		cli.token({ host: "https://github.com/path", username: "tester" })
	).rejects.toThrow("Invalid");
	await expect(
		cli.token({ host: "github.com", username: "--active" })
	).rejects.toThrow("Invalid");
	expect(run).not.toHaveBeenCalled();
	const controller = new AbortController();

	controller.abort();
	await expect(cli.accounts(controller.signal)).rejects.toThrow();
	expect(run).not.toHaveBeenCalled();
});

it("does not persist cancelled CLI connections or accept CLI metadata for GitLab", async () => {
	const f = fixture();
	const controller = new AbortController();

	controller.abort();
	await expect(
		f.accounts.connectCli(selected, { signal: controller.signal })
	).rejects.toThrow();
	expect(f.store.load()).toEqual([]);
	expect(() =>
		f.store.save([
			{
				provider: "gitlab",
				webUrl: "https://gitlab.com/",
				id: "7",
				username: "tester",
				credentialSource: "github-cli",
			},
		])
	).toThrow("Invalid credential source");
});
