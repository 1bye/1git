import type { OAuthTokens } from "./oauth.js";
import { fail, number, record, string } from "./result.js";

/** Internal shared normalization for code and device grants. */
export function oauthTokens(value: unknown): OAuthTokens {
	const data = record(value);

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

	for (const token of [accessToken, refreshToken]) {
		if (
			token !== null &&
			(!token || token.length > 4096 || /\s/u.test(token) || hasControls(token))
		)
			fail("invalid-response", "Provider returned an invalid token.");
	}

	const now = Date.now();

	return {
		accessToken,
		refreshToken,
		tokenType: "bearer",
		expiresAt: data.expires_in == null ? null : expiresAt(now, data.expires_in),
		refreshExpiresAt:
			data.refresh_token_expires_in == null
				? null
				: expiresAt(now, data.refresh_token_expires_in),
		scopes:
			data.scope == null
				? null
				: string(data.scope).split(/[ ,]+/u).filter(Boolean),
	};
}

function expiresAt(now: number, seconds: unknown): number {
	const expiry = now + number(seconds) * 1000;

	if (!Number.isSafeInteger(expiry))
		fail("invalid-response", "Invalid token lifetime.");

	return expiry;
}

function hasControls(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);

		if (code < 32 || code === 127) return true;
	}

	return false;
}
