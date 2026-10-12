/**
 * Covers: ChatGPT PKCE, state, issued client ID, signed identity, granted scope and session rotation.
 * Real: authorization service and JOSE signing/verification.
 * Doubles: browser callback, provider HTTP/JWKS; no real identity or credentials.
 * Requires: Bun cryptography only; no graphics or network.
 */
import { beforeAll, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
	exportJWK,
	generateKeyPair,
	SignJWT,
	type CryptoKey,
	type JWK,
} from "jose";
import { ChatGptAuthorization } from "../../src/feature/ai/lib/chatgpt-authorization";
import { AiHttp } from "../../src/feature/ai/lib/ai-http";
import { emptyAiPreferences } from "../../src/feature/ai/lib/ai-settings-store";

let privateKey: CryptoKey;
let publicKey: JWK;
const clientId = "oaiapp_test1";

const scope =
	"openid email profile offline_access resource.invoke chatgpt.tokens.use.direct";

const preferences = {
	...emptyAiPreferences,
	provider: "chatgpt" as const,
	hostId: "urn:uuid:01234567-89ab-cdef-0123-456789abcdef",
};

beforeAll(async () => {
	const keys = await generateKeyPair("RS256");

	privateKey = keys.privateKey;
	publicKey = {
		...(await exportJWK(keys.publicKey)),
		kid: "test-key",
		alg: "RS256",
		use: "sig",
	};
});

function authorization(
	options: {
		invalidState?: boolean;
		invalidNonce?: boolean;
		scope?: string;
		issued?: string;
		previous?: boolean;
	} = {}
) {
	let request: URL;
	let exchange: URLSearchParams | undefined;

	const service = new ChatGptAuthorization(
		new AiHttp(async (url, init) => {
			if (String(url).endsWith("jwks.json"))
				return Response.json({ keys: [publicKey] });

			exchange = new URLSearchParams(String(init?.body));
			const token = await new SignJWT({
				nonce: options.invalidNonce
					? "wrong"
					: request.searchParams.get("nonce"),
				email: "test@example.invalid",
			})
				.setProtectedHeader({ alg: "RS256", kid: "test-key" })
				.setIssuer("https://auth.openai.com")
				.setAudience(clientId)
				.setSubject("subject1")
				.setIssuedAt()
				.setExpirationTime("5m")
				.sign(privateKey);

			return Response.json({
				access_token: "synthetic-access",
				refresh_token: "synthetic-refresh",
				id_token: token,
				token_type: "Bearer",
				expires_in: 3600,
				scope: options.scope ?? scope,
			});
		}),
		async (attempt, callback) => {
			request = new URL(attempt.authorizationUrl);
			const result = new URL(callback);

			result.searchParams.set("code", "test-code");
			result.searchParams.set(
				"state",
				options.invalidState
					? "wrong"
					: (request.searchParams.get("state") ?? "")
			);

			if (!options.previous)
				result.searchParams.set("client_id", options.issued ?? clientId);

			return result.href;
		}
	);

	return { service, exchange: () => exchange, request: () => request };
}

it("uses the issued registration, fresh PKCE and signed identity before connecting", async () => {
	const test = authorization();

	const result = await test.service.connect(
		preferences,
		async () => undefined,
		new AbortController().signal
	);

	const exchange = test.exchange();

	expect(test.request().searchParams.get("client_id")).toBe(
		"dynamic_agent_client"
	);
	expect(test.request().searchParams.get("agent_name_hint")).toBe("1git");
	expect(test.request().searchParams.get("ext_agent_host_id")).toBe(
		preferences.hostId
	);
	expect(exchange?.get("client_id")).toBe(clientId);
	expect(exchange?.get("redirect_uri")).toBe(
		"http://127.0.0.1:8766/auth/callback"
	);
	expect(
		createHash("sha256")
			.update(exchange?.get("code_verifier") ?? "")
			.digest("base64url")
	).toBe(test.request().searchParams.get("code_challenge") ?? "");
	expect(result.account).toEqual({
		clientId,
		subject: "subject1",
		email: "test@example.invalid",
	});
	expect(result.session.accessToken).toBe("synthetic-access");
});

it.each([
	{ invalidState: true },
	{ invalidNonce: true },
	{ issued: "dynamic_agent_client" },
	{ scope: "openid profile email" },
])("rejects invalid callback/identity/permissions: %j", async (options) => {
	const test = authorization(options);

	await expect(
		test.service.connect(
			preferences,
			async () => undefined,
			new AbortController().signal
		)
	).rejects.toThrow();
});

it("reauthorizes only the selected account's issued registration", async () => {
	const test = authorization({ previous: true });

	await test.service.connect(
		{
			...preferences,
			chatgpt: { clientId, subject: "subject1", email: "test@example.invalid" },
		},
		async () => undefined,
		new AbortController().signal
	);
	expect(test.request().searchParams.get("client_id")).toBe(clientId);
	expect(test.request().searchParams.has("agent_name_hint")).toBe(false);
	expect(test.exchange()?.get("client_id")).toBe(clientId);

	const changed = authorization();

	await expect(
		changed.service.connect(
			{
				...preferences,
				chatgpt: {
					clientId: "oaiapp_other",
					subject: "other",
					email: "other@example.invalid",
				},
			},
			async () => undefined,
			new AbortController().signal
		)
	).rejects.toThrow("changed accounts");
});

it("refreshes with the issued ID, omits scope and retains a rotated pair", async () => {
	let body: URLSearchParams | undefined;

	const service = new ChatGptAuthorization(
		new AiHttp(async (_url, init) => {
			body = new URLSearchParams(String(init?.body));

			return Response.json({
				access_token: "new-access",
				refresh_token: "rotated-refresh",
				token_type: "Bearer",
				expires_in: 3600,
			});
		})
	);

	const refreshed = await service.refresh(
		{
			clientId,
			subject: "subject1",
			accessToken: "expired",
			refreshToken: "old-refresh",
			idToken: "retained-id",
			scope,
			expiresAt: 0,
		},
		new AbortController().signal
	);

	expect(body?.get("client_id")).toBe(clientId);
	expect(body?.get("resource")).toBe("https://api.openai.com/v1");
	expect(body?.has("scope")).toBe(false);
	expect(refreshed.refreshToken).toBe("rotated-refresh");
	expect(refreshed.subject).toBe("subject1");
	expect(refreshed.idToken).toBe("retained-id");
});
