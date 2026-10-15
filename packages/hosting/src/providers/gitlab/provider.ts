import { HostingProvider } from "../../provider.js";
import type { HostingAdapter, ProviderOAuthAdapter } from "../../provider.js";
import type {
	Capabilities,
	CallOptions,
	RepositoryRef,
} from "../../contracts.js";
import type { Transport } from "../../transport.js";
import { repositoryPath } from "../../adapter.js";
import { fail } from "../../result.js";
import { GitLabAdapter } from "./adapter.js";
import { GitLabOAuthAdapter } from "./oauth.js";

// A supported GitLab scaler size with spare detail for the app's 64 px output.
const avatarThumbnailPixels = 200;

/** Configured GitLab.com/self-managed account with nested group namespaces. */
export class GitLabProvider extends HostingProvider {
	readonly id = "gitlab";
	readonly defaultWebUrl = "https://gitlab.com";
	readonly capabilities: Capabilities = Object.freeze({
		pullRequestDrafts: true,
		repositoryVisibilities: Object.freeze([
			"public",
			"private",
			"internal",
		] as const),
		oauthPkce: true,
		oauthClientSecretRequired: false,
		oauthRefresh: "when-issued",
		oauthRevocation: true,
	});

	apiUrl(web: URL): URL {
		return new URL("api/v4/", web);
	}

	createAdapter(http: Transport): HostingAdapter {
		return new GitLabAdapter(http);
	}

	createOAuthAdapter(http: Transport): ProviderOAuthAdapter {
		return new GitLabOAuthAdapter(http);
	}

	avatarThumbnailUrl(value: unknown): string | null {
		const validated = this.avatarUrl(value);

		if (!validated) return null;

		const url = new URL(validated);

		url.searchParams.set("width", String(avatarThumbnailPixels));

		return url.href;
	}

	async repositoryAvatar(
		http: Transport,
		ref: RepositoryRef,
		options: CallOptions
	): Promise<string | null> {
		return (
			(await this.createAdapter(http).repository(ref, options)).avatarUrl ??
			null
		);
	}

	parseRepositoryPath(path: string): RepositoryRef {
		const parts = path.split("/");
		const name = parts.pop();

		if (!name || !parts.length)
			fail("validation", "Remote does not identify a repository.");

		const ref = { owner: parts.join("/"), name };

		repositoryPath(ref, true);

		return ref;
	}
}
