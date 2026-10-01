import type { CallOptions } from "../../contracts.js";
import type {
	OAuthApplication,
	OAuthGrant,
	ProviderOAuthAdapter,
} from "../../provider.js";
import { fail } from "../../result.js";
import type { Transport } from "../../transport.js";

export class GitHubOAuthAdapter implements ProviderOAuthAdapter {
	constructor(private readonly http: Transport) {}

	authorizationUrl(parameters: Readonly<Record<string, string>>): URL {
		const url = new URL("login/oauth/authorize", this.http.endpoints.web);

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
			client_secret: this.secret(application),
			redirect_uri: application.redirectUri,
			...grant,
		});

		const reply = await this.http.request(
			new URL("login/oauth/access_token", this.http.endpoints.web),
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
		const basic = Buffer.from(
			`${application.clientId}:${this.secret(application)}`
		).toString("base64");

		await this.http.request(
			this.http.url(
				`applications/${encodeURIComponent(application.clientId)}/token`
			),
			"DELETE",
			options,
			{ access_token: accessToken },
			`Basic ${basic}`
		);
	}

	private secret(application: OAuthApplication): string {
		if (!application.clientSecret)
			fail(
				"unsupported",
				"This GitHub OAuth operation requires the registered application's client secret; use a trusted exchange service for distributed clients."
			);

		return application.clientSecret;
	}
}
