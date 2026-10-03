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
Alternatively, `bun run build:native --runtime-shaders` uses GPUI's built-in
runtime shader compilation without downloading that optional component. Both
shader modes use the same pinned sources and patch fingerprint; an up-to-date
binary is reused regardless of this flag.

`native/test-session.patch` and `native/test-session-platform.patch` close old
test windows while their GPUI app is alive, route native test work through the
test scheduler, and scope AppKit autoreleases to native calls. Test sessions
drain pending macOS work themselves and are disposed through an N-API cleanup
hook before thread-local profiler state disappears. The macOS window teardown
also breaks the accessibility-adapter/content-view ownership cycle. Visible app
windows retain their normal asynchronous close behavior. The native lifecycle
integration test checks that repeated sessions leave no GPUI views after explicit
disposal and that automatic process-exit cleanup succeeds.

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

`native/close-protection.patch` and `native/close-platform.patch` add a synchronous
macOS close/quit veto, including the red close button, Close Window action and
AppKit termination (Quit menu, Cmd-Q and Dock Quit). They reuse GPUI's window
callback and add a pre-termination callback to the pinned macOS platform.
The build unwinds known patches in reverse order before reapplying the stack.
The root Turbo dev task builds the addon first; direct app commands require
the explicit setup command above. `build` only emits the app's TypeScript.

`native/window-activation.patch` forwards GPUI's window activation observation
through the existing native event bridge. The auto-refresh hook registers one
`windowActivated` handler using `@gpuix/native/host`'s renderer-scoped event map
(`elementId: 0`) and removes it on unmount. Moving focus between controls does
not trigger repository refreshes. No polling of the foreground application is used.

To change the patch, update the checked-in patch and move the old
`.cache/native-source` aside before rebuilding if it no longer applies.
Do not develop changes only inside the ignored checkout. To upgrade GPUIX,
update both dependency pins and `native/config.ts`, then rebase the patch.
The native setup remains app-owned, following the Turborepo workflow.

## Hosting accounts

Open **1git → Settings…** or press **Cmd+,**. Settings replaces the workspace inside
the same window, without a new tab or popover. Back restores mounted tabs, selections,
drafts, scroll and focus; Settings scopes keyboard traversal to its own controls.
Accounts stays visible as a list, with **Add account** beside its heading rather
than in a bottom toolbar. Headings, list content and setup sections share a
480-point maximum width and 16-point content insets, with compact heading descriptions. An empty list shows
a centered thin-vector account illustration and a short connection hint.
**Add account** or **Reconnect** opens a separate
right-hand setup pane with a divider and an even split of the content space;
Cancel/Escape closes that pane without leaving Settings. Choose a GitHub or GitLab
icon tile, then use matching tiles for **Browser sign-in** or **Access token**.
Quick setup follows the provider and method without numbered steps. Public application
name, homepage and callback values have keyboard-accessible **Copy** buttons with
success feedback and retryable errors; GitLab's redirect value follows the callback
configured in **Advanced**. Tokens are never exposed through these copy controls.
Provider-specific permissions and expiry guidance stay visible, followed by the public
application ID or masked token input. **Advanced** is below these fields. Setup and the saved list scroll independently;
Cancel/Connect stay in a fixed footer outside setup scrolling, even at minimum window
height. Saved-account actions are disabled while setup is open to avoid interrupting
an unfinished connection. **Open GitHub/GitLab settings** opens the exact setup
page in the system browser only when clicked. The **Other…** cell opens a draft
issue in this project's GitHub repository with provider contribution instructions;
it does not submit an issue or connect an unsupported provider.

**Advanced** contains the HTTPS host for GitHub Enterprise or self-managed GitLab,
and GitLab's registered loopback callback. Setup links follow the chosen host,
including self-managed base paths. Invalid or credential-bearing hosts cannot
open setup links or start sign-in. Changing provider/method clears typed tokens;
changing provider also clears application IDs and restores its default host.
Each connection
is verified with the provider's current-user endpoint before it is saved. This
verifies identity, not permission for every repository or future write operation.

Multiple users and hosts are supported. Saved rows show a provider glyph on the
left, with the username above a compact host/status description. Provider names
remain accessible without repeating them visually. Compact, right-aligned actions use Phosphor
refresh, pencil and trash icons with account-specific accessible names. **Check**
verifies a saved connection and refreshes expiring OAuth credentials when a valid
refresh token exists; **Reconnect** replaces only that account's token. **Remove**
opens a centered confirmation naming the account, provider and host before deleting
our saved credential and metadata. Cancel, Escape or backdrop dismissal leaves them
unchanged; dismissal and repeated confirmation are blocked while saving, and a failed
removal stays open for retry. Removal does not revoke the token at the provider,
delete repositories or touch Git's credentials. Network failures never silently
disconnect an account.

Access/refresh tokens and their public OAuth registration use GPUI's OS vault
(macOS Keychain in the supported build), with an
application-namespaced key derived from provider, canonical host and immutable
user ID. No plaintext storage fallback exists. Only account identity is persisted
in `accounts.json`, beside `session.json`; `GPUIX_ACCOUNTS_PATH` overrides that
metadata path for isolated development. It is not a token path. Metadata writes
are private (0600) and atomic; failed saves attempt credential rollback and report
rollback failures explicitly. Malformed existing metadata is preserved.

The token editor is an uncontrolled, native password field. It masks painting
and platform text, uses the password accessibility role, and prevents clipboard
copy/undo snapshots. Tokens are not React props, workspace drafts, or session
data. Temporary byte buffers are cleared; JavaScript strings cannot be guaranteed
zeroized and exist transiently while validating/storing a token. Never log an
account request, native change event, or configured provider object.

`native/accounts.patch` exposes scoped vault methods and the macOS Settings menu,
and adds native password-input support. `native/accounts-platform.patch` preserves
Keychain cancellation as an error for our entries, not “credential missing.”
Other applications' credential keys are rejected. The native bridge has Windows
and Linux dispatch paths, but this app and these vault tests are currently
validated only on Apple Silicon macOS. A packaged executable's Keychain prompts
and signing identity still require release validation.

### Registering browser sign-in

No production client IDs are embedded yet. Enter the public ID in Settings;
reconnect loads it from the saved vault entry. No client secret field exists.

- **GitHub:** [register an OAuth app](https://github.com/settings/applications/new)
  and enable device flow. The app displays a user code, opens the system browser,
  and polls with the provider's interval/slow-down rules. This flow uses no callback
  or embedded secret; GitHub's registration form may still require a callback value.
- **GitLab:** [register an application](https://gitlab.com/user_settings/applications)
  with **Confidential unchecked**, the `read_user` scope and exact callback
  `http://127.0.0.1:8765/oauth/callback` (or another explicitly registered port).
  Paste its Application ID; change the callback under Advanced if needed.
  A temporary Bun listener binds
  only `127.0.0.1`, verifies random state and PKCE, and closes on success, denial,
  cancellation, timeout or browser failure. No separate process or permanent server
  is spawned. A busy callback port produces an actionable error.

Sign-in currently requests only profile access (`read:user` / `read_user`), not
repository write access. Self-managed applications must be registered on their own
host; unsupported Enterprise device flow can use a PAT. Cancel/Escape stops pending
authorization. Once tokens are issued, identity validation and vault persistence
must finish. Refresh is serialized and rotated pairs are saved immediately so a
subsequent network failure cannot lose the new refresh token. Exchanges are not
blindly retried. The vault accepts bounded documents up to 16 KiB and remains
compatible with existing raw PAT entries. No OAuth secrets enter session/account
JSON or retained renderer props.

The token guide links to GitHub's fine-grained token form (name and 30-day expiry
prefilled; no extra permissions needed for the current-user endpoint) or GitLab's
token form (`read_user` preselected). Users still choose expiry and create the token
on the provider's site. These permissions verify account identity only; future
repository/PR features must request and verify their own permissions explicitly.

Setup references: [GitHub OAuth registration](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app),
[GitHub token setup](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens),
[GitHub current-user permissions](https://docs.github.com/en/rest/users/users),
[GitLab OAuth setup](https://docs.gitlab.com/integration/oauth_provider/),
[GitLab token setup](https://docs.gitlab.com/user/profile/personal_access_tokens/).

This milestone does **not** change HTTPS clone/push authentication,
list hosted repositories, publish repositories or open PRs. Hosting credentials
and Git transport authentication remain separate until explicitly integrated.

```sh
# Offline account logic and native UI; no live provider or real credential.
bun test --preload ./native/preload.ts --path-ignore-patterns '**/*.integration.test.ts' tests/accounts
# Real OS-vault round-trip; one random synthetic entry, removed afterward.
bun test tests/accounts/native.integration.test.ts
# Real local callback listener; synthetic provider/browser, no live account.
bun test tests/accounts/authorization.integration.test.ts
```

The OS-vault test requires an unlocked Keychain and native graphics access, and
may show a Keychain access prompt. It never infers credentials from saved accounts.

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
    workspace-menu.tsx
  hooks/
    use-workspace-tab-drag.ts
  lib/
    workspace-tabs-model.ts
    repository-branches.ts
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

- Click an inactive tab to activate it; click the active connected tab to open
  its branch/worktree menu. + adds and selects
  a new workspace. Dragging never opens the menu.
- Drag a tab horizontally: after a 5px threshold it follows the pointer directly
  while neighbors slide aside. Release commits and settles into the new slot;
  Escape animates back without changing the order. GPUIX `motion.div` animates
  explicit positions over 240ms with the desktop's `[0.22, 1, 0.36, 1]` easing.
  Overflow scrolls while holding near an edge. This does not detach tabs into
  new windows or animate their entrance/exit.
- Shift+Left/Right reorders the focused tab, without wrapping at the ends.
- Close with × or Delete/Backspace while its tab is focused.
- Left/Right wrap between tabs; Home/End select the first/last.
- Enter and Space activate a focused tab or open its menu when already active;
  Down also opens the active tab's menu. Tab/Shift+Tab traverse the active
  tab, its close action, and the add action, with a visible focus outline.
- Horizontal trackpad scrolling handles overflow; selection reveals the entire
  tab and close control.
- Closing the active tab selects the right neighbor, then the left. Closing the
  last tab leaves the white workspace and focuses +.

On first launch the window starts with one empty workspace. Later launches restore
the saved tabs and drafts. + opens another empty tab so each repository keeps its
own state. Cmd+W
remains the native Close Window command. There is no theme switch or tab
entrance/exit animation yet.

### Open, clone and create

With no tabs or an empty workspace, the native app matches the desktop launch
layout: Quick actions at left and a searchable All repositories list at right,
without the repository sidebar. Create repository, Clone from URL and Open from
disk work from this page; starting setup opens an empty tab without dismissing
its form. Previously opened roots remain available after their tabs close and
across restarts (up to 100, deduplicated, stored as paths in the session). Search
matches names/paths locally; opening reads fresh Git data, and missing folders
use the existing retry view. This list does not scan disk or import Electron data.
Right-click, Control-click or Shift+F10 on a saved repository opens the native
menu: Open, Reveal in Finder, or Forget. Forget removes only the saved entry,
preserving files and open tabs; the removal survives session restoration.
Clone/Create use the shared dimmed popover, transparent
fields, a folder-picker location control and explicit confirmation.
Clone suggests `~/repository-name` from the entered URL; the picker selects the
exact destination folder (not its parent). Create initializes the chosen folder
on the entered initial branch, defaulting to `main`, without making a commit or
changing existing files. The macOS picker can also create the destination folder.

Setup uses the existing Git backend and configured credentials. Clone displays
indeterminate progress, not invented percentages; this boundary does not stream
Git's progress output. Cancel requests process termination and keeps the form
locked until the operation settles. Tab/window closure is blocked during setup.
No app cleanup recursively deletes a failed/cancelled destination; review any
remaining files before retrying. No hosted login flow is introduced.

Nonempty clone destinations, symlinks and destinations inside another repository
are rejected. Already initialized folders offer an explicit Open repository
action instead of reinitialization. Errors preserve input; successful setup loads
fresh Changes into the requesting tab. A failure reading a successfully created
repository offers Open rather than repeating the write. Tests use disposable local
repositories and native UI events with picker/Git doubles; hosted authentication
and the physical folder dialog still need manual checks.

### Session restoration

- Open repository/worktree roots, tab order, active tab, empty tabs and commit
  drafts survive restarts. Duplicate tabs for the same root retain separate drafts.
  Closing a tab intentionally removes it and its draft from the saved session;
  closing the window retains the remaining tabs. Successful commits save the cleared draft.
- Each tab remembers Changes/History/Stashes, its selected changed file, commit,
  stash and revision file. Paths and immutable revision IDs are checked against
  fresh data; missing revision files fall back to the first available file.
  History lazily searches its previous loaded range plus one page (up to 10,000
  commits), then falls back to the newest commit if the saved ID is absent.
  Older session files remain supported; invalid optional navigation is ignored
  without losing roots or drafts. Scroll positions and inclusion checkboxes are
  not persisted.
- Every restored root is read again. Branches, status, files, inclusion checkboxes,
  History/Stashes caches, diffs and pending Git operations are never deserialized.
  Startup neither checks out a branch nor contacts a remote or resumes a write.
- Missing/unavailable folders stay in their tab with an editable draft and
  **Retry repository**. Slow reads cannot steal the active tab; closing a restored
  tab cancels its read. Restore failures do not erase the saved root or draft.
- On macOS the file is `~/Library/Application Support/1git-gpuix/session.json`,
  separate from Electron's data. Windows uses `%APPDATA%/1git-gpuix/session.json`;
  Linux uses `$XDG_STATE_HOME/1git-gpuix/session.json` (default `~/.local/state`).
  Set `GPUIX_SESSION_PATH` to an isolated file for development/testing.
- The versioned JSON contains local paths and **plaintext draft text**, not
  credentials, remote URLs or file contents. New directories/files use owner-only
  permissions on POSIX. Use one app process per session file; separate instances
  should use different `GPUIX_SESSION_PATH` values.
- Writes are debounced by 200ms, atomically replaced, and synchronously flushed
  on unmount and GPUIX's normal process-exit path. Force-killing or crashing may
  lose the last debounce interval. Completed operations flush drafts before
  releasing the close guard.
- Invalid, unsupported, unreadable or oversized saved files are preserved, with a
  visible error and autosaving disabled until repaired and restarted. Write failures
  retain the in-memory draft and expose Retry. The session has a 1 MiB size limit.
- `GPUIX_PREVIEW=1` neither reads nor writes sessions. Tests inject the session and
  storage boundary or use temporary files; they never access real application data.

### Workspace menu

The native floating layer dims the window with a translucent black backdrop and
reuses the active tab's SVG silhouette and label above it. The original tab stays
in place. The menu opens directly from the copied tab with a 160ms height/opacity
animation, centered beneath it and shifted inward at window edges. It overlays
the content without moving the sidebar; there is no chevron. Backdrop clicks are
consumed, so dismissing the menu never activates dimmed controls underneath.
The compact desktop-style menu shows the current branch/upstream, three local
branches ordered by latest commit, relative commit ages, and a More row to expand
the scrollable list. Existing worktrees remain available below the branches.
Create new branch opens an inline form; Cancel/Escape returns to the actions.
There is no permanent search field or Close footer. Right-click a local branch
(or use Control-click / Shift-F10) for Rename and Delete. Both require confirmation;
rename starts with the current name. Checked-out branches cannot be deleted,
branches checked out elsewhere cannot be renamed here, and Git's non-forcing
delete protects unmerged work. Remote branches have no management actions.
Upstream editing is not yet exposed.
Up/Down moves through enabled rows, Enter activates, and Escape/outside-click dismisses the menu.
Keyboard dismissal returns focus to the tab; Tab dismisses and continues traversal.
Inside the worktree form, Tab moves between its controls instead of dismissing it.
This is not a port of the Electron liquid SVG morph.

- Switch a local branch in this working directory, or explicitly create and
  switch to a new branch based on the current HEAD.
- Branch changes require a clean tree and no ongoing Git operation. Fresh status
  and HEAD/branch identity are checked before writing. No force checkout,
  auto-stash, reset, or discard is used. Dirty-tree handling offers no automatic
  resolution yet. Git also rejects branches checked out in another worktree.
- Existing worktrees open in separate tabs; an already-open canonical root reuses
  its tab. **New worktree…** creates a separate checkout on a new branch based on
  the current HEAD, or an existing local branch not already checked out. The editable
  branch picker filters local branches and accepts new names; exact matches reuse
  the existing branch. A short hint explains the choice, and occupied/invalid names
  disable creation. Selecting a suggestion never writes to Git. Choose a
  branch name to suggest a sibling folder automatically; clicking **Location** opens
  the native folder picker and uses that exact destination. Cancelling preserves
  the location, and chosen folders are kept when the branch changes.
  **Create and open** opens a new tab.
  The original checkout, index, uncommitted files and commit draft stay untouched.
  Existing empty folders are accepted; non-empty folders, files and symlinks are
  rejected, never overwritten. No force or automatic
  cleanup is used. Remote branches are also available in the expanded branch menu
  and the worktree picker. Confirmation creates a local tracking branch from the
  selected remote ref, without fetching automatically. Local-name collisions are
  blocked; choose the existing local branch instead. Use Fetch to refresh remote refs.
  Remote refs already tracked by a local branch are hidden in both pickers.
  Right-click a linked worktree for **Remove worktree…**. Confirmation shows its
  exact folder and warns that its tabs and saved commit drafts will be removed;
  the branch is retained. Main/current, locked, stale, dirty and unavailable
  worktrees are refused, including folders containing untracked or ignored files.
  Removal never forces or recursively deletes files itself. Related app writes and
  tab/window closure are blocked until completion. Only confirmed success removes
  affected tabs from session restoration; failures keep them available for review.
  Closing a tab alone never removes its worktree.
  Creation locks app writes across related worktrees and protects window/tab closure
  until status is refreshed. If opening fails after creation, the error identifies
  the folder to open manually; creation is not retried automatically.
- Tabs showing the same folder share its branch. The window-owned mutation hook
  serializes commits and branch changes for that root, pauses reads, and prevents
  closing affected tabs while writing. A fresh snapshot updates every matching
  tab after success or failure, preserving drafts. Failed refresh blocks further
  writes until the user refreshes successfully.

### Remote synchronization

- **Fetch** is an explicit action in the tab menu. It uses `@1git/git` to fetch
  configured remotes, including with uncommitted changes. Opening a menu or
  refreshing local status never contacts a remote. No remote means a disabled
  action, not a successful no-op.
- **Pull** updates the current branch from its configured upstream, fast-forward
  only. It requires a clean working tree, an existing commit, and no active Git
  operation. Diverged histories are rejected without starting a merge or rebase.
- **Push** sends the reviewed HEAD to that branch's exact upstream destination.
  It never forces, mirrors, automatically pushes tags, or writes other branches.
  Uncommitted changes can remain in place. Multiple push URLs are rejected.
- Without an upstream, **Publish branch…** replaces Push. Choose a configured
  remote explicitly, then confirm. It publishes the current branch under the same
  name and sets its upstream; opening the picker or cancelling never writes.
- The menu shows operation progress and **Cancel/Stop**, the last successful fetch,
  and current upstream/ahead/behind counts. These counts describe the last known
  remote refs; Fetch updates them. The action survives dismissing the menu;
  errors stay available when it reopens, and retry is explicit.
- Sync uses existing Git credentials and a two-minute deadline. Cancellation
  aborts the Git request; normal window closure is blocked until it settles and
  status is refreshed. A stopped or timed-out
  write may already have completed: review status before explicitly retrying.
  There is no sign-in UI, background schedule, force push, rebase, or automatic stash.
- During synchronization, affected tabs pause repository reads and block competing writes
  and tab closure. Tabs sharing the same Git common directory, including linked
  worktrees, share the pending operation and last-fetch status. Every open root
  is refreshed afterward, even on failure/cancellation because some remotes may
  already have updated. Drafts and file inclusion are retained. Pull deliberately
  advances the current branch; Fetch and Push do not change working files.
  A failed status refresh blocks writes until a successful manual refresh.

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
- External edits refresh automatically; the refresh icon remains available.
  Refresh retains the draft, selected path, and existing checkbox choices;
  removed paths disappear and new paths start included. On failure the previous
  data stays visible with a stale-data notice.
- Reads belong to their original tab, even after switching/reordering. Closing a
  tab or unmounting cancels pending reads and ignores late picker/read results.
- **Checkboxes select whole files for the next commit, not Git staging.** Toggling
  them neither stages nor unstages files. Command+Enter/the composer button creates
  a real commit in a connected repository. Drafts are saved with the session;
  inclusion choices remain in-memory only.
  History is read-only; Stashes provides explicit create, apply and delete actions.
  Unavailable views never substitute sample records for live data.

Git must be installed on PATH. The app imports the existing workspace Git package;
the Turbo build/dev tasks build dependencies first. No Electron IPC is involved.

### Automatic refresh

- A recursive filesystem subscription watches each open working tree and its
  private/shared Git directories, including linked worktrees. Tabs sharing a root
  share one subscription and one background status read. Returning to the native
  window also requests an update, covering missed filesystem events.
- Events are debounced for 250 ms, with a one-second ceiling for sustained bursts.
  Only one background read per root runs at a time; events during it queue one
  follow-up. Git objects, logs and temporary lock churn are ignored. Status uses
  `--no-optional-locks` so its own index-stat refresh cannot trigger a read loop.
  Ignored working-tree build outputs can still cause a coalesced read; there is
  no periodic repository scan or extra watcher dependency.
- Changes and the selected working diff update quietly without replacing the
  mounted native diff list, preserving its scroll anchor. Drafts, checkbox choices,
  list scroll and available selections remain intact. History reloads after HEAD
  changes; a selected commit/file is retained when present in the refreshed page.
  Stashes reload even when HEAD is unchanged and retain selection by immutable OID.
  History/Stashes queries remain lazy while their views are hidden.
- Any tab's commit or explicit repository read pauses background work for that
  root and aborts stale reads. Queued changes are drained after completion.
  Automatic refresh never clears an uncertain-commit review safeguard: that still
  requires an explicit refresh and inspection of History.
- Closing the last tab, unmounting or hot reloading closes watchers, removes the
  activation handler, cancels timers and aborts reads. If watching cannot start or
  fails, a notice directs the user to manual/focus refresh. Sample preview mode
  has no watchers. The application entry point supplies the filesystem boundary;
  native component tests inject notifications without observing real repositories.

## Committing selected files

- Write a first-line summary, with optional details after a blank line, then use
  **Commit N files** or **Command+Enter**. The commit uses the checked files' current
  whole-file contents. Excluded staged and working-tree changes remain excluded;
  checkbox toggles themselves never write Git state.
- The backend acquires the repository's index lock, prepares a temporary index,
  and uses Git's selected-path commit operation. Configured hooks and signing run
  normally. On success it installs the updated index, retaining excluded staging.
  Hook/signing failures keep the original index and draft; hook programs may still
  perform their own configured filesystem side effects.
- Selected partially staged files are intentionally blocked: stage or unstage the
  whole file using Git and refresh, or uncheck it. Submodules, unresolved conflicts,
  active merge/rebase operations, and ambiguous file/directory changes are also
  blocked. HEAD and branch are rechecked before committing; stale state requires
  a refresh and review. Partial-hunk selection is not implemented.
- During a write, the composer, inclusion checkboxes, refresh and affected tab-close
  actions are disabled. View/tab switches remain usable; they do not cancel a write.
  Duplicate submissions are blocked across tabs for the same repository. Normal
  close/quit is vetoed until all open workspaces finish their operations and
  required refreshes. A blocked attempt shows window-wide progress, including
  background tabs; it never queues a later quit. Synchronization offers Stop,
  but commits and branch changes have no unsafe force-cancel button. Dismissal
  keeps working without cancelling anything. Force Quit, crashes and OS kills
  cannot be prevented. Do not hot-reload/restart development code during writes.
- Confirmed success clears only the submitting tab's message and refreshes Changes
  and History state in every open tab for that repository. Other drafts and excluded
  checkbox choices survive. A failed commit keeps the draft and shows Git's error.
- If the write outcome cannot be confirmed, or a post-commit refresh/index update
  fails, the app shows a warning and blocks further submissions until an explicit
  refresh. Inspect History before retrying an uncertain operation. Recovery warnings
  include the retained temporary index location; never blindly recommit.
- Explicit `GPUIX_PREVIEW=1` sample mode remains preview-only and performs no writes.

## Comparing branches

- Open the active tab menu and choose **Compare**. The centered selectors above
  the preview choose the base (left) and incoming branch (right); the swap button
  reverses them. Both offer local and remote-tracking branches. The base initially
  uses the workspace's HEAD. This is a read-only snapshot; it does not fetch,
  switch branches, merge, or change the index or working files.
- Incoming commits are those reachable from the selected branch but not the
  selected base, loaded in pages of 50. **All branch changes** shows the combined
  changes from their common ancestor to the selected branch. This is not a
  preview of the eventual merge result or a conflict check.
- Select an individual commit to browse its first-parent changes. File selection
  automatically previews the first file, reusing text diffs and image previews.
  Endpoint commits and image blobs remain pinned if branches move externally.
- **Back** restores the underlying Changes/History/Stashes view and draft.
  Comparison is temporary and is not restored after restarting. Reopen it to
  capture newer branch tips. Unborn HEADs cannot compare; unrelated histories or
  multiple merge bases report an explicit error rather than a misleading diff.

## Browsing History

- History search uses the toolbar search icon or Command+F. It matches full commit
  messages, author names/emails, and full or partial hashes case-insensitively as
  literal text. It scans history reachable from the refreshed HEAD in cancellable
  batches, not just the loaded rows, and returns pages of 50 matches. Typing is
  debounced; large histories can take longer to search. Escape restores the normal
  cached list and selection. Repository/HEAD changes invalidate the search cache.
- History lazily loads real commits reachable from the last refreshed HEAD, with
  the summary, author, authored date and short SHA. Scroll near the end for the
  next 50 commits, or use **Load more commits**. Pagination is anchored to that
  HEAD, so external commits cannot shift page offsets while browsing.
- Select a commit in the upper sidebar to read its changed paths and automatically
  preview its first changed file. Choose any other path below to inspect it.
  File lists are fetched on demand without loading
  every patch; completed lists/pages are retained for the workspace tab's lifetime.
- Committed diffs compare with the first parent (the empty tree for root commits).
  Merge commits use the same first-parent comparison, not a combined/conflict diff.
  Empty commits and unborn repositories have explicit empty states.
- The existing native text diff and PNG/JPEG/WebP/SVG previews are reused. Image
  versions come from the exact committed blobs, independently of the current index
  or working files. SVG **Preview / Source**, original metadata, size limits and
  binary/unsupported notices work here too. There are no staging or commit actions.
- Each workspace keeps its selected commit/file, list scroll offsets and divider
  size across tab/view switches. Changing commits resets the file list to the top
  and selects its first file, including cached commits, without moving keyboard
  focus out of the commit list. Empty commits keep the file selection empty.
  Pending reads are cancelled on view/tab changes, refresh or close; errors expose
  Retry without discarding loaded pages. History selection is persisted as session
  intent; Git pages are always reloaded after restart.
- Refresh keeps cached History when HEAD is unchanged. A different HEAD resets
  pagination to the new snapshot. Automatic refresh retains the selected commit
  and file when they remain in the refreshed page; explicit refresh and successful
  app commits reset selection when HEAD changes.

## Browsing Stashes

- Stashes lazily lists saved work with Git's summary (including the original branch),
  creation date and stash reference. Select a stash to automatically preview its
  first file; mouse/keyboard selection, the split sidebar and per-tab scroll state
  work the same way as History.
- Tracked files compare the saved working tree with the stash's original base,
  combining staged and unstaged changes. The optional untracked snapshot is also
  included. This is a saved-content preview, not a reconstruction of staging choices.
  Text, image and SVG previews read immutable Git objects, never today's working files.
- Refresh reloads the stash list even if HEAD is unchanged. Selection and cached
  files follow object IDs, not `stash@{n}` labels, which Git can renumber. Removed
  stashes disappear; the first remaining stash is selected if necessary.
- Files load on demand. Leaving the view, refreshing or closing/switching tabs
  cancels pending reads; late results are ignored. Empty and failed reads have
  explicit states and retry controls. Reading never changes the index, working tree
  or stash reflog.
- **Stash changes…** in Changes and **New stash** in Stashes open a compact form
  in a dimmed, anchored popover. New stash is a primary button fixed at the
  lower-right of the Saved work pane, above Stashed files. The form opens above
  it without moving the list, with native opening/closing animation, contained
  keyboard focus and Escape/outside-click dismissal (blocked during writes).
  The form comes
  with an optional message and an opt-in untracked-files checkbox. Creation saves
  all tracked changes, independently of the commit checkboxes; ignored files stay
  untouched. Unborn repositories and changed submodules are not supported.
- **Apply** requires a clean working tree and keeps the stash, including when Git
  reports conflicts. A successful apply returns to Changes. There is no Pop action.
- **Delete stash…** requires confirmation. The reviewed immutable ID is resolved
  to its current stash reference immediately before deletion; stale or ambiguous
  selections are refused. Avoid concurrent external stash mutations: resolving
  the reference and deleting it are separate Git commands, not an atomic operation.
- Writes recheck HEAD/branch and reject active Git operations or conflicts. All
  open worktrees sharing the stash reflog are locked against competing app writes
  and refreshed after success or failure. Refresh failures block further writes
  until refreshed. Native close protection remains active through this refresh;
  stash commands cannot be cancelled mid-write. Commit drafts are preserved.

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
  same viewer. PNG, JPEG, WebP and SVG files have image previews, described below.
  Other binary files have explicit notices instead of
  misleading text. Conflict resolution is not implemented.
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

### Changes file actions

- Use the **search icon** beside the connected view tabs or **Command+F** in Changes to match filenames and relative
  paths (case-insensitive). Escape clears and closes the field. Filtering leaves
  the current diff and commit inclusion unchanged; Shift-selection and native
  group actions use visible matching files. The select-all commit checkbox still
  controls all changed files, including hidden ones.
- Click selects one file; Command-click toggles files and Shift-click selects a
  range. Shift+Arrow extends the range. The diff follows the last clicked file;
  highlighted files are independent of the commit inclusion checkboxes.
- Right-click within a selection keeps the group; right-click outside it selects
  just that file. The group menu includes/excludes files from the commit, copies
  their relative paths, or discards their changes together.
- Right-click or Control-click a file, or press Shift+F10 on its focused row.
  The pinned macOS addon displays an actual AppKit context menu; there are no
  three-dot controls, custom menu surfaces, or dimmed menu backdrops.
  Actions open the file in the macOS text editor, reveal it in Finder, or copy
  its repository-relative path. Opening/revealing requires an existing regular
  repository path; errors remain visible in the menu.
- **Discard changes…** requires a native macOS warning dialog (Cancel is the
  default) and removes both staged
  and unstaged changes for the selected files, irrespective of commit checkboxes.
  It is unavailable during Git operations; conflicts, renames, submodules and
  non-regular working files require external handling. Branch identity is checked
  again before writing. Closing and competing app writes are blocked through refresh.
- Recovery patches and instructions are saved before modifying files under
  `~/Library/Application Support/1git-gpuix/discard-recovery/<id>` with private
  permissions. **Show recovery backup** reveals the folder after success.
  Backups survive restarts, can contain sensitive source contents, and are not
  automatically deleted. Recovery is manual using the included instructions;
  do not force a patch over subsequent edits. External Git/editor processes are
  not locked, so avoid concurrent writes during discard.
  Every selected path is validated and backed up before any file is changed.

Native menu tracking and confirmation run synchronously on the AppKit main
thread. No Git write starts until a menu choice and confirmation have returned.
Rebuild native support and fully restart the app after changing these patches;
hot reload cannot replace a loaded addon. This bridge is macOS-only.

### Manual conflict resolution

- Conflicted Changes rows show a red status icon and **Conflict** label. Selecting
  one shows the read-only working file, including its conflict markers.
- **Open in editor** uses macOS's default text editor (`open -t`), never a
  repository-provided shell command. Save edits there, then **Refresh preview**.
- **Mark resolved** stages only the reviewed file. It rechecks HEAD/branch,
  conflict status, regular-file safety, UTF-8 content, remaining marker lines,
  and the preview's content hash. It does not commit, continue/abort a merge or
  rebase, choose a side, or delete the stash. Use the separate operation controls
  after resolving conflicts; stash conflicts without an ongoing operation can
  return to the normal commit flow after resolution.
- Binary, deleted, symbolic-link, submodule and oversized conflicts require
  external Git resolution. Text previews/resolution are limited to 512 KiB.
  Marker detection is conservative; marker-like text may require external staging.
- Closing and competing app writes are blocked until the resolution and status
  refresh finish. Failures retain the draft and refresh the index state. A failed
  refresh blocks further writes. External editors/Git processes are not locked;
  avoid concurrent writes while marking a file resolved.

### Merge and rebase completion

- Changes shows the active merge/rebase, conflict count, **Continue** and **Abort…**.
- Continue uses Git's staged resolutions and existing message, retaining hooks
  and signing. It never stages files or uses the commit-inclusion checkboxes.
  Unresolved conflicts or unstaged tracked edits block continuation.
- Abort requires confirmation: Git attempts to restore the pre-operation state,
  and conflict-resolution edits may be lost.
- Both actions recheck HEAD, branch and an operation-metadata fingerprint.
  Results are refreshed even on failure: a rebase may stop at another conflict.
  Closing and competing app writes remain blocked through the refresh; a failed
  refresh blocks further writes until the repository is reviewed again.
- Skip, interactive rebase editing, cherry-pick/revert completion and cancellation
  of an in-flight local Git command remain external workflows. External Git
  processes are not locked; avoid concurrent writes.

### Image previews

- PNG, JPEG, static WebP and self-contained SVG files open in a centered native
  image view. Modified images show **Before** and **After** side by side; new and
  deleted files show only the available version with a centered **Added** or
  **Deleted** caption. The file header's right side shows original dimensions
  (after EXIF orientation) and byte sizes instead of line counts, labeled
  Before/After when both versions exist.
- SVG files have keyboard-operable **Preview / Source** controls in the existing
  header. Source uses the same native text diff, including when SVG preview
  validation fails. Staged/Unstaged switching selects the corresponding image
  comparison without changing Git staging or commit inclusion.
- Before/after bytes come from the status snapshot's HEAD/index blob IDs and a
  bounded working-file read. A per-read cache shares index pixels between both
  comparisons. Refresh reads new versions; selection/tab changes cancel Git
  reads and discard late decoding results. Each failed side shows its own error;
  Refresh retries reads. Missing versions are not treated as decode failures.
- Sharp prepares bounded, oriented PNG preview pixels off the UI thread; GPUIX
  still displays them using its native `<img>` with aspect-preserving containment.
  The subtle transparency checkerboard is composed into preview pixels only,
  never the source file. Saxes validates SVG XML before decoding. No WebView or
  browser renderer is introduced and no native GPUIX rebuild is required.
- SVGs rasterize from vectors at the fitted viewport resolution, not their small
  intrinsic bitmap size. GPUIX 0.10 exposes logical bounds but no display scale;
  this macOS app uses a bounded **2× backing** for both Retina and 1× displays.
  Bounds are sampled every 100 ms, then rendering waits for 100 ms of stable size.
  Each visible side permits one decode at a time and discards obsolete results.
  A sharp initial preview remains visible while the fitted version is prepared.
  Validated SVG source stays with the selected image; resizing does not reread Git.
  The original dimensions remain in the header, and checker squares stay about
  eight logical pixels wide (rounded to backing pixels). Preview/Source changes
  and unmount stop sampling and cancel pending work.
- Limits: **8 MiB input**, **16 megapixels**, **8192 px per side**, and a maximum
  **2048 px preview edge**. SVG additionally allows at most **512 KiB / 10,000
  elements**. Sharp retains its decoder safety checks and a three-second pixel
  processing timeout; this is not a whole-operation deadline for SVG parsing.
  Already-running native work may finish after cancellation, but its result is
  discarded. No cross-file preview cache is retained.
- SVG previews reject external/embedded image references, scripts, foreign
  documents, animation, DTDs, processing instructions, CSS escapes and at-rules.
  Internal fragment references and gradients are supported. Animated WebP and
  working-tree symbolic links show an explanation. Browser-dependent SVG features
  are not guaranteed to match browser rendering; Source remains available.

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
  and file-list scroll; History then selects its first changed file automatically.
  The last sample revision in each view has no changed files
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

Sync tests exercise native menu/keyboard activation, dirty-tree fetching/pushing,
explicit publish confirmation, cancellation across worktree tabs, retry, pending
locks, refresh failures and window cleanup. Offline Git fixtures use temporary
bare remotes and clones to verify tracking, fast-forward-only pulls, exact push
destinations, publish/upstream setup, config overrides, stale-branch rejection,
non-fast-forward rejection, and preservation of dirty files and index bytes.
They do not exercise hosted authentication or a real network connection.

Connection component tests replace the OS picker and repository/diff readers while
exercising the real lifecycle and native UI. They cover cancellation, late results,
loading/errors and refresh reconciliation. Commit component tests replace the Git
write boundary and exercise native button/keyboard submission, pending-state guards,
errors, partial staging, uncertain outcomes and cross-tab refresh. The Git package's
selected-commit integration tests use real disposable repositories to verify index
preservation, hooks, special paths, first commits, worktrees and recovery outcomes.
The separate,
uncached `test:integration` task uses the real Git CLI with disposable repositories
to check mixed status, unusual filenames, nested folders, worktrees, clean/unborn
HEAD and errors, and verifies staged content and HEAD are unchanged. It requires
Git and writable temporary storage, but no network. The session-exit integration
test also requires native macOS graphics access. The
physical native directory dialog still needs a manual check on macOS.

Session tests cover schema validation, duplicate/linked roots, independent drafts,
tab order/activation, fresh out-of-order repository reads, missing-folder retry,
read cancellation, debounced saves and failure feedback, preview isolation, private
atomic files and preservation of corrupt sessions. A separate Bun/native process
edits a draft and calls `process.exit` before the debounce to verify final flushing.

Automatic-refresh tests additionally exercise real atomic saves, index and HEAD
changes, shared worktree stash refs, watcher cleanup and the absence of status
feedback loops. macOS filesystem events require execution outside a restricted
sandbox. Native tests inject the activation event and check coalescing, shared
subscriptions, draft/inclusion preservation, diff scroll and commit cancellation;
physical app switching should still be checked after restarting the native app.

Diff tests cover native line-number/text painting, comparison switching,
keyboard/trackpad scrolling on both axes, a bounded painted-row count for 1,800-line
patches, full-width backgrounds, text selection without gutters, native scroll-state
cleanup, errors/retry, stale reads, refresh and preview guards.
Real-Git integration tests also cover both sides of a partially staged file,
untracked/empty/deleted/renamed paths, literal special filenames, disabled external
drivers and oversized/binary patches, without changing HEAD or staged content.
