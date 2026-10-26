# Changesets

Run `bun run changeset` from the repository root for a change that should appear
in a package's next release. Select the affected workspace packages, choose a
patch, minor, or major bump, and write a summary for users. Commit the generated
Markdown file with the change. Documentation, tests, and tooling changes that
do not need a release can omit a changeset.

All workspace packages are private. Changesets versions them and generates their
`CHANGELOG.md` files independently, without publishing them to npm or creating
tags. Comparisons use the repository's `master` branch, and generated Markdown
uses Oxfmt with the repository's formatting configuration.

```sh
# Add a release note interactively:
bun run changeset
# Preview pending version bumps:
bun run changeset:status
# Apply pending bumps and changelogs, then refresh bun.lock:
bun run changeset:version
```

Changesets 3 requires Node.js `^22.11 || ^24 || >=26` to run its CLI; Bun remains
the workspace package manager. `changeset:version` changes local files only;
review and commit the resulting manifests, changelogs, removed changesets, and
lockfile. It exits with code 1 when there are no pending changesets.
`changeset:status` also exits with code 1 if packages have changed without a
changeset; it is a manual preview and is not a required CI check.

For desktop changes, select `@1git/gpuix` as well as any changed internal
packages when the app needs a release. Before the first Changesets-managed app
release, align its package version with the last published numeric appcast
version: existing binary releases have used an explicit version independently
of the development manifest. After alignment, pass the new app package version
to `release:macos -- --version`. Binary publication and GitHub releases follow
the [release guide](../docs/RELEASING.md).

See the [Changesets guide](https://changesets.dev/guide/getting-started) for the
full workflow.

## Working with agents

The root [`AGENTS.md`](../AGENTS.md#changesets-and-releases) instructs agents to
include a changeset with each releasable change. You can ask for a bug fix as
usual; the agent should add the note and report its path. To make the scope
explicit, use a prompt such as:

> Fix the repository reconnect bug, add a regression test, and include a patch
> changeset for the affected packages and the desktop app.

Agents can add notes without interactive prompts:

```sh
bun run changeset --patch @1git/gpuix,@1git/git \
  --message "Fix repository loading after reconnecting."
bun run changeset:status --verbose
```

Each task owns a separate note, so fixes can be developed independently and
merged with their release notes. Update an existing note when continuing the
same task. Keep notes focused on the behavior users will see; test details and
implementation notes belong in the PR description.

Leave notes pending while fixing bugs. At release time, Changesets combines the
notes and uses the highest requested bump for each package: several patch notes
produce one patch bump, and a minor note plus patch notes produces one minor
bump. Include `@1git/gpuix` in changesets for desktop fixes in internal packages;
its `workspace:*` dependencies do not guarantee an automatic app bump.

To collect the notes into a release candidate, ask:

> Prepare the next macOS release from the pending changesets. Follow
> docs/RELEASING.md, verify the app version against the published feed, apply the
> version bumps, run the relevant checks, draft release notes from the changelog,
> and build a dry run. Leave publication for later.

After reviewing the candidate, request publication separately using the prepared
version and source commit. The [release guide](../docs/RELEASING.md) covers the
binary, matching tag, and GitHub release.
