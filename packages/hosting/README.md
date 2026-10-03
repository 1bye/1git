# @1git/hosting

GitHub and GitLab hosting APIs for 1git, independent of local Git and of either desktop app.

This package answers “which repositories can I access?”, “where can I create a repository?” and “how do I open a pull/merge request?”. It **does not** clone, push, run Git, change remotes, launch browsers, store accounts, or access the Keychain. GPUIX consumes account/OAuth APIs; application-owned browser and vault integration stays outside this package.

## Setup

Internal ESM workspace package; not published to npm. Add `"@1git/hosting": "workspace:*"` to a future consumer, then run `bun install`. Build before importing compiled exports:

```sh
bun run --cwd packages/hosting build
```

Runtime: Bun 1.3+ or Node.js 22+ with standard `fetch`, Web Streams and AbortSignal support. No runtime dependencies. Node crypto provides secure random state, PKCE and client-bound cursors. Use in a privileged desktop process, not an untrusted renderer. Emulate is a **development-only**, pinned dependency.

Public entry points:

| Import | API |
| --- | --- |
| `@1git/hosting` | `HostingClient` |
| `@1git/hosting/contracts` | Result, error, `AccessToken`, account, owner, repository, pagination and PR/MR types |
| `@1git/hosting/oauth` | `HostingOAuth`, `Authorization`, `OAuthTokens` |
| `@1git/hosting/device-oauth` | `HostingDeviceOAuth`, `DeviceAuthorization`, `DevicePoll` |
| `@1git/hosting/remote` | `parseRemote`, `RemoteIdentity` |
| `@1git/hosting/provider` | `HostingProvider`, `ProviderOptions`, `HostingAdapter`, OAuth extension contracts, `ProviderFailure` |
| `@1git/hosting/transport` | `Transport`, `Endpoints`, `Reply` for provider authors |
| `@1git/hosting/providers/github` | `GitHubProvider` |
| `@1git/hosting/providers/gitlab` | `GitLabProvider` |

Concrete REST/OAuth adapters are internal to their provider folders. Application-facing operations, including client creation and remote parsing, use the same Result shape as `@1git/git`. Provider constructors snapshot setup without I/O and throw a safe `ProviderFailure` for malformed configuration shapes; clients validate endpoints/credentials before use. Provider extension methods return values or throw; the client converts them to Results:

```ts
type HostingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: HostingError };
```

## Client API

```ts
import { HostingClient } from "@1git/hosting";
import { GitHubProvider } from "@1git/hosting/providers/github";

const provider = new GitHubProvider({ // or new GitLabProvider(...)
  accessToken: async ({ signal }) => credentialStore.read(accountKey, signal),
});
const configured = HostingClient.create(provider);
if (!configured.ok) return showError(configured.error);

const client = configured.value;
const result = await client.listRepositories({ pageSize: 50 });
if (result.ok) showRepositories(result.value.items);
else showError(result.error);
```

`credentialStore`, `accountKey`, `showError` and `showRepositories` above are application-owned dependencies. Fully runnable, type-checked examples are in `examples/workflows.ts` below.

Providers are configured class instances, not string selectors. Their constructors own URLs, HTTP settings, access tokens/lookups and OAuth registration. `HostingClient.create(provider)` takes no configuration object. Switch hosts/accounts by constructing the appropriate provider and a new client. Do not mutate provider options or reuse cursors with another client. `client.provider.id` is a stable string for account metadata only; it does not select an implementation.

| Method | Purpose |
| --- | --- |
| `getAccount(options?)` | Verify credential and get the authenticated identity |
| `listOwners(page?)` | Candidate personal and organization/group destinations |
| `listRepositories(page?)` | Account-member/collaborator repositories |
| `searchRepositories(query, page?)` | Provider search, including accessible public repositories |
| `getRepository(ref, options?)` | Retrieve repository details and clone URLs |
| `createRepository(input, options?)` | Create a hosted repository only |
| `listPullRequests(ref, filter?)` | List GitHub PRs or GitLab MRs |
| `getPullRequest(ref, number, options?)` | Get a repository-local PR/MR number |
| `createPullRequest(input, options?)` | Open a PR/MR for already-pushed branches |

Repository refs are `{ owner, name }`. GitLab supports nested owners such as `team/subgroup`. GitHub uses a single user/organization login. `sourceRepository` on PR creation supports forks; `repository` always identifies the target. Titles and branch names are explicit; creation does not push branches or perform any Git operation.

### Provider differences and permissions

| Concern | GitHub | GitLab |
| --- | --- | --- |
| Default REST endpoint | `https://api.github.com/` | `https://gitlab.com/api/v4/` |
| Owners | Current user, then `/user/orgs` | `/namespaces` (user and groups) |
| Creation visibility | Public/private | Public/private/internal, subject to instance policy |
| Draft request | Native `draft` field | `Draft:` title prefix; returned draft flag is authoritative |
| Search | GitHub query syntax; subject to its search result cap | GitLab project text search |
| PR/MR identifier | Repository-local number | Project-local IID, not global ID |
| Fork creation | Qualified head plus head repository | Source project endpoint plus target project ID |

GitHub can return existing internal repositories even though this adapter does not create them. GitHub merged/closed filters are applied to provider closed pages; a filtered page may be empty with a non-null `next`. Do not stop until `next` is null. Incomplete GitHub search responses are explicit failures; narrow the query.

`client.capabilities` describes the adapter, **not account authorization**. Repository `permissions` describe provider-reported access and can be `null` when omitted. GitLab maps standard access levels to read/push/admin (20/30/40); branch protection, custom roles and policy may impose further restrictions. These fields are UI hints, never an authorization check.

Owner `canCreateRepository` is currently `null`: membership/namespace visibility does not prove the organization allows repository creation. `listOwners` returns candidates; the server decides whether a create succeeds. GitHub's first owner page also includes the current user, so it can contain `pageSize + 1` items. GitLab owner IDs are **namespace IDs**, not user IDs.

## Accounts, hosts and credentials

Create a separate configured provider for each account, then create its client. There is no global account, shared response cache, environment lookup or implicit `gh`/Git credential lookup. A credential callback supplied to the provider runs for each authenticated REST request with a deadline/cancellation signal. The application owns storage, refresh, locking and removal; a static token is also accepted for explicitly supplied PATs/OAuth tokens.

Use `(client.provider.id, canonical webUrl, account.id)` as an account key. Verify `getAccount()` after authorization/rotation before attaching credentials to an existing saved account. Multiple clients can reuse one configured provider for the **same account**; each gets a fresh adapter, transport and cursor key. Distinct account credentials require distinct provider instances. Provider options and OAuth scopes are immutable snapshots; changing the original options object does not reconfigure a provider. Use a credential callback for rotation instead of mutating setup.

Configuration is held in private runtime fields, so ordinary JSON serialization of a provider/client/OAuth client excludes it. `provider.options` deliberately exposes the sensitive snapshot to trusted clients/adapters: **never log, serialize or persist that getter's value**. Constructors keep no request/response state, and the package does not persist supplied credentials. If changing a provider implementation, never add enumerable token or secret fields.

For enterprise/self-managed hosts:

```ts
import { GitLabProvider } from "@1git/hosting/providers/gitlab";

const provider = new GitLabProvider({
  webUrl: "https://code.example.com/gitlab/",
  // Defaults to webUrl + api/v4/ for GitLab, or api/v3/ for enterprise GitHub.
  apiUrl: "https://code.example.com/gitlab/api/v4/",
  sshHost: "ssh.code.example.com", // only if the SSH host differs
  accessToken,
});
const configured = HostingClient.create(provider);
```

Endpoints must be credential-free HTTPS URLs without query/fragment. Returned browser/HTTPS clone URLs must remain under the configured web endpoint. SSH clone URLs must use `git` and the configured web/SSH hostname. Explicit loopback HTTP is available only with `allowLoopbackHttp: true` for fixtures. OAuth browser/token endpoints derive from `webUrl`; REST derives from `apiUrl`.

An injected `fetch` is a **trusted platform boundary**, responsible for respecting `redirect: "manual"` and the signal. It must not log authorization headers/bodies. The package rejects redirects instead of forwarding credentials. Pagination links cannot change host, path or filters; cursors are authenticated and client-bound. Transport errors deliberately omit raw provider bodies, URLs, causes and token values.

## OAuth lifecycle

```ts
import { HostingOAuth } from "@1git/hosting/oauth";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";

const provider = new GitLabProvider({
  oauth: {
    clientId: registeredApplicationId,
    redirectUri: "http://127.0.0.1:8765/callback",
    scopes: ["api"],
  },
});
const configured = HostingOAuth.create(provider);
if (!configured.ok) return showError(configured.error);

const oauth = configured.value;
const started = oauth.beginAuthorization();
if (!started.ok) return showError(started.error);

await openSystemBrowser(started.value.authorizationUrl);
const callbackUrl = await receiveRegisteredCallback();
const exchanged = await oauth.exchangeCode(started.value, callbackUrl);
if (!exchanged.ok) return showError(exchanged.error);
// Construct a provider with exchanged.value.accessToken, verify getAccount, then securely store the token pair.
```

The application registers OAuth, opens the system browser, binds/validates its callback listener, and stores tokens in Keychain or an equivalent credential store. This package handles random state, S256 PKCE, callback URL/state matching and one-time exchange. Keep the same OAuth instance and returned `Authorization` object until the callback; attempts expire after ten minutes, cannot be serialized/restored and are consumed before token exchange. On failure, begin again. Discarding an attempt lets its private verifier be garbage-collected.

`HostingOAuth.create(provider)` requires `provider.options.oauth`, but not an access token. Conversely, REST client creation requires `accessToken`, but not OAuth registration. A provider may configure both. OAuth exchanges never automatically send its REST access token, retain returned tokens or change the provider's credential. Use a new provider with the returned token, or an application-owned rotating credential callback, when creating the authenticated client.

Callbacks support HTTPS or explicit loopback HTTP with no query/fragment; register the exact URL, including path and port. Custom application schemes are not implemented. Do not claim callback URLs from unrelated tabs/processes without matching them to the pending attempt. Device authorization has its separate public-client lifecycle below.

- **GitLab:** register a public/non-confidential OAuth application for secretless PKCE. `api` covers repository/MR writes; choose narrower registered scopes for read-only use. Confidential registrations can supply `clientSecret`. Revocation sends that secret when configured; instance/registration rules remain authoritative.
- **GitHub:** register an OAuth application, scopes such as `repo` for private repository/PR access and `read:org` for organizations. The code-flow adapter uses PKCE but requires the registration secret for exchange, code-flow refresh and revocation. **Do not embed that secret in a desktop build.** Public clients can enable device flow and use `HostingDeviceOAuth` below. A GitHub App's installation flow is not implemented.

Refresh is `oauth.refresh(refreshToken, options?)`, **only when the provider issued a refresh token**. Tokens without expiry/refresh normalize to null. Persist the returned pair atomically: refresh rotation can invalidate the previous pair. Serialize concurrent refreshes in the application; never retry a possibly-completed exchange automatically. `oauth.revoke(accessToken, options?)` revokes this OAuth token, not an arbitrary PAT or every application grant. Local credential deletion remains the caller's responsibility.

`OAuthTokens` is intentionally sensitive. Never write it to normal account/session JSON, logs or error reports. The package does not retain tokens from exchanges. Scopes can be null when the provider omits them; do not infer additional grants.

### Public-client device OAuth

```ts
import { HostingDeviceOAuth } from "@1git/hosting/device-oauth";

const configured = HostingDeviceOAuth.create(new GitHubProvider({
  deviceOAuth: { clientId: publicClientId, scopes: ["read:user"] },
}));
if (!configured.ok) throw new Error(configured.error.message);
const oauth = configured.value;
const started = await oauth.beginAuthorization({ signal });
if (!started.ok) throw new Error(started.error.message);
const attempt = started.value;
// Display userCode and open verificationUrl in the system browser.
const reply = await oauth.poll(attempt, { signal });
// pending: wait retryAfterMs with cancellation before polling again.
// authorized: verify identity and persist reply.value.tokens securely.
// Call oauth.cancel(attempt) on cancellation/failure.
```

Sensitive device codes are private and tied to one lifecycle/attempt. Early polls
return `pending` without HTTP; `slow_down` adds five seconds to subsequent intervals.
Expired, cancelled, denied, cross-client and consumed attempts cannot yield tokens.
Verification URLs are bound to the configured host. Device requests never attach a
REST token or client secret. `refresh(token, options?)` handles refresh tokens issued
by device flow without a secret. The caller owns browser/waiting, cancellation,
secure storage and refresh serialization; no exchange is automatically retried.
GitHub registration must enable device flow; Enterprise support depends on version.

Third providers can override `createDeviceOAuthAdapter(http)` using the public
`ProviderDeviceOAuthAdapter` contract. Their public registration belongs in the
provider constructor's `deviceOAuth` option, not a central string dispatch.

## Pagination, cancellation and errors

Every list returns `{ items, next, rateLimit }`. Pass `next` as `cursor` on **the same client, operation, page size and filters**. Tokens do not survive client recreation. Page size is 1–100 (default 50). The caller decides how many pages to load; no method drains a whole account automatically.

```ts
const controller = new AbortController();
const first = await client.listRepositories({ signal: controller.signal });
if (first.ok && first.value.next) {
  const second = await client.listRepositories({ cursor: first.value.next, signal: controller.signal });
}
// controller.abort() cancels future/in-flight work using that signal.
```

Requests default to a 15-second deadline and a 4 MiB response ceiling. Configure `timeoutMs` (1–120000) and `maxResponseBytes` (up to 32 MiB) in the provider constructor. The deadline covers credential acquisition, HTTP and response reads. A multi-request operation (e.g. fork MR creation) has a deadline **per request**; use a caller signal for an overall deadline.

Failures include `code`, `operation`, `message`, `retryable`, and when available `status` and `rateLimit`. Codes: authentication, permission, validation, not-found, rate-limit, network, cancelled, timeout, unsupported, invalid-response. Rate metadata includes remaining/limit, Unix-millisecond reset time and retry-after seconds. Unknown metadata is omitted.

There are **no automatic retries**, including reads. Write failures are never advertised as automatically retryable. A timeout/cancel/disconnection does not prove a create failed: check the provider before retrying, or a duplicate repository/PR could result. Invalid JSON, missing/wrong response fields and unsafe URLs fail closed. Response normalization drops unrelated fields rather than exposing raw provider payloads.

## Remote identification

```ts
import { parseRemote } from "@1git/hosting/remote";
import { GitLabProvider } from "@1git/hosting/providers/gitlab";

parseRemote("git@github.com:owner/repository.git");
parseRemote("https://gitlab.com/group/subgroup/repository.git");
parseRemote("git@ssh.example:team/repository.git", [
  new GitLabProvider({ webUrl: "https://code.example", sshHost: "ssh.example" }),
]);
```

Supports HTTPS, `ssh://git@host/path`, and SCP-style `git@host:path`. Rejects credential-bearing HTTPS URLs, query strings, fragments and unsupported transports. Unknown hosts need an explicitly configured provider; parsing reads its `webUrl`/`sshHost` options and needs no credentials. `webUrl` defaults to the provider's `defaultWebUrl`. Results contain serializable `providerId` metadata rather than a provider instance. Parsing is identity detection, not proof of repository existence/access. SSH host aliases must be mapped explicitly; SSH configuration is never read.

## Adding a provider

Add a folder, implement the base class and export its definition from `package.json`. No client/OAuth dispatch switch or global registration is needed:

```text
src/providers/
  github/   provider.ts · adapter.ts · oauth.ts
  gitlab/   provider.ts · adapter.ts · oauth.ts
  yourhost/ provider.ts · adapter.ts · oauth.ts (optional)
```

```ts
import { HostingProvider } from "@1git/hosting/provider";
import type { HostingAdapter } from "@1git/hosting/provider";
import type { Capabilities } from "@1git/hosting/contracts";
import type { Transport } from "@1git/hosting/transport";
import { YourHostAdapter } from "./adapter.js";

export class YourHostProvider extends HostingProvider {
  readonly id = "yourhost";
  readonly defaultWebUrl = "https://code.example";
  readonly capabilities: Capabilities = Object.freeze({
    pullRequestDrafts: false,
    repositoryVisibilities: Object.freeze(["public", "private"] as const),
    oauthPkce: false,
    oauthClientSecretRequired: false,
    oauthRefresh: "unsupported",
    oauthRevocation: false,
  });

  apiUrl(web: URL): URL { return new URL("api/v1/", web); }
  createAdapter(http: Transport): HostingAdapter { return new YourHostAdapter(http); }
}
```

`YourHostAdapter` above is the contributor's implementation, not a shipped provider. It implements `HostingAdapter`: account, owners, repository listing/search/detail/creation and review-request listing/detail/creation. Normalize into `contracts` types and validate all external data before returning it. Implement only supported behavior; throw `new ProviderFailure({ code: "unsupported", message: "Safe explanation.", retryable: false })` for unsupported operations. These details are returned to callers verbatim: never include tokens, raw bodies, URLs containing secrets or original exception messages. Unexpected exceptions are redacted by the client.

The base constructor already accepts and snapshots `ProviderOptions`, so this subclass needs no configuration plumbing. Usage is `HostingClient.create(new YourHostProvider({ accessToken, webUrl, fetch }))`. If custom stable dependencies require a constructor, accept the appropriate options and call `super(options)`; do not bypass the private snapshot or expose secrets as public fields.

Use the supplied `Transport` for requests: it binds credentials per client and enforces endpoint boundaries, redirects, deadlines and response limits. `request()` returns untrusted `Reply.data` plus headers/rate metadata; `page()` handles `per_page`/`page` pagination with Link or X-Next-Page continuations. A host with another pagination protocol needs its own bounded pagination handling. `apiHeaders()` adds non-credential REST headers; it cannot replace Authorization. Provider code is trusted executable code, not a sandboxed plugin.

Optional hooks:

- `createOAuthAdapter(http)` returns a per-instance `ProviderOAuthAdapter`. It constructs authorization URLs, exchanges code/refresh grants and revokes tokens using provider-specific endpoints. Return the standard OAuth response fields as `unknown` from exchange; shared code validates/normalizes tokens and owns state, S256 PKCE and replay protection. The default is `null` (explicit access tokens only). Advertise `oauthPkce` only when this flow is genuinely supported; refresh/revocation capability checks fail before dispatch.
- `parseRepositoryPath(path)` interprets a decoded remote path. The default validates a single owner/repository pair; override for nested namespaces, preserving path validation. Register hosts by passing provider instances to `parseRemote`; no default-map edit is necessary for custom hosts.
- `apiHeaders()` supplies REST version/accept headers, applied only under the configured API root, not automatically to separate OAuth endpoints.

Keep configured providers immutable and scoped to one account. Let the base class own sensitive setup in private fields; never store transport, request/response data or cursors on the provider. `createAdapter`/`createOAuthAdapter` must create fresh instances or closures. Use a unique stable `id` for persisted account identity. Add captured-wire, failure-boundary and compiled consumer tests for the new provider. `tests/consumer/provider-extension.component.test.ts` proves third providers use only public exports, including OAuth/custom remotes and isolated account instances.

Migration from earlier APIs: move every host/HTTP/token setting into `new GitHubProvider(options)` or `new GitLabProvider(options)`, then call `HostingClient.create(provider)`. Move OAuth registration into the constructor's `oauth` object and call `HostingOAuth.create(provider)`. Pass configured providers directly to `parseRemote` instead of separate mapping objects. Read `client.provider.id` and remote `providerId` for metadata. Electron integration remains separate.

## Runnable examples

`examples/workflows.ts` imports only public exports and compiles in `check-types`. Supply credentials explicitly in your shell environment (prefer a secure shell/credential helper; don't put tokens in command-line arguments). **These examples contact the chosen real host and create data when requested. They are not tests.** Use an authorized sandbox account/repository.

```sh
# Set HOSTING_PROVIDER=github or gitlab and HOSTING_TOKEN securely first.
# Optional: HOSTING_WEB_URL / HOSTING_API_URL for a self-managed host.
bun packages/hosting/examples/workflows.ts list
bun packages/hosting/examples/workflows.ts create my-owner sandbox-repository
bun packages/hosting/examples/workflows.ts pr my-owner sandbox-repository feature main "Example change"
```

Creation uses private visibility and leaves the repository empty. PR/MR creation uses draft mode and assumes both branches already exist on the provider.

### Composing with @1git/git later

The application would list hosted repositories, choose `cloneUrls.https` or `.ssh`, then ask `@1git/git` to clone. For publishing: create the hosted repository here, ask the Git package to add the remote/push, then optionally create a PR/MR here. Git transport authentication is separate from REST authentication and must use an appropriate credential helper/SSH configuration, **never a token embedded into a clone URL**. Failure recovery and partial-success UI belong to the application.

## Verification and emulator

```sh
bun install
bun run --cwd packages/hosting build
bun run --cwd packages/hosting check-types
bun run --cwd packages/hosting test
bun run --cwd packages/hosting test:integration
bun x oxlint packages/hosting
bun x oxfmt --check packages/hosting
# Or let Turbo build prerequisites for the consumer-import tests:
bun x turbo run build check-types test --filter=@1git/hosting
```

Default tests are offline units/components plus compiled consumer-import checks. Integration tests are separate and uncached. They start ephemeral loopback servers, close them in `finally`, and use only fake users/tokens/repos. No personal repositories, real credentials or internet are required after dependency installation. Sandboxed environments may need permission to bind loopback ports.

`tests/integration/emulate.integration.test.ts` starts **Emulate 0.12.0** programmatically with explicit users, org membership, repositories, token mappings and an OAuth registration. It exercises account/owner discovery, list/search/create/get repos, draft PR list/get/create and authorization-code exchange. Its configured canonical GitHub base URL is routed to the loopback server by injected fetch, without changing responses or weakening production URL checks. This also avoids Emulate's malformed SCP clone URLs when its base URL includes a local port.

Coverage limits found by inspecting the pinned published implementation:

- Unknown bearer tokens fall back to a seeded user. Explicit token configuration does **not** make Emulate an authentication-security oracle.
- OAuth uses client-secret checking but does not validate PKCE; it does not implement this package's refresh/revocation flow.
- No GitLab service, real Git smart-HTTP/SSH transport, production SSO enforcement or real provider rate limiting is verified.
- Search, policy/permissions, branch/fork rules and API fidelity are not guaranteed identical to the live services.

Strict captured-response tests cover those security/failure boundaries. A separate local HTTP GitLab fixture validates PKCE and rotates/revokes tokens while exercising repository/MR operations. These are **emulated/fixture tests, not live-provider verification**. No live-account suite runs implicitly. Before release, explicitly authorized sandbox smoke tests should cover the chosen OAuth registrations, enterprise versions, organization policies and real fork/PR behavior.

Reference contracts: [GitHub repositories](https://docs.github.com/en/rest/repos/repos), [GitHub pull requests](https://docs.github.com/en/rest/pulls/pulls), [GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [GitHub token revocation](https://docs.github.com/en/rest/apps/oauth-applications), [GitLab projects](https://docs.gitlab.com/api/projects/), [GitLab merge requests](https://docs.gitlab.com/api/merge_requests/), [GitLab OAuth](https://docs.gitlab.com/api/oauth2/), [Emulate](https://github.com/vercel-labs/emulate).
