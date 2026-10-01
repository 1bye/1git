import { HostingProvider } from "../../provider.js";
import type { HostingAdapter, ProviderOAuthAdapter } from "../../provider.js";
import type { Capabilities } from "../../contracts.js";
import type { Transport } from "../../transport.js";
import { GitHubAdapter } from "./adapter.js";
import { GitHubOAuthAdapter } from "./oauth.js";

/** Configured GitHub/GitHub Enterprise account. Construct separate instances for distinct credentials. */
export class GitHubProvider extends HostingProvider {
	readonly id = "github";
	readonly defaultWebUrl = "https://github.com";
	readonly capabilities: Capabilities = Object.freeze({
		pullRequestDrafts: true,
		repositoryVisibilities: Object.freeze(["public", "private"] as const),
		oauthPkce: true,
		oauthClientSecretRequired: true,
		oauthRefresh: "when-issued",
		oauthRevocation: true,
	});

	apiUrl(web: URL): URL {
		return web.href === "https://github.com/"
			? new URL("https://api.github.com/")
			: new URL("api/v3/", web);
	}

	createAdapter(http: Transport): HostingAdapter {
		return new GitHubAdapter(http);
	}

	createOAuthAdapter(http: Transport): ProviderOAuthAdapter {
		return new GitHubOAuthAdapter(http);
	}

	apiHeaders(): Readonly<Record<string, string>> {
		return { "X-GitHub-Api-Version": "2022-11-28" };
	}
}
