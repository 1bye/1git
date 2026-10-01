import type {
	AccessToken,
	Capabilities,
	HostingFetch,
	RepositoryRef,
} from "./contracts.js";
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

/** Immutable host/account setup passed to provider constructors. No environment or credential store is read implicitly. */
export interface ProviderOptions {
	readonly webUrl?: string;
	readonly apiUrl?: string;
	readonly sshHost?: string;
	readonly fetch?: HostingFetch;
	readonly timeoutMs?: number;
	readonly maxResponseBytes?: number;
	/** Test-only opt-in; plaintext HTTP remains restricted to literal loopback hosts. */
	readonly allowLoopbackHttp?: boolean;
	/** Omit while authorizing with OAuth; a REST client requires an explicit token or lookup. */
	readonly accessToken?: AccessToken;
	readonly oauth?: OAuthApplication;
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

/** Extend to add a host. Each configured instance owns one account's stable dependencies, never operation state. */
export abstract class HostingProvider {
	readonly #options: ProviderOptions;

	/** Snapshot setup without I/O; invalid configuration shapes throw a safe ProviderFailure. Clients validate endpoints/credentials. */
	constructor(options: ProviderOptions = {}) {
		if (!options || typeof options !== "object" || Array.isArray(options))
			fail("validation", "Invalid provider configuration.");

		if (options.oauth && !Array.isArray(options.oauth.scopes))
			fail("validation", "OAuth scopes must be an array.");

		this.#options = Object.freeze({
			...options,
			oauth: options.oauth
				? Object.freeze({
						...options.oauth,
						scopes: Object.freeze([...options.oauth.scopes]),
					})
				: undefined,
		});
	}

	/** Sensitive immutable setup for clients and provider adapters. Never log or serialize this value. */
	get options(): ProviderOptions {
		return this.#options;
	}

	/** Stable metadata identifier for persisted accounts, e.g. github. Does not select an implementation. */
	abstract readonly id: string;
	abstract readonly defaultWebUrl: string;
	abstract readonly capabilities: Capabilities;

	/** Resolve the default REST root for a validated public or self-managed web endpoint. */
	abstract apiUrl(web: URL): URL;

	/** Construct a fresh REST adapter. Never retain transport, responses or cursors on the provider. */
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
