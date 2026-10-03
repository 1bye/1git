import type { CallOptions, HostingResult } from "./contracts.js";
import type { OAuthTokens } from "./oauth.js";
import { oauthTokens } from "./oauth-tokens.js";
import type {
	DeviceOAuthApplication,
	HostingProvider,
	ProviderDeviceOAuthAdapter,
} from "./provider.js";
import { Endpoints, Transport } from "./transport.js";
import {
	fail,
	failureResult,
	nonempty,
	number,
	record,
	result,
	string,
} from "./result.js";

/** Safe to display. The sensitive device code is retained privately by this lifecycle. */
export interface DeviceAuthorization {
	readonly userCode: string;
	readonly verificationUrl: string;
	readonly expiresAt: number;
}
export type DevicePoll =
	| { readonly status: "pending"; readonly retryAfterMs: number }
	| { readonly status: "authorized"; readonly tokens: OAuthTokens };

/** Public-client device OAuth. Caller owns browser, cancellation and storage; no implicit polling/retries. */
export class HostingDeviceOAuth {
	readonly #attempts = new WeakMap<
		DeviceAuthorization,
		{ code: string; interval: number; next: number; busy: boolean }
	>();
	readonly #config: DeviceOAuthApplication;
	readonly #adapter: ProviderDeviceOAuthAdapter;
	readonly #endpoints: Endpoints;
	private constructor(readonly provider: HostingProvider) {
		this.#endpoints = new Endpoints(provider);
		const config = provider.options.deviceOAuth;

		if (!config)
			fail(
				"validation",
				"Configure a device OAuth application on this provider."
			);

		nonempty(config.clientId, "OAuth client ID");

		if (/\s/u.test(config.clientId))
			fail("validation", "Invalid OAuth client ID.");

		for (const scope of config.scopes) {
			nonempty(scope, "OAuth scope");

			if (/[\s,]/u.test(scope))
				fail("validation", "OAuth scopes must be separate array entries.");
		}

		const adapter = provider.createDeviceOAuthAdapter(
			new Transport(this.#endpoints)
		);

		if (!adapter)
			fail(
				"unsupported",
				"This provider does not support device authorization."
			);

		this.#config = config;
		this.#adapter = adapter;
	}
	static create(provider: HostingProvider): HostingResult<HostingDeviceOAuth> {
		try {
			return { ok: true, value: new HostingDeviceOAuth(provider) };
		} catch (error) {
			return failureResult("configure-device-oauth", error);
		}
	}
	beginAuthorization(
		options: CallOptions = {}
	): Promise<HostingResult<DeviceAuthorization>> {
		return result("begin-device-authorization", async () => {
			const data = record(await this.#adapter.begin(this.#config, options));

			if (data.error !== undefined)
				fail(
					"authentication",
					"Device authorization is unavailable. Check the application registration."
				);

			const code = nonempty(string(data.device_code), "device code");
			const userCode = string(data.user_code);

			if (!/^[A-Z0-9-]{4,32}$/iu.test(userCode))
				fail("invalid-response", "Invalid user verification code.");

			const expiry = number(data.expires_in);
			const interval = data.interval == null ? 5 : number(data.interval);

			if (expiry < 1 || expiry > 3600 || interval < 1 || interval > 60)
				fail("invalid-response", "Invalid device authorization lifetime.");

			const attempt = Object.freeze({
				userCode,
				verificationUrl: this.#endpoints.browser(
					nonempty(string(data.verification_uri), "verification URL")
				),
				expiresAt: Date.now() + expiry * 1000,
			});

			this.#attempts.set(attempt, {
				code,
				interval: interval * 1000,
				next: Date.now() + interval * 1000,
				busy: false,
			});

			return attempt;
		});
	}
	/** Returns pending without making a request when called early; slow_down permanently increases the interval. */
	poll(
		attempt: DeviceAuthorization,
		options: CallOptions = {}
	): Promise<HostingResult<DevicePoll>> {
		return result("poll-device-authorization", async () => {
			const session = this.#attempts.get(attempt);

			if (!session || Date.now() >= attempt.expiresAt) {
				this.#attempts.delete(attempt);
				fail(
					"authentication",
					"Authorization expired or was consumed; start again."
				);
			}

			if (session.busy || Date.now() < session.next)
				return {
					status: "pending",
					retryAfterMs: Math.max(1, session.next - Date.now()),
				};

			session.busy = true;

			try {
				const data = record(
					await this.#adapter.exchange(
						{
							grant_type: "urn:ietf:params:oauth:grant-type:device_code",
							device_code: session.code,
						},
						this.#config,
						options
					)
				);

				if (
					this.#attempts.get(attempt) !== session ||
					options.signal?.aborted ||
					Date.now() >= attempt.expiresAt
				) {
					this.#attempts.delete(attempt);
					fail(
						"authentication",
						"Authorization cancelled or expired; start again."
					);
				}

				if (
					data.error === "authorization_pending" ||
					data.error === "slow_down"
				) {
					if (data.error === "slow_down") session.interval += 5000;

					return { status: "pending", retryAfterMs: session.interval };
				}

				this.#attempts.delete(attempt);

				if (data.error !== undefined)
					fail(
						"authentication",
						"Device authorization was denied or expired; start again."
					);

				return { status: "authorized", tokens: oauthTokens(data) };
			} finally {
				session.busy = false;
				session.next = Date.now() + session.interval;
			}
		});
	}
	/** Forget private attempt state when the caller cancels. */
	cancel(attempt: DeviceAuthorization): void {
		this.#attempts.delete(attempt);
	}
	refresh(
		refreshToken: string,
		options: CallOptions = {}
	): Promise<HostingResult<OAuthTokens>> {
		return result("refresh-device-token", async () =>
			oauthTokens(
				await this.#adapter.exchange(
					{
						grant_type: "refresh_token",
						refresh_token: nonempty(refreshToken, "refresh token"),
					},
					this.#config,
					options
				)
			)
		);
	}
}
