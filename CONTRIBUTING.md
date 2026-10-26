# Contributing to 1git

Bug reports, focused fixes, documentation, and accessibility improvements are
welcome. For substantial changes, open an issue first so we can agree on scope.

## Setup

Follow the [README](README.md#build-from-source). The desktop app needs an Apple
Silicon Mac, full Xcode, Rust/rustup, Git, and Bun. The website and portable tests
can be developed without macOS graphics access or production credentials.

```sh
bun install --frozen-lockfile
bun run dev:app
# Or work on the website independently:
bun run dev:web
```

The first native launch compiles the pinned GPUIX addon. Keep its JS packages and
native revision in sync; [upstream patch notes](docs/gpuix-upstream/README.md)
explain why the local patches exist.

## Making a change

- Read the nearest `AGENTS.md` and the owning package's README.
- Keep changes focused and use existing domain owners and components.
- Preserve keyboard behavior, accessibility, cancellation, and recovery paths.
- Add meaningful tests for behavior changes, especially Git writes and credentials.
- Update documentation when setup, commands, or visible behavior changes.
- Use Oxlint and Oxfmt; avoid unrelated formatting changes.

For a change that needs a release, run `bun run changeset`, select the affected
workspace packages, and commit the generated release note with your change.
Use patch for fixes, minor for features, and major for breaking changes. Include
`@1git/gpuix` when an internal package change also needs a desktop app release.
Documentation, tests, and tooling changes can omit a changeset. See the
[Changesets workflow](.changeset/README.md) for CLI requirements and commands.

## Verification

```sh
bun run check
bun run check-types
bun run build
bun run test:portable
```

For native changes, build the addon and run the native app's tests on a Mac with
graphics access:

```sh
bun run --cwd apps/gpuix build:native
bun run test
```

Package-specific READMEs document integration tests, packaging, and signing
checks. Run checks appropriate to the change and say what you could not verify.
CI covers portable checks; it does not prove native rendering or code signing.

Use `bun run playground` for disposable repositories. Never use personal
repositories, saved account credentials, or live providers as test fixtures.
Keep `.env*` files, signing keys, certificates with private keys, and Alchemy state
out of commits. Sanitized `.env.*.example` files are safe to share.

## Pull requests and reports

Explain the problem, resulting behavior, and verification. Include screenshots
for visible changes and describe any platform requirements. Check the diff for
generated artifacts, credentials, and unrelated changes before opening the PR.

For bugs, include your macOS version, chip, 1git version, and reproduction steps.
Remove repository contents, private paths, tokens, and account details from logs
and screenshots. Follow [SECURITY.md](SECURITY.md) for vulnerabilities.

By contributing, you agree that your contribution is available under the
repository's [MIT license](LICENSE). Third-party code and assets must retain
their original notices.
