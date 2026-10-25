# Releasing 1git

The signed Sparkle feed and download endpoint already distribute the macOS app.
GitHub Releases adds human-readable notes and a matching source tag. Publishing
source, deploying infrastructure, and releasing a binary are separate operations.

## Verify a release candidate

Use an Apple Silicon release Mac with full Xcode, Rust/rustup, Bun, and the
existing Sparkle update key. No Apple account, code-signing certificate, or
notarization is required for the default release. Start from a clean, reviewed commit that is pushed
to GitHub. Run the [contribution checks](../CONTRIBUTING.md#verification) and the
native suites appropriate to the change, then the packaging checks:

```sh
bun run test:package:macos
bun run test:updates:macos
```

See [native packaging](../apps/gpuix/README.md#macos-app-bundle) and
[the release environment example](../apps/gpuix/.env.release.example). Sparkle
credentials stay in Keychain or an ignored local environment file. The default
uses a local ad-hoc signature, required for Apple Silicon, without a certificate
or identity. Leave `ONEGIT_MACOS_SIGNING_IDENTITY`, `ONEGIT_MACOS_TEAM_ID`,
`ONEGIT_MACOS_NOTARY_PROFILE`, and `ONEGIT_MACOS_SIGNING_CONFIG` unset. Explicit
settings still opt into certificate signing. A dry run builds locally and never
publishes; inspect its results, then use a normal release for distribution.

## Publish the macOS build

Read the current version from
[`appcast.xml`](https://git.1bye.dev/appcast.xml). Choose a strictly higher numeric
`major.minor.patch` version. The example below is a future version, not a record
of a published release; replace it consistently before running the commands.

```sh
bun run release:macos -- --version 0.0.21 --dry-run
# After reviewing the build:
bun run release:macos -- --version 0.0.21
```

Sparkle archive/feed signatures authenticate updates independently of Apple
code signing; keep the existing Ed25519 key. The release command reads saved
Alchemy outputs, uploads the immutable ZIP,
verifies its public bytes, and updates the signed feed last. It does not deploy
infrastructure, create a Git tag, or publish a GitHub release. See the
[release infrastructure guide](../apps/releases/README.md) for setup and recovery.

Verify `/download`, the appcast version, the exact versioned ZIP, installation on
a supported Mac, and **Check for Updates…** from a prior installed release.

## Draft the matching GitHub release

Tag the exact commit used to build the verified binary. Do not tag a newer commit
for an older binary or infer a historical release's commit from its version.
If its source commit is unknown, keep using the existing versioned download until
a new matching source/binary release is available.

For example, from that reviewed commit, using the same version as above:

```sh
git tag -a v0.0.21 -m "1git 0.0.21"
git push origin v0.0.21
gh release create v0.0.21 --repo 1bye/1git --verify-tag --draft --prerelease \
  --title "1git 0.0.21" --generate-notes \
  --notes-file /tmp/1git-release-notes.md
```

Create `/tmp/1git-release-notes.md` first, using this template and the actual
version. Review generated notes for accuracy; `.github/release.yml` groups merged
pull requests by label. Direct commits may need a manually written summary.

```md
## Download

[1git for macOS — Apple Silicon](https://git.1bye.dev/1git-0.0.21-macos-arm64.zip)

Requires macOS 13 or later and Git. Extract the ZIP and move 1git.app to Applications.

## Highlights

- Describe the changes included in this version.

## Known issues

- This release is not Developer ID signed or notarized. macOS may require Open Anyway.
- Document any additional limitations and upgrade steps.
```

If attaching a binary to GitHub, upload the **exact verified release ZIP** from
the signed feed and its checksum. Sparkle's app-only ZIP differs from the local
distribution ZIP; preserve the feed's artifact and signature. Do not rebuild it
or use a dry-run archive. GitHub's generated source archives are not macOS apps.

Review the draft and publish it explicitly in GitHub when ready. Keep beta
versions marked as prereleases. GitHub Releases does not replace or modify the
Sparkle feed, its keys, immutable archives, or existing update URLs.
