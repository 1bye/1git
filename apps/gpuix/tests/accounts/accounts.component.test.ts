/**
 * Covers: host/account isolation, token validation, persistence, reauthentication, rollback and safe failures.
 * Real: Accounts, hosting providers/transport and private AccountStore files in disposable directories.
 * Doubles: HTTP responses and OS credential vault; no live accounts or network.
 * Requires: built @1git/hosting.
 */
import { afterEach, expect, it, mock, spyOn } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Accounts } from "../../src/feature/accounts/lib/accounts";
import {
	AccountStore,
	type SavedAccount,
} from "../../src/feature/accounts/lib/account-store";
import {
	NativeCredentials,
	type CredentialVault,
} from "../../src/feature/accounts/lib/native-credentials";
import type { HostingFetch } from "@1git/hosting/contracts";

const directories: string[] = [];

afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });

	mock.restore();
});

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "1git-accounts-test-"));

	directories.push(directory);
	const store = new AccountStore(join(directory, "accounts.json"));
	const secrets = new Map<string, string>();

	const vault: CredentialVault = {
		async read(key) {
			return secrets.get(key) ?? null;
		},
		async write(key, token) {
			secrets.set(key, token);
		},
		async delete(key) {
			secrets.delete(key);
		},
	};

	const requests: { url: string; authorization: string | null }[] = [];

	let response = Response.json({
		id: 7,
		login: "tester",
		name: "Test User",
		html_url: "https://github.com/tester",
	});

	const fetch: HostingFetch = async (url, init) => {
		requests.push({
			url: String(url),
			authorization: new Headers(init?.headers).get("authorization"),
		});

		if (new URL(String(url)).pathname === "/user/emails")
			return Response.json([
				{ email: "tester@example.invalid", primary: true, verified: true },
			]);

		const body: unknown = await response
			.clone()
			.json()
			.catch(() => null);

		const target = new URL(String(url));

		if (
			target.host !== "api.github.com" &&
			body &&
			typeof body === "object" &&
			"html_url" in body &&
			typeof body.html_url === "string"
		) {
			return Response.json(
				{ ...body, html_url: `${target.origin}/tester` },
				{ status: response.status }
			);
		}

		return new Response(await response.clone().arrayBuffer(), {
			status: response.status,
			headers: new Headers(response.headers),
		});
	};

	const service = new Accounts(store, vault, fetch);

	const input = {
		provider: "github" as const,
		webUrl: "https://github.com",
		token: "fixture-only-token",
	};

	return {
		service,
		store,
		secrets,
		vault,
		requests,
		input,
		respond: (value: Response) => {
			response = value;
		},
	};
}

it("reads verified author suggestions without persisting emails or changing credentials", async () => {
	const f = fixture();
	const saved = await f.service.connect(f.input);
	const account = saved[0]!;

	expect(await f.service.commitIdentity(account)).toEqual({
		id: "7",
		name: "Test User",
		email: "tester@example.invalid",
	});
	expect(f.store.load()).toEqual(saved);
	expect(f.secrets.get(AccountStore.key(account))).toBe(f.input.token);
	expect(f.requests.at(-1)?.authorization).toBe("Bearer fixture-only-token");

	f.respond(
		Response.json({
			id: 99,
			login: "other",
			html_url: "https://github.com/other",
		})
	);
	await expect(f.service.commitIdentity(account)).rejects.toThrow(
		"could not be verified"
	);

	const controller = new AbortController();

	controller.abort();
	const count = f.requests.length;

	await expect(
		f.service.commitIdentity(account, controller.signal)
	).rejects.toThrow();
	expect(f.requests).toHaveLength(count);
});

it("validates the token with the configured provider, persists only identity, and disconnects locally", async () => {
	const f = fixture();
	const saved = await f.service.connect(f.input);
	const account = saved[0]!;

	expect(f.requests).toEqual([
		{
			url: "https://api.github.com/user",
			authorization: "Bearer fixture-only-token",
		},
	]);
	expect(f.store.load()).toEqual(saved);
	expect(account.webUrl).toBe("https://github.com/");
	expect(f.secrets.get(AccountStore.key(account))).toBe(f.input.token);
	expect(readFileSync(f.store.path, "utf8")).not.toContain(f.input.token);
	expect(statSync(f.store.path).mode & 0o777).toBe(0o600);
	expect(await f.service.check(account)).toBe("Connected");
	expect(await f.service.disconnect(account)).toEqual([]);
	expect(f.secrets.size).toBe(0);
	expect(f.store.load()).toEqual([]);
});

it("supports GitLab and self-hosted API endpoints with distinct credential keys", async () => {
	const f = fixture();
	const github = (await f.service.connect(f.input))[0]!;

	const enterprise = (
		await f.service.connect({ ...f.input, webUrl: "https://code.example.test" })
	)[1]!;

	const gitlabResponse = {
		id: 7,
		username: "tester",
		name: "Test User",
		web_url: "https://gitlab.example.test/tester",
	};

	f.respond(Response.json(gitlabResponse));
	const gitlab = (
		await f.service.connect({
			...f.input,
			provider: "gitlab",
			webUrl: "https://gitlab.example.test",
		})
	)[2]!;

	expect(f.requests.map((entry) => entry.url)).toEqual([
		"https://api.github.com/user",
		"https://code.example.test/api/v3/user",
		"https://gitlab.example.test/api/v4/user",
	]);
	expect(new Set([github, enterprise, gitlab].map(AccountStore.key)).size).toBe(
		3
	);
	expect(f.secrets.size).toBe(3);
});

it("keeps multiple identities on the same host and prevents reconnecting the wrong identity", async () => {
	const f = fixture();
	const first = (await f.service.connect(f.input))[0]!;

	f.respond(
		Response.json({
			id: 8,
			login: "another",
			name: null,
			html_url: "https://github.com/another",
		})
	);

	await expect(
		f.service.connect({ ...f.input, replacing: first })
	).rejects.toThrow("different account");
	expect(f.store.load()).toEqual([first]);
	expect((await f.service.connect(f.input)).length).toBe(2);
});

it("replaces an account token and restores it if metadata saving fails", async () => {
	const f = fixture();
	const account = (await f.service.connect(f.input))[0]!;

	await f.service.connect({
		...f.input,
		token: "replacement-fixture",
		replacing: account,
	});
	spyOn(f.store, "save").mockImplementation(() => {
		throw new Error("fixture write failure");
	});

	await expect(
		f.service.connect({
			...f.input,
			token: "failed-replacement",
			replacing: account,
		})
	).rejects.toThrow("restored");
	expect(f.secrets.get(AccountStore.key(account))).toBe("replacement-fixture");
	expect(f.store.load()).toEqual([account]);
	await expect(f.service.disconnect(account)).rejects.toThrow("restored");
	expect(f.secrets.get(AccountStore.key(account))).toBe("replacement-fixture");
});

it("removes a newly written credential when metadata cannot be saved", async () => {
	const f = fixture();

	spyOn(f.store, "save").mockImplementation(() => {
		throw new Error("fixture write failure");
	});

	await expect(f.service.connect(f.input)).rejects.toThrow(
		"previous credential was restored"
	);
	expect(f.secrets.size).toBe(0);
	expect(f.store.load()).toEqual([]);
});

it("reports an unsuccessful rollback explicitly", async () => {
	const f = fixture();

	spyOn(f.store, "save").mockImplementation(() => {
		throw new Error("fixture write failure");
	});
	spyOn(f.vault, "delete").mockRejectedValue(new Error("fixture denied"));

	await expect(f.service.connect(f.input)).rejects.toThrow("rollback failed");
});

it("keeps saved accounts and tokens on authentication and network failures", async () => {
	const f = fixture();
	const account = (await f.service.connect(f.input))[0]!;

	f.respond(Response.json({ message: f.input.token }, { status: 401 }));

	await expect(f.service.connect(f.input)).rejects.toThrow();
	expect(await f.service.check(account)).toContain("token expired or invalid");
	f.respond(new Response("unavailable", { status: 503 }));
	await expect(f.service.check(account)).rejects.toThrow();
	expect(f.store.load()).toEqual([account]);
	expect(f.secrets.get(AccountStore.key(account))).toBe(f.input.token);
});

it("does not replace credentials when a Keychain read is denied", async () => {
	const f = fixture();
	const account = (await f.service.connect(f.input))[0]!;

	spyOn(f.vault, "read").mockRejectedValue(
		new Error("OS credential access denied")
	);

	await expect(
		f.service.connect({ ...f.input, token: "new-fixture" })
	).rejects.toThrow("denied");
	await expect(f.service.disconnect(account)).rejects.toThrow("denied");
	expect(f.secrets.get(AccountStore.key(account))).toBe(f.input.token);
	expect(f.store.load()).toEqual([account]);
});

it("does not overwrite invalid metadata or write a credential after cancellation", async () => {
	const f = fixture();

	writeFileSync(f.store.path, "not json");

	await expect(f.service.connect(f.input)).rejects.toThrow("left unchanged");
	expect(readFileSync(f.store.path, "utf8")).toBe("not json");
	expect(f.secrets.size).toBe(0);
	rmSync(f.store.path);
	const controller = new AbortController();

	controller.abort();
	await expect(
		f.service.connect({ ...f.input, signal: controller.signal })
	).rejects.toThrow();
	expect(f.secrets.size).toBe(0);
});

it("serializes concurrent account writes without losing identities", async () => {
	const f = fixture();

	await Promise.all([
		f.service.connect(f.input),
		f.service.connect({ ...f.input, webUrl: "https://another.example.test" }),
	]);

	expect(f.store.load().length).toBe(2);
	expect(f.secrets.size).toBe(2);
});

it("rejects unsafe hosts, oversized tokens and control characters before requests", async () => {
	const f = fixture();

	for (const webUrl of [
		"http://github.com",
		"https://user:password@github.com",
		"https://github.com/?token=secret",
	])
		await expect(f.service.connect({ ...f.input, webUrl })).rejects.toThrow();

	for (const token of [
		"",
		"a".repeat(2049),
		"has\nnewline",
		"has space",
		"has\x7fdelete",
	])
		await expect(f.service.connect({ ...f.input, token })).rejects.toThrow();

	expect(f.requests).toEqual([]);
	expect(f.secrets.size).toBe(0);
});

it("projects away unexpected secret fields when saving metadata", () => {
	const f = fixture();

	const account = {
		provider: "github" as const,
		webUrl: "https://github.com/",
		id: "7",
		username: "tester",
		token: "never-save-me",
	};

	f.store.save([account]);

	expect(readFileSync(f.store.path, "utf8")).not.toContain("never-save-me");
	expect(f.store.load()).toEqual([
		{
			provider: account.provider,
			webUrl: account.webUrl,
			id: account.id,
			username: account.username,
		},
	]);
});

it("sanitizes native failures and never falls back to plaintext storage", async () => {
	const key = AccountStore.key({
		provider: "github",
		webUrl: "https://github.com/",
		id: "7",
		username: "tester",
	});

	const reject = async () => {
		throw new Error("RAW-secret-fixture");
	};

	const credentials = new NativeCredentials({
		readHostingCredential: reject,
		writeHostingCredential: reject,
		deleteHostingCredential: reject,
	});

	await expect(credentials.read(key)).rejects.toThrow("Unlock");
	await expect(credentials.write(key, "synthetic-token")).rejects.toThrow(
		"not connected"
	);
	await expect(credentials.delete(key)).rejects.toThrow("left connected");
	await expect(credentials.read("github.com")).rejects.toThrow(
		"Invalid application"
	);
	await expect(
		new NativeCredentials({}).write(key, "synthetic-token")
	).rejects.toThrow("unavailable");
});

it("clears temporary native byte buffers after reading or writing", async () => {
	const account: SavedAccount = {
		provider: "github",
		webUrl: "https://github.com/",
		id: "7",
		username: "tester",
	};

	const key = AccountStore.key(account);
	const bytes = Buffer.from("synthetic-token");
	let written: Buffer | undefined;

	const credentials = new NativeCredentials({
		async readHostingCredential() {
			return bytes;
		},
		async writeHostingCredential(_key: string, value: Buffer) {
			written = value;
		},
	});

	expect(await credentials.read(key)).toBe("synthetic-token");
	expect(bytes.every((byte) => byte === 0)).toBe(true);
	await credentials.write(key, "another-synthetic-token");
	expect(written?.every((byte) => byte === 0)).toBe(true);
});
