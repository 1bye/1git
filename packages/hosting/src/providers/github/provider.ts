import { HostingProvider } from "../../provider.js";
import type { HostingAdapter, ProviderOAuthAdapter } from "../../provider.js";
import type {
	Capabilities,
	CallOptions,
	RepositoryRef,
} from "../../contracts.js";
import { repositoryPath } from "../../adapter.js";
import { fail, record } from "../../result.js";
import type { Transport } from "../../transport.js";
import { GitHubAdapter } from "./adapter.js";
import { GitHubOAuthAdapter } from "./oauth.js";
import { GitHubDeviceOAuthAdapter } from "./device-oauth.js";
import type { ProviderDeviceOAuthAdapter } from "../../provider.js";

const avatarThumbnailPixels = 200;

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
	createDeviceOAuthAdapter(http: Transport): ProviderDeviceOAuthAdapter {
		return new GitHubDeviceOAuthAdapter(http);
	}

	apiHeaders(): Readonly<Record<string, string>> {
		return { "X-GitHub-Api-Version": "2022-11-28" };
	}

	avatarCacheKey(ref: RepositoryRef): string {
		return ref.owner.toLowerCase();
	}

	avatarThumbnailUrl(value: unknown): string | null {
		const validated = this.avatarUrl(value);

		if (!validated) return null;

		const url = new URL(validated);

		url.searchParams.set("s", String(avatarThumbnailPixels));

		return url.href;
	}

	protected avatarHosts(web: URL): readonly string[] {
		return web.origin === "https://github.com"
			? ["https://avatars.githubusercontent.com"]
			: [];
	}

	async repositoryAvatar(
		http: Transport,
		ref: RepositoryRef,
		options: CallOptions
	): Promise<string | null> {
		repositoryPath(ref, false);

		if (options.signal?.aborted)
			fail("cancelled", "Hosting operation cancelled.");

		// Public owner images do not need a REST request or its shared anonymous quota.
		if (http.endpoints.web.origin === "https://github.com")
			return this.avatarUrl(
				`https://avatars.githubusercontent.com/${encodeURIComponent(ref.owner)}`
			);

		const reply = await http.request(
			http.url(`users/${encodeURIComponent(ref.owner)}`),
			"GET",
			options
		);

		return this.avatarUrl(record(reply.data).avatar_url);
	}
}
