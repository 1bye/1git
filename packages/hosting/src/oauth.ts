import { createHash, randomBytes } from "node:crypto";
import type { CallOptions, HostingResult } from "./contracts.js";
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
import type {
	OAuthApplication,
	OAuthGrant,
	ProviderOAuthAdapter,
	HostingProvider,
} from "./provider.js";

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
	readonly #adapter: ProviderOAuthAdapter;
	readonly #config: OAuthApplication;
	readonly provider: HostingProvider;

	private constructor(provider: HostingProvider) {
		const http = new Transport(new Endpoints(provider));
		const options = provider.options.oauth;

		if (!options)
			fail("validation", "Configure an OAuth application on this provider.");

		this.#config = options;
		this.provider = provider;
		const adapter = provider.createOAuthAdapter(http);

		if (!provider.capabilities.oauthPkce || !adapter)
			fail(
				"unsupported",
				"This provider does not support authorization-code/PKCE authentication."
			);

		this.#adapter = adapter;
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

	/** Validate configuration and provider support for authorization-code/PKCE authentication. */
	static create(provider: HostingProvider): HostingResult<HostingOAuth> {
		try {
			return { ok: true, value: new HostingOAuth(provider) };
		} catch (error) {
			return failureResult("configure-oauth", error);
		}
	}

	/** Generate cryptographic state and S256 PKCE; no network or browser side effects. */
	beginAuthorization(): HostingResult<Authorization> {
		try {
			const verifier = randomBytes(32).toString("base64url");
			const state = randomBytes(32).toString("base64url");

			const url = this.#adapter.authorizationUrl({
				client_id: this.#config.clientId,
				redirect_uri: this.#config.redirectUri,
				scope: this.#config.scopes.join(" "),
				response_type: "code",
				state,
				code_challenge: createHash("sha256")
					.update(verifier)
					.digest("base64url"),
				code_challenge_method: "S256",
			});

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
		return result("refresh-token", () => {
			if (this.provider.capabilities.oauthRefresh === "unsupported")
				fail(
					"unsupported",
					"This provider does not support refreshing OAuth tokens."
				);

			return this.tokens(
				{
					grant_type: "refresh_token",
					refresh_token: nonempty(refreshToken, "refresh token"),
				},
				options
			);
		});
	}

	/** Revoke this OAuth token, not unrelated tokens/PATs. Some registrations require a secret. */
	revoke(
		accessToken: string,
		options: CallOptions = {}
	): Promise<HostingResult<void>> {
		return result("revoke-token", async () => {
			nonempty(accessToken, "access token");

			if (!this.provider.capabilities.oauthRevocation)
				fail(
					"unsupported",
					"This provider does not support revoking OAuth tokens."
				);

			await this.#adapter.revokeToken(accessToken, this.#config, options);
		});
	}

	private async tokens(
		grant: OAuthGrant,
		options: CallOptions
	): Promise<OAuthTokens> {
		const data = record(
			await this.#adapter.exchangeToken(grant, this.#config, options)
		);

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
