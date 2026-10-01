import type { Capabilities, RepositoryRef } from "./contracts.js";
import { repositoryPath } from "./adapter.js";
import { fail } from "./result.js";
import type { Transport } from "./transport.js";
import type { Adapter } from "./adapter.js";
import type { CallOptions } from "./contracts.js";

/** Throw only sanitized, user-safe details. The client attaches the operation and returns a Result. */
export { Failure as ProviderFailure } from "./result.js";

/** Normalized REST operations implemented by a provider's per-client adapter. */
export type HostingAdapter = Adapter;

/** Registration credentials supplied by the application for each OAuth operation. */
export interface OAuthApplication {
	readonly clientId: string;
	readonly clientSecret?: string;
	readonly redirectUri: string;
	readonly scopes: readonly string[];
}

/** Standard code/PKCE and refresh grants used by the shared OAuth lifecycle. */
export type OAuthGrant =
	| {
			readonly grant_type: "authorization_code";
			readonly code: string;
			readonly code_verifier: string;
	  }
	| { readonly grant_type: "refresh_token"; readonly refresh_token: string };

/** Provider OAuth wire behavior; shared code owns state, PKCE, replay prevention and token validation. */
export interface ProviderOAuthAdapter {
	authorizationUrl(parameters: Readonly<Record<string, string>>): URL;
	exchangeToken(
		grant: OAuthGrant,
		application: OAuthApplication,
		options: CallOptions
	): Promise<unknown>;
	revokeToken(
		accessToken: string,
		application: OAuthApplication,
		options: CallOptions
	): Promise<void>;
}

/** Extend this stateless definition to add a host. Adapters own each client's HTTP/account context. */
export abstract class HostingProvider {
	/** Stable metadata identifier for persisted accounts, e.g. github. Does not select an implementation. */
	abstract readonly id: string;
	abstract readonly defaultWebUrl: string;
	abstract readonly capabilities: Capabilities;

	/** Resolve the default REST root for a validated public or self-managed web endpoint. */
	abstract apiUrl(web: URL): URL;

	/** Construct a fresh REST adapter. Never retain transport or credentials on the provider itself. */
	abstract createAdapter(http: Transport): HostingAdapter;

	/** Return null for providers that support explicit tokens but not this authorization-code/PKCE flow. */
	createOAuthAdapter(_http: Transport): ProviderOAuthAdapter | null {
		return null;
	}

	/** Provider-specific API headers, applied only to requests under the configured REST endpoint. */
	apiHeaders(): Readonly<Record<string, string>> {
		return {};
	}

	/** Interpret a decoded owner/repository path. Override to support nested namespaces. */
	parseRepositoryPath(path: string): RepositoryRef {
		const parts = path.split("/");
		const name = parts.pop();

		if (!name || !parts.length)
			fail("validation", "Remote does not identify a repository.");

		const ref = { owner: parts.join("/"), name };

		repositoryPath(ref, false);

		return ref;
	}
}
