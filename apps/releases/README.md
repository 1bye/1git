# Release downloads infrastructure

This workspace owns an **Alchemy-managed private R2 bucket** and a
read-only downloads Worker and a separate signature-authenticated publisher
Worker. The pinned SDK is `alchemy@2.0.0-beta.83` with
`effect@4.0.4` and its platform adapters; none are shipped in the desktop app.
Deploying this stack is separate from publishing a macOS release or deploying a
the website.

Production downloads use `https://git.1bye.dev`. Share
`https://git.1bye.dev/download` for the latest Apple Silicon macOS release; it
returns a non-cached redirect based on the current published appcast. Versioned
links remain available as `https://git.1bye.dev/1git-<version>-macos-arm64.zip`.

The Worker serves only `GET`/`HEAD` for `/download`, `/appcast.xml` and numeric-versioned
`/1git-<version>-macos-arm64.zip` objects. It streams the stored bytes unchanged,
does not expose bucket listing or arbitrary keys, and has no upload endpoints or
publisher credentials. Feeds and error responses use `Cache-Control: no-store`;
ZIPs use a year-long immutable cache policy. Downloads do not require a user's
GitHub, AI, or Cloudflare account.

## One-time setup — do not run until deployment is approved

1. Authenticate Alchemy with the intended Cloudflare account. Use permissions
   for R2 buckets and Workers, following the pinned SDK's Cloudflare setup guide.
   Publishing uses that profile for R2 reads and the existing Sparkle key for writes.
   **Account API Tokens Write / token provisioning is not required.**
2. From the repository root, explicitly provision the production stack:

   ```sh
   bun run deploy:updates -- --stage prod
   ```

   On the initial publisher deployment, provide the existing Sparkle **public**
   key as `ONEGIT_UPDATE_PUBLIC_KEY`. Subsequent deployments reuse the pinned key
   from saved stack outputs, so no repeated export is needed. The private key
   never enters Alchemy or either Worker. Changing the pinned key requires an
   explicit key migration; an accidental replacement is refused.
3. The stack saves `accountId`, `bucketName`, `jurisdiction`, `workerURL`,
   `publisherURL` and `publicKey`.
   `release:macos` reads these outputs; no copying endpoint/account/bucket values
   or configuring separate S3 keys is required. In production, Alchemy attaches
   `git.1bye.dev` in the existing `1bye.dev` zone and manages DNS/TLS. Other stages
   use their own `workers.dev` URL. The feed is `workerURL` + `/appcast.xml`.
   The original production `workers.dev` endpoint remains enabled for installed
   apps and previously shared links. Existing signed feeds are never rewritten
   to change their enclosure URLs; future releases use the custom domain.
4. Back up the ignored `apps/releases/.alchemy/state/` directory securely. This
   stack uses Alchemy's local state, so deployment does not provision an extra
   remote state service. Use the same state and stage for later infrastructure
   changes. Do not delete state or rename resource IDs casually.

The bucket is retained on stack removal and `forceDestroy` is disabled. There
are no expiry rules deleting release objects. The website uses its
own stack/resources and preserves this downloads endpoint. Keep the endpoint
stable: it is embedded in installed apps.

No deployment occurs during install, type checking, build, test, macOS packaging,
release preparation, or `release:macos --dry-run`.

## Build and publish a release

See the [desktop release configuration](../gpuix/.env.release.example).
Run `bun run setup:signing:macos` once on the release Mac to provision its separate,
stable self-signed code-signing identity. Back it up securely; only its public
certificate pin is committed. Publishing refuses missing/unavailable identities
and ad-hoc mode. This does not create or rotate the Sparkle key described below.
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
normal profile reader, including OAuth refresh, for Cloudflare R2 object reads.
Stored ETags and byte counts come from the authenticated, exact-key metadata
listing, not the object download's HTTP headers, which compression can weaken.
The body read must match that metadata's ETag and byte count; missing or changed
objects abort publication. Only the stored ETag is used for conditional writes.
Writes go through the separately deployed publisher, not the REST upload API:
the latter was verified live to ignore conditional uploads. No API tokens are
created/revoked, no S3 keys are derived, and no second profile is required.
No profile secret reaches app builds or either Worker. Standard Alchemy OAuth
refresh may persist refreshed credentials through Alchemy's normal profile store.

Each publisher request carries a five-minute, domain-separated Ed25519
authorization signed by the existing Sparkle Keychain/file key. It binds the
destination origin, method, object key, byte length, SHA-256 and write condition.
Only the public verification key is deployed. The publisher verifies the
authorization before accessing R2, enforces the body checksum via native R2,
and uses native `put({ onlyIf: ... })` for atomic create-once/ETag replacement.
Archives cannot be overwritten or deleted. Only isolated probe keys and temporary
archive parts can be deleted. The publisher exposes no reads/listing; downloads remain read-only.

Before touching any ZIP or feed, a real publish checks create-once,
current-ETag replacement and stale-ETag rejection on a unique
`release-checks/<uuid>.txt` object, verifies its bytes/ETag, then deletes it.
There is no unsafe overwrite or automatic token-provisioning fallback.
Probe cleanup failures print the exact non-secret key for manual cleanup. The
downloads Worker cannot serve these probe keys. Dry-run performs none of this.

Archives above 96 MiB use signed, create-once 64 MiB objects under private
`release-parts/<uuid>/` keys. A final signed request binds the part set, total
length and full archive checksum. The publisher streams those parts into one
R2 `put` with the original create-once condition and SHA-256, without buffering
the archive in Worker memory. Archives are capped at 512 MiB. Parts are removed
after success or failure; interrupted clients can leave private parts, and cleanup
failures print their exact keys. The downloads Worker cannot serve parts.
Deploy this publisher update before using the large-archive client.

The command uses the existing Turbo prerequisite graph, builds/ad-hoc signs the
app, takes an isolated signed-bundle snapshot, and creates a signed app-only ZIP
and signed feed in a unique `apps/gpuix/build/updates/<version>-<run>/` directory.
Release runs never share mutable artifact paths. Publishing then:

1. Reads the previous feed and rejects an equal/older numeric version.
2. Verifies the signed publisher's native conditional writes on an isolated probe.
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
Cloudflare credentials/permissions, and R2 acceptance require explicitly
approved live verification. Production verification passed for native R2
create-once/stale-ETag checks, two simultaneous writers (200/412), and unsigned
uploads (401). Check the current signed appcast before choosing a version; a new release must
be higher than its current version. See [the release guide](../../docs/RELEASING.md)
for GitHub release notes and source tags.
