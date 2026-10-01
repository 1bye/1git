/**
 * Covers: GitHub repositories, destinations, search, draft PRs and OAuth code exchange.
 * Real: pinned Emulate 0.12.0 over loopback HTTP, public compiled package imports.
 * Doubles: GitHub itself; injected routing maps configured GitHub origins to the emulator.
 * Requires: installed dev dependencies and permission to bind a loopback port; no internet/accounts.
 */
import { expect, test } from "bun:test";
import { createEmulator } from "emulate";
import { HostingClient } from "@1git/hosting";
import { HostingOAuth } from "@1git/hosting/oauth";
import { GitHubProvider } from "@1git/hosting/providers/github";
import type { HostingFetch } from "@1git/hosting/contracts";
import { value } from "../_shared/fixtures.js";

test("GitHub hosting lifecycle against explicitly seeded Emulate", async () => {
	// Reserve an OS-assigned port, then release it for Emulate's HTTP server.
	// A canonical base URL avoids Emulate's invalid git@localhost:PORT:owner/repo SSH formatting.
	const reservation = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(null),
	});

	const port = reservation.port;

	await reservation.stop(true);
	const redirectUri = "http://127.0.0.1:8765/callback";

	const emulator = await createEmulator({
		service: "github",
		port,
		baseUrl: "https://github.com",
		seed: {
			tokens: {
				fixture_alice: { login: "alice", scopes: ["repo", "user", "read:org"] },
				fixture_bob: { login: "bob", scopes: ["repo", "user"] },
			},
			github: {
				users: [
					{ login: "alice", name: "Alice", email: "alice@example.invalid" },
					{ login: "bob", name: "Bob", email: "bob@example.invalid" },
				],
				orgs: [
					{
						login: "fixture-team",
						members: [{ login: "alice", role: "admin" }],
					},
				],
				repos: [
					{ owner: "alice", name: "seeded", auto_init: true, private: true },
					{ owner: "fixture-team", name: "team-repo", auto_init: true },
				],
				oauth_apps: [
					{
						client_id: "fixture-client",
						client_secret: "fixture-secret",
						name: "Hosting tests",
						redirect_uris: [redirectUri],
					},
				],
			},
		},
	});

	const route: HostingFetch = async (input, init) => {
		const url = new URL(input);

		if (!["https://github.com", "https://api.github.com"].includes(url.origin))
			throw new Error("Unexpected fixture origin");

		return fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, init);
	};

	try {
		const client = value(
			HostingClient.create(
				new GitHubProvider({
					accessToken: "fixture_alice",
					fetch: route,
				})
			)
		);

		expect(value(await client.getAccount()).username).toBe("alice");
		const owners = value(await client.listOwners()).items;
		const organization = owners.find((owner) => owner.path === "fixture-team");

		expect(organization).toBeDefined();
		expect(
			value(await client.listRepositories()).items.some(
				(repo) => repo.ref.name === "seeded"
			)
		).toBe(true);
		expect(
			value(await client.searchRepositories("seeded")).items.some(
				(repo) => repo.ref.name === "seeded"
			)
		).toBe(true);
		const self = owners.find((owner) => owner.kind === "user");

		if (!self || !organization) throw new Error("Missing seeded destinations");

		const repo = value(
			await client.createRepository({
				owner: self,
				name: "created",
				visibility: "private",
				initialize: true,
			})
		);

		expect(repo.cloneUrls.https).toBe("https://github.com/alice/created.git");
		expect(
			value(
				await client.createRepository({
					owner: organization,
					name: "created-team",
					visibility: "public",
				})
			).ref.owner
		).toBe("fixture-team");
		expect(value(await client.getRepository(repo.ref)).visibility).toBe(
			"private"
		);

		// Seed an already-pushed branch through the emulator's Git-data API, not local Git.
		const refReply = await route(
			"https://api.github.com/repos/alice/created/git/ref/heads/main",
			{ headers: { Authorization: "Bearer fixture_alice" } }
		);

		expect(refReply.ok).toBe(true);
		const main = (await refReply.json()) as { object: { sha: string } };

		const branchReply = await route(
			"https://api.github.com/repos/alice/created/git/refs",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer fixture_alice",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					ref: "refs/heads/feature",
					sha: main.object.sha,
				}),
			}
		);

		expect(branchReply.ok).toBe(true);
		const pr = value(
			await client.createPullRequest({
				repository: repo.ref,
				sourceBranch: "feature",
				targetBranch: "main",
				title: "Fixture change",
				draft: true,
			})
		);

		expect(pr.draft).toBe(true);
		expect(
			value(await client.listPullRequests(repo.ref)).items.some(
				(item) => item.number === pr.number
			)
		).toBe(true);
		expect(
			value(await client.getPullRequest(repo.ref, pr.number)).browserUrl
		).toContain("/pull/");

		const oauth = value(
			HostingOAuth.create(
				new GitHubProvider({
					fetch: route,
					oauth: {
						clientId: "fixture-client",
						clientSecret: "fixture-secret",
						redirectUri,
						scopes: ["repo", "user"],
					},
				})
			)
		);

		const authorization = value(oauth.beginAuthorization());
		const login = await route(authorization.authorizationUrl);

		expect(login.status).toBe(200);
		const params = new URL(authorization.authorizationUrl).searchParams;

		params.set("login", "bob");
		const callback = await route("https://github.com/login/oauth/callback", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: params,
			redirect: "manual",
		});

		expect(callback.status).toBe(302);
		const tokens = value(
			await oauth.exchangeCode(
				authorization,
				callback.headers.get("location") ?? ""
			)
		);

		const bob = value(
			HostingClient.create(
				new GitHubProvider({
					accessToken: tokens.accessToken,
					fetch: route,
				})
			)
		);

		expect(value(await bob.getAccount()).username).toBe("bob");
		expect(value(await client.getAccount()).username).toBe("alice");
	} finally {
		await emulator.close();
	}
}, 20_000);
