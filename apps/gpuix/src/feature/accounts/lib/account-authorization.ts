import { setTimeout as delay } from "node:timers/promises";
import type { HostingFetch } from "@1git/hosting/contracts";
import { HostingOAuth, type OAuthTokens } from "@1git/hosting/oauth";
import {
	HostingDeviceOAuth,
	type DeviceAuthorization,
} from "@1git/hosting/device-oauth";
import { GitHubProvider } from "@1git/hosting/providers/github";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";
import type { SavedAccount } from "./account-store";
import { hasControlCharacters } from "./account-store";
import { LoopbackAuthorization } from "./loopback-authorization";

/** Public registration. Tokens and this registration are stored together only in the OS vault. */
export interface AccountRegistration {
	readonly clientId: string;
	readonly redirectUri?: string;
}
export interface BrowserConnection {
	readonly provider: SavedAccount["provider"];
	readonly webUrl: string;
	readonly registration: AccountRegistration;
	readonly signal: AbortSignal;
	readonly onDeviceCode?: (attempt: DeviceAuthorization) => void;
}

export function validateRegistration(
	provider: SavedAccount["provider"],
	value: AccountRegistration
): void {
	if (
		!value.clientId ||
		value.clientId.length > 256 ||
		/\s/u.test(value.clientId) ||
		hasControlCharacters(value.clientId)
	)
		throw new Error("Enter the registered application's public client ID.");

	if (provider === "gitlab")
		LoopbackAuthorization.callback(value.redirectUri ?? "");
}

/** Browser opening is an explicit boundary; tests replace it, never the OAuth lifecycle. */
export async function openAuthorizationBrowser(value: string): Promise<void> {
	const url = new URL(value);

	if (url.protocol !== "https:" || url.username || url.password || url.hash)
		throw new Error("Invalid provider authorization URL.");

	if (process.platform !== "darwin")
		throw new Error(
			"Browser authorization is currently supported on macOS. Use an access token instead."
		);

	const browserProcess = Bun.spawn(["/usr/bin/open", url.href], {
		stdout: "ignore",
		stderr: "ignore",
	});

	if ((await browserProcess.exited) !== 0)
		throw new Error("Could not open the browser. Try again.");
}

/** Owns one cancellable sign-in, not a permanent server or child runtime. */
export class AccountAuthorization {
	constructor(
		private readonly fetch?: HostingFetch,
		private readonly open = openAuthorizationBrowser
	) {}
	async authorize(input: BrowserConnection): Promise<OAuthTokens> {
		validateRegistration(input.provider, input.registration);
		input.signal.throwIfAborted();

		if (input.provider === "gitlab") {
			const oauth = this.code(input.webUrl, input.registration);
			const begun = oauth.beginAuthorization();

			if (!begun.ok) throw new Error(begun.error.message);

			const callback = await LoopbackAuthorization.wait(
				begun.value,
				input.registration.redirectUri!,
				this.open,
				input.signal
			);

			const exchanged = await oauth.exchangeCode(begun.value, callback, {
				signal: input.signal,
			});

			if (!exchanged.ok) throw new Error(exchanged.error.message);

			return exchanged.value;
		}

		const oauth = this.device(input.webUrl, input.registration);
		const begun = await oauth.beginAuthorization({ signal: input.signal });

		if (!begun.ok) throw new Error(begun.error.message);

		try {
			input.signal.throwIfAborted();
			input.onDeviceCode?.(begun.value);
			await this.open(begun.value.verificationUrl);

			while (true) {
				input.signal.throwIfAborted();
				const polled = await oauth.poll(begun.value, { signal: input.signal });

				if (!polled.ok) throw new Error(polled.error.message);

				if (polled.value.status === "authorized") return polled.value.tokens;

				await delay(
					Math.min(
						polled.value.retryAfterMs,
						Math.max(1, begun.value.expiresAt - Date.now())
					),
					undefined,
					{ signal: input.signal }
				);
			}
		} finally {
			oauth.cancel(begun.value);
		}
	}
	async refresh(
		provider: SavedAccount["provider"],
		webUrl: string,
		registration: AccountRegistration,
		refreshToken: string,
		signal?: AbortSignal
	): Promise<OAuthTokens> {
		validateRegistration(provider, registration);
		const result = await (
			provider === "github"
				? this.device(webUrl, registration)
				: this.code(webUrl, registration)
		).refresh(refreshToken, { signal });

		if (!result.ok) throw new Error(result.error.message);

		return result.value;
	}
	private device(
		webUrl: string,
		registration: AccountRegistration
	): HostingDeviceOAuth {
		const configured = HostingDeviceOAuth.create(
			new GitHubProvider({
				webUrl,
				fetch: this.fetch,
				timeoutMs: 10_000,
				deviceOAuth: { clientId: registration.clientId, scopes: ["read:user"] },
			})
		);

		if (!configured.ok) throw new Error(configured.error.message);

		return configured.value;
	}
	private code(
		webUrl: string,
		registration: AccountRegistration
	): HostingOAuth {
		const configured = HostingOAuth.create(
			new GitLabProvider({
				webUrl,
				fetch: this.fetch,
				timeoutMs: 10_000,
				oauth: {
					clientId: registration.clientId,
					redirectUri: registration.redirectUri!,
					scopes: ["read_user"],
				},
			})
		);

		if (!configured.ok) throw new Error(configured.error.message);

		return configured.value;
	}
}
