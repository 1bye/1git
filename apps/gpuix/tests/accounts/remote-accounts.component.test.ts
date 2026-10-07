/**
 * Covers: HTTPS account matching, remembered choices, host isolation, system/SSH fallback and cancellation.
 * Real: Accounts, provider adapters and private metadata/binding files.
 * Doubles: hosting HTTP and OS credential vault; no live accounts or network.
 * Requires: built Git and hosting packages.
 */
import { afterEach, expect, it, spyOn } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import {
	AccountStore,
	type SavedAccount,
} from "../../src/feature/accounts/lib/account-store";
import { RemoteAccounts } from "../../src/feature/accounts/lib/remote-accounts";

const directories: string[] = [];
const remote = "https://github.com/team/project.git";
const signal = () => new AbortController().signal;

afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function fixture(count = 1) {
	const directory = mkdtempSync(join(tmpdir(), "remote-accounts-test-"));

	directories.push(directory);
	const store = new AccountStore(join(directory, "accounts.json"));

	const saved: SavedAccount[] = Array.from({ length: count }, (_, index) => ({
		provider: "github",
		webUrl: "https://github.com/",
		id: String(index + 7),
		username: `user-${index + 7}`,
	}));

	store.save(saved);
	let vaultReads = 0;
	let verifiedId: string | undefined;
	let denied = false;

	const accounts = new Accounts(
		store,
		{
			async read(key) {
				vaultReads++;

				return `fixture-token-${saved.find((account) => AccountStore.key(account) === key)?.id}`;
			},
			async write() {},
			async delete() {},
		},
		async (_url, init) => {
			if (denied) throw new Error("fixture-token-7 must never leak");

			const id =
				verifiedId ??
				new Headers(init?.headers).get("authorization")?.split("-").at(-1);

			return Response.json({
				id: Number(id),
				login: `user-${id}`,
				html_url: `https://github.com/user-${id}`,
			});
		}
	);

	const path = join(directory, "bindings.json");
	const bindings = new RemoteAccounts(accounts, path);

	return {
		saved,
		store,
		accounts,
		bindings,
		path,
		reads: () => vaultReads,
		deny: () => {
			denied = true;
		},
		wrongIdentity: () => {
			verifiedId = "999";
		},
	};
}

it("automatically uses one matching account, not the repository owner or commit author", async () => {
	const f = fixture();

	const auth = await f.bindings.authentication(
		"repo/.git",
		"origin",
		remote,
		signal()
	);

	expect(auth).toEqual({
		url: remote,
		username: "x-access-token",
		password: "fixture-token-7",
	});
	expect(f.reads()).toBe(1);
});

it("asks once, persists only a public account key, and shares the choice across linked worktrees", async () => {
	const f = fixture(2);
	let prompts = 0;

	const choose = async () => {
		prompts++;

		return AccountStore.key(f.saved[1]!);
	};

	const auth = await f.bindings.authentication(
		"common/.git",
		"origin",
		remote,
		signal(),
		choose
	);

	const reopened = new RemoteAccounts(f.accounts, f.path);

	const again = await reopened.authentication(
		"common/.git",
		"origin",
		remote,
		signal(),
		choose
	);

	expect(auth?.password).toBe("fixture-token-8");
	expect(again?.password).toBe("fixture-token-8");
	expect(prompts).toBe(1);
	expect(readFileSync(f.path, "utf8")).not.toContain("fixture-token");
	expect(reopened.choice("other/.git", "origin", remote)).toBe("automatic");
	expect(
		reopened.choice("common/.git", "origin", "https://github.com/team/new.git")
	).toBe("automatic");
});

it("preserves SSH, local paths, unsupported hosts and an explicit system credential choice without vault reads", async () => {
	const f = fixture();

	for (const url of [
		"git@github.com:team/project.git",
		"ssh://git@github.com/team/project.git",
		"/tmp/local.git",
		"https://other.invalid/team/project.git",
		"https://github.com.evil.invalid/team/project.git",
		"https://user@github.com/team/project.git",
	])
		expect(
			await f.bindings.authentication("repo", "origin", url, signal())
		).toBeUndefined();

	f.bindings.select("repo", "origin", remote, "system");
	expect(
		await f.bindings.authentication("repo", "origin", remote, signal())
	).toBeUndefined();
	expect(f.reads()).toBe(0);
});

it("keeps fetch and push destinations independent and rejects unavailable remembered accounts", async () => {
	const f = fixture(2);
	const push = "https://github.com/other/project.git";

	f.bindings.select("repo", "origin", remote, AccountStore.key(f.saved[0]!));
	f.bindings.select("repo", "origin", push, AccountStore.key(f.saved[1]!));
	expect(
		(await f.bindings.authentication("repo", "origin", push, signal()))
			?.password
	).toBe("fixture-token-8");
	f.store.save([f.saved[0]!]);
	await expect(
		f.bindings.authentication("repo", "origin", push, signal())
	).rejects.toThrow("unavailable");
	expect(f.reads()).toBe(1);
});

it("cancels ambiguous selection before saving or accessing credentials", async () => {
	const f = fixture(2);
	const controller = new AbortController();

	await expect(
		f.bindings.authentication(
			"repo",
			"origin",
			remote,
			signal(),
			async () => null
		)
	).rejects.toThrow("Choose an account");
	await expect(
		f.bindings.authentication(
			"repo",
			"origin",
			remote,
			controller.signal,
			async () => {
				controller.abort();

				return AccountStore.key(f.saved[0]!);
			}
		)
	).rejects.toThrow();
	expect(f.bindings.choice("repo", "origin", remote)).toBe("automatic");
	expect(f.reads()).toBe(0);
});

it("does not fall back after failed identity verification, and hides provider/vault details", async () => {
	const f = fixture();

	f.wrongIdentity();
	await expect(
		f.bindings.authentication("repo", "origin", remote, signal())
	).rejects.toThrow("no other account");
	f.deny();
	await expect(
		f.bindings.authentication("repo", "origin", remote, signal())
	).rejects.toThrow("Could not authenticate this account.");
	await expect(
		f.accounts.remoteAuthentication(
			f.saved[0]!,
			"https://other.invalid/team/project.git",
			signal()
		)
	).rejects.toThrow("does not match");
});

it("rejects malformed preferences without overwriting them or reading credentials", async () => {
	const f = fixture();

	writeFileSync(f.path, "invalid");
	await expect(
		f.bindings.authentication("repo", "origin", remote, signal())
	).rejects.toThrow("left unchanged");
	expect(readFileSync(f.path, "utf8")).toBe("invalid");
	expect(f.reads()).toBe(0);
});

it("explains a known missing GitHub permission and leaves unknown token permissions qualified", async () => {
	const f = fixture();
	const access = spyOn(f.accounts, "repositoryAccess").mockResolvedValue(false);

	const profileOnly = await f.bindings.permissionHelp("repo", "origin", remote);

	expect(profileOnly.message).toContain(
		"without access to private repositories"
	);
	expect(profileOnly.accountKey).toBe(AccountStore.key(f.accounts.load()[0]!));
	access.mockResolvedValue(null);
	const unknown = await f.bindings.permissionHelp("repo", "origin", remote);

	expect(unknown.message).toContain("Check its permissions");
	expect(unknown.message).not.toContain(
		"without access to private repositories"
	);
	expect(unknown.accountKey).toBe(profileOnly.accountKey);
	access.mockRestore();
});

it("matches self-hosted GitLab by its exact origin and installation path", () => {
	const f = fixture();

	const account: SavedAccount = {
		provider: "gitlab",
		webUrl: "https://git.example.invalid/gitlab/",
		id: "9",
		username: "self-hosted",
	};

	f.store.save([account]);
	expect(
		f.bindings.matching(
			"https://git.example.invalid/gitlab/group/nested/project.git"
		)
	).toEqual([account]);
	expect(
		f.bindings.matching("https://git.example.invalid/group/project.git")
	).toEqual([]);
	expect(
		f.bindings.matching(
			"https://git.example.invalid/gitlab-other/group/project.git"
		)
	).toEqual([]);
	expect(
		f.bindings.matching(
			"https://git.example.invalid:8443/gitlab/group/project.git"
		)
	).toEqual([]);
	expect(f.reads()).toBe(0);
});
