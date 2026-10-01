/**
 * Covers: state/PKCE, callback binding/replay, token exchange/rotation/revocation and safe failures.
 * Real: OAuth lifecycle and transport.
 * Doubles: provider HTTP responses, including behavior not implemented by Emulate 0.12.0.
 * Requires: none.
 */
import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { HostingOAuth } from "../../src/oauth.js";
import type { OAuthApplication, ProviderOptions } from "../../src/provider.js";
import { GitHubProvider } from "../../src/providers/github/provider.js";
import { GitLabProvider } from "../../src/providers/gitlab/provider.js";
import { value } from "../_shared/fixtures.js";

test("serializing an OAuth client does not disclose its registration secret", () => {
	const { oauth } = setup("github");

	expect(JSON.stringify(oauth)).not.toContain("fake-secret");
});

function setup(
	provider: "github" | "gitlab",
	overrides: Partial<OAuthApplication> & Pick<ProviderOptions, "fetch"> = {}
) {
	const requests: { url: URL; init: RequestInit }[] = [];

	const { fetch: fetchOverride, ...application } = overrides;

	const options: ProviderOptions = {
		oauth: {
			clientId: "client",
			clientSecret: "fake-secret",
			redirectUri: "http://127.0.0.1:8765/callback",
			scopes: ["repo"],
			...application,
		},
		fetch:
			fetchOverride ??
			(async (url, init = {}) => {
				requests.push({ url: new URL(url), init });

				return Response.json({
					access_token: "fake-access",
					token_type: "bearer",
					refresh_token: "fake-refresh",
					expires_in: 3600,
					scope: "repo,user",
				});
			}),
	};

	const configured =
		provider === "github"
			? new GitHubProvider(options)
			: new GitLabProvider(options);

	const oauth = value(HostingOAuth.create(configured));

	return { oauth, requests };
}

function callback(authorizationUrl: string, code = "fake-code") {
	const url = new URL(authorizationUrl);
	const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");

	redirect.search = new URLSearchParams({
		code,
		state: url.searchParams.get("state") ?? "",
	}).toString();

	return redirect.href;
}

test.each(["github", "gitlab"] as const)(
	"%s authorization uses fresh state and S256 PKCE",
	async (provider) => {
		const { oauth, requests } = setup(provider);
		const attempt = value(oauth.beginAuthorization());
		const url = new URL(attempt.authorizationUrl);
		const other = new URL(value(oauth.beginAuthorization()).authorizationUrl);

		expect(url.searchParams.get("state")).not.toBe(
			other.searchParams.get("state")
		);
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		const tokens = value(
			await oauth.exchangeCode(attempt, callback(attempt.authorizationUrl))
		);

		expect(tokens.accessToken).toBe("fake-access");
		expect(tokens.scopes).toEqual(["repo", "user"]);
		const body = new URLSearchParams(String(requests[0]?.init.body));

		expect(
			createHash("sha256")
				.update(body.get("code_verifier") ?? "")
				.digest("base64url")
		).toBe(url.searchParams.get("code_challenge") ?? "");
		expect(body.get("client_secret")).toBe("fake-secret");
		expect(requests[0]?.url.href).not.toContain("fake-secret");
		expect(
			await oauth.exchangeCode(attempt, callback(attempt.authorizationUrl))
		).toMatchObject({ ok: false, error: { code: "authentication" } });
		expect(requests).toHaveLength(1);
	}
);

test("state, callback path, duplicates and cross-client attempts are rejected", async () => {
	const { oauth, requests } = setup("github");
	const attempt = value(oauth.beginAuthorization());
	const valid = callback(attempt.authorizationUrl);

	for (const invalid of [
		valid.replace("callback?", "other?"),
		`${valid}&state=evil`,
		valid.replace(/state=[^&]+/u, "state=evil"),
	]) {
		expect(await oauth.exchangeCode(attempt, invalid)).toMatchObject({
			ok: false,
			error: { code: "authentication" },
		});
	}

	expect(
		await setup("github").oauth.exchangeCode(attempt, valid)
	).toMatchObject({ ok: false, error: { code: "authentication" } });
	expect(requests).toHaveLength(0);
});

test("provider denial is safe and consumes the attempt", async () => {
	const { oauth, requests } = setup("github");
	const attempt = value(oauth.beginAuthorization());

	const denied = callback(attempt.authorizationUrl).replace(
		"code=fake-code",
		"error=access_denied&error_description=secret"
	);

	const result = await oauth.exchangeCode(attempt, denied);

	expect(result).toMatchObject({
		ok: false,
		error: { code: "authentication" },
	});
	expect(JSON.stringify(result)).not.toContain("secret");
	expect(requests).toHaveLength(0);
});

test.each(["github", "gitlab"] as const)(
	"%s refresh and revocation serialize credentials in bodies/headers only",
	async (provider) => {
		const { oauth, requests } = setup(provider);

		expect(value(await oauth.refresh("old-refresh")).refreshToken).toBe(
			"fake-refresh"
		);
		expect(
			new URLSearchParams(String(requests[0]?.init.body)).get("grant_type")
		).toBe("refresh_token");
		expect((await oauth.revoke("old-access")).ok).toBe(true);
		expect(requests[1]?.url.pathname).toBe(
			provider === "github" ? "/applications/client/token" : "/oauth/revoke"
		);
		expect(requests[1]?.init.method).toBe(
			provider === "github" ? "DELETE" : "POST"
		);
		expect(requests.every((request) => !request.url.search)).toBe(true);
	}
);

test("public GitLab PKCE clients do not send a fabricated secret", async () => {
	const { oauth, requests } = setup("gitlab", { clientSecret: undefined });
	const attempt = value(oauth.beginAuthorization());

	expect(
		(await oauth.exchangeCode(attempt, callback(attempt.authorizationUrl))).ok
	).toBe(true);
	expect(
		new URLSearchParams(String(requests[0]?.init.body)).has("client_secret")
	).toBe(false);
});

test("GitHub operations without the registration secret fail explicitly", async () => {
	const { oauth, requests } = setup("github", { clientSecret: undefined });

	expect(await oauth.refresh("fake")).toMatchObject({
		ok: false,
		error: { code: "unsupported" },
	});
	expect(await oauth.revoke("fake")).toMatchObject({
		ok: false,
		error: { code: "unsupported" },
	});
	expect(requests).toHaveLength(0);
});

test("OAuth 200 error bodies are not mistaken for tokens", async () => {
	const { oauth } = setup("github", {
		fetch: async () =>
			Response.json({
				error: "bad_verification_code",
				error_description: "fake-secret",
			}),
	});

	const result = await oauth.refresh("old-refresh");

	expect(result).toMatchObject({
		ok: false,
		error: { code: "authentication" },
	});
	expect(JSON.stringify(result)).not.toContain("fake-secret");
});

test.each([
	"javascript:alert(1)",
	"http://example.com/callback",
	"https://example.com/callback?token=secret",
])("rejects unsafe callback %s", (redirectUri) => {
	expect(
		HostingOAuth.create(
			new GitLabProvider({
				oauth: {
					clientId: "id",
					redirectUri,
					scopes: [],
				},
			})
		)
	).toMatchObject({ ok: false, error: { code: "validation" } });
});
