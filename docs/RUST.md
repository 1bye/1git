# Rust workspace

The root Cargo workspace contains `onegit-git`, `onegit-ui`, and `onegit-app`.
Run these commands from the workspace root. Builds and tests keep using the stable
compiler pinned in `rust-toolchain.toml`.

## Run the repository app

```sh
cargo run -p onegit-app --locked
```

The window uses the original 1git chrome and compact workspace geometry: a
42-pixel custom titlebar, 36-pixel connected repository tab, 48-pixel navigation
rail, and a white/dark workspace with 14-pixel corners. On macOS the six-pixel
outer inset exposes AppKit's Sidebar material and the original cached grain.
The window starts at 1280×820 and supports sizes down to 640×420. The gear switches
light/dark palettes. Changes and History use accessible vertical rail tabs.

Home includes Machines, Quick Actions, a searchable repository library, folders,
tile/list views, repository avatars, and local branch/change/tracking summaries.
The first launch imports the original app's persisted local library and cached
avatars without modifying either. Rust subsequently saves its own library at
`~/Library/Application Support/1git-rust/home.json` on macOS. Only visible rows
request background status, with at most four reads in flight. Star/forget actions
change library metadata, never repository files. Create/clone require a new absolute
destination and refuse existing folders. Remote machines and hosting accounts are
explicitly marked as not yet ported; no credentials are imported.

Each repository tab retains its summary/description draft, selected Changes file
and side, History commit/file, filters, diff mode, viewport and pane sizes while
another tab or Home is active. Open from Home or the titlebar's plus button to add
a tab. The connected selection and tab positions use `gpui-ce-motion` with the original
240 ms easing. Dragging previews the new order in place; Escape cancels it.
Overflowing labels reveal on hover/focus, and settled tabs stop requesting frames.
Reduced motion snaps to the destination. Tabs can be dragged to reorder; close via the hover button, middle click,
or Command+W (Ctrl+W elsewhere). Closing a busy tab is disabled. Closing the active
tab selects its right neighbor, then its left, then Home. Command+O/Command+T
(Ctrl elsewhere) open the native picker; Ctrl+Tab/Ctrl+Shift+Tab cycle tabs, and
Command+1–9 (Ctrl elsewhere) select a tab. Arrow keys navigate the focused tab strip; Shift+Left/Right reorder its tab.
Workspace sessions restore after relaunch: tab order and active tab (including Home),
independent summary/description drafts, Changes path and staged/unstaged side,
History commit/file, per-view diff modes, file filter and visibility, sidebar widths
and the History detail proportion. The app rereads Git; it never replays operations.
Missing repositories retain their draft and navigation with a Retry action.
The Rust session is saved separately at `1git-rust/workspace.json` under the platform
application-state directory; the current app’s session is untouched. Saves coalesce
for 250 ms and use private, atomic file replacement, with a final flush on ordinary
window close or quit. Unsupported, corrupt or oversized sessions are preserved
and saving stays disabled with an error until repaired and restarted. The limit is
128 tabs and 8 MiB, without silently truncating drafts. `ONEGIT_SESSION_PATH` can
select a disposable session for development. Scroll offsets are retained while the
window is open; restart restoration covers navigation and sizes. **Open from disk** uses the native folder picker; **Add folder** discovers
repositories under a chosen directory without following descendant symlinks.

Git must be available on `PATH`. Choose **Open from disk** and select a local
working folder. The app opens its canonical worktree, reads changed files, and
loads a real patch when a file is selected. Staged and unstaged entries are shown
separately, including both sides of partially staged files. Use **Unified** or
**Split** to change the patch presentation and drag the divider to resize panes.
The changed-file list supports Up/Down and Home/End navigation and virtualizes rows.

**Refresh** reads a fresh snapshot and retains the selected path/side when it
still exists. Removed selections fall back to the same path on its other side,
then the first remaining change; a clean worktree has an explicit empty state.
Native filesystem notifications automatically refresh open repositories, including
background tabs. Each canonical root shares one subscription/read queue across
its tabs; linked worktrees also watch their external Git/common directories.
Events debounce for 250 ms, with a one-second ceiling during continuous writes.
Refresh pauses during explicit reads or accepted writes, cancels stale reads and
drains one pending update afterward. Refocusing the window also invalidates status.
Automatic refresh retains the current snapshot/patch while reading, including
same-status content edits, and preserves drafts and surviving selections. Missing
file selections fall back to the same path's other side, then a visible change.
Watcher/read failures appear as a notice with manual refresh available. Open/read failures have
retry controls and are never presented as a clean repository.

Git reads and patch parsing run on GPUI's background executor. Superseded reads
are cancelled, stale results are ignored, and window closure requests process
cleanup without retaining the workspace. The application keeps exact `GitPath`
bytes for selection and command arguments; labels escape controls and invalid
UTF-8 bytes for display. Binary patches, metadata-only changes, oversized patches
and unresolved conflicts have explicit presentations.

Use each file row's checkbox to stage or unstage the whole file. Its label names
the actual index operation; checked rows are staged entries. Partially staged
files retain separate staged and unstaged entries. The header checkbox and count
menu offer **Stage all files** and **Unstage all files** for the entire repository,
including files hidden by the optional search filter. The file toolbar's display
menu also provides **Stage file** or **Unstage file** for the selected patch.
Unstaging preserves working files. Staging a partially staged file replaces its
staged content with the complete current working version.

The compact, borderless commit composer accepts a required summary and optional
description; its action shows the staged-file count. **Commit staged changes**
commits only the existing index; unstaged and untracked content stays in the working
tree. Enter in the summary
moves to the description; Command+Enter on macOS or Ctrl+Enter elsewhere in the
description submits. Git's configured hooks and signing settings are respected.

One write runs at a time in the background. Controls are disabled until completion,
then status and the selected patch refresh. Progress toasts become success/error
notifications. Successful commits clear the form; failures retain the draft and
refresh status to expose partial effects, without replaying the write. Opening another repository creates an independent draft; switching tabs and manual
refresh retain drafts. A write accepted before
window closure continues while the application is running. Writes are registered
as application-owned Rake tasks, so normal application quit waits for them.
Writes require a normal repository state without conflicts; finish merge/rebase
operations externally for now. A changed branch or HEAD is rejected and refreshed
before writing; changed rename metadata also requires renewed review. External Git
can still change the repository concurrently.

The **History** tab browses locally available commits reachable from the checked-out
HEAD. It loads 50 commits at a time; **Load more commits** appends the next page.
Pages share the exact initial tip, so commits created outside the app cannot shift
offsets mid-session. **Refresh** starts again from the current HEAD and resets
history selection and pagination. A commit created through the app invalidates
cached history automatically. Ordinary staging keeps existing history selection.

Select a commit to see its subject, author, date, message and changed files; the
short SHA button copies the full object ID. Select a file to load its unified or split patch. Commits and changed files
share a proportionally resizable stacked sidebar; selected commit metadata sits above the right-hand patch.
The sliders menu switches unified/split modes. Merge commits show changes
against their first parent; root commits show additions against an empty tree.
Empty commits, an unborn branch, binary files and oversized patches have explicit
states. History lists and committed file lists virtualize rows and support keyboard
selection. Git reads and patch parsing run in the background with cancellation;
failed pages retain existing rows and can be retried. Switching tabs preserves the
commit draft and history selection. History never stages or changes files.

Hunk staging, discard, remote machines, account management
and network operations in repository workspaces remain future app work.
Loading status and previews does not mutate repository contents.
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
keyboard submission, duplicate prevention and window closure. Native layout checks
pin the original shell/file-row/composer measurements, and event tests cover row
staging, filtering and rail keyboard navigation. History tests cover
pinned pagination, first-parent merges, root/rename/deletion/binary patches, byte
preservation, failed-read recovery, tab/draft retention and stale-read cancellation.
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
