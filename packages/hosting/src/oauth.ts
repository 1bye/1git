import { createHash, randomBytes } from "node:crypto";
import type {
	CallOptions,
	EndpointOptions,
	HostingResult,
} from "./contracts.js";
import {
	fail,
	failureResult,
	nonempty,
	number,
	record,
	result,
	string,
} from "./result.js";
import { Endpoints, Transport } from "./transport.js";

/** Registered OAuth application. Secrets belong to the caller, never to repository data. */
export interface OAuthOptions extends EndpointOptions {
	readonly clientId: string;
	readonly clientSecret?: string;
	readonly redirectUri: string;
	readonly scopes: readonly string[];
}

/** Open authorizationUrl in the system browser; retain this object until the callback arrives. */
export interface Authorization {
	readonly authorizationUrl: string;
	readonly expiresAt: number;
}

/** Sensitive result: persist using the platform credential store, never logs/session JSON. */
export interface OAuthTokens {
	readonly accessToken: string;
	readonly tokenType: "bearer";
	readonly refreshToken: string | null;
	readonly expiresAt: number | null;
	readonly refreshExpiresAt: number | null;
	readonly scopes: readonly string[] | null;
}

/** Authorization-code/PKCE lifecycle. The caller owns browser, callback listener, and token storage. */
export class HostingOAuth {
	readonly #attempts = new WeakMap<
		Authorization,
		{ verifier: string; state: string }
	>();
	readonly #http: Transport;
	readonly #config: OAuthOptions;

	private constructor(options: OAuthOptions) {
		this.#config = { ...options, scopes: [...options.scopes] };
		this.#http = new Transport(new Endpoints(options));
		nonempty(options.clientId, "OAuth client ID");

		if (
			options.clientId.includes(":") ||
			options.clientId === "." ||
			options.clientId === ".."
		)
			fail("validation", "Invalid OAuth client ID.");

		if (options.clientSecret !== undefined)
			nonempty(options.clientSecret, "OAuth client secret");

		let redirect: URL;

		try {
			redirect = new URL(options.redirectUri);
		} catch {
			return fail("validation", "Invalid OAuth callback URL.");
		}

		const local =
			redirect.protocol === "http:" &&
			["127.0.0.1", "[::1]", "localhost"].includes(redirect.hostname);

		if (
			(redirect.protocol !== "https:" && !local) ||
			redirect.username ||
			redirect.password ||
			redirect.search ||
			redirect.hash
		)
			fail(
				"validation",
				"Use an HTTPS or loopback HTTP callback without query parameters."
			);

		for (const scope of options.scopes) {
			nonempty(scope, "OAuth scope");

			if (/[\s,]/u.test(scope))
				fail("validation", "OAuth scopes must be separate array entries.");
		}
	}

	/** Validate configuration. GitHub code exchange/revocation requires a client secret. */
	static create(options: OAuthOptions): HostingResult<HostingOAuth> {
		try {
			return { ok: true, value: new HostingOAuth(options) };
		} catch (error) {
			return failureResult("configure-oauth", error);
		}
	}

	/** Generate cryptographic state and S256 PKCE; no network or browser side effects. */
	beginAuthorization(): HostingResult<Authorization> {
		try {
			const verifier = randomBytes(32).toString("base64url");
			const state = randomBytes(32).toString("base64url");

			const url = new URL(
				this.#config.provider === "github"
					? "login/oauth/authorize"
					: "oauth/authorize",
				this.#http.endpoints.web
			);

			url.search = new URLSearchParams({
				client_id: this.#config.clientId,
				redirect_uri: this.#config.redirectUri,
				scope: this.#config.scopes.join(" "),
				response_type: "code",
				state,
				code_challenge: createHash("sha256")
					.update(verifier)
					.digest("base64url"),
				code_challenge_method: "S256",
			}).toString();
			const attempt = Object.freeze({
				authorizationUrl: url.href,
				expiresAt: Date.now() + 10 * 60 * 1000,
			});

			this.#attempts.set(attempt, { verifier, state });

			return { ok: true, value: attempt };
		} catch (error) {
			return failureResult("begin-authorization", error);
		}
	}

	/** Validate callback origin/path/state and consume the attempt once before exchanging the code. */
	exchangeCode(
		attempt: Authorization,
		callbackUrl: string,
		options: CallOptions = {}
	): Promise<HostingResult<OAuthTokens>> {
		return result("exchange-code", async () => {
			const session = this.#attempts.get(attempt);

			if (!session || Date.now() >= attempt.expiresAt)
				fail(
					"authentication",
					"Authorization expired or was already consumed; start again."
				);

			let callback: URL;

			try {
				callback = new URL(callbackUrl);
			} catch {
				return fail("validation", "Invalid authorization callback.");
			}

			const base = new URL(callback);

			base.search = "";

			if (
				base.href !== new URL(this.#config.redirectUri).href ||
				callback.searchParams.getAll("state").length !== 1 ||
				callback.searchParams.get("state") !== session.state
			)
				fail(
					"authentication",
					"Authorization callback did not match its pending request."
				);

			this.#attempts.delete(attempt);

			if (callback.searchParams.has("error"))
				fail("authentication", "Provider authorization was denied.");

			const codes = callback.searchParams.getAll("code");

			if (codes.length !== 1 || !codes[0])
				fail("authentication", "Authorization callback has no valid code.");

			return this.tokens(
				{
					grant_type: "authorization_code",
					code: nonempty(codes[0], "authorization code"),
					code_verifier: session.verifier,
				},
				options
			);
		});
	}

	/** Rotate a provider-issued refresh token. Persist the new pair atomically; never automatically retries. */
	refresh(
		refreshToken: string,
		options: CallOptions = {}
	): Promise<HostingResult<OAuthTokens>> {
		return result("refresh-token", () =>
			this.tokens(
				{
					grant_type: "refresh_token",
					refresh_token: nonempty(refreshToken, "refresh token"),
				},
				options
			)
		);
	}

	/** Revoke this OAuth token, not unrelated tokens/PATs. Some registrations require a secret. */
	revoke(
		accessToken: string,
		options: CallOptions = {}
	): Promise<HostingResult<void>> {
		return result("revoke-token", async () => {
			nonempty(accessToken, "access token");

			if (this.#config.provider === "github") {
				const secret = this.secret();

				const basic = Buffer.from(
					`${this.#config.clientId}:${secret}`
				).toString("base64");

				await this.#http.request(
					this.#http.url(
						`applications/${encodeURIComponent(this.#config.clientId)}/token`
					),
					"DELETE",
					options,
					{ access_token: accessToken },
					`Basic ${basic}`
				);
			} else {
				const body = new URLSearchParams({
					client_id: this.#config.clientId,
					token: accessToken,
				});

				if (this.#config.clientSecret)
					body.set("client_secret", this.#config.clientSecret);

				await this.#http.request(
					new URL("oauth/revoke", this.#http.endpoints.web),
					"POST",
					options,
					body,
					undefined,
					true
				);
			}
		});
	}

	private secret(): string {
		if (!this.#config.clientSecret)
			fail(
				"unsupported",
				"This GitHub OAuth operation requires the registered application's client secret; use a trusted exchange service for distributed clients."
			);

		return this.#config.clientSecret;
	}

	private async tokens(
		fields: Record<string, string>,
		options: CallOptions
	): Promise<OAuthTokens> {
		const body = new URLSearchParams({
			client_id: this.#config.clientId,
			redirect_uri: this.#config.redirectUri,
			...fields,
		});

		if (this.#config.provider === "github")
			body.set("client_secret", this.secret());
		else if (this.#config.clientSecret)
			body.set("client_secret", this.#config.clientSecret);

		const endpoint =
			this.#config.provider === "github"
				? "login/oauth/access_token"
				: "oauth/token";

		const reply = await this.#http.request(
			new URL(endpoint, this.#http.endpoints.web),
			"POST",
			options,
			body,
			undefined,
			true
		);

		const data = record(reply.data);

		if (data.error !== undefined)
			fail(
				"authentication",
				"Provider rejected the OAuth exchange; authorize again."
			);

		if (string(data.token_type).toLowerCase() !== "bearer")
			fail("invalid-response", "Unsupported OAuth token type.");

		const accessToken = string(data.access_token);

		const refreshToken =
			data.refresh_token == null ? null : string(data.refresh_token);

		if (
			!accessToken ||
			/\s/u.test(accessToken) ||
			(refreshToken !== null && (!refreshToken || /\s/u.test(refreshToken)))
		)
			fail("invalid-response", "Provider returned an invalid token.");

		const now = Date.now();

		return {
			accessToken,
			refreshToken,
			tokenType: "bearer",
			expiresAt:
				data.expires_in == null ? null : now + number(data.expires_in) * 1000,
			refreshExpiresAt:
				data.refresh_token_expires_in == null
					? null
					: now + number(data.refresh_token_expires_in) * 1000,
			scopes:
				data.scope == null
					? null
					: string(data.scope).split(/[ ,]+/u).filter(Boolean),
		};
	}
}
