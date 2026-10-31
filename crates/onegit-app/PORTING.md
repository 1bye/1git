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
workflow. It retains explicit page loading in History. Unported workspace network, branch-switching, AI, amend/undo, stash,
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
Branch switching from the active tab remains part of the unported branch workflow.

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
