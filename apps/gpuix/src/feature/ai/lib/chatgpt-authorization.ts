import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { LoopbackAuthorization } from "../../accounts/lib/loopback-authorization";
import { AiHttp } from "./ai-http";
import type { AiPreferences } from "./ai-settings-store";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const redirectUri = "http://127.0.0.1:8766/auth/callback";

/** OAuth credentials live together in the OS vault, never in settings or renderer props. */
export interface ChatGptSession {
	readonly clientId: string;
	readonly subject: string;
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly idToken: string;
	readonly expiresAt: number;
	readonly scope: string;
}

/** Official public-client ChatGPT plan authorization, with PKCE and signed OIDC identity validation. */
export class ChatGptAuthorization {
	constructor(
		private readonly http: AiHttp,
		private readonly wait = LoopbackAuthorization.wait.bind(
			LoopbackAuthorization
		)
	) {}

	async connect(
		preferences: AiPreferences,
		open: (url: string) => Promise<void>,
		signal: AbortSignal
	): Promise<{
		account: NonNullable<AiPreferences["chatgpt"]>;
		session: ChatGptSession;
	}> {
		if (!preferences.hostId) throw new Error("Missing AI host registration.");

		const verifier = randomBytes(32).toString("base64url");
		const state = randomBytes(32).toString("base64url");
		const nonce = randomBytes(32).toString("base64url");
		const url = new URL(`${issuer}/api/accounts/authorize`);

		url.search = new URLSearchParams({
			client_id: preferences.chatgpt?.clientId ?? "dynamic_agent_client",
			ext_agent_host_id: preferences.hostId,
			response_type: "code",
			redirect_uri: redirectUri,
			scope:
				"openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
			resource,
			state,
			nonce,
			code_challenge_method: "S256",
			code_challenge: createHash("sha256").update(verifier).digest("base64url"),
		}).toString();

		if (preferences.chatgpt)
			url.searchParams.set("login_hint", preferences.chatgpt.email);
		else url.searchParams.set("agent_name_hint", "1git");

		const callback = new URL(
			await this.wait(
				{ authorizationUrl: url.href, expiresAt: Date.now() + 5 * 60_000 },
				redirectUri,
				open,
				signal
			)
		);

		signal.throwIfAborted();

		if (
			callback.origin !== new URL(redirectUri).origin ||
			callback.pathname !== "/auth/callback" ||
			callback.searchParams.getAll("state").length !== 1 ||
			callback.searchParams.get("state") !== state
		)
			throw new Error(
				"ChatGPT sign-in did not match this authorization attempt."
			);

		if (callback.searchParams.has("error"))
			throw new Error(
				"ChatGPT sign-in was declined. Enable ChatGPT plan usage when reconnecting."
			);

		const code = callback.searchParams.get("code");

		const clientId =
			callback.searchParams.get("client_id") ?? preferences.chatgpt?.clientId;

		if (
			!code ||
			callback.searchParams.getAll("code").length !== 1 ||
			callback.searchParams.getAll("client_id").length > 1 ||
			!clientId ||
			!/^oaiapp_[a-zA-Z0-9_-]{1,240}$/u.test(clientId) ||
			(preferences.chatgpt && clientId !== preferences.chatgpt.clientId)
		)
			throw new Error(
				"ChatGPT registration was incomplete or changed accounts. Disconnect and start again."
			);

		const raw = await this.exchange(
			{
				grant_type: "authorization_code",
				client_id: clientId,
				code,
				code_verifier: verifier,
				redirect_uri: redirectUri,
				resource,
			},
			signal
		);

		const session = ChatGptAuthorization.tokens(raw, clientId);

		const keys = createRemoteJWKSet(
			new URL(`${issuer}/.well-known/jwks.json`),
			{
				[customFetch]: (address, options) =>
					this.http.fetch(address, {
						...options,
						signal: AbortSignal.any([options.signal, signal]),
						redirect: "error",
					}),
			}
		);

		let subject: string;
		let email: string;

		try {
			const { payload } = await jwtVerify(session.idToken, keys, {
				issuer,
				audience: clientId,
				algorithms: ["RS256", "ES256"],
				requiredClaims: ["sub", "exp", "iat"],
				clockTolerance: 5,
			});

			if (
				payload.nonce !== nonce ||
				!payload.sub ||
				(preferences.chatgpt && payload.sub !== preferences.chatgpt.subject)
			)
				throw new Error("Identity mismatch.");

			subject = payload.sub;
			email =
				typeof payload.email === "string" ? payload.email : "ChatGPT account";
		} catch {
			throw new Error(
				"Could not verify ChatGPT identity. Nothing was connected; try signing in again."
			);
		}

		signal.throwIfAborted();

		return {
			account: { clientId, subject, email },
			session: { ...session, subject },
		};
	}

	async refresh(
		session: ChatGptSession,
		signal: AbortSignal
	): Promise<ChatGptSession> {
		const raw = await this.exchange(
			{
				grant_type: "refresh_token",
				client_id: session.clientId,
				refresh_token: session.refreshToken,
				resource,
			},
			signal
		);

		return {
			...ChatGptAuthorization.tokens(raw, session.clientId, session),
			subject: session.subject,
		};
	}

	/** Revokes remotely before local removal; caller can still remove locally if offline. */
	async revoke(session: ChatGptSession, signal: AbortSignal): Promise<void> {
		const discovery = await this.http.json(
			`${issuer}/.well-known/openid-configuration`,
			{},
			signal
		);

		if (
			!discovery ||
			typeof discovery !== "object" ||
			!("revocation_endpoint" in discovery) ||
			typeof discovery.revocation_endpoint !== "string"
		)
			throw new Error("Revocation is unavailable.");

		const endpoint = new URL(discovery.revocation_endpoint);

		if (endpoint.origin !== issuer || endpoint.username || endpoint.password)
			throw new Error("Invalid revocation endpoint.");

		const response = await this.http.fetch(endpoint, {
			method: "POST",
			body: new URLSearchParams({
				token: session.refreshToken,
				token_type_hint: "refresh_token",
				client_id: session.clientId,
			}),
			signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
			redirect: "error",
		});

		await response.body?.cancel();

		if (!response.ok) throw new Error("Revocation was not confirmed.");
	}

	private async exchange(
		parameters: Record<string, string>,
		signal: AbortSignal
	): Promise<unknown> {
		return await this.http.json(
			tokenEndpoint,
			{ method: "POST", body: new URLSearchParams(parameters) },
			signal
		);
	}

	static tokens(
		raw: unknown,
		clientId: string,
		previous?: ChatGptSession
	): ChatGptSession {
		if (
			!raw ||
			typeof raw !== "object" ||
			!("access_token" in raw) ||
			typeof raw.access_token !== "string" ||
			!raw.access_token ||
			raw.access_token.length > 32_000 ||
			/[\s\p{Cc}]/u.test(raw.access_token) ||
			!("token_type" in raw) ||
			String(raw.token_type).toLowerCase() !== "bearer" ||
			!("expires_in" in raw) ||
			typeof raw.expires_in !== "number" ||
			!Number.isFinite(raw.expires_in) ||
			raw.expires_in <= 0 ||
			raw.expires_in > 86400 * 31
		)
			throw new Error(
				"ChatGPT returned invalid credentials. Reconnect in Settings → AI."
			);

		const refreshToken =
			"refresh_token" in raw && typeof raw.refresh_token === "string"
				? raw.refresh_token
				: previous?.refreshToken;

		const idToken =
			"id_token" in raw && typeof raw.id_token === "string"
				? raw.id_token
				: previous?.idToken;

		const scope =
			"scope" in raw && typeof raw.scope === "string"
				? raw.scope
				: previous?.scope;

		if (
			!refreshToken ||
			refreshToken.length > 32_000 ||
			!idToken ||
			idToken.length > 32_000 ||
			!scope ||
			!scope.split(" ").includes("chatgpt.tokens.use.direct") ||
			!scope.split(" ").includes("resource.invoke")
		)
			throw new Error(
				"ChatGPT plan usage was not granted. Reconnect and allow ChatGPT plan usage."
			);

		return {
			clientId,
			subject: previous?.subject ?? "",
			accessToken: raw.access_token,
			refreshToken,
			idToken,
			expiresAt: Date.now() + raw.expires_in * 1000,
			scope,
		};
	}

	static saved(
		raw: string,
		account: NonNullable<AiPreferences["chatgpt"]>
	): ChatGptSession {
		let value: unknown;

		try {
			value = JSON.parse(raw);
		} catch {
			throw new Error(
				"Invalid saved ChatGPT credentials. Reconnect in Settings → AI."
			);
		}

		if (
			!value ||
			typeof value !== "object" ||
			!("clientId" in value) ||
			value.clientId !== account.clientId ||
			!("subject" in value) ||
			value.subject !== account.subject ||
			!("expiresAt" in value) ||
			typeof value.expiresAt !== "number" ||
			!Number.isFinite(value.expiresAt) ||
			!("accessToken" in value) ||
			!("refreshToken" in value) ||
			!("idToken" in value) ||
			!("scope" in value)
		)
			throw new Error(
				"Saved ChatGPT credentials do not match the account. Reconnect in Settings → AI."
			);

		const checked = ChatGptAuthorization.tokens(
			{
				access_token: value.accessToken,
				refresh_token: value.refreshToken,
				id_token: value.idToken,
				scope: value.scope,
				token_type: "Bearer",
				expires_in: 1,
			},
			account.clientId
		);

		return { ...checked, subject: account.subject, expiresAt: value.expiresAt };
	}
}
