import type { OAuthTokens } from "@1git/hosting/oauth";
import {
	validateRegistration,
	type AccountRegistration,
} from "./account-authorization";
import { hasControlCharacters, type SavedAccount } from "./account-store";

/** This entire document belongs in the OS vault, never the metadata/session file. */
export interface AccountCredential {
	readonly token: string;
	readonly oauth?: {
		readonly registration: AccountRegistration;
		readonly tokens: OAuthTokens;
	};
}
export function credentialToken(value: string): void {
	if (
		!value ||
		Buffer.byteLength(value) > 4096 ||
		/\s/u.test(value) ||
		hasControlCharacters(value)
	)
		throw new Error("Invalid saved credential. Reconnect this account.");
}
export function encodeCredential(value: AccountCredential): string {
	credentialToken(value.token);

	if (!value.oauth) return value.token;

	const { registration, tokens } = value.oauth;

	const encoded = JSON.stringify({
		version: 1,
		registration: {
			clientId: registration.clientId,
			redirectUri: registration.redirectUri,
		},
		tokens,
	});

	if (Buffer.byteLength(encoded) > 16 * 1024)
		throw new Error("Provider credential is too large to save securely.");

	return encoded;
}
export function decodeCredential(
	value: string,
	provider: SavedAccount["provider"]
): AccountCredential {
	if (!value.startsWith("{")) {
		credentialToken(value);

		return { token: value };
	}

	try {
		const data: unknown = JSON.parse(value);

		if (
			!data ||
			typeof data !== "object" ||
			!("version" in data) ||
			data.version !== 1 ||
			!("registration" in data) ||
			!("tokens" in data)
		)
			throw new Error();

		const registration = data.registration;
		const tokens = data.tokens;

		if (
			!registration ||
			typeof registration !== "object" ||
			!("clientId" in registration) ||
			typeof registration.clientId !== "string" ||
			("redirectUri" in registration &&
				typeof registration.redirectUri !== "string")
		)
			throw new Error();

		const setup: AccountRegistration = {
			clientId: registration.clientId,
			redirectUri:
				"redirectUri" in registration &&
				typeof registration.redirectUri === "string"
					? registration.redirectUri
					: undefined,
		};

		validateRegistration(provider, setup);

		if (
			!tokens ||
			typeof tokens !== "object" ||
			!("accessToken" in tokens) ||
			typeof tokens.accessToken !== "string" ||
			!("tokenType" in tokens) ||
			tokens.tokenType !== "bearer" ||
			!("refreshToken" in tokens) ||
			(tokens.refreshToken !== null &&
				typeof tokens.refreshToken !== "string") ||
			!("expiresAt" in tokens) ||
			!("refreshExpiresAt" in tokens) ||
			!("scopes" in tokens)
		)
			throw new Error();

		credentialToken(tokens.accessToken);

		if (tokens.refreshToken !== null) credentialToken(tokens.refreshToken);

		const expiresAt = expiry(tokens.expiresAt);
		const refreshExpiresAt = expiry(tokens.refreshExpiresAt);

		if (
			tokens.scopes !== null &&
			(!Array.isArray(tokens.scopes) ||
				!tokens.scopes.every((scope: unknown) => typeof scope === "string"))
		)
			throw new Error();

		const oauth: OAuthTokens = {
			accessToken: tokens.accessToken,
			tokenType: "bearer",
			refreshToken: tokens.refreshToken,
			expiresAt,
			refreshExpiresAt,
			scopes: tokens.scopes,
		};

		return {
			token: oauth.accessToken,
			oauth: { registration: setup, tokens: oauth },
		};
	} catch {
		throw new Error("Invalid saved credential. Reconnect this account.");
	}
}
function expiry(value: unknown): number | null {
	if (value === null) return null;

	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new Error();

	return value;
}
