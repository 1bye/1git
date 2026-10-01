/**
 * Covers: provider-owned setup, immutable snapshots, secret redaction, validation and OAuth credential isolation.
 * Real: compiled provider constructors, REST/OAuth clients, remote parser and secure transport.
 * Doubles: captured HTTP with fake account/OAuth responses.
 * Requires: package build, no network.
 */
import { expect, test } from "bun:test";
import { HostingClient } from "@1git/hosting";
import { HostingOAuth } from "@1git/hosting/oauth";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";
import type { HostingFetch } from "@1git/hosting/contracts";
import { parseRemote } from "@1git/hosting/remote";
import { value } from "../_shared/fixtures.js";

test("one configured provider supplies REST, OAuth and remote setup without client overrides", async () => {
	const requests: { url: URL; init: RequestInit }[] = [];

	const fetch: HostingFetch = async (input, init = {}) => {
		const url = new URL(input);

		requests.push({ url, init });

		return url.pathname === "/gitlab/oauth/token"
			? Response.json({ access_token: "exchanged-token", token_type: "bearer" })
			: Response.json([]);
	};

	const source = {
		webUrl: "https://code.example/gitlab/",
		apiUrl: "https://api.example/rest/",
		sshHost: "ssh.example",
		accessToken: "fixture-rest-token",
		timeoutMs: 500,
		maxResponseBytes: 512,
		fetch,
		oauth: {
			clientId: "app",
			clientSecret: "fixture-client-secret",
			redirectUri: "https://app.example/callback",
			scopes: ["api"],
		},
	};

	const provider = new GitLabProvider(source);

	// Mutating caller-owned setup must not redirect requests, change accounts or widen scopes.
	source.webUrl = "https://unexpected.example/";
	source.accessToken = "different-account";
	source.oauth.clientSecret = "different-secret";
	source.oauth.scopes.push("admin");
	const client = value(HostingClient.create(provider));
	const oauth = value(HostingOAuth.create(provider));
	const attempt = value(oauth.beginAuthorization());
	const authorize = new URL(attempt.authorizationUrl);
	const callback = new URL("https://app.example/callback");

	callback.search = new URLSearchParams({
		code: "fixture-code",
		state: authorize.searchParams.get("state") ?? "",
	}).toString();

	expect(value(await client.listRepositories()).items).toEqual([]);
	expect(
		value(await oauth.exchangeCode(attempt, callback.href)).accessToken
	).toBe("exchanged-token");
	expect(requests[0]?.url.href).toBe(
		"https://api.example/rest/projects?membership=true&order_by=last_activity_at&per_page=50"
	);
	expect(new Headers(requests[0]?.init.headers).get("authorization")).toBe(
		"Bearer fixture-rest-token"
	);
	expect(requests[1]?.url.href).toBe("https://code.example/gitlab/oauth/token");
	expect(new Headers(requests[1]?.init.headers).has("authorization")).toBe(
		false
	);
	expect(
		new URLSearchParams(String(requests[1]?.init.body)).get("client_secret")
	).toBe("fixture-client-secret");
	expect(authorize.searchParams.get("scope")).toBe("api");
	expect(client.webUrl).toBe("https://code.example/gitlab/");
	expect(
		value(parseRemote("git@ssh.example:team/project.git", [provider]))
	).toMatchObject({
		host: "code.example",
		browserUrl: "https://code.example/gitlab/team/project",
	});
	expect(provider.options.accessToken).toBe("fixture-rest-token");
	expect(Object.isFrozen(provider.options)).toBe(true);
	expect(Object.isFrozen(provider.options.oauth)).toBe(true);
	expect(Object.isFrozen(provider.options.oauth?.scopes)).toBe(true);

	for (const object of [provider, client, oauth]) {
		const serialized = JSON.stringify(object);

		expect(serialized).not.toContain("fixture-rest-token");
		expect(serialized).not.toContain("fixture-client-secret");
	}
});

test("missing REST credentials or OAuth registration fail safely before HTTP", () => {
	let requested = false;

	const provider = new GitHubProvider({
		fetch: async () => {
			requested = true;

			return Response.json({});
		},
	});

	expect(HostingClient.create(provider)).toMatchObject({
		ok: false,
		error: { code: "validation", operation: "configure" },
	});
	expect(HostingOAuth.create(provider)).toMatchObject({
		ok: false,
		error: { code: "validation", operation: "configure-oauth" },
	});
	expect(requested).toBe(false);
	expect(parseRemote("git@github.com:team/project.git", [provider]).ok).toBe(
		true
	);
});

test("provider snapshots preserve rotating credential callbacks without retaining request state", async () => {
	let token = "first";
	const sent: string[] = [];

	const provider = new GitHubProvider({
		accessToken: () => token,
		fetch: async (_url, init) => {
			sent.push(new Headers(init?.headers).get("authorization") ?? "");

			return Response.json([]);
		},
	});

	const client = value(HostingClient.create(provider));

	await client.listRepositories();
	token = "rotated";
	await client.listRepositories();

	expect(sent).toEqual(["Bearer first", "Bearer rotated"]);
});

test("the former client configuration object is not an accepted entry point", () => {
	const configured = HostingClient.create({
		// @ts-expect-error Configure the provider itself and pass its instance to the client.
		provider: new GitHubProvider(),
		accessToken: "fixture",
	});

	expect(configured).toMatchObject({
		ok: false,
		error: { code: "validation" },
	});
});

test("provider construction rejects malformed OAuth scopes instead of coercing them", () => {
	expect(
		() =>
			new GitLabProvider({
				oauth: {
					clientId: "app",
					redirectUri: "https://app.example/callback",
					// @ts-expect-error Runtime JavaScript callers must not have string scopes silently expanded.
					scopes: "api",
				},
			})
	).toThrow("OAuth scopes must be an array.");
});
