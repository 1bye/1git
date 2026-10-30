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
still exists. Removed selections fall back to the first remaining change; a clean
worktree has an explicit empty state. Changes made outside the app require a
manual refresh. Open/read failures have retry controls and are never presented as
a clean repository.

Git reads and patch parsing run on GPUI's background executor. Superseded reads
are cancelled, stale results are ignored, and window closure requests process
cleanup without retaining the workspace. The application keeps exact `GitPath`
bytes for selection and command arguments; labels escape controls and invalid
UTF-8 bytes for display. Binary patches, metadata-only changes, oversized patches
and unresolved conflicts have explicit presentations.

This slice browses local repositories. Staging, committing, network operations,
repository history and persistence remain future app work. Loading status and
previews does not stage, discard or commit files. The existing component gallery
remains available with `cargo run -p onegit-ui --example gallery --locked`.

Verify the app and its real-Git/native-event tests:

```sh
cargo test -j 2 -p onegit-app -p onegit-ui --all-features --locked
cargo test -j 2 -p onegit-ui --example gallery --all-features --locked
cargo clippy -j 2 -p onegit-app -p onegit-ui --all-targets --all-features --locked -- -D warnings
```

The fixtures create disposable repositories and check that reads preserve working
files, index bytes, objects and refs. Native-event tests exercise folder-picker
cancellation/opening, selection, refresh, errors and stale-result suppression.
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
