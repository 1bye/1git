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
Ordinary staging/committing requires a normal repository state without conflicts.
The conflict controls below handle merge/rebase; other operations finish outside
the app. A changed branch or HEAD is rejected and refreshed
before writing; changed rename metadata also requires renewed review. External Git
can still change the repository concurrently.

The **Branches** rail control and an active repository tab open an attached picker.
Click the active tab or press Enter/Down while it is focused. Search locally known
branches (no fetch), expand the recent list, switch local branches, or create and
switch from the displayed HEAD. Remote choices create an explicitly tracked local
branch after confirmation; branches already tracked locally are hidden. Existing
local-name collisions and branches used by another worktree remain unavailable.

With dirty work, switching requires an explicit **Leave** or **Bring** choice.
Leave retains a durable branch/worktree backup, discoverable through **Restore
saved changes…** after returning to that branch. Bring restores the exact backup
and staged state after switching, retaining it if conflicts occur. Branch creation
requires a clean tree. A changed HEAD, conflicts, active Git operation or unknown
outcome requires renewed review. Nothing is force-switched or replayed.

Branch work uses the existing app-owned write flow. Every tab for the canonical
worktree refreshes on success and failure while retaining independent commit drafts,
filters, diff modes, selections where available and pane preferences. Other tabs
for that worktree cannot start another write while the operation is pending.
The picker uses `gpui-ce-motion` for its 160 ms height/opacity transitions, snaps
with reduced motion, and stops requesting frames once settled. Rename/delete,
branch integration and worktree management are separate UI work.

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
commit draft and history selection. Browsing History does not write files. Right-click a commit in History or Graph
(or press Shift+F10 on the selected commit) to **Cherry-pick commit…** or **Revert
commit…**. Each opens a confirmation pinned to the reviewed branch and commit.
Cherry-pick searches available local destination branches, switches only after
confirmation, and keeps the source branch unchanged. Revert adds a reversing
commit to the current branch. Both require clean working files, reject stale
reviews, preserve drafts and retained navigation, and refresh related tabs.
Conflicts open Changes with the existing previews and explicit Continue/Abort
controls. Aborting a cherry-pick keeps the checked-out destination branch.

Remote machines and account management remain future app work.
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


### Fetch, pull, push and branch publication

Open Synchronization from the top rail control. Opening it reads local status and
remotes only. Fetch, Pull and Push are separate actions; the incoming/outgoing
badges reflect the last fetch and cap visually at 99+ while accessibility keeps the
exact counts. Command-R fetches remote updates; with no remotes, it refreshes local
status. Pull only fast-forwards a clean committed branch. Push targets its exact
configured upstream and does not force, mirror, include other branches or tags.

For an untracked branch, choose Publish branch…, review its name and destination,
then confirm Publish branch. A single remote with one push URL is preselected;
multiple remotes require a selection. Closing or backing out clears publication
consent. Detached/unborn branches, ongoing Git operations and ambiguous push URLs
are explained rather than guessed. Creating hosted repositories and editing
remotes/accounts remain separate future workflows; existing Git credential helpers
and SSH configuration are used without importing account secrets.

Progress, errors and the last confirmed fetch are shared across duplicate tabs
and linked worktrees. Closing the panel leaves a transport running; Stop cancels
explicitly. Closing the window or quitting cancels it too. A 120-second deadline
bounds transport waits. Cancellation, failure and success all reread each worktree
independently, preserving drafts, selections, filters, diff modes and panes. A
failed status read keeps the view/draft but blocks writes until a fresh read succeeds.
No transport is replayed automatically. Inspect local and remote status after an
uncertain push before trying again.

The centered panel uses the current 340/400-pixel status/publication widths,
compact forty-pixel remote choices, destination-specific confirmation and shared
controls and fast gpui-ce-motion width/height/opacity transitions. Its phase-local
rail gauge is painted as native GPU paths. Progress updates repaint only the small
retained rail/panel views. Reduced motion snaps transitions and stops the unknown
progress sweep; settled views do not request animation frames.

## Stashes

Open **Stashes** in the repository rail to inspect saved work without changing the
working tree. The resizable sidebar shows newest stashes first and the selected
stash's files below it. Select a file to preview its immutable saved diff, including
saved untracked files. Unified/split diff modes, selection and pane sizes survive
app restarts independently in each tab.

Use **+ New stash** to save tracked edits with an optional message. Enable
**Include untracked files** explicitly to save new files too; ignored files stay
in place. Commit message/description drafts are retained. **Apply** restores the
selected stash and keeps its saved copy. **More stash actions → Pop stash** applies
and removes the exact saved entry after successful application. Apply/Pop require
a clean worktree; conflicts keep the stash and show Git's refreshed result.

**More stash actions → Delete stash…** opens a confirmation with Cancel focused.
Deletion removes the saved entry, without replacing working files. Requests retain
the reviewed branch/HEAD and stash OID, so branch switches or stash renumbering
cannot silently retarget a form. Close/cancel never submits a write. Accepted
operations show progress and errors, refresh related worktree tabs separately and
preserve their drafts and navigation. An unconfirmed refresh blocks further writes
until a fresh read. Pending operations and deletion consent are never restored.

The source-style anchored forms use gpui-ce-motion with fast transitions,
reduced-motion support and no settled animation loop. Existing text diff rendering
reports binary or oversized patches explicitly; image previews and tree file
layout are not part of this pass. Stash deletion safely refuses unsupported Git
reference storage formats. No automatic retry or force option is offered.

## Discard and restore

Right-click a changed file (Control-click on macOS), or focus the file list and
press Shift+F10, then choose **Discard Changes…**. The diff display menu offers
the same action. A single confirmation covers both staged and unstaged edits to
that exact path. Untracked files instead offer **Delete untracked file…**.

The staged-count menu offers **Discard all tracked changes…** and a separate
**Delete all untracked files…** action. These use the entire repository snapshot,
including files hidden by a filter. Each confirmation names the captured path or
count, explains what is kept, and initially focuses Cancel. Escape or Cancel
never starts a write. Unsupported paths disable the batch rather than being skipped.

A durable recovery backup is saved before any discard. Use **Restore** on the
completion notification, or **Restore last discarded changes** in the count menu,
within 15 seconds. Restore keeps staging and working contents separate and refuses
a changed branch/HEAD. New writes, expired or consumed tokens, or conflicting edits
may require manual recovery; the notification/error includes the backup directory.
Recovery files remain on disk after restart or expiry. Confirmations and short-lived
restore tokens are never replayed or restored from the workspace session.

Operations show progress and errors and refresh each related open worktree.
Drafts, surviving file selections, filters, diff modes and pane sizes are retained.
An uncertain refresh blocks further writes until a successful refresh.
Confirmations use fast gpui-ce-motion transitions with reduced-motion support.

## Resolve conflicts

Changes groups unresolved files separately while a Git operation owns the index.
Select a conflicted text file to compare Current/Incoming with its working result.
During rebase the labels become Upstream version/Replayed commit.

"Use this version…" asks before replacing the whole file and staging it.
For manual resolution, save the file in your editor, Refresh, then use Mark
resolved. Marker content cannot be staged by this action. Binary, oversized,
deleted and linked conflicts require Git outside the app.

Merge/rebase Continue is separate and becomes available after all conflicts are
resolved with no unstaged tracked edits. It uses Git's existing message and
configuration. Abort requires confirmation and may lose conflict-resolution
edits. Stale working contents, indexed versions or operation state require a
fresh review. A failed command may already have changed Git state; the app
refreshes it without retrying.

Accepted actions refresh every related worktree tab while retaining commit drafts,
surviving selections, filters, diff modes and pane sizes. Consent is never restored
after restart. Confirmation transitions use gpui-ce-motion and honor reduced motion.

## Syntax and unchanged diff context

Changes (staged and working), History, Stashes and conflict previews share syntax
highlighting and expandable unchanged lines in unified and split views. Click a
hunk separator or **Expand unchanged lines**, or focus the diff and press **E**,
to reveal up to 20 lines. Repeated expansion joins adjacent hunks and stops at EOF.

The viewer preserves the source-line position and horizontal scroll when context
is inserted. Split columns stay synchronized. Tabs and unchanged refreshes retain
expanded context; a changed file rebuilds its context from the new snapshot.
Conflict source sides retain separate viewports. Commit drafts and selections
are preserved.

Colors match the current app's light/dark syntax and changed-word palettes.
JavaScript/JSX, TypeScript/TSX, Rust, Python, Go, JSON/JSONC, CSS, HTML, Bash, C,
TOML, Markdown and YAML use the reference app’s Syntect grammars; other files stay plain text. Binary/oversized notices remain.
Hidden context is optional and snapshot-checked; when it cannot be safely loaded,
the ordinary preview stays usable. Expansion reports its safe display limit.
Hover/press feedback and a fast reveal fade use gpui-ce-motion with reduced-motion
support and no idle animation loop.

## Partial staging and diff text selection

Changes supports Stage/Unstage for a line, contiguous change group, whole hunk or
selected changed lines. Use the two narrow gutters, the hunk action or the floating
selection toolbar. Tab then Space activates a focused gutter. Renames, binary,
mode/type and submodule changes use the existing whole-file checkbox.

Actions freeze the reviewed root, branch/HEAD and original patch. A private index
transaction rechecks them under the repository queue and index lock before atomic
installation. A changed or outdated diff is rejected; review the refreshed preview
before retrying. Unselected staging and all working bytes stay intact. Commit
drafts, file selections and source-line scroll offsets survive, and related tabs
(including linked worktrees) refresh without replacing their own intent.

All diff views support drag selection, word/line clicks, Shift+arrows,
Command/Ctrl+A and Command/Ctrl+C. Copy includes raw source only, retaining
Unicode, tabs and CRLF. Split selection stays in its original column. Escape clears
it. Dragging beyond the viewport scrolls only while held. History, stash and
conflict source previews support copying without index actions. Hover/press motion
uses gpui-ce-motion with reduced-motion support and no idle loop.

## Amend and Undo last commit

The last-commit footer enables **Amend** and **Undo** for an unpublished,
non-merge tip on a named branch in a normal repository state. Eligibility uses
known remote-tracking refs and performs no fetch. Published, stale, conflicted
and active-operation reviews are guarded in the UI and rechecked by the Git worker.

Amend loads the last message and focuses Summary. The **Amending** header has
Cancel; both cancellation and confirmed success restore the ordinary draft.
The submit button opens a confirmation, with an option to include the exact staged
index. Uncheck it for a message-only amend that keeps staging intact. Failed or
uncertain writes keep the amend draft available and never retry automatically.

Undo asks first, keeps every working file and the exact index, and retains a
recovery ref. It restores the old message only into an empty originating draft.
Other repository tabs retain their drafts, selections, diff modes, filters and
pane sizes while refreshing; the diff keeps both scroll axes at its source anchor.

Composer and confirmation transitions use gpui-ce-motion with reduced-motion
support and no idle animation. Sessions preserve the ordinary draft while an amend
is active; reopening the app cancels amend mode. A result needing review blocks
new writes until History is inspected and the repository is refreshed.

Graph and History committed-file panes support tree/list layout, folder counts,
compact directory chains and keyboard disclosure. The selected diff and draft
survive layout changes; layout and collapsed folders restore with the session.


## Reset to commit

Graph and History expose **Reset to commit…** on an earlier commit. The confirmation
reviews the exact branch/HEAD and target, shows how many later commits will be
undone, and requires explicit consent. The current tip, dirty repositories, detached
HEADs and active operations are unavailable. Review is cancellable and times out
after ten seconds; no write occurs while reviewing.

Reset changes only the current branch ref. Every working file and the exact index
stay intact; the undone changes appear in Changes. Other branches and existing
tags stay unchanged. An atomic transaction retains the original tip in
`refs/1git/reset/<id>`, displayed in the result. Inspect retained history with
`git log refs/1git/reset/<id>`; do not delete the ref until recovery is no longer
needed.

Publication guards use known remote-tracking refs. Fetch first if another tool may
have pushed. The Git worker rechecks publication, ancestry, clean state and the
reviewed branch/HEAD under the mutation queue before installing refs. Stale or
failed consent must be reopened; uncertain results never retry and block new
writes until an explicit refresh. Recovery feedback survives refresh failures.

The originating tab shows Changes after confirmed success. Duplicate and linked
worktree tabs refresh without replacing their own drafts, selected commits/files,
diff modes, filters, pane sizes or scroll anchors. The retained historical
selection stays readable through the recovery ref. Confirmation opacity and
height use gpui-ce-motion, honor reduced motion and stop requesting frames at rest.
