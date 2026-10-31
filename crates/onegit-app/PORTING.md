# Native app appearance port

The GPUIX implementation in `apps/gpuix` is the reference. Its welcome/sidebar,
workspace tabs, change list, composer, last-commit footer, revision panes, commit
subjects and native diff renderer map to `workspace/home`, `chrome`, `view`,
`history`, and the shared `onegit-ui` controls. Exact SVG glyphs and the original
grain are embedded; macOS material uses the same public AppKit Sidebar settings.
Rake 011294cb leaves custom chrome transparent so that material remains visible.

Local library data is imported read-only on first launch, then saved separately.
Only names are imported for remote machines; credentials and connections are not.
Repository reads stay off the UI thread; visible Home status reads are bounded.
Git paths and staging/commit semantics remain those of the existing Rust app.

## Verification

Compare equal-size 1280×820 native windows: Home with the same GitHub folder;
Changes with `onbot` / `docs/guides/models.md`; History with `pkgs`, commit
`15e69589e0298f2a1018b6d93d1f9d6730d5a7d8`, and `bun.lock`. Keep appearance,
scroll positions and selected files equal. Native capture may fail transiently;
a successful build or accessibility snapshot alone does not establish visual parity.
The October 30 comparison used successful full-window native captures of light and
dark Home, the same unstaged `models.md` patch, and the same immutable `bun.lock`
commit. It corrected Sidebar material, tab/avatar placement, compact typography,
checkbox alignment, diff gutters, hunk heights, changed-word backgrounds and the
revision/file split and read-only outgoing markers. Native automation also caught
a multiple-active-descendant panic when focus returned to the shared workspace;
lists and menus now report an active descendant only while they own focus. A fresh settled Home capture showed a four-column grid;
tiles now measure the real library width, reflow between columns on resize and
virtualize complete rows. The supplied single-column Home capture represents its
initial measurement state. The live `pkgs` checkout changed branches during verification;
comparison of commit details stayed anchored to the immutable SHA above.

Geometry/event tests pin Home dimensions, workspace chrome, file rows, composer,
hunk/line heights, proportional resizing, focus, retained navigation and real Git
operations. Run the app/UI and gallery tests, Clippy, rustfmt, rustdoc and workspace
spacing checks described in `docs/RUST.md`.

## Intentional differences

Rust retains index staging rather than the source app's selected-file inclusion
workflow. It retains explicit page loading in History. Unported AI, amend/undo, stash,
graph, account and SSH actions are unavailable. Read-only diffs do not include
hunk staging, context expansion, syntax highlighting or text selection.
These are behavior gaps, not a claim that the full original application is ported.
Only persisted source library/cache entries are imported; unsaved source runtime
state can differ. Repository contents, refs and the source session are not written
by import or preview operations.

## Multiple tabs and automatic refresh

`workspace-tabs-model.ts` maps to `workspace/tabs.rs`: window-owned repository
entities retain each draft, file/side, History commit/file, filter, view mode and
pane sizes. The original close order (right, left, Home), busy-close guard and
reorder identity are preserved. Duplicate-root tabs are supported with independent
state and a shared monitor/read queue. Home navigation does not dispose tabs.
`RepositoryRefresh` maps to `tabs/refresh.rs`; `RepositoryWatcher.watch` maps to
`watch.rs` using notify's native backend. Native setup/teardown and Git reads run
off the UI thread. Worktree, git-directory and common-directory subscriptions
cover linked worktrees; metadata filtering excludes locks/objects/logs and access
noise. The original 250 ms trailing debounce / one-second maximum, in-flight
invalidation, write pause/cancellation, window-activation refresh and disposal
are preserved. Automatic refresh keeps the old snapshot on errors and preserves
immutable selected History detail when HEAD changes.

Test mappings: `workspace-tabs.unit.test.ts` close/Home/reorder cases map to
`multiple_tabs_home_reordering_and_closing_keep_independent_drafts_and_selections`
and `closes_right_then_left_keeps_active_on_inactive_close_and_rejects_busy_close`.
The source refresh timing tests map to the deterministic queue test; source
`auto-refresh.component.test.tsx` sharing, same-status patches, History, pause and
failure cases map to `tabs/tests.rs`. `watch.rs` additionally exercises real nested
file changes, external shared refs and watcher teardown for a linked worktree.
Shared UI viewport state is explicitly retained outside the render tree.

As in the source watcher, ignored
worktree build-output changes can invalidate status. File-watch availability
still depends on the filesystem; failures retain manual and focus refresh.

Native verification used two disposable repositories: distinct drafts, a retained
`b.txt` selection, Home round trips, keyboard reordering, background badge updates
from an external edit, and a retained History commit/file. The live two-tab Changes
capture was compared with the original app's two-tab Changes capture; inactive
label ink and badge size/opacity were corrected to the source styles. A native
pointer-event regression also verifies drag/drop ordering without replacing views.

The final matching-screen capture used `onbot / master` and `pkgs / development`
in both apps, with `docs/guides/models.md` selected in Changes (+2/−0). The runnable
Rust bundle is left on that two-tab workspace; verification did not stage, commit,
or change refs in either real repository.

## Tab motion and gestures

The initial tab port retained repository state but used static selection surfaces
and native drag images. `tabs/motion.rs` now owns `gpui-ce-motion` values at window
scope so switching repository entities cannot restart selection motion. Its shared
connected surface and tab reflow use the source 240 ms `(0.22, 1, 0.36, 1)` curve.
A captured eight-pixel-threshold gesture moves the tab in place, previews adjacent
slots, commits order on release and returns on Escape/window deactivation. Edge
scrolling uses elapsed time rather than the display's frame rate. Native layout
and hit targets use the same presented coordinates; no second GPUI renderer or
native motion adapter is enabled.

Overflowing labels use source timings: 320 ms hover/focus delay, 48 px/s bounded
to 700–2200 ms, and a 220 ms return. Hover/close feedback uses a short 80 ms tween.
Motion samples request frames only until settled, and reduced motion snaps.
Tests check intermediate native selection/neighbor bounds, interrupted transitions,
preview-versus-committed drag order, Escape, label delays/return and idle frames.
The active tab also opens the attached branch picker with click, Enter or Down.

The motion pass passes 58 app tests, strict all-target Clippy, rustfmt, rustdoc,
workspace spacing checks and the native build. The running app was exercised with
`onbot` and `pkgs` using tab switching and keyboard reordering; the timing and
pointer preview/cancellation assertions use clock-controlled native frames rather
than relying on delayed screen captures.


## Workspace session restoration

| Source | Rust |
| --- | --- |
| `WorkspaceSession.capture/parse/restore` | `tabs/session/model.rs`, `SavedTab::capture/install`, `Workspace::restore_session` |
| `WorkspaceSessionStore.load/save` | `tabs/session/store.rs` |
| `useWorkspaceSession` debounce/exit flush | `Workspace::session_changed`, quit/release subscriptions |

Source tests for ordered duplicate-root tabs/drafts, Home selection, and malformed
/future/path documents map to `round_trips_tab_order_separate_drafts_home_and_exact_paths_without_git_state`,
`home_and_intentionally_empty_session_survive_restart`, and
`malformed_future_oversized_and_invalid_paths_are_rejected_without_losing_saved_bytes`.
`restart_restores_order_duplicate_root_drafts_selections_modes_filters_and_panes`
exercises real Git reads through fresh native windows. Additional tests cover
missing repositories, close before the debounce, latest-write ordering, save retry,
unchanged-render write suppression, and non-UTF-8 roots/private permissions.

The Rust document is separate from the original session and Home library. It saves
per-tab filters, diff modes and panes rather than the source's global view settings.
Exact Git path bytes and native non-Unicode roots round-trip without escaped-label
identity. As in the source, Home and an intentionally empty workspace stay empty,
invalid data blocks saving, and only navigation/drafts are persisted. No snapshots,
credentials or pending operations are saved or replayed. History rereads the exact
immutable commit, including a selection outside the first 50 rows; previously loaded
rows are restored up to the source's 10,000-row budget. Startup repository reads are
bounded to four. Deliberate limits are 128 tabs and 8 MiB (source: 1 MiB), with explicit
errors rather than draft truncation. Restart scroll offsets remain outside this pass.

Validation: `cargo test -p onegit-app --features test-support --lib` passed 70 tests;
`cargo test -p onegit-ui --all-targets --features test-support` passed 101 tests
including the gallery. The original `session.unit.test.ts` passed 24 tests.
Workspace Clippy with all targets/features and warnings denied, rustfmt, app/UI
rustdoc with warnings denied, native app build and logical spacing checks passed.
The spacing check also compiles Windows/Linux Git code; native restart tests ran
on macOS. No changeset is needed for these unpublished Rust crates.

A real bundle quit/relaunch restored `onbot` and `pkgs` in order, the active History
tab and immutable commit/file, two independent drafts (including a multiline body),
the Changes `models` filter and selection, split diff and pane preferences. The
entire saved document matched before and after relaunch. Temporary drafts were
cleared afterward. Both existing repositories retained their HEAD/index bytes.
The freshly signed bundle initially needed the native folder picker to complete
macOS folder access; the subsequent restart restored without another picker.


## Branch navigation and writes

| Source | Rust |
| --- | --- |
| `WorkspaceMenu` sidebar search/recent/expanded/create/remote forms | `workspace/branches/{mod,view}.rs` |
| `WorkspaceMenuModel` and `RepositoryBranchTargets` | `branches/model.rs` and date-ordered `onegit-git::BranchCollection` |
| `RepositoryBranches.write`, `RepositoryBranchChanges` | Existing `Repository::change_branch`, called through `write::Operation::Branch` |
| Window-owned branch completion and shared-root invalidation | `tabs/branch_actions.rs` |

The original 288-pixel, 28-pixel-row picker layout and 160 ms ease-out height/opacity
transition map to an attached `DialogPresentation` with `gpui-ce-motion`. Standard
dialogs keep their existing layout. The attached presentation shares modal focus,
outside/Escape dismissal and busy guards with ordinary dialogs. Branch rows reuse
`ListRow` feedback and can expose current-branch context without changing visible
labels. Local refs are already sorted by Git; presentation keeps the current local
branch first, hides tracked remote refs, filters without mutating metadata, and
retains source numeric-auto English age labels. Remote selection uses an exact ref,
never a guessed remote, and never contacts the network.

Source test mappings: `workspace-menu.unit.test.ts` ordering/tracked-ref/date cases
map to `branches/model_tests.rs`; `repository-branches.integration.test.ts` local
creation/switching, remote tracking, dirty Leave/Bring/Restore, conflicts, stale
review and worktree ownership map to `tabs/branch_tests.rs`. The native tests also
cover duplicate-tab refresh and drafts/layout, busy protection before the next
frame, intermediate geometry, reduced motion, active-tab access and idle frames.
Real Git fixtures prove mixed staged/unstaged/untracked work and recovery backups
survive partial failures. An unborn repository can change its symbolic branch
without inventing a commit.

This pass exposes search, create/switch, direct remote tracking and managed dirty
work recovery. The source menu's rename/delete, integration, comparison, worktree
and settings actions are omitted until those workflows are ported. The active tab
is reconstructed above the backdrop when it opens the picker, including its cached
avatar and connected surface; clicking that preview dismisses the menu. Session
restoration continues to store navigation/drafts, never a pending branch action or
dirty-switch consent. No changeset is needed for unpublished
Rust crates.

Validation: 83 app tests, 101 UI/gallery tests and 36 original branch-menu/branch-write
tests pass. Strict workspace all-target/all-feature Clippy, rustfmt, app/UI rustdoc,
native app build and workspace spacing checks pass. The spacing check also compiles
Windows/Linux Git code. Native branch tests use disposable real repositories; the
existing onbot/pkgs repositories retained their exact HEAD/index bytes during the
read-only bundle check. The rebuilt, signed bundle is installed and running.

Live captures of both branch pickers using `pkgs` / `development` revealed an extra
search separator, narrower row insets, smaller/different glyphs, a verbose More
label and an extra Close action in Rust. The corrected picker removes those extra
rows, uses the source eight-pixel row insets/gaps and fourteen-pixel Phosphor glyphs,
and shows More with its caret while retaining the descriptive accessible name.
Menu rows are a single full-width button, including decorative glyphs and metadata;
standard content rows retain independently interactive slots. Native geometry and
pointer tests verify the first branch starts directly below the 32-pixel search and
clicking its glyph activates the row. The supported creation form's wording and
controls were also checked against the current app's accessibility tree.

A post-correction foreground capture verified the supported picker rows against
the reference `pkgs` / `development` menu, plus live filtering to `read-abort` and
opening/cancelling the empty creation form. The geometry checks agree with the
observed search/row alignment. Background captures can still return Stage Manager
thumbnails or stale accessibility frames. This is scoped branch-picker verification,
not a claim of pixel parity for the entire application. Worktree and integration
menu actions remain outside this pass, so their rows are intentionally absent.


## Explicit repository synchronization

| Source | Rust |
| --- | --- |
| `RepositorySyncButton` rail, status and publication review | `workspace/sync/{rail,view}.rs` |
| `RepositorySync.fetch/write` | `sync/worker.rs`, existing `Repository::fetch/sync_branch` |
| `RepositorySyncProgress`, `syncProgressLabel` | native GPU-path gauge in `sync/rail.rs`, `model::progress_label` |
| Window-owned pending state, cancellation and shared-root refresh | `sync::Sync`, `tabs/synchronization.rs` |

Source tests in `repository-sync/state.unit.test.ts` map to
`opening_sync_never_transports_and_fetch_refreshes_duplicate_and_linked_tabs_without_losing_state`,
`rejected_push_keeps_error_until_explicit_action_and_refreshes_all_tabs_without_replaying`,
`uncertain_status_preserves_drafts_and_selection_but_blocks_writes_until_a_fresh_read`,
and the progress-label test. Source `sync.integration.test.ts` fetch, fast-forward,
dirty/diverged pull, exact-upstream push, publication, stale review and ambiguous
remote cases map to the corresponding `tabs/sync_tests.rs` fixtures. Rail tests for
publication confirmation, multiple remotes, Escape, Command-R, busy ownership and
cancellation map to the native event tests. Source progress tests map to the
phase-local GPU gauge and clock-controlled panel geometry/reduced-motion/idle tests.

The rail opens an explicit action panel rather than guessing and executing a
combined sync action. This is an intentional user-requested change from the source:
opening Synchronization never sends or receives repository objects. Fetch visits
each configured remote; Pull is clean-worktree, fast-forward-only; Push uses the
reviewed commit and exact upstream. Publishing requires a fresh reviewed local
branch, one effective push destination and explicit confirmation. Destination
configuration is reread before transport. No force/mirror, tag push, integration,
repository hosting or account picker is introduced here. Existing Git helpers and
SSH configuration remain available; account credentials are never copied into
workspace/session state.

One controller per canonical common directory owns progress, cancellation and the
last confirmed fetch, with a bounded latest-progress channel and a dedicated
transport worker. Only the retained rail/panel repaint for progress. The Rake task
scope observes cleanup; window release/app quit/Stop cancel through Git's owned
process-tree cleanup. Timeout is 120 seconds. Every result rereads each distinct
worktree separately, including partial failures, and updates all related tabs and
Home while retaining drafts and navigation. Uncertain status blocks local writes
until a successful read; no pending operation or publication consent is persisted.

The centered panel retains source 340/400-pixel widths, themed controls and a
160 ms gpui-ce-motion transition; determinate progress settles over 120 ms. The
270-degree rail gauge is painted directly as GPU paths, and sending 100% means
waiting for Git confirmation. Reduced motion stops the unknown sweep and snaps
size changes. Unrelated repositories retain independent progress and views.

Validation: 98 app tests and 101 UI/gallery tests pass; the 14 native sync tests
were rerun after the final row-layout/focus correction and pass. Workspace
all-target/all-feature Clippy with warnings denied, rustfmt, app/UI rustdoc, native
build and workspace spacing pass. Spacing also compiles Windows/Linux Git code.
The original state/transport suites pass 22 tests. Its isolated publication test
and light/dark gauge correctness tests pass another three, with captured reference
images. Two optional source scrolling benchmarks return no scroll offset and fail;
the TypeScript app was unchanged, and those failures are not Rust-test results.

The captured reference publication dialog established a 400-by-168-pixel one-remote
layout, forty-pixel choice rows, eight-pixel corners and a destination-specific
confirmation. Compact dialogs retain caller-owned content and source modal shading;
standard dialogs retain their existing chrome. Native geometry tests pin that
publication size, horizontal action/footer rows, initial Close focus, visible branch
details, intermediate width transitions, reduced motion and settled idle frames.
The first live Rust capture caught stacked actions and focus scrolling identity out
of view; both were corrected and covered by regression assertions. The user confirmed
the final live panel is visible with horizontal buttons. Final automatic capture
still returned a blank frame, so final screenshot-level pixel parity is unverified.

All transport execution used disposable local bare remotes and worktrees. Live
inspection only opened/dismissed the Rust synchronization panel; HEAD, index,
FETCH_HEAD and ref digests in the existing onbot/pkgs repositories remained exact.
The persisted workspace document also matched the pre-check document. The rebuilt,
signed app bundle is installed and running; operations/consent are not restored.
No changeset is needed for these unpublished Rust crates.

## Stash management

| Source | Rust |
| --- | --- |
| `RepositoryStashes.read/entry`, lazy `useRepositoryStashes` | `workspace/stashes::{Stashes, view}` |
| `RepositoryStashes.readFiles`, saved revision diff reads | `stashes/read.rs`, shared immutable `history::read::patch` |
| `RepositoryStashActions` create/delete popovers and Apply row | `stashes/{form,view}.rs`, shared window `DialogHost` |
| `RepositoryStashes.write`, `StashDeletion.run` | reviewed `Repository::change_stash`, `onegit-git/src/stash.rs` |
| Shared stash mutation refresh and per-tab intent | `tabs/stash_actions.rs`, `write::run_stash`, optional session `StashView` |

The source `state.unit.test.ts` OID-renumbering/removal/cache/late-read contracts map
to `reads_lazily_selects_first_files_keeps_immutable_selection_and_patch_after_renumbering`
and `repository_replacement_cancels_obsolete_list_and_file_reads`.
The source `stashes.integration.test.ts` create/apply/identity/conflict cases map
to the corresponding `stashes/tests.rs` real-Git tests. Saved tracked and third-parent
untracked previews include separate immutable revisions when paths coincide.
The source deletion race/packed-ref cases map to
`git_stash_lock_excludes_an_external_writer_during_reviewed_identity_lookup`,
`final_ref_cleanup_keeps_a_new_stash_inserted_by_an_external_client`,
`packed_last_stash_deletion_preserves_head_index_and_working_files`, and the
renumbering, middle-entry and duplicate-ID/corrupt-reflog/foreign-lock tests.

Source `actions.component.test.tsx` confirmation, cancellation, captured request,
busy guard, failure/retry and layout cases map to `stashes/form_tests.rs`, native
stash state tests and `tabs/stash_tests.rs`. Source lazy read, automatic preview,
cache and tab-retention cases map to the native stash tests. The full source suite
passes 25 tests. Native modal tests check Cancel focus for deletion, narrow-window
placement above the trigger, animated error height, reduced motion and settled
animation values. The restart test uses real serialized workspace state and a new
window; older version-1 documents without the optional stash field still load.

Save includes all tracked changes and optionally untracked files; ignored files
remain untouched. Apply preserves the saved copy and requires a clean worktree.
Pop is the requested extension to the source UI: apply the exact OID first, then
remove only that OID after success. Conflicts keep saved work. Failure to delete
an already-applied Pop is reported as partial completion, never as an unstarted
write. Destructive deletion always requires the captured confirmation and rejects
ambiguous duplicate OIDs. The files reference backend uses Git's stash ref lock
through OID lookup and reflog replacement; final packed/loose ref cleanup uses
compare-and-delete, preserving concurrent inserts. Other ref backends fail safely.
No operation is replayed automatically.

Related worktrees share busy guards. Accepted work stays busy through fresh
reads of each distinct open ready worktree; each exact-root tab gets its own
worktree's snapshot, keeping drafts, filters, file selection and panes. Failed
refreshes retain the last view and block writes until a fresh read. Successful
Apply/Pop opens Changes only in the originating tab. Stash list/file selection,
diff mode and pane sizes are saved per tab; pending actions and confirmation are
never serialized. The immutable preview/cache survives renumbering and refresh.

The Stashes view uses the source 48-pixel saved rows, 28-pixel file rows, stacked
resizable sidebar, action row, footer, original static empty-state vectors and
anchored create/delete forms. Buttons, menus and toasts reuse the existing motion
components. The forms use a fast 140 ms gpui-ce-motion opacity/height transition;
reduced motion snaps, and settled forms request no animation frames. Binary and
oversized patches retain the existing Rust notice behavior; source raster-image
previews and tree file layout are separate remaining renderer features.

Validation: 128 app tests, 312 Git tests and 101 UI/gallery tests pass. All 25
original stash tests pass. Strict workspace all-target/all-feature Clippy,
workspace spacing (including Windows/Linux Git code), rustfmt and app/UI/Git
rustdoc pass. Native layout tests compare the source action-row measurements at
wide/narrow widths, including stable panes under modal forms. Actual GUI writes
were restricted to disposable fixtures; the real repositories are inspected
read-only. The final native comparison is recorded below.
No changeset is required for these unpublished Rust crates.

The create form preserves a cancelled message across other stash operations and
retains the untracked checkbox after a successful save, matching the source's
separate create/selection form state. Only an accepted successful Save clears its
message. Commit drafts remain independent throughout.

Native accessibility activation exposed a focus-ownership bug that the fake test
platform does not activate: both selected lists claimed an active descendant while
the workspace ancestor had focus. Rows now use History's non-button list semantics
and only the focused list marks its selected descendant. Repeated OIDs mark only
one row, while writes remain safely rejected as ambiguous. Pane keyboard focus
and tab navigation have regression coverage; final native startup is checked
with the OS accessibility adapter active.

The final foreground Rust capture shows the corrected left-aligned stash title
and date, visible Apply/More/New stash controls, 93 saved files and the selected
`.dockerignore` unified preview (+39/-0) in pkgs. The source app was inspected
on the same repository, stash and file; source fixtures provided the row and
form measurements. Native restart, file-list Up/Down and Tab navigation passed
with accessibility active. The final source background capture remained a
Stage Manager thumbnail, so this is not a claim of whole-app pixel parity.

## Discard and restore changes

| Source | Rust |
| --- | --- |
| `RepositoryFileActions.canDiscard`, file menu and Changes header | `discard::Selection`, row/keyboard context menus and header actions |
| `NativeFileMenu.confirm` / `confirm_file_discard` | Cancel-first `discard::Form` using the shared alert dialog host |
| `RepositoryFileActions.discard`, `discardFiles` | existing disk-backed `Repository::discard_files` plus scoped `discard_reviewed` |
| Session-owned `undoDiscard` | `restore_discard` and captured recovery actions |
| Workspace mutation refresh | `tabs/discard_actions.rs`, separate reads per related worktree |

A single-file discard removes both staged and unstaged edits to that path, rather
than just the side currently displayed. Snapshot paths are deduplicated before
confirmation and remain frozen with the branch/HEAD. Whole-list actions use the
complete snapshot even when files are filtered. Renames/copies, type changes,
submodules, conflicts and unfinished operations are not silently skipped.

The requested tracked/untracked split is deliberate: unlike the original mixed
“Discard all changes” action, “Discard all tracked changes…” leaves new files
alone. “Delete all untracked files…” has its own confirmation and rejects a path
that became tracked. Scope is checked inside the existing shared mutation guard,
before backup and again before application. Reviewed restore also checks branch,
HEAD and operation state under that guard. External writers remain possible;
checked patch application provides the existing non-forcing boundary.

Recovery patches, manifest and instructions are durably captured before writes
under the Rust app's private application-state recovery directory. Staged and
working data restore separately. The session-owned token expires after 15 seconds,
is single-use and is never serialized. Older notification actions retain their
exact recovery token. Expiry, failed operations and restart do not delete backups.
Errors retain backup paths and compensation failures; nothing retries automatically.
After any outcome, each related root is reread independently. Failed refreshes keep
the previous view and block more writes until reviewed. Drafts, surviving selections,
filters, diff modes and pane sizes stay local to each tab.

The source's native alert was captured with `docs/guides/models.md` selected, then
cancelled without accepting a write. The Rust alert follows its compact 260-pixel
width, app icon, 13/16 typography, neutral stacked actions and initial Cancel focus.
The embedded icon is a static AppKit rendering of the existing installed app icon.
The Rust host supplies modal focus/input isolation and a 140 ms gpui-ce-motion
opacity/height transition. Reduced motion snaps; settled alerts request no frames.
Right-click/Control-click and Shift+F10 reuse the dropdown's navigation, clipping,
disabled-action and focus-restoration behavior without adding file-row tab stops.

Tests map the original whole-list/filter/unsupported guards to selection and
workspace discard tests, native confirmation and close protection to form and
pointer/keyboard tests, and index/working/Undo/backup failures to the existing Git
discard suites plus `discard_reviewed.rs`. The new category and stale-restore cases
cover the requested separation. The original app's 18 backend discard tests pass.
Its component suite requires a rebuilt GPUIX addon, unavailable in this checkout;
the installed app supplies the live confirmation reference instead.

Validation: all 554 workspace tests pass (138 app, 315 Git and 101 UI/gallery).
Strict all-target/all-feature Clippy, rustfmt, rustdoc, the normal app build and
workspace spacing checks pass; spacing also covers Windows/Linux Git code.
The development app bundle passes strict signature verification. CI was not run.

The matching source and Rust single-file confirmations were inspected on
`docs/guides/models.md`. The final fresh-process capture confirms the corrected
16-pixel corners, 52-pixel icon and stacked actions. Native paragraph wrapping
still differs slightly; this is not a claim of whole-app pixel parity. Live
confirmations for all 10 tracked files and all 11 untracked files were also opened
and cancelled. No live repository write was accepted. Existing HEADs, index,
tracked changes, existing untracked bytes and commit drafts match the baseline.
Eight additional onbot untracked files appeared during concurrent external work.

No changeset is needed: the changed Rust crates are unpublished, and no TypeScript
release package is changed.

## Conflict resolution and operation controls

| Source | Rust |
| --- | --- |
| `RepositoryConflicts.read`, `ConflictPreviewModel` | `workspace/conflicts/read.rs`, bounded immutable index/working comparisons |
| `RepositoryConflictFiles`, `RepositoryConflictPreview` | grouped operation file lists and split previews in `conflicts/view.rs` |
| Whole-file version choice and `resolveConflict` | frozen `Action::Resolve`, Cancel-first `Form`, `resolve_reviewed_conflict` |
| `RepositoryOperation` continue/abort | `FinishOperation` with reviewed operation, HEAD and durable marker token |
| Workspace mutation refresh | `tabs/conflict_actions.rs`, independent related-worktree reads |

Stage 2 and stage 3 are read as immutable blobs. Rebase labels are "Upstream
version" and "Replayed commit", retaining Git's actual index-side semantics.
The working result keeps exact UTF-8 bytes, BOM, newlines and markers. Preview
reads and switching comparison sides never stage or edit files. Comparisons run
off the UI thread through bounded Git no-index diff, with external diff/textconv
disabled, and share the existing split viewer's virtualized scrolling.

Whole-file replacement freezes the displayed working hash, indexed blob OID,
branch/HEAD and operation fingerprint. The Git writer checks them under the
common-directory guard before replacement and staging; replacement bytes come
from the immutable reviewed blob. Manual "Mark resolved" stages only the exact
reviewed path, refuses marker content, and never continues. Deleted, linked,
binary, oversized and nested-conflict cases retain explicit unsupported behavior;
the writer does not silently resolve them. The original conservative backend
marker guard (including custom three-character markers) also governs the Rust
display, rather than enabling a button the writer would reject.

Continue and confirmed Abort are exposed for merge/rebase. Continue refuses
unmerged or unstaged tracked changes, preserves Git's existing message, hooks and
signing, and never implicitly stages. Abort warns that resolution edits may be
lost. Failed commands are not replayed or compensated; a fresh status read shows
partial effects or a subsequent rebase pause. Fresh operation state is rebuilt
after restart; consent is never serialized.

Each related root is refreshed separately after every accepted outcome. Drafts
are not cleared by resolutions or continuation, and surviving selections,
filters, diff modes and pane widths remain tab-owned. Unreadable refreshes keep
the prior view and block more writes. App-owned tasks and shared busy state
protect close/quit and concurrent writes through the final refresh.

The original 320-pixel anchored confirmation, Cancel-first focus, source washes,
amber operation strip and separate conflict/other-change groups are retained.
Measured trigger bounds place confirmations for pointer and keyboard activation.
Confirmation opacity/height use gpui-ce-motion with a 140 ms ease-out; reduced
motion snaps and settled forms request no further animation frames. Existing
buttons retain their motion and expose an optional accessible pressed state for
the source selectors. Conflict previews use one aligned virtualized split list
with shared hunk headers, fixed column bounds and synchronized scrolling.

Source preview tests map to `conflicts::tests` (multiple/incomplete markers,
unchanged and bounded comparisons, Unicode/newlines and separated hunks).
Source resolution cases map to the existing Git conflict suite plus the new
reviewed-operation/blob-identity case. Source operation merge/rebase cases map to
the existing Git integration suite and app worker tests. Native pointer tests
cover side replacement, default Cancel, abort cancellation/confirmation and
shared refresh with independent drafts, selection, filters and pane widths.
Form tests cover frozen consent, duplicate/busy rejection, failure review and
reduced-motion geometry.

Differences: the source's external-editor preference has not been ported;
"Open editor" uses macOS's default text editor after validating a regular
canonical path inside the repository; other platforms show manual-editor guidance. Interactive hunk context expansion and
syntax highlighting remain shared diff-renderer gaps. Cherry-pick/revert and
squash operation controls remain outside this merge/rebase slice.

No changeset is required: these Rust crates are unpublished and no TypeScript
release package is changed.

Native QA uses a disposable paused merge with the same theme.ts selected in both
apps. The source and Rust operation strip, source controls, paired patch and frozen
replacement confirmation were inspected at the same window size. Comparing them
removed redundant split labels and inclusion gutters, corrected shared hunk
headers, matched the amber source/result treatment and tightened the popover.
A native accessibility restart caught duplicate row identities in the aligned
renderer; old/new cells now have distinct stable IDs. The corrected executable
was verified against the running bundle and restored the screen with accessibility
active. No live repository action was accepted during comparison.

The original 24 preview/resolution and 14 operation backend tests pass. Its two
native component suites stop at preload because the checkout's GPUIX addon is
missing/stale; the installed app provides the live UI reference instead.

Validation: the full workspace run passes 567 tests. The final 15-test focused
conflict rerun includes the additional literal Unicode/pattern filename case,
bringing coverage to 568 tests total. Strict workspace all-target/all-feature
Clippy, rustfmt, rustdoc, the normal app build and workspace spacing (including
Windows/Linux Git code) pass. The development bundle passes strict signature
verification. CI was not run.
