/**
 * Covers: OAuth credential persistence/rotation, backwards-compatible PATs, identity checks and interrupted refreshes.
 * Real: Accounts, private metadata files, providers and refresh transport.
 * Doubles: initial authorization grant, provider HTTPS replies and OS vault; no live account.
 * Requires: built hosting package.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthTokens } from "@1git/hosting/oauth";
import type { HostingFetch } from "@1git/hosting/contracts";
import { AccountAuthorization } from "../../src/feature/accounts/lib/account-authorization";
import { AccountStore } from "../../src/feature/accounts/lib/account-store";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import { decodeCredential } from "../../src/feature/accounts/lib/account-credential";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "1git-oauth-credentials-"));

	directories.push(directory);
	const store = new AccountStore(join(directory, "accounts.json"));
	const secrets = new Map<string, string>();
	let identity = 7;
	let offline = false;
	let refreshes = 0;
	const grants: URLSearchParams[] = [];

	const fetch: HostingFetch = async (url, init) => {
		if (new URL(url).pathname === "/login/oauth/access_token") {
			refreshes++;
			const body = new URLSearchParams(String(init?.body));

			grants.push(body);

			return Response.json({
				access_token: "rotated-access",
				refresh_token: "rotated-refresh",
				token_type: "bearer",
				expires_in: 7200,
			});
		}

		if (offline) throw new Error("Do not leak network details.");

		return Response.json({
			id: identity,
			login: "tester",
			name: null,
			html_url: "https://github.com/tester",
		});
	};

	const tokens: OAuthTokens = {
		accessToken: "initial-access",
		refreshToken: "initial-refresh",
		tokenType: "bearer",
		expiresAt: Date.now() - 1000,
		refreshExpiresAt: null,
		scopes: ["read:user"],
	};

	class GrantFixture extends AccountAuthorization {
		override async authorize(): Promise<OAuthTokens> {
			return tokens;
		}
	}
	const accounts = new Accounts(
		store,
		{
			async read(key) {
				return secrets.get(key) ?? null;
			},
			async write(key, value) {
				secrets.set(key, value);
			},
			async delete(key) {
				secrets.delete(key);
			},
		},
		fetch,
		new GrantFixture(fetch)
	);

	return {
		accounts,
		store,
		secrets,
		tokens,
		grants,
		refreshes: () => refreshes,
		identity: (id: number) => {
			identity = id;
		},
		offline: () => {
			offline = true;
		},
	};
}
const input = () => ({
	provider: "github" as const,
	webUrl: "https://github.com",
	registration: { clientId: "public-client" },
	signal: new AbortController().signal,
});

test("refreshes and verifies the account before supplying one-shot Git credentials", async () => {
	const f = fixture();
	const [account] = await f.accounts.connectBrowser(input());

	if (!account) throw new Error("Missing fixture account.");

	const auth = await f.accounts.remoteAuthentication(
		account,
		"https://github.com/team/project.git",
		new AbortController().signal
	);

	expect(auth).toEqual({
		url: "https://github.com/team/project.git",
		username: "x-access-token",
		password: "rotated-access",
	});
	expect(f.refreshes()).toBe(1);
	expect(f.store.load()).toEqual([account]);
});

test("stores the whole OAuth pair only in the vault and serializes simultaneous refresh checks", async () => {
	const f = fixture();
	const saved = await f.accounts.connectBrowser(input());
	const account = saved[0]!;
	const key = AccountStore.key(account);

	expect(readFileSync(f.store.path, "utf8")).not.toContain("initial-");
	expect(
		decodeCredential(f.secrets.get(key)!, "github").oauth?.tokens.refreshToken
	).toBe("initial-refresh");
	expect(await f.accounts.registration(account)).toEqual({
		clientId: "public-client",
		redirectUri: undefined,
	});
	expect(
		await Promise.all([f.accounts.check(account), f.accounts.check(account)])
	).toEqual(["Connected", "Connected"]);
	expect(f.refreshes()).toBe(1);
	expect(f.grants[0]?.get("refresh_token")).toBe("initial-refresh");
	expect(f.grants[0]?.has("client_secret")).toBe(false);
	expect(
		decodeCredential(f.secrets.get(key)!, "github").oauth?.tokens.refreshToken
	).toBe("rotated-refresh");
	await f.accounts.disconnect(account);
	expect(f.secrets.size).toBe(0);
});
test("retains the rotated pair when the identity request loses its network connection", async () => {
	const f = fixture();
	const account = (await f.accounts.connectBrowser(input()))[0]!;

	f.offline();
	await expect(f.accounts.check(account)).rejects.toThrow();
	expect(
		decodeCredential(f.secrets.get(AccountStore.key(account))!, "github").token
	).toBe("rotated-access");
	expect(f.store.load()).toHaveLength(1);
});
test("refuses another identity on reconnect and preserves the previous saved credential", async () => {
	const f = fixture();
	const account = (await f.accounts.connectBrowser(input()))[0]!;
	const previous = f.secrets.get(AccountStore.key(account));

	f.identity(8);
	await expect(
		f.accounts.connectBrowser({ ...input(), replacing: account })
	).rejects.toThrow("different account");
	expect(f.secrets.get(AccountStore.key(account))).toBe(previous);
	expect(f.store.load()[0]?.id).toBe("7");
});
test("legacy tokens still work, corrupt bundles are rejected and missing refresh requires reconnect", async () => {
	const f = fixture();
	const account = (await f.accounts.connectBrowser(input()))[0]!;
	const key = AccountStore.key(account);

	f.secrets.set(key, "legacy-token");
	expect(await f.accounts.check(account)).toBe("Connected");
	expect(await f.accounts.registration(account)).toBeUndefined();
	f.secrets.set(key, "{broken}");
	await expect(f.accounts.check(account)).rejects.toThrow("Reconnect");
	f.secrets.set(
		key,
		JSON.stringify({
			version: 1,
			registration: { clientId: "public-client" },
			tokens: { ...f.tokens, refreshToken: null },
		})
	);
	expect(await f.accounts.check(account)).toContain("Reconnect");
	expect(f.refreshes()).toBe(0);
});
