/**
 * Covers: configured third-provider extension, capabilities, OAuth and account/cursor isolation.
 * Real: compiled public extension contracts, client, OAuth, remote parser and secure transport.
 * Doubles: test-only provider/adapter and captured HTTP; not a real hosting service.
 * Requires: package build, no network.
 */
import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { HostingClient } from "@1git/hosting";
import { HostingOAuth } from "@1git/hosting/oauth";
import { HostingProvider, ProviderFailure } from "@1git/hosting/provider";
import type {
	HostingAdapter,
	ProviderOAuthAdapter,
	ProviderOptions,
} from "@1git/hosting/provider";
import type {
	Capabilities,
	HostingFetch,
	Owner,
	Repository,
	PullRequest,
} from "@1git/hosting/contracts";
import type { Transport } from "@1git/hosting/transport";
import { parseRemote } from "@1git/hosting/remote";
import { value } from "../_shared/fixtures.js";

const owner: Owner = {
	id: "team",
	path: "team",
	kind: "group",
	canCreateRepository: null,
};

const repository: Repository = {
	id: "project",
	ref: { owner: "team", name: "project" },
	name: "project",
	description: null,
	visibility: "private",
	defaultBranch: "main",
	browserUrl: "https://forge.example/team/project",
	cloneUrls: { https: "https://forge.example/team/project.git", ssh: null },
	permissions: { read: true, push: null, admin: null },
};

const pullRequest: PullRequest = {
	id: "review",
	number: 1,
	title: "Update",
	description: null,
	state: "open",
	draft: false,
	sourceBranch: "feature",
	targetBranch: "main",
	browserUrl: "https://forge.example/team/project/reviews/1",
};

const FIXTURE_CAPABILITIES: Capabilities = Object.freeze({
	pullRequestDrafts: false,
	repositoryVisibilities: Object.freeze(["private"] as const),
	oauthPkce: false,
	oauthClientSecretRequired: false,
	oauthRefresh: "unsupported",
	oauthRevocation: false,
});

class FixtureProvider extends HostingProvider {
	readonly id = "fixture-forge";
	readonly defaultWebUrl = "https://forge.example";
	readonly capabilities = FIXTURE_CAPABILITIES;

	apiUrl(web: URL): URL {
		return new URL("rest/", web);
	}
	apiHeaders(): Readonly<Record<string, string>> {
		return { "X-Forge-Version": "1" };
	}

	createAdapter(http: Transport): HostingAdapter {
		return {
			account: async (options) => {
				const { data } = await http.request(
					http.url("identity"),
					"GET",
					options
				);

				if (
					typeof data !== "object" ||
					data === null ||
					!("username" in data) ||
					typeof data.username !== "string"
				)
					throw new ProviderFailure({
						code: "invalid-response",
						message: "Invalid forge identity.",
						retryable: false,
					});

				return {
					id: data.username,
					username: data.username,
					name: null,
					browserUrl: http.endpoints.browser(
						`https://forge.example/${data.username}`
					),
				};
			},
			owners: async (options) => {
				const reply = await http.request(
					http.url("destinations"),
					"GET",
					options
				);

				return { items: [owner], next: null, rateLimit: reply.rateLimit };
			},
			repositories: (options, search) =>
				http.page("projects", search ? { search } : {}, options, (data) => {
					if (!Array.isArray(data))
						throw new ProviderFailure({
							code: "invalid-response",
							message: "Invalid forge projects.",
							retryable: false,
						});

					return data.map(() => repository);
				}),
			repository: async (_ref, options) => {
				await http.request(http.url("project"), "GET", options);

				return repository;
			},
			createRepository: async (input, options) => {
				await http.request(http.url("projects"), "POST", options, input);

				return repository;
			},
			pullRequests: async (_ref, options) => {
				const reply = await http.request(http.url("reviews"), "GET", options);

				return { items: [pullRequest], next: null, rateLimit: reply.rateLimit };
			},
			pullRequest: async (_ref, _number, options) => {
				await http.request(http.url("reviews/1"), "GET", options);

				return pullRequest;
			},
			createPullRequest: async (input, options) => {
				await http.request(http.url("reviews"), "POST", options, input);

				return pullRequest;
			},
		};
	}
}

class OAuthFixtureProvider extends FixtureProvider {
	override readonly capabilities: Capabilities = Object.freeze({
		...FIXTURE_CAPABILITIES,
		oauthPkce: true,
	});

	override createOAuthAdapter(http: Transport): ProviderOAuthAdapter {
		return {
			authorizationUrl: (parameters) => {
				const url = new URL("authorize", http.endpoints.web);

				url.search = new URLSearchParams(parameters).toString();

				return url;
			},
			exchangeToken: async (grant, application, options) => {
				const reply = await http.request(
					new URL("token", http.endpoints.web),
					"POST",
					options,
					new URLSearchParams({
						client_id: application.clientId,
						redirect_uri: application.redirectUri,
						...grant,
					}),
					undefined,
					true
				);

				return reply.data;
			},
			revokeToken: async () => {
				throw new ProviderFailure({
					code: "unsupported",
					message: "Forge revocation is unavailable.",
					retryable: false,
				});
			},
		};
	}
}

class InvalidHeadersProvider extends FixtureProvider {
	override apiHeaders(): Readonly<Record<string, string>> {
		return { AUTHORIZATION: "Bearer shared-credential" };
	}
}

class BrokenAdapterProvider extends FixtureProvider {
	override createAdapter(http: Transport): HostingAdapter {
		return {
			...super.createAdapter(http),
			account: async () => {
				throw new Error("hidden-server-token");
			},
		};
	}
}

function capture(
	Provider: new (options: ProviderOptions) => HostingProvider = FixtureProvider
) {
	const requests: { url: URL; init: RequestInit }[] = [];

	const fetch: HostingFetch = async (input, init = {}) => {
		const url = new URL(input);

		requests.push({ url, init });

		if (url.pathname === "/token")
			return Response.json({
				access_token: "fixture-access",
				token_type: "bearer",
			});

		if (url.pathname === "/rest/identity")
			return Response.json({
				username: new Headers(init.headers).get("authorization")?.slice(7),
			});

		const next = new URL(url);

		next.searchParams.set("page", "2");

		return Response.json([{}], {
			headers: url.searchParams.has("page")
				? {}
				: { Link: `<${next}>; rel="next"` },
		});
	};

	const provider = new Provider({
		accessToken: "alice",
		fetch,
		oauth: {
			clientId: "app",
			redirectUri: "https://app.example/callback",
			scopes: ["repositories"],
		},
	});

	const client = value(HostingClient.create(provider));

	return { provider, client, requests, fetch };
}

test("a third provider implements all REST operations without registering a string selector", async () => {
	const { client, requests } = capture();
	const ref = repository.ref;

	expect(value(await client.getAccount()).username).toBe("alice");
	expect(value(await client.listOwners()).items).toEqual([owner]);
	expect(value(await client.listRepositories()).items).toEqual([repository]);
	expect(value(await client.searchRepositories("query")).items).toEqual([
		repository,
	]);
	expect(value(await client.getRepository(ref))).toEqual(repository);
	expect(
		value(
			await client.createRepository({
				owner,
				name: "project",
				visibility: "private",
			})
		)
	).toEqual(repository);
	expect(value(await client.listPullRequests(ref)).items).toEqual([
		pullRequest,
	]);
	expect(value(await client.getPullRequest(ref, 1))).toEqual(pullRequest);
	expect(
		value(
			await client.createPullRequest({
				repository: ref,
				sourceBranch: "feature",
				targetBranch: "main",
				title: "Update",
			})
		)
	).toEqual(pullRequest);
	expect(requests.map(({ url, init }) => [init.method, url.pathname])).toEqual([
		["GET", "/rest/identity"],
		["GET", "/rest/destinations"],
		["GET", "/rest/projects"],
		["GET", "/rest/projects"],
		["GET", "/rest/project"],
		["POST", "/rest/projects"],
		["GET", "/rest/reviews"],
		["GET", "/rest/reviews/1"],
		["POST", "/rest/reviews"],
	]);
	expect(requests[3]?.url.searchParams.get("search")).toBe("query");
	expect(
		requests.every(
			({ init }) => new Headers(init.headers).get("x-forge-version") === "1"
		)
	).toBe(true);
	expect(client.provider.id).toBe("fixture-forge");
});

test("configured providers isolate accounts and clients isolate cursors", async () => {
	const { provider, client: alice, fetch, requests } = capture();

	const bob = value(
		HostingClient.create(new FixtureProvider({ accessToken: "bob", fetch }))
	);

	const otherAlice = value(HostingClient.create(provider));

	expect(value(await alice.getAccount()).username).toBe("alice");
	expect(value(await bob.getAccount()).username).toBe("bob");
	const cursor = value(await alice.listRepositories()).next ?? "";
	const requestCount = requests.length;

	expect(await bob.listRepositories({ cursor })).toMatchObject({
		ok: false,
		error: { code: "validation" },
	});
	expect(requests).toHaveLength(requestCount);
	expect(await otherAlice.listRepositories({ cursor })).toMatchObject({
		ok: false,
		error: { code: "validation" },
	});
	expect(requests).toHaveLength(requestCount);
	expect(value(await alice.listRepositories({ cursor })).next).toBeNull();
	expect(new Headers(requests.at(-1)?.init.headers).get("authorization")).toBe(
		"Bearer alice"
	);
	expect(JSON.stringify(provider)).not.toContain("alice");
});

test("provider headers cannot overwrite the per-account credential", async () => {
	const { client, requests } = capture(InvalidHeadersProvider);

	expect(await client.getAccount()).toMatchObject({
		ok: false,
		error: { code: "validation" },
	});
	expect(requests).toHaveLength(0);
});

test("unexpected provider exceptions do not expose original error messages", async () => {
	const { client } = capture(BrokenAdapterProvider);
	const result = await client.getAccount();

	expect(result).toMatchObject({
		ok: false,
		error: { code: "network", operation: "get-account" },
	});
	expect(JSON.stringify(result)).not.toContain("hidden-server-token");
});

test("custom capabilities reject unsupported features without issuing requests", async () => {
	const { client, requests } = capture();

	expect(
		await client.createRepository({
			owner,
			name: "project",
			visibility: "public",
		})
	).toMatchObject({ ok: false, error: { code: "unsupported" } });
	expect(
		await client.createPullRequest({
			repository: repository.ref,
			sourceBranch: "feature",
			targetBranch: "main",
			title: "Update",
			draft: true,
		})
	).toMatchObject({ ok: false, error: { code: "unsupported" } });
	expect(HostingOAuth.create(client.provider)).toMatchObject({
		ok: false,
		error: { code: "unsupported" },
	});
	expect(requests).toHaveLength(0);
});

test("custom providers preserve safe failures and identify explicit remote mappings", async () => {
	const provider = new FixtureProvider({
		accessToken: "alice",
		fetch: async () => Response.json({}),
	});

	const invalid = value(HostingClient.create(provider));

	expect(await invalid.getAccount()).toMatchObject({
		ok: false,
		error: {
			code: "invalid-response",
			operation: "get-account",
			message: "Invalid forge identity.",
		},
	});
	expect(
		parseRemote("https://forge.example/team/project.git", [provider])
	).toEqual({
		ok: true,
		value: {
			providerId: "fixture-forge",
			host: "forge.example",
			repository: repository.ref,
			browserUrl: repository.browserUrl,
		},
	});
	expect(
		parseRemote("https://forge.example/team/sub/project.git", [provider]).ok
	).toBe(false);
});

test("a third provider reuses shared PKCE, callback validation and token normalization", async () => {
	const { provider, requests } = capture(OAuthFixtureProvider);

	const oauth = value(HostingOAuth.create(provider));

	const attempt = value(oauth.beginAuthorization());
	const parameters = new URL(attempt.authorizationUrl).searchParams;
	const callback = new URL("https://app.example/callback");

	callback.search = new URLSearchParams({
		code: "fixture-code",
		state: parameters.get("state") ?? "",
	}).toString();

	expect(new URL(attempt.authorizationUrl).pathname).toBe("/authorize");
	expect(parameters.get("code_challenge_method")).toBe("S256");
	expect(value(await oauth.exchangeCode(attempt, callback.href))).toMatchObject(
		{ accessToken: "fixture-access", refreshToken: null, scopes: null }
	);
	const sent = new URLSearchParams(String(requests[0]?.init.body));

	expect(
		createHash("sha256")
			.update(sent.get("code_verifier") ?? "")
			.digest("base64url")
	).toBe(parameters.get("code_challenge") ?? "");
	expect(sent.get("client_id")).toBe("app");
	expect(new Headers(requests[0]?.init.headers).has("x-forge-version")).toBe(
		false
	);
	expect(await oauth.exchangeCode(attempt, callback.href)).toMatchObject({
		ok: false,
		error: { code: "authentication" },
	});
	expect(await oauth.refresh("refresh")).toMatchObject({
		ok: false,
		error: { code: "unsupported" },
	});
	expect(await oauth.revoke("access")).toMatchObject({
		ok: false,
		error: { code: "unsupported" },
	});
	expect(requests).toHaveLength(1);
});
