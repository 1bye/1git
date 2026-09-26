# 1git GPUIX

Native workspace shell, replacing the earlier component showcase. The showcase
is still available in `packages/gpuix-ui/example`.

```sh
bun install
bunx turbo run build --filter=@1git/gpuix
bun run --cwd apps/gpuix build:native
bun run --cwd apps/gpuix dev
```

Both GPUIX packages stay pinned to `0.10.0`. This app runs on Bun, React 19,
and GPUIX, not the DOM or Electron. The window uses native macOS blur and
traffic lights, with a translucent light tint and an opaque white workspace.
The connected tab silhouette keeps its shape while moving; it does not port
the desktop's liquid shape-morphing machinery.

## Local native patches

The app currently requires Apple Silicon macOS, Rust **1.97.1**, and Xcode
with its Metal toolchain. The first `build:native` downloads and compiles
GPUIX; later runs reuse the build. Cargo uses the upstream lockfile and Rust
toolchain pin. Install the Metal component with
`xcodebuild -downloadComponent MetalToolchain` if Xcode reports it missing.

`native/titlebar-drag.patch` applies to GPUIX 0.10.0 commit
`9fcd628863e354e9c58019fc3bf38981a1e64158`, including its pinned GPUI submodule
`81c99f816b4a5f69d3c014774068034c24d1d7af`. It exposes GPUI's existing
`appOwnsTitlebarDrag` window option and a `windowDrag` host prop. The latter
starts native window movement synchronously during mouse down; double-click
zooms. JavaScript callbacks cannot reliably retain AppKit's current event.
Empty titlebar space and the upper gutter are drag regions; tab and close
targets are separate. Window movability and native tiling remain enabled.

`native/checkbox-a11y.patch` maps `aria-checked` to GPUI's existing
checked/unchecked/mixed accessibility state. The root Bun patch in
`patches/@gpuix%2Fnative@0.10.0.patch` adds that prop to the published JavaScript
bridge and TypeScript host contract; `bun install` reapplies it reproducibly.

`native/diff-scroll.patch` connects GPUIX's existing native diff list to the
pixel-scroll API used for keyboard navigation, in both live and test renderers.
It offers explicit file-header visibility for application-owned chrome and
avoids redundant horizontal-overflow wrappers around explicitly non-shrinking
children, preserving full-width diff backgrounds. Parsing, highlighting and
virtualization stay in GPUIX; no JavaScript diff renderer is introduced.
The patch also measures displayed text through GPUI's text shaper, caches the
width per patch/font/metrics, and exposes independent row and word backgrounds.
These APIs are wrapped by `@1git/gpuix-ui/diff-view`; the Git feature only owns
loading, notices and its filename/comparison toolbar. Hidden patch metadata does
not contribute to horizontal overflow. Short diffs fill the viewport.
Dependency versions stay pinned. `native/preload.ts` selects the
release addon through `NAPI_RS_NATIVE_LIBRARY_PATH` before GPUIX loads.
Native source, build outputs, and the patch fingerprint live in ignored `.cache/`;
there is no public fork or committed binary. All native patches participate in
the build fingerprint and are applied independently.
Missing/stale builds fail with a rebuild command, not an unpatched fallback.
Restart `dev` after a native rebuild: hot reload cannot unload a native addon.
The root Turbo dev task builds the addon first; direct app commands require
the explicit setup command above. `build` only emits the app's TypeScript.

To change the patch, update the checked-in patch and move the old
`.cache/native-source` aside before rebuilding if it no longer applies.
Do not develop changes only inside the ignored checkout. To upgrade GPUIX,
update both dependency pins and `native/config.ts`, then rebase the patch.
The native setup remains app-owned, following the Turborepo workflow.

## Structure

- `src/main.tsx`: native boot and hot reload.
- `src/window-options.ts`: window chrome and Tab/Shift+Tab traversal.
- `src/app.tsx`: one window's in-memory tabs and per-tab workspace state.
- `src/fixture/app-shell.tsx`: full-width toolbar and contained navigation/content composition.
- `src/feature/workspace-tabs/`: tab UI, focus, scrolling, and pure state transitions.
- `src/feature/repository-workspace/`: repository picking/status reads, native file diffs, navigation views, and pure workspace transitions.
- `src/styles/tokens.ts`: shared desktop colors adapted to `gpuix-ui`.
- `src/styles/workspace-layout.ts`: native chrome spacing; a 96px traffic-light area and 36px tabs in a 42px toolbar, preserving shared bottom spacing and control sizes.

The tab feature groups its modules by responsibility, following
`.agents/workflow/react.md`:

```text
src/feature/workspace-tabs/
  workspace-tabs.tsx
  components/
    workspace-tab.tsx
    workspace-tab-icon.tsx
  hooks/
    use-workspace-tab-drag.ts
  lib/
    workspace-tabs-model.ts
```

The main feature component coordinates focus, selection, and scrolling; its
components own presentation and local interaction state. The hook owns the drag
lifecycle, and the model owns pure transitions and their contracts. Modules use
direct imports without barrel files. Tests remain in `tests/workspace-tabs/`.

`fixture/app-shell.tsx` stays a stateless composition. Reusable UI primitives
already live in `packages/gpuix-ui`, so there is no duplicate app-local `ui/`.
The reusable controls and stylesheet package remain independent of app features.
`@1git/design-tokens` supplies shared colors and shell dimensions to both
Electron (generated CSS and numeric constants) and GPUIX (plain values).
The native app currently uses the platform font; the web's Manrope font import
does not register that font with GPUIX.

## Tabs

- Click a tab to activate it; + adds and selects a new workspace.
- Drag a tab horizontally: after a 5px threshold it follows the pointer directly
  while neighbors slide aside. Release commits and settles into the new slot;
  Escape animates back without changing the order. GPUIX `motion.div` animates
  explicit positions over 240ms with the desktop's `[0.22, 1, 0.36, 1]` easing.
  Overflow scrolls while holding near an edge. This does not detach tabs into
  new windows or animate their entrance/exit.
- Shift+Left/Right reorders the focused tab, without wrapping at the ends.
- Close with × or Delete/Backspace while its tab is focused.
- Left/Right wrap between tabs; Home/End select the first/last.
- Enter and Space activate a focused tab. Tab/Shift+Tab traverse the active
  tab, its close action, and the add action, with a visible focus outline.
- Horizontal trackpad scrolling handles overflow; selection reveals the entire
  tab and close control.
- Closing the active tab selects the right neighbor, then the left. Closing the
  last tab leaves the white workspace and focuses +.

The window starts with one empty workspace. + opens another empty tab so each
repository keeps its own state. Nothing is restored after restarting. Cmd+W
remains the native Close Window command. There is no theme switch or tab
entrance/exit animation yet.

## Opening a repository

- Choose **Open repository…** and select a folder in the native directory picker.
  A subfolder resolves to its Git root; linked worktrees and unborn/detached HEAD
  are supported. Cancelling leaves the workspace unchanged. Invalid folders,
  bare repositories, missing Git and read failures show an error with a retry.
- The tab shows the repository name and branch. Changes uses the existing
  `@1git/git` backend to read real status asynchronously: staged and unstaged
  records share one row per path, including untracked files, deletions, renames,
  conflicts and type changes. Ignored files are omitted. Accessible row labels
  retain both index and worktree status. A clean tree has an explicit empty state.
- Use the refresh icon beside the view pills after external edits. There is no
  filesystem watcher or automatic polling yet. Refresh retains the draft, selected
  path, and existing checkbox choices; removed paths disappear and new paths start
  included. On failure the previous data stays visible with a stale-data notice.
- Reads belong to their original tab, even after switching/reordering. Closing a
  tab or unmounting cancels pending reads and ignores late picker/read results.
- **Checkboxes are planned commit inclusion, not Git staging.** They neither stage
  nor unstage files. The composer remains preview-only: Command+Enter/the button
  never creates a commit, even with a connected repository. Drafts and inclusion
  are in-memory only. History and Stashes are not connected yet; those views
  never substitute sample records for live data.

Git must be installed on PATH. The app imports the existing workspace Git package;
the Turbo build/dev tasks build dependencies first. No Electron IPC is involved.

## Read-only file diffs

Selecting a live Changes row reads only that file and displays GPUIX's native
unified diff, with old/new line numbers, hunk headers, addition/deletion colors,
syntax highlighting and selectable text. A local native bridge preserves keyboard
scrolling while using GPUIX's virtualized list; no additional diff library is needed.

- A compact header shows the filename first, a muted folder path, and added/deleted
  line counts for the displayed comparison. Folder text yields to the filename
  and totals on narrow panes. Counts come from Git (including untracked files);
  binary files and unavailable counts show no misleading zero totals.
- **Unstaged** compares the index to the working tree; **Staged** compares HEAD
  to the index. A partially staged file offers a compact switch beside the filename;
  files with only one comparison show no switch. Technical comparison labels and
  the read-only badge are omitted. Switching the view
  does not change checkboxes or Git staging. The first available comparison opens
  automatically, preferring Unstaged.
- New/untracked files, deletions, empty files, renames and mode changes use the
  same viewer. Binary files and merge conflicts have explicit notices instead of
  misleading text. Image previews and conflict resolution are not implemented.
- The native list owns vertical scrolling and only builds rows near the viewport;
  its surrounding viewport owns horizontal scrolling only. There are no competing
  vertical scroll containers. Focus the viewer with Tab and use arrows,
  Page Up/Down, Home/End or Space; trackpad scrolling works independently of the
  file list. Drag to select text and use Command+C to copy. Comparisons and file
  selections start at the top; scroll restoration across selections is deferred.
- Refreshing repository status reloads the selected diff. Changing the file,
  view or workspace cancels the previous read; late results cannot replace a
  newer selection. Failures have a retry action. Repository-refresh failures hide
  the old diff until status can be read again.
- Preview limits are **512 KiB of Git output per command, 2,000 patch lines, and
  4,000 characters per line**. Oversized patches are omitted in full with an
  explanation, not silently truncated. These limits still bound parsing and syntax
  highlighting work even though row rendering is now virtualized.
- The light diff theme uses muted green/red markers and washes, a calmer syntax
  palette, and shared application surface/text tokens. The local native patch
  exposes `diffAddBg`, `diffDelBg`, `diffAddWordBg`, and `diffDelWordBg` theme
  colors (including alpha), independently of marker colors. Header visibility
  uses `showFileHeader`, not a zero-height header.
  The app disables the pane-wide focus ring without disabling keyboard scrolling.
  New text files omit the redundant "New file" row; empty/binary/metadata notices remain.

The shared Git diff commands treat requested paths literally and disable external
diff/text-conversion drivers, returning raw patches without invoking those tools.
Reading a diff never stages, unstages, discards or commits changes.

## Workspace preview

To try the original sample layout, scrolling and dragging without opening Git:

```sh
GPUIX_PREVIEW=1 bun run --cwd apps/gpuix dev
```

This explicit mode starts with eight sample tabs. The behaviors below describe
that preview; normal startup reads real Changes only after a repository is chosen.

Workspace tabs span the titlebar after the traffic lights. Inside the rounded
content container below, a 310px navigation pane holds compact Changes/History/Stashes
pills and lists beside the diff panel. A hairline divider separates navigation
within the same white surface without taking width away from the tab rail. The native app
reuses the desktop's color tokens and Phosphor Light icons.

- Changes shows one list of 30 sample files, all initially included in the planned
  commit. Compact rows prioritize filenames over muted paths, with status icons,
  struck-through deleted filenames, and right-aligned inclusion checkboxes.
- Clicking a filename selects its diff; clicking a checkbox only changes inclusion.
  The header shows “N of 30 selected” and an all/none/mixed checkbox. Activating
  the mixed state includes all files. Unchecking never discards a file's changes.
- Changes pins a compact commit composer below the independently scrolling list.
  One native multiline field holds a first-line summary and optional details after
  a blank line. Enter adds a newline; Command+Enter or the file-count button
  previews the action only when the summary is nonblank and files are included.
  A persistent notice makes clear that no repository is connected. Previewing
  creates no commit and leaves the draft and included files intact.
  Each workspace tab retains its draft through view switches and reordering;
  closing it or restarting the app discards that in-memory draft. History and
  Stashes do not show the composer. No separate description field is needed.
- History and Stashes stack two independently scrolling lists within the existing
  navigation width: revisions above and their files below. Selecting a revision
  populates the lower list; its title and metadata stay only in the sidebar. Those file
  rows reuse the Changes styling without inclusion checkboxes; selecting a file
  updates the diff header. Changing revisions clears the previous file selection
  and file-list scroll. The last sample revision in each view has no changed files
  so the empty state can be tried too.
- Drag the horizontal divider to resize the two lists. Tab focuses it; Up/Down
  adjust in 5% steps, Home/End choose the 25%/75% limits. Escape or focus loss
  cancels an active drag. Each view remembers its own split per workspace tab.
- Click a row to select it. Up/Down, Home/End, and Page Up/Down navigate and
  reveal rows. Enter/Space select a focused row. Tab/Shift+Tab move between the
  active view pill, include-all checkbox, focused file and its checkbox, the
  commit editor and enabled preview action, and workspace tab controls.
  Space releases toggle a focused checkbox without
  changing the viewed file. Arrow navigation from a checkbox returns to file
  navigation; offscreen keyboard targets are revealed. In History/Stashes, Tab
  traverses the revision list, divider, and file list before leaving navigation.
- Three rounded pills switch views directly. Left/Right wrap between them;
  Home/End select the first/last. Enter/Space activate the focused pill. Only the
  active pill is in the Tab order, with a keyboard-only focus outline.
  Mouse wheel/trackpad scroll the list independently of tabs.
- Every tab keeps its included files, view, each view's selected row and scroll
  offset, plus revision file selection/scroll and split proportions.
  Reordering preserves that state; closing a tab discards it. New tabs
  start fresh. Nothing is persisted across restarts.
- Selection updates the diff header; the panel explicitly remains an empty
  sample-data preview. This mode performs no Git commands, staging, commits, or
  stash mutations.

## Verification

```sh
bun run --cwd apps/gpuix check-types
bun run --cwd apps/gpuix test
bun run --cwd apps/gpuix test:integration
bun run --cwd apps/gpuix build
bun x oxlint apps/gpuix
bun x oxfmt --check apps/gpuix
```

Tests include pure tab transitions and real GPUIX native layout, accessibility,
clicks, keyboard focus, captured reordering, cancellation, and overflow. The
native motion clock also checks intermediate positions, settling, reversal,
and grabbing a moving tab without a jump. Workspace tests cover navigation/diff
geometry, all three views, inclusion independent of diff selection, select-all/mixed
state, native checkbox accessibility, row selection, keyboard reveal, wheel scrolling,
stacked revision/file selection, independent scrolling, splitter dragging/cancellation
and keyboard limits, per-tab restoration, closing/reopening, and dragging in the full-width strip. These
app tests use the patched addon and require macOS graphics access. They dispatch
GPUI events, not physical AppKit events: manually check that tab drags keep the
window still and empty-titlebar drags move it after restarting the app.
Offscreen screenshots do not capture macOS vibrancy; compare
the running window on macOS when adjusting blur/material appearance.

Connection component tests replace the OS picker and repository/diff readers while
exercising the real lifecycle and native UI. They cover cancellation, late results,
loading/errors, refresh reconciliation and preview-only commits. The separate,
uncached `test:integration` task uses the real Git CLI with disposable repositories
to check mixed status, unusual filenames, nested folders, worktrees, clean/unborn
HEAD and errors, and verifies staged content and HEAD are unchanged. It requires
Git and writable temporary storage, but no graphics access or network. The
physical native directory dialog still needs a manual check on macOS.

Diff tests cover native line-number/text painting, comparison switching,
keyboard/trackpad scrolling on both axes, a bounded painted-row count for 1,800-line
patches, full-width backgrounds, text selection without gutters, native scroll-state
cleanup, errors/retry, stale reads, refresh and preview guards.
Real-Git integration tests also cover both sides of a partially staged file,
untracked/empty/deleted/renamed paths, literal special filenames, disabled external
drivers and oversized/binary patches, without changing HEAD or staged content.
