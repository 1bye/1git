# Release downloads infrastructure

This private workspace owns an **Alchemy-managed private R2 bucket** and a
read-only downloads Worker. The pinned SDK is `alchemy@2.0.0-beta.83` with
`effect@4.0.4` and its platform adapters; none are shipped in the desktop app.
Deploying this stack is separate from publishing a macOS release or deploying a
future website.

The Worker serves only `GET`/`HEAD` for `/appcast.xml` and numeric-versioned
`/1git-<version>-macos-arm64.zip` objects. It streams the stored bytes unchanged,
does not expose bucket listing or arbitrary keys, and has no upload endpoints or
publisher credentials. Feeds and error responses use `Cache-Control: no-store`;
ZIPs use a year-long immutable cache policy. Downloads do not require a user's
GitHub, AI, or Cloudflare account. The GitHub repository stays private.

## One-time setup — do not run until deployment is approved

1. Authenticate Alchemy with the intended Cloudflare account. Use permissions
   for R2 buckets and Workers, following the pinned SDK's Cloudflare setup guide.
   Publishing uses that same profile's R2 read/write permissions directly.
   **Account API Tokens Write / token provisioning is not required.**
2. From the repository root, explicitly provision the production stack:

   ```sh
   bun run deploy:updates -- --stage prod
   ```

3. The stack saves `accountId`, `bucketName`, `jurisdiction` and `workerURL`.
   `release:macos` reads these outputs; no copying endpoint/account/bucket values
   or configuring separate S3 keys is required. The stable `workers.dev` URL is
   usable without buying a domain; the feed is `workerURL` + `/appcast.xml`.
4. Back up the ignored `apps/releases/.alchemy/state/` directory securely. This
   stack uses Alchemy's local state, so deployment does not provision an extra
   remote state service. Use the same state and stage for later infrastructure
   changes. Do not delete state or rename resource IDs casually.

The bucket is retained on stack removal and `forceDestroy` is disabled. There
are no expiry rules deleting release objects. A future website should use its
own stack/resources, not replace this downloads endpoint. Keep the endpoint
stable: it is embedded in installed apps.

No deployment occurs during install, type checking, build, test, macOS packaging,
release preparation, or `release:macos --dry-run`.

## Build and publish a release

See the [desktop release configuration](../gpuix/.env.release.example).
Generate/back up a permanent Sparkle key with
`apps/gpuix/.cache/sparkle/bin/generate_keys --account dev.1git.gpuix` after the
first packaging run. `release:macos` automatically reads its existing public key
from Keychain account `dev.1git.gpuix` using read-only `generate_keys -p`; no export
is needed. It never creates or rotates a key. If the key is missing or access is
denied, it stops with setup instructions. Only the public key goes into the app;
the private key stays in Keychain or an explicitly supplied secure CI key file.

With the existing Keychain key and `personal` Alchemy profile, no environment setup
is needed. Optional overrides can be exported from ignored
`apps/gpuix/.env.release.local`:

```sh
set -a
source apps/gpuix/.env.release.local
set +a

# Safe local build/signing: no R2 or public endpoint requests.
bun run release:macos -- --version 0.0.2 --dry-run

# Publishes to the existing bucket; does not deploy infrastructure.
bun run release:macos -- --version 0.0.2

# Optional selection; defaults are stage prod and your personal Alchemy profile.
bun run release:macos -- --version 0.0.2 --stage prod --profile personal
```

The explicit version changes the app's bundle version and artifact filename,
not the development `package.json` version. Packaging without the release
override keeps its existing defaults. `--profile` overrides `ALCHEMY_PROFILE`.
If neither `--profile` nor `ALCHEMY_PROFILE` is set, publishing uses `personal`.
An exported `ONEGIT_UPDATE_PUBLIC_KEY` takes precedence over Keychain. With
`ONEGIT_UPDATE_KEY_FILE`, that public key is required explicitly so a CI/file key
cannot accidentally inherit an unrelated Keychain identity. Plain `package:macos`
keeps its existing explicit configuration; only `release:macos` has the fallback.
Account/bucket/feed values come only from saved outputs for the selected stage;
missing outputs fail without deploying. The profile's account must match the
saved stack account before any object requests are made. Environment
Cloudflare tokens are not used as a silent replacement for your selected profile.

Dry-run reads local stack outputs but does not load profiles or make Cloudflare,
R2, or public-download requests. Real publishing authenticates through Alchemy's
normal profile reader, including OAuth refresh, and calls Cloudflare's R2 object
HTTP API with those existing credentials. It never creates or revokes API tokens,
derives S3 keys, or requires a second profile. The authenticated transport is
restricted to the saved bucket and release/probe keys. No profile secret is
passed to app builds or added to the read-only Worker. Standard Alchemy OAuth
refresh may persist refreshed credentials through Alchemy's normal profile store.

The installed HTTP upload helper does not expose conditional writes, and the
REST documentation does not guarantee their behavior. Before touching any ZIP
or feed, a real publish therefore checks create-once, current-ETag replacement
and stale-ETag rejection on one unique `release-checks/<uuid>.txt` object. It
checks the resulting bytes/ETag and deletes only that probe object afterward.
If the API ignores conditional headers, publishing stops with an explicit error;
there is no unsafe overwrite fallback or automatic token-provisioning fallback.
Probe cleanup failures print the exact non-secret key for manual cleanup. The
downloads Worker cannot serve these probe keys. Dry-run performs none of this.

The command uses the existing Turbo prerequisite graph, builds/ad-hoc signs the
app, takes an isolated signed-bundle snapshot, and creates a signed app-only ZIP
and signed feed in a unique `apps/gpuix/build/updates/<version>-<run>/` directory.
Release runs never share mutable artifact paths. Publishing then:

1. Reads the previous feed and rejects an equal/older numeric version.
2. Verifies the HTTP API's conditional-write behavior on an isolated probe.
3. Creates the ZIP with `If-None-Match: *`, refusing to overwrite any version.
4. Downloads the public ZIP and checks its byte count and SHA-256 against the
   signed local artifact. Failure leaves the old feed unchanged.
5. Uploads the **exact signed feed bytes last**, using the previous ETag as an
   `If-Match` precondition (or `If-None-Match: *` for the first feed).
6. Verifies the public feed bytes. A failure at this point reports that the feed
   was already uploaded; inspect the endpoint before retrying.

Concurrent releases cannot silently overwrite a feed changed since preflight.
If ZIP upload succeeds but verification/feed publication fails, the immutable
ZIP is retained rather than deleted. Do not rebuild/overwrite that same version;
inspect the failed release and use a new version if necessary. Publication never
stages/commits files, pushes Git, or changes repository visibility.

Existing builds without a configured feed/public key need one manual install
of the first configured release. Thereafter Sparkle detects it on scheduled or
manual checks. Automatic download/install-on-quit remains the user's opt-in.
Ad-hoc signing still requires the initial Gatekeeper exception; these publishing
commands do not provide Developer ID signing or notarization.

## Local verification

```sh
bun run --cwd apps/releases check-types
bun run --cwd apps/releases test
bun run test:release:transport
bun run test:release:macos
```

Worker/component tests use in-memory R2 doubles and isolated Alchemy profiles/
state, with intercepted Cloudflare requests. The transport suite uses real
Bun HTTP against loopback with synthetic authentication, not live Cloudflare,
including two simultaneous publishers and APIs that ignore conditional writes.
The macOS suite runs the complete root dry-run with disposable signing keys and
restores existing generated build outputs afterward. Live Alchemy deployment,
Cloudflare credentials/permissions, and R2 acceptance require a separately
approved smoke test before distributing the first configured release.
