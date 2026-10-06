/** A successful hosting value or a safe, serializable failure, matching @1git/git. */
export type HostingResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: HostingError };

/** Machine-readable failures. No raw response bodies or credential-bearing causes are exposed. */
export type HostingErrorCode =
	| "authentication"
	| "permission"
	| "validation"
	| "not-found"
	| "rate-limit"
	| "network"
	| "cancelled"
	| "timeout"
	| "unsupported"
	| "invalid-response";

/** Safe details for a caller to display or use when deciding whether to retry. */
export interface HostingError {
	readonly code: HostingErrorCode;
	readonly operation: string;
	readonly message: string;
	readonly retryable: boolean;
	readonly status?: number;
	readonly rateLimit?: RateLimit;
}

/** Provider-reported rate information; times are Unix milliseconds, delays are seconds. */
export interface RateLimit {
	readonly limit?: number;
	readonly remaining?: number;
	readonly resetAt?: number;
	readonly retryAfterSeconds?: number;
}

/** Per-call cancellation; requests also have a configured deadline. */
export interface CallOptions {
	readonly signal?: AbortSignal;
}

/** Explicit HTTP dependency, useful for platform bridges and isolated tests. */
export type HostingFetch = (
	url: string | URL,
	init?: RequestInit
) => Promise<Response>;

/** Explicit account credential or per-request lookup. The caller owns secure storage and refresh. */
export type AccessToken =
	| string
	| ((options: CallOptions) => string | Promise<string>);

/** Provider feature support, not a statement about a user's permissions. */
export interface Capabilities {
	readonly pullRequestDrafts: boolean;
	readonly repositoryVisibilities: readonly Visibility[];
	readonly oauthPkce: boolean;
	readonly oauthClientSecretRequired: boolean;
	readonly oauthRefresh: "when-issued" | "unsupported";
	readonly oauthRevocation: boolean;
}

/** GitLab internal visibility has no GitHub equivalent. */
export type Visibility = "public" | "private" | "internal";

/** Authenticated user identity; account keys should also include provider and webUrl. */
export interface Account {
	readonly id: string;
	readonly username: string;
	readonly name: string | null;
	readonly browserUrl: string;
}

/** Suggested Git author details, not authentication settings. An unavailable email stays null. */
export interface CommitIdentity {
	readonly id: string;
	readonly name: string | null;
	readonly email: string | null;
}

/** Candidate repository destination; membership alone does not guarantee creation permission. */
export interface Owner {
	readonly id: string;
	readonly path: string;
	readonly kind: "user" | "organization" | "group";
	readonly canCreateRepository: boolean | null;
}

/** Stable repository identity. GitLab paths may contain nested groups. */
export interface RepositoryRef {
	readonly owner: string;
	readonly name: string;
}

/** An API repository. Unknown permissions/default branches remain null rather than inferred. */
export interface Repository {
	/** Public, credential-free image URL, or null when the provider has no image. */
	readonly avatarUrl?: string | null;
	readonly id: string;
	readonly ref: RepositoryRef;
	readonly name: string;
	readonly description: string | null;
	readonly visibility: Visibility;
	readonly defaultBranch: string | null;
	readonly browserUrl: string;
	readonly cloneUrls: { readonly https: string; readonly ssh: string | null };
	readonly permissions: {
		readonly read: boolean | null;
		readonly push: boolean | null;
		readonly admin: boolean | null;
	};
}

/** A single bounded page. Pass next to the same operation with the same filters. */
export interface Page<T> {
	readonly items: readonly T[];
	readonly next: string | null;
	readonly rateLimit: RateLimit;
}

/** Opaque continuation tokens are client-bound and must not be constructed by applications. */
export interface PageOptions extends CallOptions {
	readonly cursor?: string;
	readonly pageSize?: number;
}

/** Create a remote repository only; no local Git writes or initial push are performed. */
export interface CreateRepository {
	readonly owner: Owner;
	readonly name: string;
	readonly visibility: Visibility;
	readonly description?: string;
	readonly initialize?: boolean;
}

/** Shared review-request state; provider-specific identifiers remain available. */
export type PullRequestState = "open" | "closed" | "merged";

/** Normalized GitHub pull request or GitLab merge request. */
export interface PullRequest {
	readonly id: string;
	readonly number: number;
	readonly title: string;
	readonly description: string | null;
	readonly state: PullRequestState;
	readonly draft: boolean;
	readonly sourceBranch: string;
	readonly targetBranch: string;
	readonly browserUrl: string;
}

/** List review requests for a target repository. */
export interface PullRequestFilter extends PageOptions {
	readonly state?: PullRequestState | "all";
}

/** Create a PR/MR. sourceRepository optionally identifies a fork; repository is the target. */
export interface CreatePullRequest {
	readonly repository: RepositoryRef;
	readonly sourceRepository?: RepositoryRef;
	readonly sourceBranch: string;
	readonly targetBranch: string;
	readonly title: string;
	readonly description?: string;
	readonly draft?: boolean;
}
