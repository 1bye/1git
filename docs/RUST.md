# Rust workspace

The root Cargo workspace contains `onegit-git`, `onegit-ui`, and `onegit-app`.
Run these commands from the workspace root. Builds and tests keep using the stable
compiler pinned in `rust-toolchain.toml`.

## Run the repository app

```sh
cargo run -p onegit-app --locked
```

Git must be available on `PATH`. Choose **Open repository…** and select a local
working folder. The app opens its canonical worktree, reads changed files, and
loads a real patch when a file is selected. Staged and unstaged entries are shown
separately, including both sides of partially staged files. Use **Unified** or
**Split** to change the patch presentation and drag the divider to resize panes.
The changed-file list supports Up/Down and Home/End navigation and virtualizes rows.

**Refresh** reads a fresh snapshot and retains the selected path/side when it
still exists. Removed selections fall back to the same path on its other side,
then the first remaining change; a clean worktree has an explicit empty state. Changes made outside the app require a
manual refresh. Open/read failures have retry controls and are never presented as
a clean repository.

Git reads and patch parsing run on GPUI's background executor. Superseded reads
are cancelled, stale results are ignored, and window closure requests process
cleanup without retaining the workspace. The application keeps exact `GitPath`
bytes for selection and command arguments; labels escape controls and invalid
UTF-8 bytes for display. Binary patches, metadata-only changes, oversized patches
and unresolved conflicts have explicit presentations.

Use **Stage file** or **Unstage file** above the selected patch to move the entire
file between the working tree and index. **Stage all** and **Unstage all** apply
to the repository. Unstaging preserves working files. Staging a partially staged
file replaces its staged content with the complete current working version.

The commit form shows the staged-file count and accepts a required summary and
optional description. **Commit staged changes** commits only the existing index;
unstaged and untracked content stays in the working tree. Enter in the summary
moves to the description; Command+Enter on macOS or Ctrl+Enter elsewhere in the
description submits. Git's configured hooks and signing settings are respected.

One write runs at a time in the background. Controls are disabled until completion,
then status and the selected patch refresh. Progress toasts become success/error
notifications. Successful commits clear the form; failures retain the draft and
refresh status to expose partial effects, without replaying the write. Changing
repositories clears the draft; manual refresh retains it. A write accepted before
window closure continues while the application is running. Writes are registered
as application-owned Rake tasks, so normal application quit waits for them.
Writes require a normal repository state without conflicts; finish merge/rebase
operations externally for now. A changed branch or HEAD is rejected and refreshed
before writing; changed rename metadata also requires renewed review. External Git
can still change the repository concurrently.

Hunk staging, discard, network operations, repository history and persistence remain
future app work. Loading status and previews does not mutate repository contents.
The component gallery remains available with
`cargo run -p onegit-ui --example gallery --locked`.

Verify the app and its real-Git/native-event tests:

```sh
cargo test -j 2 -p onegit-app -p onegit-ui --all-features --locked
cargo test -j 2 -p onegit-ui --example gallery --all-features --locked
cargo clippy -j 2 -p onegit-app -p onegit-ui --all-targets --all-features --locked -- -D warnings
```

The fixtures create disposable repositories and check that reads preserve working
files, index bytes, objects and refs. Native-event tests exercise folder-picker
cancellation/opening, selection, refresh, errors and stale-result suppression.
Write tests cover literal paths, renames, copies, partially staged files, unborn
branches, index locks, rejecting hooks, exact commit messages, draft retention,
keyboard submission, duplicate prevention and window closure.
The filesystem-backed non-UTF-8-name test runs on Linux, since macOS filesystems
reject those names; label escaping is checked on every platform.

## Logical spacing

The workspace uses [`workflow_spacing`](https://github.com/1bye/workflow/tree/f62c7d7dcdf3ffd9b77de95a523544a0c688bb9b/rust/spacing),
pinned in `Cargo.toml`. The source matches the shared local `workflow/rust/spacing`
library without requiring a machine-specific path or a checkout beside 1git.

Install its separate development toolchain once:

```sh
rustup toolchain install nightly-2026-08-20 --profile minimal \
  --component rustc-dev,llvm-tools-preview,rust-src,rustfmt \
  --target x86_64-pc-windows-gnu,x86_64-unknown-linux-gnu
cargo +nightly-2026-08-20 install cargo-dylint dylint-link --version 6.2.0 --locked
```

Check every workspace crate, target and feature, including tests and examples.
The same command cross-checks `onegit-git` for Windows and Linux, covering
platform-specific Rust that macOS does not compile:

```sh
python3 scripts/check_spacing.py
```

Apply fixes, then verify stable rustfmt preserves them:

```sh
python3 scripts/check_spacing.py --fix
cargo fmt --all
python3 scripts/check_spacing.py
```

The policy separates definition/method boundaries, multiline declaration groups,
standalone control flow and returns with one blank line. Consecutive short
related declarations stay compact. Block edges are not padded, and repeated blank
lines are removed. Literal contents and macro-generated code remain unchanged;
statement padding does not parse macro token trees such as `rake::view!`.
Rustfmt still owns normal formatting.

Dylint defaults to warnings, so its exit status alone does not enforce the policy.
The Python checker rejects all four spacing diagnostics and compiler errors,
fails if no lint library is found, and rechecks after fixing. It covers workspace
members, including future additions, without linting dependency packages. The
extra Git target passes need no cross-linker because they only check compilation.
The **Rust spacing** GitHub Actions workflow runs the same check on macOS, where
all three crates' native dependencies are supported. It does not change the
separate Windows/Linux/macOS Git platform tests.

Test the checker itself:

```sh
python3 -m unittest discover -s scripts -p test_spacing.py -v
```
