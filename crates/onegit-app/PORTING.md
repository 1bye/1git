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
workflow. It retains explicit page loading in History. Unported AI, SSH, reset and tag-writing actions are unavailable. History, stash and conflict diffs
support text selection and copying, but remain read-only.
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
canonical path inside the repository; other platforms show manual-editor guidance. Shared context expansion and syntax highlighting are described below. Cherry-pick/revert controls are described in the replay port below; squash
operation controls remain outside this merge/rebase slice.

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

## Diff syntax and unchanged context

| Original implementation | Rust implementation |
| --- | --- |
| `DiffContext` request/expand and unit cases | `onegit-ui/src/diff_viewer/context.rs` |
| `RepositoryDiff.readText` optional syntax context | `workspace/read::document`, shared Changes/History/Stashes worker reads |
| Conflict indexed/working comparisons | `conflicts/read::compare_named`, using the actual GitPath as a language hint |
| Native syntax cache and token palette | `diff_viewer/syntax.rs`, reference Syntect grammars and prepared per-side spans |
| Native expansion, keyboard and virtual scrolling | `diff_viewer/rows.rs`, `state.rs`, `onegit-ui/tests/diffs.rs` |

All four repository views use the same immutable prepared document. Hidden context
is optional and read on the existing background preview worker. Exact headers,
edits, source coordinates, newline markers and visible context must match before
it is attached. A failed, oversized or racing full read leaves the ordinary
preview available. Context is never used as staging or resolution input.

Click a hunk separator or the trailing control to reveal up to 20 unchanged
lines. E expands the first remaining gap and then trailing context. Adjacent
hunks merge only when both source coordinates meet; known EOF removes the final
control. Expanded previews retain the source's 512 KiB/2,000-line/4,000-byte-line
budget and explain when that budget is reached. The immutable hidden patch uses
the existing bounded Git reader and parser (16 MiB and 200,000 patch rows).

Highlighting prepares separate old/new streams with the source app's light/dark
token palette. Bundled grammars cover JavaScript/JSX, TypeScript/TSX, Rust,
Python, Go, JSON/JSONC, CSS, HTML, Bash, C, TOML, Markdown and YAML. Other extensions remain plain text.
Multiline comments and strings use omitted context without displaying it.
Fragment fallback resets parser state across gaps. Syntax parsing is bounded to
512 KiB, 2,000 source lines and 4,000 bytes per line; oversized sources fall back
to visible fragments. UTF-8 offsets are mapped through visible tabs and controls.
Foreground syntax and changed-word backgrounds are composed without overlap.
No parsing runs during scrolling, theme changes or ordinary rendering.

Expansion preserves the source-line anchor, offset within its row and horizontal
scroll, clamped by the available content extent. Both split layouts share scroll
state. Repository screens use fixed aligned panes and one shared hunk header,
without the gallery's optional Before/After captions. Unchanged refreshes and tab unmounts retain expansion; changed snapshots
retain the viewport while rebuilding context. Conflict source sides now own
separate retained viewers. Drafts and file selections are unchanged.

Expansion controls use the existing 80 ms gpui-ce-motion hover/press treatment;
newly revealed rows fade in over 100 ms without moving existing hit targets or
animating scroll. Reduced motion snaps and settled viewers schedule no frames.
The gallery includes an expandable TypeScript sample.

Tests characterize 20-line steps, per-gap isolation, hunk merging, EOF/missing
newline, CRLF/Unicode, stale headers/edits/context, display limits, multiline
syntax, independent rename languages, gap resets and unsupported/large-source
fallback. Native interactions cover exact viewport retention in unified and both
split layouts, E/pointer expansion, mode changes, hidden tabs, same-file refresh,
shared scrolling and settled motion.

Native QA has verified expansion controls in Changes, History and Stashes and
highlighted TypeScript in the running development bundle. The matching reference
screen comparison is pending: reads of the installed original application's
window currently time out, and background captures can return stale frames or
Stage Manager thumbnails. An earlier attempt reported the Mac was locked. After resuming, Rust accessibility
works again, but the installed reference app still fails screen capture. This is not a claim of completed visual parity.

No changeset is required: the Rust crates are unpublished and no TypeScript
release package changed.

Validation: the full workspace run passed 575 tests. Final UI and app reruns pass
112 and 150 tests respectively; the final UI suite includes three additional
syntax/scroll cases, bringing combined coverage to 578 tests. After the final
context-index optimization, all 34 UI library and nine diff interaction tests pass.
Strict all-target/all-feature workspace Clippy, rustdoc with warnings denied,
rustfmt, Git whitespace checks and workspace spacing (including Windows/Linux Git
code) pass. The normal app build succeeds, and its signed development bundle is
running. CI was not run. Matching-screen visual verification remains pending.

## Hunk and line staging, selection and copying

| Current app source | Rust implementation |
| --- | --- |
| `native/diff-inclusion.patch` group and line rails | `onegit-ui/diff_viewer/staging.rs`, two 18-pixel gutters, keyboard-focusable native controls |
| `RepositoryTextDiff` snapshot-bound selection | Frozen `DiffStageRequest`, retained original patch and app root/branch/HEAD guards |
| Native diff source selection and clipboard | `diff_viewer/selection.rs`, native shaped-text hit testing, raw-source byte selection |
| `packages/git` PartialPatch | Existing Rust `PartialPatch`, reused by `Repository::change_lines` |
| Source viewport retained across status updates | `DiffViewerState::refresh` source-side anchor and pixel offsets |
| Shared repository refresh | `workspace/tabs/staging_actions.rs`, independent related-tab drafts, selection, mode and filters |

The intentional index-staging behavior remains: these actions change the actual
Git index, rather than the source app's selected-commit inclusion set. A changed
line, contiguous change group, complete hunk or selected text can stage/unstage
its changed-source coordinates. Unsupported patches (renames, mode/type changes,
binary or submodule updates) retain whole-file staging. Eligibility is prepared
on the preview worker; patch parsing never runs during selection or motion frames.

Each write holds the repository's common-directory mutation queue and an owned
real index lock. It prepares a private index, revalidates the original three-line
context diff, branch and HEAD, then atomically installs it. Unstaging restores only
the selected path in that private index and reapplies complementary unselected
changes. It preserves unrelated staging and every working-file byte. Foreign locks,
unknown coordinates, changed diffs/branches and a replaced tab root are rejected.
Errors never automatically retry writes; failed refreshes block subsequent writes.

Dragging selects exact raw source text without diff prefixes, gutters or synthetic
newline notes. Tabs, Unicode and CRLF survive copying. Split selection stays in its
starting column even if the pointer crosses the divider. Double/triple click selects
a word/line, Shift+arrows extends, Command/Ctrl+A selects source text,
Command/Ctrl+C copies, and Escape clears selection. Selection crossing changed
lines exposes Copy and Stage/Unstage selected lines; History/Stashes/conflict
previews expose only Copy. Dragging outside the viewport scrolls while held and
stops on release or window deactivation.

The original app's rails, dimensions, colors and grouping guided the controls.
Fast hover/press feedback uses gpui-ce-motion; reduced motion snaps and settled
controls request no animation frames. Hunk buttons and the selection toolbar
provide explicit action labels. The toolbar overlays the viewport without
changing row heights or scroll position.

Coverage includes native pointer/keyboard/copy events, synchronized split
selection, original-patch requests after expansion, stale old-frame controls,
pixel anchors after index changes, real Git partial stage/unstage, CRLF, missing
newlines, unborn/deleted/literal-path files, cancellation, foreign locks, and
duplicate/linked tabs with independent drafts. A replaced repository with the
same HEAD and patch cannot receive an old tab action.

The installed reference app still fails screen capture; matching-screen visual
verification is pending. This limitation is separate from the native event and
real-Git checks above.

Validation: the all-target/all-feature workspace run passes 593 tests. The final
UI rerun passes 126 tests including doctests; native tests cover selection across
virtualized rows, drag auto-scroll stopping on release, and source pixel offsets
after partial stage/unstage. The source PartialPatch's three Bun tests also pass.
Strict workspace Clippy, rustdoc with warnings denied, rustfmt, Git whitespace
and workspace/Windows/Linux spacing checks pass. The normal signed development
bundle builds and is running. CI was not run.

Live macOS verification used only the disposable
`target/diff-qa/comparison-npne66yc` repository: line stage/unstage and hunk
stage/unstage changed exactly the intended index content, retained the draft,
and refreshed the file entries. Triple-click selection exposed Copy and Stage
selected lines; Copy and Escape worked. The fixture index and temporary draft
were restored afterward. A fresh native frame confirms the Rust rails and hunk
actions at the normal window size. Reference capture still fails, so no completed
matching-screen comparison is claimed.

No changeset is required: the Rust crates are unpublished and TypeScript release
packages are unchanged.

## Amend and Undo last commit

| Current app source | Rust implementation |
| --- | --- |
| `RepositoryLastCommit` metadata and recovery eligibility | `workspace/read::from_snapshot`, background `review_last_commit`, retained metadata for unavailable published tips |
| `RepositoryCommit` amend header, focus and Cancel | `workspace/recovery`, previous draft retained separately, animated composer height |
| `RepositoryWorkspaceModel` amend/cancel/commit-finished transitions | Frozen root/HEAD/branch review, exact draft restoration, stale amend marker |
| `RepositoryCommit.undo` | Existing `Repository::undo_last_commit` with atomic recovery-ref creation |
| Source selected-file amend | `commit_selected_files` with message-only Files mode or exact Staged mode |
| Related mutation refresh | `tabs/recovery_actions` and shared `refresh_written_tabs` |

Entering Amend performs no write: it loads the original message into the composer,
retains the ordinary summary/body verbatim, and focuses Summary. Cancel and a
confirmed amend restore that prior draft. Failed or uncertain amendments retain
the edited amend draft and its original draft separately. A changed root, branch,
HEAD or publication status disables submission until cancel/review.

Both writes have cancel-first confirmations. Amend offers **Include staged files**
when staging exists; leaving it unchecked changes only the message and preserves
all staging. Checked uses the exact existing index, including partially staged
lines, without including working edits. The same guarded private-index transaction
handles staged amend; hooks, signing, original author and parent retention remain.

Undo moves the reviewed named branch to its parent, or makes a first-commit branch
unborn, while keeping the exact index and working-file bytes. The old commit remains
in `refs/1git/undo/…`. Only an empty originating draft receives its message;
other tabs keep their own drafts.

Publication is based on known local remote-tracking refs, with no implicit fetch.
Published, merge, detached/unborn, conflicted, active-operation and stale reviews
cannot write. The backend rechecks eligibility under the repository write queue;
Undo compares the branch tip atomically and Amend retains its old commit in
`refs/1git/amend/…`. Command uncertainty or failed refresh requires History review
and refresh, never an automatic retry. Hook diagnostics remain visible.

Related duplicate tabs and linked worktrees refresh their independent snapshots.
The origin uses the same automatic-refresh path, preserving file selection, diff
state, horizontal and vertical pixel offsets, modes, filters and pane sizes.
Closing an accepted write remains protected by the existing Rake task scope.

The composer grows in 120 ms, and confirmations reveal/resize through
gpui-ce-motion. Reduced motion snaps; settled controls request no idle frames.
The footer and amend header follow the current app. These requested confirmations
extend the current app's direct actions using its existing alert presentation.
The Rust app continues to stage the index, rather than the source app's inclusion set.
Sessions save the ordinary draft while amending; restart cancels amend mode, so a
temporary amend message cannot silently become an ordinary commit draft.

Test mappings:
- Source `commit.component.test.tsx` amend/cancel, success, failure and published
  cases → `tabs/recovery_tests` native and real-Git tests.
- Source `repository-workspace.unit.test.ts` pinned amend and draft restoration
  → stale/published/replaced-root guards and prior-draft/session checks.
- Source `last-commit.component.test.tsx` retained footer and eligibility →
  worker-prepared metadata and unavailable-reason fields; metadata reads never
  change composer dimensions.
- Existing Git commit/recovery suites plus staged-amend coverage verify author,
  tree, parent, index, working bytes, publication guards and recovery refs.

Validation: all 605 workspace tests pass across all targets/features. The final
focused app rerun passes 12 recovery-related tests, and the Git commit/amend and
Undo suites pass, including exact-index staged amend. The source workspace-model's
20 Bun tests pass. Strict Clippy, rustdoc with warnings denied, rustfmt, Git whitespace
and logical spacing for the workspace plus Windows/Linux Git code pass. The signed
development app builds and is running. CI was not run.

Live macOS verification used the existing disposable
`target/diff-qa/comparison-npne66yc` fixture: Amend loaded its message and Cancel
restored the draft; confirmed message-only amend retained the parent and working
bytes and restored the prior draft. Confirmed Undo retained the exact pre-Undo
index and working bytes, preserved the nonempty draft, and created a recovery ref.
The fixture branch and temporary draft were restored afterward. A fresh capture
shows the native-styled confirmation and amend header.

The installed reference app still fails capture, so the matching-screen visual
comparison is pending; no completed visual-parity claim is made. The native picker
also did not open through automation, so live testing used the already open
disposable fixture rather than the newly prepared recovery fixture.

No changeset is required: these Rust crates are unpublished, and no TypeScript
release packages changed.

## Commit graph

The graph is a separate repository view with captured local/remote branch tips,
peeled tags, detached HEAD, unsimplified merge parents and topological pages.
Reference search and All/Local/Remote/Tags filters match the source: they filter
the reference sidebar, not commit subjects or graph ancestry. Selecting a reference
reads its exact captured tip; Show full graph returns to the captured complete set.

| Current app source | Rust implementation |
| --- | --- |
| `repository-graph/commit-graph.ts` | `onegit-ui/commit_graph/data.rs`, worker-prepared deterministic lanes and half-row connections |
| `repository-graph-reader.ts` | `workspace/graph/read.rs` and `Repository::graph_history`, full OIDs streamed through stdin |
| `GraphCommitRow` | Virtual native list, 36-pixel rows, GPU-painted curves/nodes, theme palettes, responsive columns and accessible ref badges |
| `RepositoryGraph` | Retained per-tab refs, filters, pinned pages, retry/cancellation and repository view navigation |
| `GraphDetailsDivider` and `GraphCommitFiles` | Bounded resizable panes and the existing history inspector, first-parent file/diff reads |
| `RepositoryCommitDetails` | Subject, author/date, copy SHA feedback, tags, description disclosure and branch creation at the selected commit |
| Restart state | Optional backward-compatible graph intent in workspace session version 1 |

The graph does not check out references or fetch. Ref/page work and lane preparation
run on background executors. Append pagination uses the same immutable tips;
superseded scope/root reads are cancelled. Related-tab refresh retains immutable
commit/file previews and the top visible commit plus its within-row pixel offset.
Manual refresh also retains graph state. Native keyboard navigation and draggable, accessible scrollbars use fixed
row geometry, so jumps to unmeasured virtual rows work. Both scroll axes, selection,
diff mode, ref search/type/scope and pane sizes survive tab switches and restart.
Restart/refresh restoration reads at most 10,000 rows before falling back if the
anchor is no longer reachable. Ordinary interactive pagination remains available.

Row hover/press/selection use the existing gpui-ce-motion surface transitions.
Reduced motion snaps and settled controls do not request idle frames. Reference
sidebars cap at 420 pixels; graph/details and file/diff splits retain independent
preferences. Tooltips use opaque surfaces so graph rows do not show through them.

Tests map the source graph's four layout cases and two real-Git reader cases to
Rust topology/backend tests, plus native virtualization, controlled selection,
distant keyboard navigation, row/pixel anchors, cancelled scopes/replaced roots,
draft retention, selected committed-file previews, refresh and restart intent.
The source's six layout/reader tests pass.

New Branch… captures the reviewed commit's immutable OID and validates its
repository before submitting through the shared write queue. Creating the branch
keeps HEAD, working files and index intact, preserves drafts and selections, and
refreshes duplicate and linked-worktree tabs. Failures after the command boundary
require reopening the form before retry. The form uses gpui-ce-motion opacity and
height transitions; Cancel does not write. Reset and tag-write menus remain separate work. Cherry-pick and Revert are
described in the replay port below.

Matching native captures now use the same 1280×820 logical window, dark theme,
repository and commit: onbot at `9bc01f3`, followed by the stable
`target/diff-qa/comparison-npne66yc` fixture at merge `0160e16`. The fixture
includes two branches, a merge, two tags and a committed Rust file. Comparison
corrected the reference ordering, filled search field, filter padding, current
branch color, row corners, badge backgrounds, pane widths, changed-files heading,
branch action and scrollbars. Native Cancel checks leave HEAD, index and working
bytes unchanged; branch writes are exercised only in disposable test repositories.
Restart restored the selected merge and committed-file preview.

This completes the graph's matching-screen comparison, not a claim that every
existing app surface or syntax token is pixel-identical. The later diff/file-navigation comparison below addresses the grammar, gutter
styling and committed-file tree gaps found in these captures.

Validation: 627 workspace tests pass across all targets/features. Subsequent
focused reruns pass six native graph viewport/motion cases, eight app graph/session/
linked-tab cases, three Git graph integration cases and three tooltip lifecycle
cases. Strict Clippy, rustdoc with warnings denied, rustfmt, Git whitespace, and
logical spacing for workspace targets plus Windows/Linux Git code pass. The signed
development app is running on the shared merge fixture. CI was not run.

No changeset is required: these Rust crates are unpublished and no TypeScript
release packages changed.

## Commit-details visual follow-up

The shared DiffViewer now uses the reference app's Syntect 5.3 and two-face 0.5.2
grammars and neutral scope mapping. This replaces the Tree-sitter query pack:
identical palette values previously produced different Rust/TypeScript tokens.
Old/new source streams remain separate, omitted source gaps reset parser state,
full context stays validated, and parsing remains on the preview worker. Added/
deleted markers, number opacity and plain-code opacity match the native reference.
Both unified gutter columns remain; the source uses both coordinates too.

Graph and History committed-file panes now expose a working tree/list toggle.
The tree groups exact Git bytes without filesystem reads, sorts numeric names,
places folders before files, compacts single-child directory chains, displays
descendant counts and supports collapse plus Left/Right/Up/Down/Home/End navigation.
Rows use shared gpui-ce-motion feedback across the entire line, including indentation.
An enclosing list owns roving focus, independently of the selected preview.
Layout, collapsed directories and immutable selection round-trip through optional,
backward-compatible session fields. Switching layout or collapsing a folder retains
the existing diff state and draft; native tests verify restart and byte preservation.

The source sorting uses locale-aware numeric string comparison. Rust preserves
raw Git bytes and uses deterministic ASCII case-insensitive numeric ordering with
a bytewise tie-break; non-ASCII locale collation is deliberately not emulated.

Scope-mapping provenance and bundled grammar notices are recorded in
`onegit-ui/THIRD_PARTY_NOTICES.md`. Rust crates remain unpublished, so no changeset
is required.

### Follow-up comparison and validation (2026-11-03)

Compared the installed native reference and the rebuilt Rust app on the same
`diff-parity-o_cgtiu3` repository, commit `68ba2a5f047b897c495846111cfab6501c11f517`,
and `src/main.rs`, in dark mode at 1280 by 820 logical pixels. Matching captures
cover unified and fixed 50/50 split layouts, syntax categories, both unified
number columns, changed-line markers, word emphasis, tree rows, counts, and the
active layout button. The final Rust capture confirms selection spans the full
row, including indentation. Collapsing and reopening `src` retains the selected
file and diff; restarting the rebuilt app restores the tree layout and selection.
Both apps were returned to unified mode. Fixture HEAD, index SHA-256, and every
working-file SHA-256 are unchanged after the comparison.

The complete workspace suite passes 630 tests. A final focused history run passes
14 tests, including tree layout/collapse/restart with exact path and draft
preservation; the UI suite and its nine doctests also pass. Final strict workspace
Clippy, rustdoc with warnings denied, rustfmt, Git whitespace, and logical spacing
for all workspace targets plus Windows/Linux Git code pass.
The signed development build was checked locally. CI was not run for this
validation. This comparison covers the shared diff styling and committed-file
navigation, not a claim that every remaining app screen is pixel-identical.

## Cherry-pick and Revert

| Native source behavior | Rust path |
| --- | --- |
| History/Graph commit menu | Shared CommitList/CommitGraph context menus; workspace/replay |
| RepositoryCherryPick branch search and exact destination consent | replay::Form and CherryPickCommit |
| RepositoryRevert confirmation and current-branch consent | replay::Form and ReplayCommit |
| Window-owned write and related-tab refresh | replay::worker, tabs/replay_actions, refresh_written_tabs |
| Continue/Abort paused cherry-pick/revert | Existing conflicts previews, resolution writer and finish_operation |

Both views expose right-click, Control-click and Shift+F10 actions. Context actions
retain the previous selection while targeting the clicked immutable commit.
Confirmations retain the exact source root, branch, HEAD and commit; cherry-pick
also retains the selected destination tip. Search excludes the current branch and
branches occupied by worktrees. Destination selection is explicit. Revert retains
published history and requires source ancestry; cherry-pick accepts an exact Graph
commit from any local ref. Merge commits require an external mainline choice,
matching the source. The existing Rust cherry-pick ancestry guard was narrowed to
Revert after a new regression test demonstrated the Graph mismatch.

Accepted work uses the shared Git mutation queue. Stale/dirty/busy/occupied
destinations fail before execution; command-boundary errors never replay. A
cherry-pick failure after switching remains on its destination for inspection,
including after Abort. Started actions show Changes for progress/conflict
recovery while retaining Graph/History state. Ordinary drafts are never cleared.
Related and duplicate tabs refresh through snapshots without replacing their
drafts, selected commits/files, diff state or viewports. History keeps old rows
until refreshed rows arrive; the shared list retains its commit anchor and partial
row pixel offset. Confirmations use
gpui-ce-motion opacity/height transitions of 120 ms, honor reduced motion and
request no frames after settling.

Test mappings: sequences.rs adds cross-ref Graph replay versus ancestry-guarded
Revert, moved destination and occupied-worktree cases. replay::tests covers stale
consent, cherry-pick resolve/continue, revert abort and outdated recovery tokens;
the existing finish_operation integration case covers Continue and Abort for
both sequencers. Native form tests cover search, explicit choice, exact consent,
duplicate submissions, stale review and reduced motion. tabs/replay_tests covers
drafts, immutable selections and scroll across duplicate/linked tabs. UI graph
tests cover right-click targeting and Shift+F10 without changing selection,
and defer keyboard menu creation for restored selections whose page is not yet
loaded. The latter regression reproduces the native startup panic found during
matching-screen verification.

The Rust menu exposes the implemented copy/replay actions. Reset and range rewrites are described
below; tag actions remain a separate port. No new dependency or
changeset is required: these Rust crates are unpublished.

### Replay verification (2026-11-03)

The complete workspace/all-target/all-feature suite passes 640 tests, including
the fractional History anchor regression. A separate final Graph run passes all
eight tests, including the newly reproduced unloaded-selection startup case;
the final native replay run passes eight cases. Strict workspace Clippy, rustdoc
with warnings denied, rustfmt, Git whitespace, and logical spacing for workspace
targets plus Windows/Linux Git code pass. The signed development bundle starts
successfully after restoring both Graph and History sessions. Temporary startup
diagnostics were removed.

Compared actual reference and Rust screens in dark mode at 1280 by 820 logical
pixels, on diff-parity-o_cgtiu3 at 68ba2a5f047b897c495846111cfab6501c11f517 with
src/main.rs selected: Graph Revert (420 by 174 logical-pixel confirmation) and
History Cherry-pick (420 by 410 confirmation), including typography, buttons,
list rows, spacing and destination choices. Live search for “rel” and Down-arrow
selection choose release, enable confirmation and display the source/destination
summary; Escape cancels while preserving commit/file selection. Both comparison
confirmations were cancelled. QA HEAD, index SHA-256 and all working-file hashes
remain unchanged. The fixture contains preview/release branches created solely
for destination review. The native Rust app is running on the compared Graph.

Validation was local; CI was not run. No changeset is needed for unpublished
Rust crates; no TypeScript release package changed.


## Reset to commit

| Native source behavior | Rust path |
| --- | --- |
| repository-history-reset.tsx frozen target and read-only count | replay::Form, Review, Repository::reset_commit_plan |
| Graph and History context action | replay::menu shared by both retained views |
| Window-owned reset with stale/publication guards and recovery | Action::Reset, replay::worker, Repository::reset_to_commit |
| Related-tab refresh and uncertain-result exclusion | tabs/replay_actions, refresh_written_tabs |

Ports apps/gpuix/tests/repository-history/reset.component.test.tsx behavior:
readonly review/cancel, exact immutable target and current-branch consent,
published/stale/dirty rejection, duplicate submission and renewed-review
requirements. Reset uses the existing branch-ref-only library transaction rather
than reimplementing it in the app. Merge targets are allowed; current HEAD is
disabled. Reset does not offer hard/mixed variants or discard working bytes.
The selected ancestor stays; all removed ancestry, including merge side commits,
is counted. Local publication refs are rechecked at submission; no automatic
network request is added.

The existing Git transaction atomically creates refs/1git/reset/<uuid> at the
original tip and compare-and-swaps only the reviewed branch ref, with an owned
index lock. Files/index, other branches and existing tags stay unchanged.
Acknowledged recovery refs remain visible even when refresh fails. Read/command
errors cannot be replayed; uncertain command or refresh results block related
tabs pending explicit refresh. Failed confirmations stay open and disabled.
Cancellation restores focus; initial focus is Cancel. The read is cancelled on
dismissal/reopen and bounded by ten seconds.

Tests: history_rewrite.rs verifies exact recovery ref, unchanged files/index and
other refs, merge counts/publication, and publication/HEAD/branch/dirty changes
after read-only review, with no backup ref installed on rejection.
replay::tests covers acknowledged success, publication arriving after review and
recovery feedback retained when a peer cannot refresh. Native Form tests cover
readonly count, Cancel focus, single frozen consent, failure requiring reopen,
published/stale refusal and cancellation ignoring a late read. The shared
tabs/replay_tests runs the duplicate/linked-tab draft, selected commit/file and
viewport invariants for both Cherry-pick and Reset, including History refresh
and a selected commit removed from the branch's visible history.

The screen comparison also maps the source Button size=sm label to the Rust
ControlSize::Small text-small token (11px); measurement and painting use the
same typography, preserving automatic width motion.

No dependency or changeset is needed: the Rust crates remain unpublished.


### Reset verification (2026-11-04)

The workspace/all-target/all-feature suite passes 649 tests. After the final
small-button typography correction, the UI suite passes 141 tests (including
nine doctests), and the focused app commit-action suite passes 15 tests.
Strict workspace Clippy, rustdoc with warnings denied, rustfmt, Git whitespace
and logical spacing for all workspace targets plus Windows/Linux Git code pass.

Compared actual reference and signed Rust development screens in light mode at
1280 by 820 logical pixels: both Graph and History, diff-parity-o_cgtiu3 at
68ba2a5f047b897c495846111cfab6501c11f517, src/main.rs selected, with the Reset
target 686a55437e341d8a3080c439f88b54b89feb0c55 (Baseline diff preview).
The centered 420 by 214 confirmation matches its title, target, count, wrapped
guidance, padding, gaps, control heights and label sizes. The initial comparison
caught the larger small-button label; the rebuilt app was compared again after
that correction. The current-tip menu action is visibly disabled. Escape cancels
without replacing the existing commit/file selection in either view.

Both apps' confirmations were cancelled. The QA HEAD, index SHA-1 and clean
working-tree status are unchanged; no reset refs were installed in this shared
comparison repository. Accepted resets and rejection paths were tested only in
disposable fixtures. The final signed app starts and restores its session.
CI and other native operating systems were not run in this pass. This comparison
covers Reset confirmations on matching views, not every remaining app screen.


## Squash and Reorder commits

| Native source behavior | Rust path |
| --- | --- |
| History reducer replace/toggle/anchored range | replay::Selection; CommitList/CommitGraph modifier-aware selection |
| repository-history-squash.tsx | replay::rewrite::Form summary/body editing and frozen RangeReview |
| repository-history-reorder.tsx | replay::rewrite::Form oldest-first list, root pin and movement controls |
| getSquashPlan / getReorderPlan | Repository::squash_plan / reorder_plan |
| squashCommits / reorderCommits | Action::Squash / Reorder, shared replay worker and guarded library transactions |
| Window-owned write and linked-tab refresh | Existing Submit/Completed orchestration and refresh_written_tabs |
| Retained range intent on restart | Existing version-1 History session with a defaulted CommitRange |

A primary commit still owns its immutable preview. Shift-click/Shift-navigation
select an inclusive range from its original anchor; Command-click (Ctrl-click on
other platforms) toggles membership. Plain selection collapses the range, including
when clicking the same primary commit. Context actions freeze the selected range
only if the clicked row belongs to it; an outside row cannot accidentally rewrite
the previous range. Single, disjoint and merge ranges disable both actions.
Graph selection is independent of History. The reusable controls expose controlled
selected IDs and a modifier-aware callback while preserving existing single-row
callbacks. Both lists announce multi-selection.

Read-only review freezes the root, named branch/HEAD and newest-first commit IDs,
and reports later replay. The squash message combines full messages oldest-first,
with editable summary/body. Reorder begins oldest-first, requires an actual
permutation, and pins a selected root first. Move earlier/later, Alt+Up/Down and
pointer dragging retain the chosen commit. Escape cancels an in-progress drag;
an outside drop restores the original order. Row movement, confirmation height
and opacity use gpui-ce-motion with 120ms tweens, reduced-motion support and no
settled frame loop. Lists remain virtualized. Surface input styling matches the
source confirmation fields while retaining native editing, selection and focus.

Reviews cancel on dismissal/reopen and time out after ten seconds. Writes have
the source's two-minute cancellation deadline; the library completes atomic ref
installation independently of cancellation after preparation. Source guards are
rechecked by the existing queue/index-lock/disposable-worktree transaction.
Selected and later commits must be unpublished according to known remote refs.
The final tree must remain identical before installation. Only the reviewed branch
moves; exact files/index, other branches and tags stay intact. Original history
is retained atomically in refs/1git/squash/<id> or refs/1git/reorder/<id>. Result
feedback keeps the acknowledged recovery ref even if related refresh fails.
Warnings and uncertain command/refresh results block related writes pending an
explicit refresh. Failed message/order edits remain inspectable but cannot submit
again without a fresh review.

Success keeps the originating Graph/History section. Duplicate and linked tabs
refresh without replacing ordinary drafts, selected historical commits/files,
diff state or pixel scroll anchors. Range membership and its original Shift anchor
are navigation intent, persisted in the existing private session file with legacy
defaults and bounded exact-OID validation. Review plans, pending dialog edits,
cancellation objects and write requests are never restored or replayed.

Deliberate differences: the current native app disables Squash/Reorder in Graph
because that graph does not provide range selection. Rust adds independent Graph
ranges and exposes the same reviewed dialogs as History, as explicitly requested.
Dragging and Alt+arrow movement supplement the source's movement buttons.
Native editors retain their visible focus indicator. This pass does not change
unrelated empty-commit illustrations.

Test mapping: all 14 source squash.component.test.tsx/reorder.component.test.tsx
cases pass in the original GPUIX app. Rust selection_tests maps replace, toggle,
Shift range/anchor and restored-range behavior. rewrite_tests maps read/cancel,
message editing, changed-order consent, root pinning, stale/published refusal,
failed intent retention, duplicate submission and late cancelled reads; native
events additionally cover dragging, keyboard movement, reduced motion and idle
settling. The complete workspace Graph test exercises the parent form and
confirmation subscriptions. Native verification found duplicate accessibility
IDs in unkeyed summary rows; commit-keyed rows fix that path, which the headless
test platform's inactive accessibility adapter does not exercise.

history_rewrite.rs characterizes publication, HEAD, branch and dirty changes
after review for both existing library APIs, without installing recovery refs.
replay::tests exercises real acknowledged writes and exact recovery refs,
unchanged files/index/other refs, stale consent and recovery feedback after a peer
refresh failure. tabs/replay_tests runs the same duplicate/linked-tab draft,
selection and viewport invariants for Replay, Reset, Squash and Reorder.
commit_selection.rs checks real pointer/Shift-key delivery in both reusable views.
Session tests cover legacy documents, exact range round trips and malformed IDs.

No dependency or changeset is required: these Rust crates are unpublished.


### Squash/Reorder verification (2026-11-04)

The workspace/all-target/all-feature suite passed 662 tests during implementation.
After the final session and accessibility changes, the complete app suite passed
201 tests and the UI all-target/all-feature suite passed 137 tests. The final
row-width correction passed all six rewrite form/motion tests, including the
412px row measurement. All nine UI doctests and 17 history-rewrite integration
tests pass. The original GPUIX Squash/Reorder component suites pass all 14 cases.
Strict workspace Clippy, rustdoc with warnings denied, rustfmt, Git whitespace
and logical spacing for all workspace targets plus Windows/Linux Git code pass.

Compared the actual original and signed Rust development apps in light mode at
1280 by 820 logical pixels on diff-parity-o_cgtiu3, codex/rewrite-parity at
197033c5c8243ad23c22c8a65848d0d8121983c8. Both apps selected First independent
preview and Second independent preview, with one later commit. The shared History
Squash (440 by 352) and Reorder (440 by 318) dialogs were checked for title/copy,
field surfaces, typography, gaps, padding, full-width selection rows and controls.
Native Rust movement changed the order and enabled confirmation; cancellation
retained the underlying selection. The History range also survived a live restart.
Rust Graph opened both corresponding dialogs with its independent range; the
original Graph layout was compared separately because its rewrite actions are
disabled. Existing empty-commit illustrations remain outside this comparison.

Native inspection caught and fixed the duplicate summary-row accessibility IDs
and the selected reorder row's label-width background. Both corrected dialogs
were captured again in the installed build. The final app is running with no
confirmation open. Every shared-fixture confirmation was cancelled: HEAD remains
197033c5c8243ad23c22c8a65848d0d8121983c8, main remains
68ba2a5f047b897c495846111cfab6501c11f517, index SHA-1 remains
2d6768433cfc195fdb65f7643bf7343b4c72738b, working-tree status is clean, and no
Squash/Reorder recovery refs were created. Accepted writes were exercised only
in disposable automated fixtures. CI and native Windows/Linux runs were not
performed in this pass.


## Local tag management

| Current app behavior | Rust path |
| --- | --- |
| RepositoryTag / TagReview | replay::tags::Form / frozen replay::Review |
| RepositoryTags.create | Repository::create_reviewed_tag; create_release_tag remains a compatible annotated wrapper |
| History and Graph Create tag menus | Shared replay menu and immutable tags::Open events |
| createReleaseTag source guards | ReviewedTag, exact commit/branch/HEAD checks and named-ref reachability |
| Window-owned pending write and linked-tab locks | Existing replay Submit/Completed queue and refresh_written_tabs |
| Local tag metadata and same-HEAD labels | Background Loaded.local_tags and History decoration-only updates |

The compact annotated form follows the source's 420px layout, selected commit
summary and SHA, 30px name field, 70px annotation field, 12px gaps and small
actions. Blank annotations use Release <trimmed name>, matching the source.
Creation is local and never replaces an existing name. Dirty and detached
worktrees are permitted; active operations, blocked refreshes, stale branch/HEAD
and replaced roots are refused. Graph targets may be reachable only from another
local branch, remote-tracking branch or tag; unreachable and noncommit objects
are rejected.

The requested additions are a lightweight/annotated selector and local deletion.
Annotated is the default; lightweight hides the annotation editor and explicitly
keeps that kind even when tag.gpgSign is configured. Annotated creation retains
configured signing. Each existing tag on the clicked commit has its own Delete
tag action. Confirmation shows its name, target and direct tag object; Cancel is
the initial deletion focus. Git atomically verifies HEAD and the exact direct
tag value before deletion, so a replacement cannot be removed by an old review.
Remote tags, files, staging and commit history are never changed by these actions.

Both views retain their section, ordinary draft, selected historical commit/file,
range and diff viewport. Duplicate and linked tabs stay protected through the
write and all refreshes. Tag labels refresh even with unchanged HEAD, without
reloading immutable history pages or replacing scroll handles. Failed metadata
reads are shown alongside the existing history. Failed or uncertain submissions
retain name/message/type, require a fresh review and never retry automatically;
uncertain writes or a failed peer refresh block related writes pending refresh.
Pending forms are never saved in workspace sessions. Writes use a two-minute
cancellation deadline. Opacity and type/error height changes use 120ms
gpui-ce-motion tweens, snap with reduced motion, and stop requesting frames at rest.

Test mapping: all 14 original tags.component, tags.integration and tags.unit cases
pass. The applicable create/cancel/dirty-state/default-annotation guards map to
tags_tests.rs and reviewed_tags.rs. Source Graph reachability cases for local,
remote and tag refs map to the backend's corresponding three-fixture test.
Tag push/account/destination cases remain covered in the existing backend
network suite; remote tag publication is outside this UI pass. New deletion tests
cover stale branch/HEAD/operation, cancellation and replaced annotation objects.
Native tests cover both parent list event routes, retained failed intent, duplicate
submission, busy dismissal, reduced motion and settled frames. Related-tab tests
exercise real creation and deletion while preserving drafts and Graph/History
selection and viewport. A peer refresh failure leaves the acknowledged local tag
in place and blocks repeat writes.

Deliberate differences: the source app only creates annotated tags and has no
local deletion confirmation. Rust adds the requested kind selector and deletion
using the same form style. Its local-only guidance does not offer an unported
remote tag push action. Native input focus remains visibly indicated.

No dependency or changeset is required: the Rust crates remain unpublished.


### Local tag verification (2026-11-04)

The complete workspace/all-target/all-feature suite passed 680 tests across 50
suites. After the final layout and header corrections, all 29 affected app tests
passed; the UI all-target/all-feature suite passed 137 tests and all nine UI
doctests passed. Six reviewed-tag backend tests and the existing network suite
pass. The original application's three tag suites pass all 14 tests. Strict
workspace Clippy, rustdoc with warnings denied, rustfmt, Git whitespace and
logical spacing across workspace targets plus Windows/Linux Git code pass.

Compared actual original and signed Rust development screens in light mode on
diff-parity-o_cgtiu3, codex/rewrite-parity at
197033c5c8243ad23c22c8a65848d0d8121983c8. Graph and History Create tag reviews
targeted Compare syntax and file navigation,
68ba2a5f047b897c495846111cfab6501c11f517. History also selected docs/README.md
with its four-file tree and two added lines. The shared 420 by 280 annotated
dialog matches content geometry, typography, fields, padding, gaps and action
sizes. The kind selector, visible native focus ring and truthful local-only
guidance are the deliberate additions described above. This verifies the tag
surfaces and matching repository states, not whole-window pixel identity across
the different captured window sizes.

Native inspection found a clipped lightweight footer and missing History header
tags. A failing bounds test reproduced the clipping; shorter guidance keeps both
actions visible in the 420 by 198 form. The 420 by 182 deletion form identifies
the exact tag and retains Cancel as its initial focus. Corrected forms and
neutral compact row/header badges were captured again. The tag-only refresh
test retains the same immutable diff viewer entity and selected commit/file,
updates both row and header metadata, then removes the labels when tags vanish.

All shared-fixture confirmations were cancelled. HEAD remains
197033c5c8243ad23c22c8a65848d0d8121983c8, main remains
68ba2a5f047b897c495846111cfab6501c11f517, the only tag remains diff-parity at
68ba2a5f047b897c495846111cfab6501c11f517, index SHA-1 remains
2d6768433cfc195fdb65f7643bf7343b4c72738b and working-tree status is clean.
Accepted writes and rejection paths ran only in disposable automated fixtures.
The final signed app starts, restores its History selection and runs with no
confirmation open. CI and native Windows/Linux execution were not run.


## Local branch rename and deletion (2026-11-04)

Source behavior comes from workspace-menu.tsx, repository-branches.ts and their
workspace-menu.component/repository-branches.integration suites. Local branch
row context actions map to workspace/branches/edit.rs and the existing attached
picker. Right-click, macOS Control-click and Shift+F10 use the shared ContextMenu.
The 288 by 150 form, prefilled 30-pixel input, copy, small actions and local-only
guidance follow the original. Height and opacity use the picker's existing
160ms gpui-ce-motion transitions, honor reduced motion and stop frames at rest.

Review captures the exact source branch/HEAD and target ref/OID. The existing
onegit-git reviewed branch API serializes revalidation and uses non-forcing
branch -m / branch -d. Renaming the current branch is supported. An occupied
branch cannot be deleted, and one checked out in another worktree cannot be
renamed. Dirty work, active operations, collisions, unmerged deletion and stale
tips are refused. Names and errors remain visible after failure; stale or uncertain
reviews require reopening rather than replaying. Invalid-name validation remains
editable. Remote refs and branch publication are unchanged.

The window owns writes through completion and all related worktree reads.
Duplicate and linked tabs retain drafts, selected commit/file, diff modes,
filters, pane sizes and viewports. Acknowledged renames remap Graph reference
filters and cursors before refreshing, so saved sessions restore the new scope.
Deletion clears only a removed scope, retaining immutable selected commit detail.
An acknowledged rename followed by a failed peer refresh still carries its ref
mapping and blocks further writes until a successful repository refresh.

Test mapping: the original two branch suites pass all 103 cases. Existing
onegit-git branches tests cover current/other-worktree restrictions, exact target
review and ordinary rename/deletion. New backend characterization covers
unmerged, dirty, cancelled and moved-source rejection. Native branch tests drive
actual context menu events, rename confirmation, deletion cancellation, retained
failed intent, duplicate-tab refresh and keyboard access. A linked-worktree
session test checks drafts, ref scope, selected commit/file, split mode and pixel
offsets across rename and restart. A Graph deletion test preserves selected
immutable details; a broken peer fixture retains acknowledged rename metadata.

Deliberate differences: deletion initially focuses Cancel rather than the
original's read-only field. Stale/uncertain reviews remain disabled until reopened.
The Rust workspace is unpublished, so this task requires no changeset or version
change. No dependencies were added.


### Branch edit verification status

The workspace/all-target/all-feature suite passes 689 tests across 50 suites.
The subsequently added occupied-branch context-menu regression also passes.
All 12 doctests pass. The final native build, strict workspace Clippy, warnings-
denied rustdoc, formatting, Git whitespace and logical spacing for all workspace
targets plus Windows/Linux Git code pass. The original branch suites pass 103
tests. No CI or native Windows/Linux run was performed in this task.

Compared successful full-size original and corrected signed Rust Rename and
Delete forms on diff-parity-o_cgtiu3, reviewing preview at
686a55437e341d8a3080c439f88b54b89feb0c55 while HEAD is codex/rewrite-parity at
197033c5c8243ad23c22c8a65848d0d8121983c8. Both apps selected History's Baseline
diff preview and docs/README.md, showing the same three added lines.

The first live Rust capture exposed clipped two-line guidance and actions eight
pixels too high. Removing the edit form's extra footer bottom padding fixes both
within the original 288 by 150 geometry. A bounds regression checks that guidance
fits above the footer and the actions end four pixels inside the attached surface.
All 28 affected branch tests pass after the correction, as do final strict Clippy,
rustfmt, Git whitespace and workspace/Windows/Linux logical-spacing checks.

Corrected full-window captures confirm matching form position, dimensions,
heading, name field, guidance wrapping, padding and action placement. Rust retains
its visible focused-input border and initially focuses Cancel for deletion.
The compared app windows have different overall sizes/tab counts; this verifies
matching branch review surfaces and repository selections, not whole-window
pixel identity. Both reviews were cancelled and the pickers dismissed.
The corrected signed development app is running with its restored History
selection and no confirmation open.

No Rename/Delete confirmation was accepted in the shared comparison fixture.
Its original branch/tag refs remain intact and its working-tree status is clean.
Accepted branch edits ran only in disposable automated test repositories.


## Merge, Squash merge and Rebase from Branches (2026-11-04)

The reference is WorkspaceMergeForm in workspace-merge-form.tsx, its containing
workspace-menu.tsx and RepositoryBranches.write in repository-branches.ts.
The port retains all three source modes in the same attached picker.

| Source API / behavior | Rust mapping |
| --- | --- |
| WorkspaceMenu mergeSource and canMerge | Picker Phase::Integrate and can_integrate |
| WorkspaceMergeForm query, selection and message | branches/integration.rs retained inputs and exact Branch target |
| onMerge explicit confirmation | integration_request, Request::Integrate and window-owned Submit |
| RepositoryBranches.write reviewed integration | Repository::integrate_branch |
| Window refresh and Changes recovery | write::run_integration, branch_completed and existing conflicts module |

The 288 by 440 review uses the same heading, three modes, 30px search field,
28px target rows, optional 54px squash editor with 11/16 typography, summary and
small footer controls. Native input text_role selects the existing theme preset;
default input typography is unchanged.
The empty search uses the original 80 by 56 SVG. Current local branch exclusion,
all other local/remote-tracking targets, case-insensitive search, clearing selection
on search and resetting the squash message when selecting a target are preserved.
Selecting a branch never switches or starts integration. Default mode is Merge.
Squash merge defaults to Squash merge <target> into <current>; a blank first-line
summary or NUL disables confirmation. Ordinary drafts remain separate.

The source repository, source branch/HEAD and exact target ref/OID remain immutable
until reopening. The shared window rejects replaced roots, busy/blocked peer tabs
and amend mode. Native input and backend guards reject dirty, detached, unborn,
active or changed state. Rebase rejects known published ancestors and merge
history before creating recovery refs, disables autostash/updateRefs/fork-point,
and leaves other branches alone. Ignored destination collision checks remain in
the backend. Arbitrary external Git can still race outside the app mutation queue;
the target command is pinned to the reviewed object rather than following a moved
ref, and the original tip is verified in the recovery-ref transaction.

All modes now retain durable pre-integration refs. This extends the original
rebase-only backup behavior as requested. The public backend result changes from
Result<BranchMutation, WriteError> to Result<IntegrationMutation, IntegrationError>;
the result exposes recovery_ref alongside branches/snapshot, and errors expose
phase, error and an optional acknowledged recovery_ref. Before-command rejection
has no backup. Errors after backup retain its exact name and require inspection.
No automatic abort, reset, retry or ref deletion occurs.

A confirmed write stays window-owned through distinct related-worktree reads.
Duplicate and linked tabs refresh together, retaining independent drafts,
selection, diff mode and pixel scroll. A paused integration opens Changes only
in its origin; the existing ours/theirs resolver and reviewed Continue/Abort also
support SquashMerge. Uncertain peer refreshes retain the acknowledged recovery ref
and block writes pending a fresh read. Failed forms keep their selected intent
but require renewed review. Pending forms and accepted requests are never saved
as restartable commands. Git operation markers and recovery refs survive restart.

| Original test / requirement | Rust coverage |
| --- | --- |
| reviews and confirms merge without switching | merge_picker_requires_confirmation_and_preserves_duplicate_and_linked_tab_drafts |
| reviews rebase/squash without losing ordinary draft | integration_modes_confirm_once_preserve_drafts_and_keep_exact_recovery_tips |
| searches/selects another worktree with keyboard | integration_search_clears_consent_keyboard_selects_occupied_target_and_modes_fit_with_settled_motion |
| clears selected target on search and cancellation | same native search test |
| rejects dirty, paused and detached state | integration_is_unavailable_for_dirty_detached_and_paused_repositories |
| locks pending integration and rejects duplicate writes | native modes test |
| shows conflicts in Changes with Continue/Abort | integration_pauses_in_changes_and_existing_resolution_continue_and_abort_keep_drafts_and_recovery |
| stale/published review cannot rewrite | integration_rejects_stale_tips_and_published_rebase_without_replaying_or_creating_recovery_refs |
| preserve historical selected file and real viewport | integration_preserves_immutable_history_file_and_nonzero_split_diff_scroll |
| unknown peer read must not replay acknowledged integration | acknowledged_integration_reports_recovery_and_requires_review_when_a_peer_refresh_fails |

The backend integration suite additionally covers source/target replacement,
published ancestors, merge history, SHA-256, ignored collisions across replayed
paths, hooks/signing failures, cancellation, uncertain command/read results,
worktree write coordination and continuation/abort after reopening. Added
assertions verify original-tip refs for every mode, exact error recovery refs,
retention after abort and absence of backup metadata on stale rejection.

Deliberate differences: native focus remains visible. All modes have persistent
recovery refs, and stale/uncertain forms retain their intent but require reopening,
where the original closes after failed submission. The source remote branches
used by publication guards are local knowledge; this picker performs no hidden
network fetch. Worktree creation/removal remains outside this pass.

The Rust crates remain unpublished, so no changeset or version bump is required.
No dependencies were added.


Native comparison (macOS): both apps used diff-parity-o_cgtiu3, History,
Baseline diff preview, docs/README.md, the same source branch codex/rewrite-parity
and target main. Full-size native captures covered selected Merge, Rebase and
Squash merge reviews. The comparison corrected the mode widths, target-list
inset and squash editor typography. The final 288 by 440 forms match the source
heading, search, rows, guidance, message field and footer geometry. Rust retains
its visible input focus indicator. Different window sizes and open-tab counts
mean this verifies the matching review surfaces, not whole-window pixel identity.

Both apps' reviews were cancelled; no integration was accepted in the shared
fixture. Its branch/tag tips remain unchanged and its worktree is clean.
Accepted operations, conflict recovery and publication/stale guards were tested
only in disposable repositories. The signed final development app is running
with the restored History selection and no confirmation open.


Verification: the two original workspace-menu / repository-branches suites pass
103 tests (652 assertions). Rust workspace all-target/all-feature tests pass
699 tests across 50 suites, including 226 app tests and 20 backend integration
tests. After the final squash typography adjustment, the affected native mode
test and all six input tests pass again. Twelve workspace doctests pass.
The locked offline app build, cargo fmt --all --check, strict workspace
all-target/all-feature Clippy, warning-denied workspace docs and logical spacing
checks pass. Spacing also checks Windows/Linux Git code. Native app checks ran
on macOS; CI and Windows/Linux runtime tests were not run for this task.


## History search (2026-11-04)

Source behavior comes from RepositoryHistory.read/matches, the History model
search/page reducers, use-repository-history and repository-navigation.
The port searches locally available immutable branch history rather than only
filtering already loaded rows.

| Source | Rust |
| --- | --- |
| RepositoryHistory.matches | history/read.rs literal matching over oid, summary, full body and author identity |
| RepositoryHistory.read search loop | page_for_query / search with 250-commit batches and source offsets |
| 250ms query debounce and AbortSignal | spawn_read_after, ReadJob cancellation and exact root/head/query completion guard |
| history.normal and Escape | history/search.rs owned Normal cache, native list/file/diff state restoration |
| filter button, find shortcut and field | History toolbar, search_shortcut and retained InputState |
| StateMessage / StateArtwork | source search/history SVGs and illustrated result/file/detail empty states |
| Saved History navigation | optional HistorySearch intent beside the existing normal History session |

The full branch total is reused for each immutable tip, independently of query
or result pagination. The 51st match proves that a next result page exists.
The next offset follows the source's scan cursor, including nonmatching rows
between the 50th and 51st matches. Search uses no regex or Git revision parsing
for user input. A new query cancels its predecessor, including the timer.
Root/head/query checks reject late queued results. Replaced roots clear the
filter; refreshed tips retain the query and exact chosen immutable patch.

Normal navigation owns its cached native list, file list, split diff and
selection while results are displayed. Escape restores those same entities,
including their pixel offsets, expanded context and text selection. A changed
HEAD invalidates cached normal pages but retains its chosen immutable detail;
clearing search then reloads the retained page span in bounded Git calls.
Ordinary drafts and pane sizes are independent. Restart stores only validated
normal/search intent and rereads Git; no worker, cached object or action is
serialized. Older sessions without HistorySearch still load.

| Original test / behavior | Rust test |
| --- | --- |
| searches through the native field, ignores late results and restores on Escape | history_search_native_field_cancels_old_reads_and_escape_restores_selection_and_native_viewports |
| isolates search pages and restores normal cache | same native test and search_pages_scan_beyond_loaded_rows_without_duplicates_or_following_head |
| matches full message, author or hashes literally | search_matches_literal_full_messages_author_identity_and_hashes |
| full branch total independent of search | read/native search tests, including refresh with added matching commits |
| frozen pagination across moving HEAD and sparse matches | search_pages_scan_beyond_loaded_rows_without_duplicates_or_following_head |
| retains immutable commit/file while refreshing history | history_search_refresh_keeps_query_selected_patch_and_draft_and_close_refreshes_normal_rows |
| navigation round trip and root replacement | history_search_session_restores_search_and_normal_navigation_and_replaced_root_cancels_pending_query |
| legacy session and invalid saved intent | history_search_intent_round_trips_and_legacy_sessions_remain_valid |
| source debounce and fast reduced-motion transition | history_search_debounces_typing_and_motion_settles_with_reduced_motion |

The existing manual Load more commits action remains the Rust pagination control.
File-scoped history and remote commit links remain separate UI work. Native input
focus remains visible. Search fields animate for 120ms with gpui-ce-motion and
stop requesting frames at rest. The reusable Button now separates disclosure
expanded state from toggle styling and accepts an optional toolbar glyph size;
existing defaults are unchanged. No dependencies or published versions change,
and the unpublished Rust crates do not need a changeset.

The 24px result header is outside the revision/file split, as in the source,
so opening search retains the same stored ratio and divider placement.

Native comparison used both apps on diff-parity-o_cgtiu3 / codex/rewrite-parity
with Baseline diff preview and docs/README.md selected. Populated and no-match
searches were captured at the same window size. The comparison corrected the
toolbar glyph/disclosure styling, result header placement, divider geometry,
and compact/full empty illustrations and typography. The Rust input retains
its visible focus outline. Existing differences in repository tab contents and
manual pagination are outside this search comparison. Escape restored the
normal five-commit list, Baseline selection and README diff in both apps.
The shared fixture's worktree, branches and tag were unchanged.

Validation: the four original History suites passed (39 tests, 288 assertions).
The complete locked/offline Rust workspace/all-target/all-feature run passed
706 tests across 50 suites with two test threads; all 12 doctests and
warning-denied documentation passed. The initial concurrent workspace run hit
an existing helper-output wall-clock deadline; its five isolated tools tests
and the subsequent complete run passed without changing that test. The final
Ctrl+F alias correction was first reproduced by a failing native assertion,
then all 17 History tests passed again. Strict workspace Clippy, formatting,
logical spacing (including Windows/Linux Git code) and diff whitespace checks
pass. The rebuilt, signed bundle also accepted Ctrl+F live on macOS and Escape
restored its selection. CI and native Windows/Linux execution were not run.

## Worktree management (2026-11-04)

The current app reference is apps/gpuix in the main checkout at 25cfa631,
including the sidebar Worktrees / New Worktree / New Branch action order.
The Rust baseline retains an older version of those source components.

| Source | Rust |
| --- | --- |
| WorkspaceMenu Worktrees floating submenu | branches/worktrees/view.rs, measured floating_layer, keyboard/hover navigation and edge flipping |
| WorkspaceWorktreeForm | retained branch suggestions, source branch-name feedback, derived destination and native folder picker |
| RepositoryWorktrees.create / remove | existing Repository::change_worktree reviewed APIs, dispatched through the window-owned write lifecycle |
| open-worktree | fresh registration/common-directory validation, activate an existing tab or open a new one |
| related worktree refresh | branches completion snapshots plus tabs/worktree_actions.rs |
| move-worktree lower-level API | reviewed WorktreeRequest::Move, preserving target files/index/branch and requiring a missing destination |

| Source test / behavior | Rust test |
| --- | --- |
| accepts ordinary names and rejects Git ref syntax and revision expressions | worktree_branch_names_match_source_ref_feedback_and_default_folder |
| dirty source permits New worktree; create and open retains source state | creates_and_opens_a_worktree_from_dirty_source_and_keeps_original_tabs_and_drafts |
| keyboard opens/reuses a worktree tab; submenu flips at the edge | worktree_submenu_keyboard_open_reuses_tab_focus_and_flips_inside_window_without_idle_motion |
| clean-only removal, frozen target and related-tab refresh | removal_keeps_tabs_drafts_and_selection_but_never_removes_dirty_or_stale_targets plus existing reviewed_worktrees backend cases |
| moving linked worktrees | moving_open_duplicate_worktree_tabs_retains_entities_drafts_navigation_and_session_paths and reviewed_move_preserves_dirty_files_index_and_branch_and_rejects_stale_or_occupied_destinations |

Create accepts new, available local and unambiguous remote-tracking branches.
A dirty source is allowed because its checkout/index are untouched. Forms retain
the reviewed source or exact registered target identity; fresh Git checks reject
stale, main/current, locked, prunable, replaced-path and active-operation targets.
Removal also refuses tracked, untracked and ignored files. Commands never force,
remove branches, overwrite destinations, automatically retry or clean up an
uncertain partial result. Move permits dirty files and retains the exact index;
its destination must be missing, outside the original checkout and under an
existing parent. Git still refuses unsupported moves such as submodule worktrees.

Open is read-only and reuses an already-open root. Related writes suspend monitor
reads and refresh each surviving checkout independently. Moving retargets existing
workspace/history/graph/stash entities before refreshing, retaining drafts,
selections, filters and mounted viewports; pending reads are cancelled/reissued.
The new path is saved in the workspace session and local Home library.

Deliberate differences requested by this task: the original UI has no Move form;
Rust adds one using the same attached form surface. Original removal closes its
tabs and discards their drafts; Rust retains unavailable tabs, drafts and navigation
in memory and the saved session, with an explanation and Retry. These confirmations
are never serialized or replayed. Main/current worktrees can be managed from
another checkout. SSH management remains outside this local port. Forms reuse
the existing 160ms gpui-ce-motion height/opacity transition and reduced-motion
handling; settled menus do not request frames.

Rust crates are unpublished, so no changeset or version bump is needed.

### Worktree verification

The original worktree-name, repository-branches integration and workspace-menu
component suites passed their worktree cases: 23 tests and 169 assertions. The
restricted native run lacked macOS graphics service access; the same tests passed
with native access. The complete locked/offline workspace/all-target/all-feature
run passed 712 tests in 50 suites with two test threads. Final focused worktree
tests passed again after the final visual/accessibility refinements (10 tests),
as did all 11 reviewed backend worktree tests and eight reusable UI interaction
and component tests. Strict workspace Clippy, formatting, logical spacing
(including Windows/Linux Git code), warning-denied docs and all 12 doctests pass.

Full-window dark captures compare the same diff-parity-o_cgtiu3 checkout,
codex/rewrite-parity branch, Baseline diff preview commit and docs/README.md.
The matching New worktree form and two-entry Worktrees submenu align with the
reference's geometry and controls. The comparison corrected a 5px grouping gap.
Rust keeps a visible native input focus ring. Removal uses the same title/path/
branch-preservation guidance and form, with the requested draft-retention wording
in place of the original warning about discarding drafts. Move is a new Rust
form, checked against the same form design rather than a nonexistent source form.

Identically named old 1git processes caused native control timeouts and stale
frames. The final comparison uses a separately named 1git Worktree QA executable,
with its own copied/filtered session, leaving the running original/Rust binaries
and the user's original session untouched. The QA bundles and sessions are ignored
target artifacts. The final signed QA bundle was verified against the build UUID
3E596A41-9458-3076-BBCA-7175BC674865. Its New worktree form, two-entry submenu,
and removal confirmation were compared with the original; the final removal
copy keeps the reference's two-line layout and button positions. The Move form
was captured with both unchanged (disabled) and edited (enabled) destinations,
then cancelled. No GUI creation, move or removal was accepted on the shared
fixture. Both apps were left on Baseline / docs/README.md outside confirmations.

A clean disposable linked checkout at target/worktree-parity-linked (release)
was added only to show matching two-entry menus. It remains available for review;
both fixture checkouts are clean and all existing branch/tag tips are unchanged.
CI and native Windows/Linux UI execution were not run.

## Git identity and remote settings (2026-11-04)

The reference is the main checkout's `feature/git-settings` and shared Settings
layout/group components. Settings keeps repository content entities and drafts
alive; its independent side editor does not stage files or change history.

| Source | Rust |
| --- | --- |
| GitSettingsModel.read | Repository::git_settings and GlobalGitIdentity::read |
| explicit identity / add / edit / remove requests | SettingsChange and reviewed change_git_settings / global write |
| SettingsSplit / SettingsPanel | settings/view.rs with equal list/editor panes, independent scrolling and pinned actions |
| identity source ChoiceTile | Default / Custom 88px tiles with the original glyphs and Git validation |
| remove-remote Popover | cancel-first 340px compact Dialog with frozen configuration review |
| app/repository entry points | workspace appearance menu → Git settings; Command/Ctrl+,; Git, Remotes and Commit identity pages |

| Source behavior/tests | Rust coverage |
| --- | --- |
| saves a repository identity, preserves history/files and resets inherited config | saves_repository_identity_preserves_history_files_index_and_resets_inheritance |
| adds/edits without fetching or replacing dedicated push URLs, then removes | remote_edits_preserve_push_urls_and_removal_preserves_local_branches |
| linked worktrees share local identity; invalid names/emails/credential URLs fail | linked_worktrees_share_settings_and_stale_remote_confirmation_cannot_remove_a_changed_connection plus rejects_stale_settings_invalid_identity_credentials_and_advanced_worktree_identity |
| preserves advanced worktree identity and multi-URL remotes | rejects_stale_settings_invalid_identity_credentials_and_advanced_worktree_identity |
| computer-wide settings only write on Save | global_identity_is_isolated_validated_and_guarded_against_external_edits and git_settings_global_save_uses_isolated_config_and_cancel_keeps_saved_values |
| background editor retains context; settings saves preserve workspace drafts | git_settings_unsaved_editor_keeps_its_repository_context_across_tab_changes and git_settings_identity_saves_explicitly_and_preserves_related_tab_drafts_selections_and_viewports |
| partial-save failure is reread rather than replayed | failed_second_identity_key_reports_partial_write_and_requires_new_review and git_settings_stale_save_retains_input_and_cannot_overwrite_external_configuration |
| unavailable repository does not silently become global settings | git_settings_unavailable_repository_never_falls_back_to_global_editor |
| editor geometry, reduced motion and no idle frames | git_settings_editor_matches_equal_pane_layout_and_settles_without_idle_frames |
| cancelled scope reads never replace current context | git_settings_switching_scope_ignores_cancelled_reads_and_keeps_the_final_identity |

Save and Remove retain an opaque SHA-256 fingerprint of Git's complete effective
configuration (including origins), plus repository identity and the reviewed
remote URLs. A changed configuration is rejected before writing. Global author
keys have a separate global-config fingerprint and the same process-local
settings mutex. Repository writes also join the existing repository mutation
queue. Git owns the individual config locks: external writers can still race
after review, and author-pair writes are not a cross-command transaction. A
partial or unconfirmed result retains the editor, requires a new read and never
replays a write automatically. Remote edits preserve dedicated push URLs;
removal preserves local branch tips and all working files. No operation fetches,
pushes, stores credentials or selects a hosting account.

Related duplicate/linked worktree tabs refresh through apply_automatic, keeping
commit drafts, filters, selections and retained viewport state. A global save
refreshes all available open repositories. Config is read from Git, not copied
into workspace session JSON. Unsaved settings editors retain their original
repository across tab activation; Save cannot follow a newly selected tab.

Deliberate scope: the Git settings navigation contains the three implemented
Git pages. Other application Settings pages, hosting-account identity tiles,
authentication choices, SSH settings and the selected-files auto-inclusion
preference remain outside this port. Global defaults have an explicit
computer-wide scope hint. Stale guards are stronger than the source model.
Forms use the existing gpui-ce-motion 160ms transition and snap with reduced
motion. The empty-remotes illustration and Pencil/Trash/RestoreDefaults glyphs are copied from
the existing app; the glyph license remains apps/gpuix/LICENSES/Phosphor-Icons.txt.
Rust crates are unpublished, so no changeset or version bump is needed.

Validation: the original Git settings component/integration suites pass all 27
tests (200 assertions). The Rust workspace run passes 725 tests across 51 suites;
after the final cancellation regression and visual refinements, all eight native
settings tests pass again. All six reviewed-settings real-Git tests, strict
workspace Clippy, formatting, logical spacing (including Windows/Linux Git),
warning-denied workspace documentation and 12 doctests pass. The final QA build
also passes. CI and native Windows/Linux UI execution were not run.

Matching captures use dark 1280×820 windows, Graph QA's repository identity and
the same dummy parity remote. The original window repeatedly returned stale
frames, so reference captures render its current AccountsSettings components
with real GitSettingsModel data in the native integration harness. Identity
summary/editor, populated remotes, Add remote and the unaccepted Remove remote
confirmation were compared. The comparison corrected dark text colors, card
rounding, source tiles/glyphs, field labels/heights, remote row spacing/actions
and the compact 340×122 removal layout. Rust retains native input focus rings
and its existing danger palette. The three-page navigation deliberately covers
only the implemented Git settings scope.

The separately named 1git Git Settings QA bundle uses a private session and a
copy of the comparison fixture under /private/tmp/onegit-git-settings-qa. This
avoids replacing running executables or editing the user's workspace session.
The final executable and signed QA bundle share UUID
4E037BA0-BB8C-33A0-A3D8-DDBB7216627A. No GUI Save or Remove was accepted; mutation
coverage uses isolated test repositories and global configuration. The temporary
reference capture test was removed from the original checkout after validation.
The dummy parity remote was removed from the original shared comparison
fixture after capture, with exact-URL and unchanged-ref checks. The private QA
copy retains it for reviewing the remote controls. The original source checkout
has no permanent code changes from this task.
The final running build's identity editor and populated remote row were
captured again after the last glyph/spacing corrections and compared against
the matching source captures. The QA app remains running; no confirmation was
accepted.


## Hosting account lifecycle and authentication recovery (2026-11-04)

| Original account boundary | Rust |
| --- | --- |
| AccountStore / SavedAccount | accounts/store.rs and model::Account; public JSON only, private atomic replacement |
| NativeCredentials / CredentialVault | vault::Vault, NativeVault; namespaced OS storage with sanitized failures |
| Accounts.connect / connectCli / disconnect | service::Accounts with reviewed metadata and rollback |
| Accounts.check / credential / registration | verified connection checks, refreshed OAuth credentials and public reconnect hints |
| AccountAuthorization / LoopbackAuthorization | oauth.rs; device grant, GitLab PKCE, exact IPv4 callback and cancellation |
| GitHubCli | cli.rs; bounded read-only discovery/token lookup for the selected host/user |
| AccountList / AccountConnectionFields / Actions | retained accounts::Panel and view.rs inside Settings |
| native password input | reusable PasswordInput with redacted native/accessibility text, no clipboard export or undo history |

| Source behavior tests | Rust tests |
| --- | --- |
| validates tokens/hosts, private metadata and host/user key isolation | metadata_is_private_versioned_and_never_contains_credentials, providers_hosts_and_identities_have_distinct_keys, hosts_tokens_and_saved_identities_are_validated_before_requests |
| reconnects only the same identity; checks keep accounts on auth/network errors | validates_then_connects_reconnects_and_removes_only_application_secrets, reconnect_refuses_wrong_identity_and_preserves_saved_credentials_on_auth_or_network_failure |
| denied vault reads, save failures and failed rollback | denied_vault_and_metadata_failures_preserve_or_explicitly_report_rollback, invalid_metadata_and_cancelled_requests_cannot_write_a_credential |
| OAuth credential format and persist refresh before later errors | oauth_credentials_round_trip_without_debugging_secrets, oauth_refresh_is_persisted_before_a_later_identity_failure_and_expiry_is_recoverable |
| public CLI discovery, pinned identity, rotation and local-only disconnect | discovers_public_cli_identities_without_exposing_credentials, cli_credentials_stay_with_gh_across_rotation_and_removal |
| device authorization, cancellation and forged loopback callbacks | device_flow_exposes_only_the_user_code_and_cancels_without_saving, gitlab_pkce_binds_loopback_and_exchanges_only_a_matching_state, callback_rejects_forgery_duplicates_wrong_origin_and_method |
| masked token, explicit connect and confirmed removal | password_masks_native_queries_blocks_copy_cut_and_undo_and_erases_on_take, account_form_requires_explicit_connect_clears_secrets_and_cancels_removal |
| background secret clearing and preserved workspace drafts | changing_method_hiding_or_cancelling_never_retains_a_token, accounts_navigation_keeps_tabs_drafts_selections_filters_and_viewports |
| equal split panels and reduced motion | account_editor_matches_split_geometry_and_motion_stops_when_settled |

The account controller is window-owned; switching repositories does not replace
repository entities or replay a Git operation. Network/CLI, file and macOS vault
work run off the render thread. Windows/Linux delegate storage and scheduling to
GPUI's native Credential Manager/Secret Service adapters. Device sign-in uses a dedicated cancellable worker rather
than occupying GPUI's read pool while waiting. Setup and confirmation transitions
use gpui-ce-motion at 160ms; reduced motion snaps and settled views stop scheduling
animation frames. The original provider/method glyphs and empty-account artwork
are retained under the existing Phosphor glyph license.

Metadata contains no credential-bearing types. Secret wrappers redact Debug and
zero transient owned buffers on drop; the password control renders only masks,
withholds IME reconversion text and accessibility values, disables copy/cut/undo,
and clears on submit/cancel/method changes or hiding. Original application
credentials are never imported. The vault has no plaintext fallback. The macOS
adapter deliberately distinguishes denied/cancelled Keychain reads from absent
items; GPUI's generic read maps cancellation to absence, so it is not used on macOS.

A process-wide asynchronous mutation gate and opaque metadata revisions reject
stale connection/removal reviews, including same-identity reconnects. The OS vault
and metadata file are separate stores: save failure restores the prior secret,
with explicit repair guidance if rollback also fails. They are not a crash-atomic
or cross-process transaction. Refresh rotation is persisted before later provider
failures. Removal never revokes a provider token or changes Git/gh credentials.
The source quirk that a switch to CLI leaves an older app-vault entry untouched
is preserved; removal of that CLI connection remains metadata-only.

Scope: GitHub/GitLab account lifecycle, browser/token/CLI methods, secure storage,
connection checks and reconnect recovery. Hosted repository browsing, account-
authenticated Git operations, publishing destinations and author suggestions are
separate ports, as are unrelated Settings pages. Git transport credentials remain
separate. The Rust namespace is intentionally isolated from the original app.
OAuth lifetimes are bounded to a year and metadata/token sizes are bounded; exotic
provider responses beyond those bounds are rejected with sanitized errors.
Rust crates are unpublished, so this feature needs no changeset or version bump.

Protocol references: [GitHub device authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) and [GitLab public-client PKCE and refresh](https://docs.gitlab.com/api/oauth2/).

The matching 1280×820 captures use the same synthetic tester/GitHub identity in
the original renderer and the live Rust preview. Browser/token setup, reconnect
and the 340×146 removal confirmation were compared. This corrected setup-header
spacing, muted action icons, source Settings glyphs and two-column CLI choices.
Rust retains its existing native focus rings and danger palette; only implemented
Settings destinations are present. No GUI sign-in, Check, Save or Remove was
accepted, and the original app's accounts and credentials were left untouched.

Live accessibility exposed duplicate native IDs in repeated setup-value/field
helpers. Explicit stable root IDs fixed the Add account crash; the corrected
browser and GitLab advanced forms were then opened with native accessibility
active. Deterministic layout tests cover distinct helper bounds but do not
initialize the macOS accessibility adapter. The separately named Accounts Preview
uses private metadata/session fixtures under /private/tmp/onegit-accounts-qa;
a process sample identified macOS file-open blocking on the earlier Documents
fixture, so that test fixture was moved without changing production storage.

Validation: all 748 Rust workspace all-target/all-feature tests passed with no
ignored tests, and all 21 account/navigation regressions passed again after the
final form corrections. The seven original account behavior suites passed 76
tests; the isolated reference-capture test also passed and was removed afterward.
Strict Clippy, rustfmt, workspace/Windows/Linux Git spacing, warning-denied
rustdoc and all 12 doctests pass. A temporary macOS Keychain entry was created,
read, rotated and deleted successfully; no personal credential was read or
modified. OAuth/provider success, expiry, cancellation and failure coverage uses
injected synthetic providers/vaults, including a real isolated loopback listener.
Live provider sign-in, native Windows/Linux account storage and CI were not run.

The final token, GitLab Advanced and reconnect native screens were compared
again after correcting the primary Connect action and the four-pixel header
spacing. The preview remains isolated from the user's application session and
account store. Production Git transport still uses its existing system
credentials; this feature does not select a hosting account for Git operations.

The final signed Accounts Preview and debug executable share UUID
7E48E4EE-81F1-3D36-93CE-6C02BE5CD6CD. The last reconnect guard also passed the
21 affected tests; the preview is left running with no sign-in or removal
confirmation accepted.
