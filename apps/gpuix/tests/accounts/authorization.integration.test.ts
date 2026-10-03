/**
 * Covers: PKCE callback listener binding, CSRF rejection, port cleanup, cancellation and denial.
 * Real: AccountAuthorization, hosting provider/transport and Bun's IPv4 loopback listener.
 * Doubles: system browser and provider HTTPS replies; no real account or token.
 * Requires: local TCP listening permission and built hosting package.
 */
import { expect, test } from "bun:test";
import { AccountAuthorization } from "../../src/feature/accounts/lib/account-authorization";
import { LoopbackAuthorization } from "../../src/feature/accounts/lib/loopback-authorization";

async function callbackUrl(): Promise<string> {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(),
	});

	const port = server.port;

	await server.stop();

	return `http://127.0.0.1:${port}/oauth/callback`;
}
test("accepts only the bound state and exchanges PKCE without a secret, then releases the port", async () => {
	const redirectUri = await callbackUrl();
	const requests: RequestInit[] = [];
	let challenge = "";
	let scope = "";

	const service = new AccountAuthorization(
		async (_url, init = {}) => {
			requests.push(init);

			return Response.json({
				access_token: "fixture-access",
				token_type: "bearer",
				refresh_token: "fixture-refresh",
				expires_in: 7200,
			});
		},
		async (value) => {
			const authorization = new URL(value);

			challenge = authorization.searchParams.get("code_challenge") ?? "";
			scope = authorization.searchParams.get("scope") ?? "";
			const callback = new URL(redirectUri);

			callback.search = new URLSearchParams({
				code: "fixture-code",
				state: "wrong-state",
			}).toString();
			expect((await fetch(callback)).status).toBe(400);
			callback.searchParams.set(
				"state",
				authorization.searchParams.get("state")!
			);
			const response = await fetch(callback);

			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(await response.text()).not.toContain("fixture-code");
		}
	);

	const tokens = await service.authorize({
		provider: "gitlab",
		webUrl: "https://gitlab.com",
		registration: { clientId: "public-client", redirectUri },
		repositoryAccess: true,
		signal: new AbortController().signal,
	});

	expect(tokens.refreshToken).toBe("fixture-refresh");
	const body = new URLSearchParams(String(requests[0]?.body));

	expect(body.has("client_secret")).toBe(false);
	expect(body.get("redirect_uri")).toBe(redirectUri);
	expect(body.get("code_verifier")).toHaveLength(43);
	expect(challenge).toHaveLength(43);
	expect(scope).toBe("read_user read_api read_repository");
	const rebound = Bun.serve({
		hostname: "127.0.0.1",
		port: Number(new URL(redirectUri).port),
		fetch: () => new Response(),
	});

	await rebound.stop();
});
test("cancellation and browser failures stop the listener without a token exchange", async () => {
	for (const failure of ["cancel", "browser"] as const) {
		const redirectUri = await callbackUrl();
		const controller = new AbortController();
		let exchanges = 0;

		const service = new AccountAuthorization(
			async () => {
				exchanges++;

				return Response.json({});
			},
			async () => {
				if (failure === "cancel") controller.abort();
				else throw new Error("Browser unavailable.");
			}
		);

		await expect(
			service.authorize({
				provider: "gitlab",
				webUrl: "https://gitlab.com",
				registration: { clientId: "public", redirectUri },
				signal: controller.signal,
			})
		).rejects.toThrow();
		expect(exchanges).toBe(0);
		const rebound = Bun.serve({
			hostname: "127.0.0.1",
			port: Number(new URL(redirectUri).port),
			fetch: () => new Response(),
		});

		await rebound.stop();
	}
});
test("denial does not exchange a code and public bind addresses are rejected", async () => {
	const redirectUri = await callbackUrl();
	let exchanges = 0;

	const service = new AccountAuthorization(
		async () => {
			exchanges++;

			return Response.json({});
		},
		async (value) => {
			const callback = new URL(redirectUri);

			callback.search = new URLSearchParams({
				error: "access_denied",
				state: new URL(value).searchParams.get("state")!,
			}).toString();
			await fetch(callback);
		}
	);

	await expect(
		service.authorize({
			provider: "gitlab",
			webUrl: "https://gitlab.com",
			registration: { clientId: "public", redirectUri },
			signal: new AbortController().signal,
		})
	).rejects.toThrow("denied");
	expect(exchanges).toBe(0);

	for (const address of [
		"http://0.0.0.0:8765/oauth/callback",
		"http://localhost:8765/oauth/callback",
		"https://127.0.0.1:8765/oauth/callback",
		"http://127.0.0.1:8765/callback?state=fixed",
	])
		expect(() => LoopbackAuthorization.callback(address)).toThrow();
});

test("a timed-out authorization releases its callback port", async () => {
	const redirectUri = await callbackUrl();

	await expect(
		LoopbackAuthorization.wait(
			{
				authorizationUrl:
					"https://gitlab.com/oauth/authorize?state=fixture-state",
				expiresAt: Date.now() + 20,
			},
			redirectUri,
			async () => undefined,
			new AbortController().signal
		)
	).rejects.toThrow("timed out");
	const rebound = Bun.serve({
		hostname: "127.0.0.1",
		port: Number(new URL(redirectUri).port),
		fetch: () => new Response(),
	});

	await rebound.stop();
});
