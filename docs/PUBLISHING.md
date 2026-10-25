# Public launch checklist

- Repository: [1bye/1git](https://github.com/1bye/1git)
- Website: [git.1bye.dev](https://git.1bye.dev)
- Download: [latest macOS build](https://git.1bye.dev/download)
- License: [MIT](../LICENSE)

## GitHub About

Description:

> A native Git workspace for macOS, with local and SSH repositories, worktrees, and AI commit messages.

Website: `https://git.1bye.dev`

Topics: `git`, `git-client`, `macos`, `apple-silicon`, `typescript`, `react`, `bun`,
`gpuix`, `ssh`, `worktrees`, `open-source`.

Workspace manifests intentionally remain `private`; that prevents npm publishing
and does not control the GitHub repository's visibility.

## Source scan on 2026-10-25

Gitleaks 8.30.1 scanned all 535 commits reachable from local refs and a separate
snapshot of 933 tracked/new source files, excluding ignored local files. The 190
history findings were reviewed: 187 source-integrity checksums, the intentionally
public PostHog ingestion token, a disposable discard-recovery identifier, and a
TLS private key for the offline loopback test fixture. The current-source scan
flagged three checksums and that same public ingestion token.

No production credentials were identified in those findings. The historical TLS
fixture is under `docs/rust-gpui-migration/evidence/avatar-http/`; its certificate
identifies it as `1git offline loopback fixture`. It must never be used outside
tests. History was preserved. Repeat the scan after final changes or fetching
additional refs; this scan does not cover remote-only refs or service settings.

```sh
gitleaks git . --log-opts=--all --redact
```

## Before making the repository public

- Review the complete outgoing diff, including any concurrent app and website work.
- Run the checks in [CONTRIBUTING.md](../CONTRIBUTING.md) and verify CI on GitHub.
- Inspect the entire Git history and all refs that will become public for secrets,
  private data, and assets without redistribution rights. A current-tree scan is
  not sufficient. Rotate exposed credentials before publishing; coordinate any
  required history rewrite with collaborators.
- Keep release environment files, private signing keys, Keychain exports, and
  Alchemy credentials/state outside the repository. Preserve the public signing
  certificate and verification keys needed by existing releases.
- Review [third-party notices](../THIRD_PARTY_NOTICES.md), especially the separate
  terms for the website's Apple marketing artwork.
- Review the README's screenshot and website captures for information you do not
  want public. Retain the native patches and upstream notes needed to build.
- Verify the website, download redirect, FAQ, and appcast. Build and deploy the
  website update when ready so its GitHub link points to this repository.
- Prepare a new source tag and matching binary using [RELEASING.md](RELEASING.md).
  Existing downloads do not automatically become GitHub releases.

## Publication

The repository owner explicitly changes visibility after reviewing the prepared
source, either through GitHub settings or the GitHub CLI. Builds and tests never
change visibility, rewrite history, push commits/tags, deploy the website, or
publish a binary.

After publication, enable private vulnerability reporting in the Security
settings, enable available secret scanning/push protection, and protect `master`
with pull-request review and the CI check. Open the README and links while signed
out, check the issue templates, and review the release draft before publishing it.
