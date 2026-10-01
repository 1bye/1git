/**
 * Covers: GitLab lifecycle, strict PKCE exchange, token rotation/revocation, wire auth and cancellation.
 * Real: local HTTP server, fetch, compiled public clients and transport.
 * Doubles: scripted GitLab REST/OAuth service; not live GitLab verification.
 * Requires: loopback port binding; no accounts, secrets or internet.
 */
import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { HostingClient } from "@1git/hosting";
import { HostingOAuth } from "@1git/hosting/oauth";
import { gitlabPull, gitlabRepository, value } from "../_shared/fixtures.js";

test("GitLab HTTP lifecycle with strict OAuth fixture", async () => {
	let challenge = "";
	let seenRefresh = false;
	let seenRevoke = false;
	let accessToken = "fixture-access";

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);

			if (url.pathname === "/oauth/token") {
				const body = new URLSearchParams(await request.text());

				if (
					body.get("client_id") !== "fixture" ||
					body.get("redirect_uri") !== "http://127.0.0.1:8765/callback" ||
					body.has("client_secret")
				)
					return Response.json({}, { status: 400 });

				if (body.get("grant_type") === "authorization_code") {
					if (
						body.get("code") !== "fixture-code" ||
						createHash("sha256")
							.update(body.get("code_verifier") ?? "")
							.digest("base64url") !== challenge
					)
						return Response.json({ error: "invalid_grant" }, { status: 400 });
				} else {
					if (body.get("refresh_token") !== "fixture-refresh")
						return Response.json({}, { status: 400 });

					seenRefresh = true;
					accessToken = "rotated-access";
				}

				return Response.json({
					access_token: accessToken,
					token_type: "bearer",
					refresh_token: "fixture-refresh",
					expires_in: 7200,
				});
			}

			if (url.pathname === "/oauth/revoke") {
				const body = new URLSearchParams(await request.text());

				seenRevoke =
					body.get("token") === accessToken &&
					body.get("client_id") === "fixture";

				return Response.json({});
			}

			if (request.headers.get("authorization") !== `Bearer ${accessToken}`)
				return Response.json({ message: "bad credential" }, { status: 401 });

			if (url.pathname === "/api/v4/user")
				return Response.json({
					id: 1,
					username: "alice",
					web_url: `${url.origin}/alice`,
				});

			if (url.pathname === "/api/v4/namespaces")
				return Response.json([{ id: 2, full_path: "team/sub", kind: "group" }]);

			if (url.pathname.endsWith("/merge_requests"))
				return Response.json(
					request.method === "POST"
						? gitlabPull(url.origin)
						: [gitlabPull(url.origin)]
				);

			if (url.pathname.endsWith("/merge_requests/2"))
				return Response.json(gitlabPull(url.origin));

			if (url.pathname === "/api/v4/projects" && request.method === "GET")
				return Response.json([gitlabRepository(url.origin)], {
					headers: { "x-next-page": url.searchParams.has("page") ? "" : "2" },
				});

			return Response.json(gitlabRepository(url.origin));
		},
	});

	const endpoint = {
		provider: "gitlab" as const,
		webUrl: server.url.origin,
		allowLoopbackHttp: true,
	};

	try {
		const oauth = value(
			HostingOAuth.create({
				...endpoint,
				clientId: "fixture",
				redirectUri: "http://127.0.0.1:8765/callback",
				scopes: ["api"],
			})
		);

		const attempt = value(oauth.beginAuthorization());
		const parameters = new URL(attempt.authorizationUrl).searchParams;

		challenge = parameters.get("code_challenge") ?? "";
		const tokens = value(
			await oauth.exchangeCode(
				attempt,
				`http://127.0.0.1:8765/callback?code=fixture-code&state=${parameters.get("state")}`
			)
		);

		const client = value(
			HostingClient.create({ ...endpoint, accessToken: tokens.accessToken })
		);

		expect(value(await client.getAccount()).username).toBe("alice");
		const owner = value(await client.listOwners()).items[0];

		if (!owner) throw new Error("Missing fixture namespace");

		const repo = value(
			await client.createRepository({
				owner,
				name: "demo",
				visibility: "private",
			})
		);

		expect(repo.ref.owner).toBe("team/sub");
		expect(value(await client.getRepository(repo.ref)).id).toBe("20");
		const page = value(await client.listRepositories());

		expect(
			value(await client.listRepositories({ cursor: page.next ?? "" })).next
		).toBeNull();
		expect(value(await client.searchRepositories("demo")).items).toHaveLength(
			1
		);
		expect(
			value(
				await client.createPullRequest({
					repository: repo.ref,
					sourceBranch: "feature",
					targetBranch: "main",
					title: "Change",
					draft: true,
				})
			).draft
		).toBe(true);
		expect(value(await client.listPullRequests(repo.ref)).items).toHaveLength(
			1
		);
		expect(value(await client.getPullRequest(repo.ref, 2)).number).toBe(2);
		const rotated = value(await oauth.refresh(tokens.refreshToken ?? ""));

		expect(seenRefresh).toBe(true);
		expect(await client.getAccount()).toMatchObject({
			ok: false,
			error: { code: "authentication" },
		});
		expect((await oauth.revoke(rotated.accessToken)).ok).toBe(true);
		expect(seenRevoke).toBe(true);
	} finally {
		await server.stop(true);
	}
});
