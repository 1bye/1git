/**
 * Covers: public-client device grants, private codes, polling limits, denial, expiry, refresh and safe endpoints.
 * Real: provider, lifecycle, normalization and transport.
 * Doubles: captured provider HTTP replies and wall clock; no live accounts.
 * Requires: none.
 */
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { HostingDeviceOAuth } from "../../src/device-oauth.js";
import { GitHubProvider } from "../../src/providers/github/provider.js";
import { GitLabProvider } from "../../src/providers/gitlab/provider.js";
import { value } from "../_shared/fixtures.js";

afterEach(() => mock.restore());

function setup() {
	let now = 100_000;

	spyOn(Date, "now").mockImplementation(() => now);
	const requests: RequestInit[] = [];
	let reply: unknown = { error: "authorization_pending" };
	let verification = "https://github.com/login/device";

	const oauth = value(
		HostingDeviceOAuth.create(
			new GitHubProvider({
				accessToken: "must-not-send-rest-token",
				deviceOAuth: { clientId: "public-id", scopes: ["read:user"] },
				fetch: async (url, init = {}) => {
					requests.push(init);

					return Response.json(
						new URL(url).pathname === "/login/device/code"
							? {
									device_code: "private-device",
									user_code: "ABCD-EFGH",
									verification_uri: verification,
									interval: 5,
									expires_in: 900,
								}
							: reply
					);
				},
			})
		)
	);

	return {
		oauth,
		requests,
		advance: (milliseconds: number) => {
			now += milliseconds;
		},
		respond: (data: unknown) => {
			reply = data;
		},
		verification: (url: string) => {
			verification = url;
		},
	};
}

test("keeps device codes private and never sends a REST token or client secret", async () => {
	const f = setup();
	const attempt = value(await f.oauth.beginAuthorization());

	expect(JSON.stringify(attempt)).not.toContain("private-device");
	expect(JSON.stringify(f.oauth)).not.toContain("private-device");
	expect(attempt.userCode).toBe("ABCD-EFGH");
	expect(
		new URLSearchParams(String(f.requests[0]?.body)).get("client_id")
	).toBe("public-id");
	f.advance(5000);
	await f.oauth.poll(attempt);
	const grant = new URLSearchParams(String(f.requests[1]?.body));

	expect(grant.get("device_code")).toBe("private-device");
	expect(grant.has("client_secret")).toBe(false);

	for (const request of f.requests)
		expect(new Headers(request.headers).has("authorization")).toBe(false);
});

test("enforces interval and slowdown, consumes success and rotates refresh without a secret", async () => {
	const f = setup();
	const attempt = value(await f.oauth.beginAuthorization());

	expect(value(await f.oauth.poll(attempt))).toEqual({
		status: "pending",
		retryAfterMs: 5000,
	});
	expect(f.requests).toHaveLength(1);
	f.advance(5000);
	f.respond({ error: "slow_down" });
	expect(value(await f.oauth.poll(attempt))).toEqual({
		status: "pending",
		retryAfterMs: 10_000,
	});
	f.advance(5000);
	await f.oauth.poll(attempt);
	expect(f.requests).toHaveLength(2);
	f.advance(5000);
	f.respond({
		access_token: "access",
		token_type: "bearer",
		refresh_token: "refresh",
		expires_in: 3600,
	});
	expect(value(await f.oauth.poll(attempt))).toMatchObject({
		status: "authorized",
		tokens: { accessToken: "access", refreshToken: "refresh" },
	});
	expect(await f.oauth.poll(attempt)).toMatchObject({
		ok: false,
		error: { code: "authentication" },
	});
	f.respond({
		access_token: "rotated",
		token_type: "bearer",
		refresh_token: "rotated-refresh",
	});
	expect(value(await f.oauth.refresh("refresh")).refreshToken).toBe(
		"rotated-refresh"
	);
	expect(
		new URLSearchParams(String(f.requests.at(-1)?.body)).has("client_secret")
	).toBe(false);
});

test("cancellation, expiry, denial and cross-client attempts cannot yield tokens", async () => {
	const f = setup();
	const attempt = value(await f.oauth.beginAuthorization());

	const other = value(
		HostingDeviceOAuth.create(
			new GitHubProvider({ deviceOAuth: { clientId: "other", scopes: [] } })
		)
	);

	expect(await other.poll(attempt)).toMatchObject({ ok: false });
	f.oauth.cancel(attempt);
	expect(await f.oauth.poll(attempt)).toMatchObject({ ok: false });
	const expired = value(await f.oauth.beginAuthorization());

	f.advance(900_000);
	expect(await f.oauth.poll(expired)).toMatchObject({ ok: false });
	const denied = value(await f.oauth.beginAuthorization());

	f.advance(5000);
	f.respond({
		error: "access_denied",
		error_description: "secret-must-not-appear",
	});
	const response = await f.oauth.poll(denied);

	expect(response).toMatchObject({
		ok: false,
		error: { code: "authentication" },
	});
	expect(JSON.stringify(response)).not.toContain("secret-must-not-appear");
});

test("rejects unsafe verification hosts, malformed tokens and unsupported providers", async () => {
	const f = setup();

	f.verification("https://attacker.invalid/device");
	expect(await f.oauth.beginAuthorization()).toMatchObject({
		ok: false,
		error: { code: "invalid-response" },
	});
	f.verification("https://github.com/login/device");
	const attempt = value(await f.oauth.beginAuthorization());

	f.advance(5000);
	f.respond({ access_token: "bad token", token_type: "bearer" });
	expect(await f.oauth.poll(attempt)).toMatchObject({
		ok: false,
		error: { code: "invalid-response" },
	});
	expect(
		HostingDeviceOAuth.create(
			new GitLabProvider({ deviceOAuth: { clientId: "id", scopes: [] } })
		)
	).toMatchObject({ ok: false, error: { code: "unsupported" } });
});

test("parallel polling does not duplicate HTTP and cancellation rejects an in-flight success", async () => {
	let now = 100_000;

	spyOn(Date, "now").mockImplementation(() => now);
	const completion = Promise.withResolvers<Response>();
	let calls = 0;

	const oauth = value(
		HostingDeviceOAuth.create(
			new GitHubProvider({
				deviceOAuth: { clientId: "public", scopes: [] },
				fetch: async (url) => {
					calls++;

					if (new URL(url).pathname === "/login/device/code")
						return Response.json({
							device_code: "private",
							user_code: "ABCD-EFGH",
							verification_uri: "https://github.com/login/device",
							interval: 5,
							expires_in: 900,
						});

					return completion.promise;
				},
			})
		)
	);

	const attempt = value(await oauth.beginAuthorization());

	now += 5000;
	const first = oauth.poll(attempt);

	expect(value(await oauth.poll(attempt)).status).toBe("pending");
	expect(calls).toBe(2);
	oauth.cancel(attempt);
	completion.resolve(
		Response.json({ access_token: "must-not-yield", token_type: "bearer" })
	);
	expect(await first).toMatchObject({
		ok: false,
		error: { code: "authentication" },
	});
});
