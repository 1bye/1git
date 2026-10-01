import type { CallOptions } from "../../contracts.js";
import type {
	OAuthApplication,
	OAuthGrant,
	ProviderOAuthAdapter,
} from "../../provider.js";
import type { Transport } from "../../transport.js";

export class GitLabOAuthAdapter implements ProviderOAuthAdapter {
	constructor(private readonly http: Transport) {}

	authorizationUrl(parameters: Readonly<Record<string, string>>): URL {
		const url = new URL("oauth/authorize", this.http.endpoints.web);

		url.search = new URLSearchParams(parameters).toString();

		return url;
	}

	async exchangeToken(
		grant: OAuthGrant,
		application: OAuthApplication,
		options: CallOptions
	): Promise<unknown> {
		const body = new URLSearchParams({
			client_id: application.clientId,
			redirect_uri: application.redirectUri,
			...grant,
		});

		if (application.clientSecret)
			body.set("client_secret", application.clientSecret);

		const reply = await this.http.request(
			new URL("oauth/token", this.http.endpoints.web),
			"POST",
			options,
			body,
			undefined,
			true
		);

		return reply.data;
	}

	async revokeToken(
		accessToken: string,
		application: OAuthApplication,
		options: CallOptions
	): Promise<void> {
		const body = new URLSearchParams({
			client_id: application.clientId,
			token: accessToken,
		});

		if (application.clientSecret)
			body.set("client_secret", application.clientSecret);

		await this.http.request(
			new URL("oauth/revoke", this.http.endpoints.web),
			"POST",
			options,
			body,
			undefined,
			true
		);
	}
}
