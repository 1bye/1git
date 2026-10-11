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
and GPUIX, not the DOM or Electron. The window uses native macOS sidebar vibrancy
and traffic lights. Titlebar and rail backgrounds stay transparent in both themes;
AppKit supplies the matching light or dark blurred material, while the workspace
uses its own opaque content surface. Dark mode never covers the native blur with
a painted tint.
The connected tab silhouette keeps its shape while moving; it does not port
the desktop's liquid shape-morphing machinery.

The app disables focus outlines through its shared native UI tokens and custom
row/tab styling. Arrow/Tab navigation, selection backgrounds, caret visibility,
and keyboard activation remain intact; ordinary field borders are unchanged.

## Appearance

Settings → Appearance offers Light and Dark, with live previews and immediate switching.
Light remains the default for new and older sessions. The choice is saved alongside
diff preferences in the workspace session and restores on restart. Switching does
not remount workspaces, clear drafts/inclusion, reload Git, or reset native diff scroll.

Window-local React context selects complete app, control and native diff palettes.
Shared styles and active-tab SVGs are precomputed per palette, not rebuilt while scrolling.
Dark syntax and addition/deletion backgrounds are separate from selection colors.
Syntax colors follow [GitHub Dark Default](https://github.com/primer/github-vscode-theme/blob/main/src/theme.js),
mapped to native token kinds rather than every language-specific scope. Comments
use a brighter Primer gray to remain readable on changed rows; diff backgrounds
and the app's surfaces are unchanged by the syntax palette.
The owning native window follows the selected appearance; there is no automatic
system-theme following in this version.

Appearance also offers **Show commit type badges**, enabled by default and saved
with the window session. History (including file history), comparison/PR commit
lists and the last-commit footer replace recognized conventional prefixes with
small, muted light/dark labels. Scopes remain beside the title and `!` stays visible
on breaking prefixes. Ordinary or unrecognized messages stay untouched; selection,
search, copying and history-editing actions always use the original Git message.
This is presentation only: no Git metadata is changed or fetched for the badges.

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

`native/live-frame-platform.patch` keeps synchronous dirty-window redraws on
GPUI's deterministic test dispatcher (and benchmarks), rather than every live
input event merely because the addon includes test support. Normal windows use
GPUI's existing display-clock scheduling. The embedded AppKit pump gives its
run loop a one-microsecond deadline, rather than zero, so pending main-queue
display callbacks can run without waiting for vsync. A real-window regression
sends a burst of scroll input without pumping frames, then checks repeated
repaints after exposure; the native component tests retain immediate rendering.

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

`native/anchored-center.patch` fixes centered floating layers on all four sides.
A zero-size anchor point prevents flex alignment and GPUI's anchor placement
from both subtracting half the content size. The shared `@1git/gpuix-ui/tooltip`
wraps native hover/focus behavior with an inverted, non-interactive surface.

`native/sidebar-vibrancy-platform.patch` matches this app's light Electron chrome
using AppKit's Sidebar material, behind-window blending and active state. It removes
the GPUI fork's private-layer tint/saturation stripping. `window-appearance.patch`
and `window-appearance-platform.patch` remove the former light-only pin and expose
a narrow per-window appearance setter. The Sidebar backdrop inherits Aqua or
Dark Aqua from its own NSWindow; it keeps AppKit's blur, tint and saturation.
The real-window integration test switches both themes under both system appearances
without changing the application's appearance. Component tests verify transparent
chrome and retained workspace state through a live theme switch.

`native/rounded-overflow-platform.patch` clips descendants of rounded overflow
surfaces, including native diff rows. GPUI otherwise rounds only the background,
leaving square child backgrounds over workspace corners. Corner-intersecting
primitives use physical-pixel scissor bands; the rectangular interior and GPU
buffer layouts stay unchanged. Screenshot-pixel tests check exposed chrome at
all four corners and retain clipping after diff scrolling.

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
`native/diff-split-layout.patch` keeps fixed split panes at 50/50 with separate
native horizontal offsets and one shared virtual vertical list. Hovering a pane
chooses it for horizontal keyboard scrolling; trackpad scrolling stays inside
that pane. Diff settings also offer the previous content-sized canvas and save
the choice with the window session. Old sessions default to fixed split panes.
`native/diff-context.patch` adds an opt-in `onExpandContext` event to omitted-code
separators. The native renderer reports the path and hunk coordinates; the app
reads and inserts additional context, keeping native virtualization and selection.
`native/diff-syntax.patch` supplies a separate `syntaxPatch` with complete,
unfiltered context for both file versions. The Git reader fetches it alongside the
visible patch, checks snapshot headers, and budgets it in the existing preview cache.
Hidden context never adds rows, changes inclusion coordinates, or stages anything.
Native highlighting uses each side's language and retains spans only for displayed
lines. Source fingerprints are computed on prop changes; wheel frames reuse parsed
rows, syntax and measured widths. Theme and inclusion changes do not reparse.
Context above 512 KiB, failed reads or stale snapshots fall back to independently
highlighted contiguous fragments; multiline state outside those fragments cannot
be recovered. Unknown languages remain plain text. Pixel regressions cover omitted
imports/comments/strings, with cache counters checked across repeated wheel frames.
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

## State illustrations

Empty, selection, search, loading, error and unavailable-preview messages share
original thin-line SVG illustrations in `src/fixture/state-artwork.tsx`. File,
commit, stash, repository, account and clone prompts use distinct drawings with
the same muted color, one-point strokes and 160 × 112 canvas; compact list messages
use half-size artwork. `StateMessage` keeps the visible text and recovery actions
accessible while the artwork remains decorative and ignores pointer events.
These are static native vectors, not bitmap assets or animated loading timers.
Genuinely empty Changes, History, Stashes and comparison sidebars retain their
quiet placeholder lines; pending reads, failed reads and search results stay distinct.

## Git identity and repository settings

The Settings sidebar separates **Application** from **Repository**, with compact
8-point padding and no repository-name label in navigation. Repository options are hidden when none is open.
**Application → Commit identity** edits the computer-wide `user.name` and `user.email` used for
future commits, including commits made by other Git apps. Hosting login and
credentials are separate and remain unchanged.

Open a repository's tab menu → **Repository settings…** to go directly to **Remotes**.
**Repository → Commit identity** is a separate page. Its identity inherits Git defaults
while the **Default** tile is selected. Choose **Custom** or a connected account to edit a repository override;
saving with **Default** selected removes the local
override. Repository defaults are shared with linked worktrees; an existing
worktree-specific identity is shown read-only rather than silently overwritten.
Identity pages show the saved name and email; **Edit** opens a right-side form.
The form reuses account setup's choice tiles: **Default** (repository only),
connected accounts labelled with username/host, and **Custom**. Account selection
reads author suggestions on demand through the existing verified/refreshable credential
path and fills an editable draft. It does not switch Git authentication or write config;
only **Save identity** applies the name/email. GitHub suggestions use verified emails,
preferring the primary address when available; missing email permission leaves email
blank for manual entry. GitLab uses its commit email when available without falling back
to a personal email for a private-email sentinel. No address is invented or stored in
account metadata. Changing the source, Cancel, or leaving the page aborts the lookup
and ignores late responses. Saved Git identity is not a live binding to a hosting account.

The Remotes page lists connections with explicit **Add**, pencil **Edit** and confirmed
trash **Remove** actions. URL edits preserve dedicated push URLs. Multi-fetch-URL
remotes require Git directly. Removal deletes remote tracking/configuration, not
local files, local branches or the hosted repository. Settings never fetch or
push automatically; remote changes refresh repository thumbnails.
Adding or editing a remote keeps the list visible on the left and opens the form
on the right, matching account setup. Form fields scroll independently, with
**Cancel** and **Save** pinned below. Cancel or Escape discards the draft without
writing to Git; a successful save closes the form. Escape closes an open form
before leaving Settings, and cannot interrupt a pending save.

Remote rows have a leading GitHub/GitLab icon based on their primary fetch URL;
unknown hosts and local paths use the generic Git glyph. Recognition includes
SSH and configured self-hosted providers, without network requests. Account
summaries remain text-only so the provider icon is not duplicated.
HTTPS remotes show a compact account summary instead of a select, with
a muted **Automatic** indicator when the app chooses the matching account.
The right-side remote editor uses the existing choice tiles for **Automatic**,
**System Git**, and connected accounts. Choices are drafts until **Save remote**;
Cancel leaves authentication unchanged. Account-only saves do not rewrite Git
URLs or author identity, and never read credentials or contact a provider.
Separate fetch/push destinations keep independent choices. Multi-fetch-URL
remotes still require Git for URL edits, but allow account changes in the editor.
SSH continues to use system Git credentials.

Saves block competing writes in the window and refresh affected open worktrees,
preserving commit drafts and selections. Partial failures reread the actual config;
failed workspace refreshes require a refresh before further Git operations.

## External editor

**Settings → Application → External editor** controls both file-menu and conflict
file opening. Select an installed editor or use **Choose application…** for a
custom macOS `.app`. Common editors are detected in `/Applications` and
`~/Applications`; **System default** keeps the macOS text-editor association.
Choices save immediately and survive restarts in private `editor.json` beside
`session.json`. `GPUIX_EDITOR_SETTINGS_PATH` isolates this preference for testing.
**File type defaults → Add rule** opens a right-side draft form. Enter comma-separated
extensions (such as `.ts, .tsx`) or exact filenames (such as `Dockerfile`), choose
an application, then Save. Edit and remove rules beside their summaries. Cancel or
Escape discards only the draft; application choices in the draft do not save early.
Exact filenames win, followed by the longest case-insensitive extension (`.d.ts`
before `.ts`), followed by the overall default. A System default rule explicitly
uses the macOS text-editor association. Duplicate file types are rejected.

Single-file context menus keep the resolved **Open in Zed** shortcut and add
**Open With** with installed/saved applications, System default and **Other application…**.
These choices affect this opening only; they never change preferences or system
file associations. The existing **Open with Default App** action still uses the
ordinary macOS file-type association instead of the text-editor association.
Application discovery is warmed once per window and refreshed in Settings; opening
the menu reads cached editor metadata and bounded preferences without discovery scans
or subprocesses.
Finder, the resolved editor shortcut, and available applications in **Open With**
show their own small native app icons. Other actions remain text-only. AppKit caches
16-point image copies with memory-pressure eviction after the first bundle lookup;
missing/invalid icons leave the label and action intact. Icon lookup never launches
the application.
Version 1 preferences remain readable and upgrade only on an explicit save.

Cancel leaves the selection unchanged. An unavailable saved editor stays visible
and produces an error when opening a file; select another rather than silently
falling back. Launching passes validated paths directly to `open -a` or `open -t`,
never a shell command from repository configuration. Git's `core.editor` is unchanged.

## Hosting accounts

Open **1git → Settings…** or press **Cmd+,**. Settings replaces the workspace inside
the same window, without a new tab or popover. Its compact Settings title stays above
the sidebar and clears the window controls; no Back button is shown. Escape restores mounted tabs, selections,
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

Sign-in defaults to profile access (`read:user` / `read_user`). **Browse and clone
private repositories** is an explicit opt-in: GitHub OAuth adds `repo` (this provider
scope permits writes too; for read-only access to selected repositories, use a
fine-grained PAT with **Contents: Read-only**). GitLab adds `read_api` and
`read_repository`; enable those on the registered application as well.
Self-managed applications must be registered on their own
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
on the provider's site. The guide follows the repository-access choice. Existing
profile-only accounts are not silently upgraded; use the pencil/Reconnect action
and opt in, or supply a suitably scoped token. Organization policy, token approval
and SSO authorization can still restrict particular repositories.

Setup references: [GitHub OAuth registration](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app),
[GitHub token setup](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens),
[GitHub current-user permissions](https://docs.github.com/en/rest/users/users),
[GitLab OAuth setup](https://docs.gitlab.com/integration/oauth_provider/),
[GitLab token setup](https://docs.gitlab.com/user/profile/personal_access_tokens/).

### Clone from an account

On the welcome page choose **Clone repository** to replace its content inside the
existing Open repository tab, without a modal or another tab. Select a saved
GitHub/GitLab account from the source sidebar, browse its repositories (30 per page), or search accessible
repositories. Provider search also includes public repositories outside account
membership. Choose a repository and destination, then **Clone**. **Repository URL** keeps
the existing credential-helper workflow and is the default when no accounts exist.
**Add account** opens the connection pane in Settings directly; returning reloads saved accounts while retaining
the URL, destination and repository selection. Search/account changes clear the selection;
search is debounced and pending reads are cancelled on dismissal. Loading, empty,
permission, network and pagination errors have retry/settings actions.
The repository list uses GPUIX's native virtual list, laying out only nearby rows
with one extra row of overdraw. Text stretches to the row's available width without
percentage-based measurement constraints. It scrolls independently of the fixed destination/Cancel/Clone
footer, including at minimum window size. Access guidance is available through the
compact information control beside search. Back/Cancel or Escape returns to the
welcome page; Cmd+F focuses search (or the URL input). Failed clones retain the
account/repository selection for an explicit retry. Tab switches retain the clone
draft, cancel hidden browsing and leave window-owned writes protected.

Account cloning re-verifies the saved identity, refreshes expiring OAuth credentials,
and re-resolves the selected repository through its provider. Only a credential-free
HTTPS URL on the account's host and matching repository path can reach Git. Tokens
stay in the vault/account service, never in UI props, clipboard or session JSON.
One-shot Git Basic auth is scoped to that remote using runtime environment config;
it is not placed in arguments, remote URLs, files, or the returned repository session.
Redirects, inherited Git config/helpers/traces/templates and submodule cloning are
disabled for this authenticated operation. This intentionally bypasses custom global
Git proxy/CA configuration; system-trusted HTTPS is required. Raw authenticated Git
errors are not exposed, preventing a server from reflecting credentials into the UI.
The credential exists transiently in the Git child's environment/memory: processes
with same-user debugging privileges can inspect it, so do not log/dump child environments.

Folder validation, progress, cancellation and close protection are shared with URL
cloning. Cancelling preserves any partial destination for review; nothing is deleted
automatically. Subsequent fetch/push uses the remote's account choice, preserving
system Git credentials and SSH when selected. Account-backed access denials show
an access-needed dialog with neutral text, a warning icon and one primary action.
**Reconnect account…** opens the affected account's existing setup form;
**Remote settings…** opens repository remotes, where System Git can be selected.
Known missing GitHub OAuth repository scope identifies private-repository access.
Neither action authorizes an account or changes a binding; the user confirms it in
Settings. If account metadata is unavailable, the Accounts list opens instead.
Opening recovery settings acknowledges the failed attempt, allowing a fresh rail
click after returning; it never retries automatically or marks access as restored.
Retry/Refresh remain available for other failures, but not this access denial.
DNS/TLS and other transport failures remain separate, and raw authenticated output
stays redacted.
Repository publishing is available from the Changes composer and the tab's Remote
menu (see below). PR/MR actions are not implemented by this milestone.

```sh
# Offline account logic and native UI; no live provider or real credential.
bun test --preload ./native/preload.ts --path-ignore-patterns '**/*.integration.test.ts' tests/accounts
# Native account cloning, including search, selection, keyboard retry and minimum-size layout.
bun test --preload ./native/preload.ts tests/repository-setup/account-clone.component.test.tsx
# Native wheel performance, fixed footer and selection with 30/300/3000 fake repositories.
bun test --preload ./native/preload.ts tests/repository-setup/clone-scroll.component.test.tsx
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
- `src/styles/workspace-layout.ts`: native chrome spacing; a 10px gap after the traffic lights, a 4px gap from Home to the visible tab body, and 36px tabs in a 42px toolbar, preserving shared bottom spacing and control sizes.

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
`@1git/design-tokens` owns typography with paired leading, font weights, spacing,
radii, icon/control sizes, density defaults, colors and shell dimensions. Import
these plain values directly into `StyleSheet.create`, e.g. `...typography.md`,
`fontWeight.medium`, `radius.lg`, `spacing[3]`. Use `md` for body/fields, `sm` for
secondary copy and compact rows, and `lg` for section headings. See the
[scale guide](../../packages/design-tokens/README.md) for all names and examples.
Virtual-list strides and other measured geometry remain separate. The package
also generates namespaced CSS equivalents for Electron without overriding its
existing Tailwind utilities.
The native app currently uses the platform font; the web's Manrope font import
does not register that font with GPUIX.

## Tabs

- Click an inactive tab to activate it; click the active connected tab to open
  its branch/worktree menu. The fixed Home button after the traffic lights opens
  the shared welcome screen without adding a tab. Dragging never opens the menu.
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
  Down also opens the active tab's menu. Tab/Shift+Tab traverse Home, the active
  tab and its close action. Right from Home activates the first repository tab.
  Selection remains visible without focus outlines.
- Horizontal trackpad scrolling handles overflow; selection reveals the entire
  tab and close control.
- Closing the active tab selects the right neighbor, then the left. Closing the
  last tab returns to the welcome screen and focuses Home.

On first launch the window starts on Home with no placeholder tab. Later launches
restore the saved tabs, drafts and Home selection. Home stays visible when tabs
overflow; it preserves repository selections and drafts and does not cancel
ongoing Git operations. Opening a recent repository reuses its existing tab or
opens a new repository tab. Cmd+W remains the native Close Window command. There is no theme switch or tab
entrance/exit animation yet.

### Open, clone and create

With no tabs or an empty workspace, the native app matches the desktop launch
layout: Quick actions at left and a searchable All repositories list at right,
without the repository sidebar. Create repository, Clone repository and Open from
disk work from this page; starting setup opens an empty tab without dismissing
its form. Previously opened roots remain available after their tabs close and
across restarts (up to 100, deduplicated, stored as paths in the session). Search
matches names/paths locally; opening reads fresh Git data, and missing folders
use the existing retry view. This list does not scan disk or import Electron data.
Right-click, Control-click or Shift+F10 on a saved repository opens the native
menu: Open, Reveal in Finder, or Forget. Forget removes only the saved entry,
preserving files and open tabs; the removal survives session restoration.
Create uses the shared dimmed popover; Clone uses the full-page source/browser
view described above. Both use transparent fields, a folder-picker location
control and explicit confirmation.
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
the scrollable list. Expanding raises the menu height limit from 370px to 650px,
bounded by the available window space, so several more branches are visible
before scrolling. A Worktrees row opens a hover submenu listing the available
worktrees, with a checkmark on the current checkout. It opens to the right and
flips left when space is limited; long lists scroll without growing the parent
menu. Moving between the trigger and submenu keeps it open. Enter/Right opens
and focuses the submenu, Up/Down navigates its entries, and Left/Escape returns
to the parent menu. Hovering does not read repository contents or switch tabs.
Create new branch opens an inline form; Cancel/Escape returns to the actions.
There is no permanent search field or Close footer. Right-click a local branch
(or use Control-click / Shift-F10) for Rename and Delete. Both require confirmation;
rename starts with the current name. Checked-out branches cannot be deleted,
branches checked out elsewhere cannot be renamed here, and Git's non-forcing
delete protects unmerged work. Remote branches have no management actions.
Upstream editing is not yet exposed.
Up/Down moves through enabled rows, Enter activates, and Escape/outside-click dismisses the menu.
Keyboard dismissal returns focus to the tab; Tab dismisses and continues traversal.
Inside worktree and branch-change forms, Tab moves between controls instead of dismissing them.
This is not a port of the Electron liquid SVG morph.

- Switch a local branch in this working directory, or explicitly create and
  switch to a new branch based on the current HEAD.
- Switching with uncommitted work opens two choices: **Leave changes on this branch**
  saves tracked and untracked files in a Git stash, then switches clean; **Bring changes
  with me** saves a recovery stash, switches, and restores the work (including the index).
  Cancel/Escape writes nothing. Returning to a branch offers **Restore saved changes**;
  the menu also exposes that action after restarting. Restoration is explicit and requires
  a clean tree. Existing saved work on the destination is never silently combined with
  brought changes. Multiple backups remain available in Stashes; the restore action selects
  the newest matching backup.
- Stash messages contain versioned branch/worktree metadata, so saved files and their
  association persist together without app session storage. Other worktrees and unrelated
  manual stashes are never restored or deleted by this flow. A backup is removed only after
  successful application and a fresh status check. Failed checkout hooks, conflicts, failed
  reads and cleanup failures keep recovery data in **Stashes**; review the actual branch and
  files before retrying. Conflicts use the existing conflict-resolution UI.
- Fresh status and HEAD/branch identity (including the identity reviewed in the prompt)
  are checked before writing. No force checkout, reset or discard is used. In-progress
  operations, unmerged files, dirty submodules, detached/unborn dirty HEADs, and branches
  checked out in another worktree are refused. Creation, rename and delete still require
  a clean tree. The whole switch/restore operation locks related worktrees against other
  app writes and protects tab/window closure until refresh completes.
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

### Merge, squash merge and rebase

The tab menu's **Merge or rebase…** opens an inline branch picker with three modes.
Select another local or remote-tracking branch and explicitly confirm. Selection,
search, mode changes and Cancel/Escape do not write to Git. The ordinary commit
draft is retained. All modes require a clean index/working tree, a named committed
branch and no active Git operation; both reviewed tips are checked before writing.

- **Merge** keeps the existing fast-forward/normal merge behavior.
- **Squash merge** combines the selected branch's changes into one new commit on
  the current branch, with an editable summary/body. It retains the source branch,
  honors hooks/signing, and does not create an empty commit for already-included work.
  Conflicts or a failed commit hook leave a pending squash with the reviewed message
  in Git's `SQUASH_MSG`, so Continue/Abort remain available after restarting.
- **Rebase** replays the current branch onto the selected tip without switching the
  source branch. It refuses replaying commits reachable from known remote-tracking
  refs, including published ancestors of an unpublished tip, and refuses flattening
  merge commits. Fetch first if another tool/device may have published work: local
  remote knowledge is not a live server check. The old tip is retained under
  `refs/1git/rebase/<id>` for manual recovery. Git autostash and updateRefs are disabled;
  sibling branch tips are not moved.

Nothing fetches, pushes or force-pushes automatically. A selected branch may be
checked out in another worktree because its tip is read, not changed. Related app
writes and tab/window closure stay protected through integration and status refresh.
Conflicts open Changes with Continue and confirmed Abort, including after restart;
failed status reads require another refresh before writing. External Git processes
are not locked. Interactive rebase, merge-preserving rebase and Skip remain external.

### Publish repository

For a local repository without remotes, the top rail control offers **Publish repository**.
The form opens
to the right of the existing sidebar and reuses the account-choice tiles.
Select a connected GitHub/GitLab account, owner/organization/group, repository
name, optional description and visibility (**Private** by default). Commit at
least once before publishing; staged, unstaged and untracked files are never
committed or uploaded implicitly.

Publishing creates an empty hosted repository, adds `origin`, remembers the
selected authentication account, then pushes only the reviewed current branch
and establishes its upstream. Existing remotes are not overwritten. Shared
repository locks, close protection, Stop and cross-worktree refresh apply to
the whole transaction. Tokens remain in the credential service and transient
Git process environment, never in form/session state or Git config.

If creation succeeds but connection/upload fails, **Retry push** uses the same
hosted repository. Its public recovery receipt survives form dismissal and tab
switches for this window; after restarting, an already connected `origin` can
be used with **Publish branch…**. If creation has an uncertain outcome, another
creation is blocked for this window: review the provider website and connect
the existing repository in Remotes. No hosted repository is automatically
deleted on failure, and creation requests are never automatically retried.

Publishing tests use disposable local Git repositories, captured provider HTTP
and fake credentials. Native tests exercise the right-side form and window
locks; no live GitHub/GitLab repository is created by tests.

### Remote synchronization

A single control at the top of the left rail handles remote operations, separated
from Changes/History/Stashes by a short divider. Its icon and tooltip reflect the
current branch: Fetch when up to date, Pull for incoming commits, Push for outgoing
commits, and a cloud-upload icon for Publish repository/branch. The upper-right
badge shows incoming commits (`↓ N`), the lower-right outgoing commits (`↑ N`).
Zeros are hidden; large visual counts cap at `99+`, with exact counts in the
accessible label. Counts come from the last known remote refs, not live polling.

- Clicking Fetch explicitly updates configured remotes. A menu open or local status
  refresh never contacts a remote. Fetch also works with uncommitted changes.
- Pull/Push reuse authenticated, guarded upstream sync: fetch first, fast-forward
  incoming commits only, then push to the exact tracking destination without force,
  mirrors, tags, automatic commits or stashes. Incoming changes require a clean tree.
- If both counts are nonzero, the control fetches and opens a review dialog.
  It offers Compare and points to Merge or rebase in the tab menu; it never
  silently merges, rebases or force-pushes.
- Without remotes, the control opens the existing right-side Publish repository
  form. Without an upstream, it opens Publish branch: explicitly choose a remote
  with a single push URL and confirm. Changing HEAD/branch invalidates the choice;
  cancelling the picker never writes.
- A 270-degree gauge replaces the busy rail icon and temporarily hides count badges.
  Its stationary track fills clockwise with Git's phase-local sending/receiving
  percentage, shown in the bottom opening. Unknown work shows an ellipsis and a
  segment moving within the track, never a rotating gauge or fabricated percentage.
  A transfer at 100% still waits for Git's confirmed result and refreshed status.
  Commits travel together in one push; the gauge never counts commits or invents
  overall progress. Streamed updates are throttled; animation stays local to the gauge.
  Clicking it again opens status with an
  explicit Stop action; closing the dialog leaves the operation running. A check
  icon and completion tooltip (**Sync complete**, **Fetch complete**, or the publish
  result) last three seconds only after Git succeeds and open roots refresh. Failures
  stay accessible from the control, with explicit Retry or local Refresh recovery.
  The status dialog also shows the last successful fetch.
- Window-owned operations retain credential routing, the two-minute deadline,
  close protection, linked-worktree locks, and post-operation refresh of every
  open root. Drafts and checked files survive success, failure and cancellation.
  A stopped/timed-out write may already have completed; review status before retrying.
  A failed status refresh blocks writes until a successful manual refresh.
- The composer contains only Commit (and last-commit Undo). The tab menu retains
  branches, Worktrees, New, Compare, Merge or rebase and Repository settings, not duplicate
  remote controls.

Native component tests use captured Git/account boundaries to exercise rail layout,
keyboard activation, counts, confirmation, failures, cancellation and linked-tab
lifetimes. Integration tests exercise real Git with disposable local remotes;
no user repositories or live hosted services are modified.

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
- **Checkboxes select changes for the next commit, not Git staging.** Toggling
  them neither stages nor unstages files. Command+Enter/the composer button creates
  a real commit in a connected repository. Drafts are saved with the session;
  inclusion choices remain in-memory only.
  History previews are read-only; its context menu provides confirmed Revert,
  Cherry-pick and tag actions. Stashes provides explicit create, apply and delete actions.
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

- **Amend** beside the last-commit summary, or **Amend last commit…** in History's
  context menu, opens the existing composer with the tip's full message. Only the
  latest unpublished non-merge commit on a named branch is eligible. Edit its
  message and optionally include checked files/lines, then explicitly choose
  **Amend commit** (or Command+Enter). With no files checked, only the message changes;
  other staged work is not included. Original commit contents and author are retained.
  Cancel and successful amendment restore the ordinary draft and leave unchecked
  work untouched. Restart restores the ordinary draft, not an active amend intent.
  Changing the root, HEAD or branch blocks submission until Cancel and another review.
  The backend rechecks publication and identity before writing and retains the old
  commit under `refs/1git/amend/<id>`. Hooks/signing, index isolation, cross-worktree
  write locks, close protection and uncertain-outcome warnings are shared with normal
  commits. No force push occurs. Publication uses known remote refs: Fetch first if
  another tool/device may have pushed, and avoid concurrent external Git writes.

- **Reset to commit…** in History reviews one exact ancestor and the number of later
  commits to undo, then requires explicit confirmation. Only unpublished later
  history may be reset; the selected commit can be the last published commit.
  Publication includes every locally known remote branch, including merged side
  history. Fetch first if another tool/device may have pushed.
  The operation requires a clean named branch, complete (non-shallow) history and
  no active Git operation. Dirty, staged and untracked work, stale branch/HEAD
  identity, non-ancestor targets, the current tip and an existing index lock are
  refused. The backend rechecks before atomically retaining `refs/1git/reset/<id>`
  and moving only the reviewed branch. This is a **soft reset**: working files and
  the index stay unchanged, so the removed commits' net changes appear staged in
  Changes. Other branches, tags and linked worktree files stay unchanged. Success
  returns to Changes and preserves the existing draft. Shared-worktree write,
  refresh and close protection apply; failures/warnings disable resubmission until
  a new review. No fetch, push or force push occurs. Recovery is available through
  the retained ref with external Git tools; avoid concurrent external Git writes.

- **Squash selected commits…** in History combines consecutive unpublished commits.
  Shift-click or Shift+Up/Down selects a range; Command-click toggles individual rows.
  Right-click a selected row, review the included commits and edit the summary/details,
  then explicitly confirm. The dialog discloses later commits that must be replayed with
  new IDs. The oldest selected author's identity is retained; later commits retain their
  messages and authors. Existing tags and other branches remain on the original commits.
  Dirty/staged/untracked changes, detached HEADs, active operations, merge/nonlinear
  histories, shallow repositories, current submodules and rewrites over 1,000 commits
  are refused. Publication is checked against locally known remote branches, not the
  server: Fetch first if another tool/device may have pushed.
  Git builds the rewrite in a disposable detached worktree with configured hooks/signing,
  verifies the final file tree, then atomically saves `refs/1git/squash/<id>` and moves only
  the reviewed branch. Working files and the user's index are not replaced. The ordinary
  commit draft survives, and shared-worktree write/refresh and close protection apply.
  Failure disables resubmission until a new review. Cleanup/uncertain-outcome warnings
  require inspecting History before retrying. No fetch, push or force push is automatic.
  Avoid concurrent external Git writes; configured hooks can have their own side effects.

- **Reorder selected commits…** uses History's same consecutive range selection.
  Right-click a selected row, then select a commit in the **oldest-first** review list
  and use **Move earlier** / **Move later**. Arrow keys navigate the list; Tab and
  Enter operate the buttons. Confirmation stays disabled until the order changes.
  A selected root must remain first. Later commits are replayed too; full messages,
  authors and author dates (including empty commits) are retained, but IDs may change.
  Reordering shares Squash's clean/unpublished/linear-history guards, isolated worktree
  replay, final-tree verification, atomic ref installation and linked-tab protection.
  Conflicts or changed final files reject the rewrite without installing it. Original
  history remains under `refs/1git/reorder/<id>`; tags and other branches stay unchanged.
  The ordinary draft and History view survive. Stale root/HEAD/branch identities,
  errors and warnings block another submission until a new review. Publication only
  uses known remote refs: Fetch first if another tool/device may have pushed.
  No automatic fetch/push/force push occurs; avoid concurrent external Git writes.

- A pinned footer below the composer shows the last commit's age and summary, with
  **Undo** on the right. Its metadata refreshes when the tip/branch changes or Sync
  finishes, without network requests or reads on draft edits. Published
  commits reachable from locally known remote-tracking refs, detached/unborn HEADs,
  merge commits and active operations are refused. Remote knowledge can be stale:
  Fetch first when another tool/device may have pushed. Final writes recheck branch
  identity and remote reachability; no force push or automatic history rewrite occurs.
- Undo is a direct action. It atomically moves the reviewed branch to its parent
  (or makes it unborn for its first commit), without changing index or working files.
  Existing drafts and checkbox exclusions survive; an empty draft receives the old
  full commit message. The old commit is retained under `refs/1git/undo/<id>` for manual
  recovery with external Git. These private refs are not pushed by normal Sync.
- Undo shares close protection and the write lock across related worktrees.

- Write a first-line summary, with optional details after a blank line, then use
  **Commit N files** or **Command+Enter**. The commit uses the checked files' current
  whole-file contents unless a line selection is present, even when some edits were prepared in another Git tool.
  Unchecked files and their existing Git staging remain untouched;
  checkbox toggles themselves never write Git state.
- The backend acquires the repository's index lock, prepares a temporary index,
  and uses Git's selected-path commit operation. Configured hooks and signing run
  normally. On success it installs the updated index, retaining excluded staging.
  Hook/signing failures keep the original index and draft; hook programs may still
  perform their own configured filesystem side effects.
- In Changes, the blue gutter selects contiguous change groups or individual added/deleted
  lines. Click the outer gutter for the group and the inner gutter for a line; Tab then
  Space/Enter also toggles a control. A partially included file has a mixed checkbox;
  clicking it includes the entire file. The controls work in unified and split layouts.
  Selected controls and line numbers use blue blocks with white SVG check/minus icons
  in light mode; dark mode uses quiet blue fills with brighter blue ink, like badges.
  `native/diff-inclusion-theme.patch` adds optional `diffInclusionText` for the marks
  and numbers without changing layout, selection ownership or scrolling caches.
  `native/diff-rails.patch` colors the 2px change rail with muted green/red tokens,
  independent of inclusion. In partial diffs it separates numbers from code;
  read-only previews retain their rail at the outer edge. Context rows have no rail.
  The group gutter is darker. Excluded numbers stay neutral. The shared diff theme uses
  pale green/red rows, quiet hunk headers aligned to code and an SVG expansion icon.
  Gutters have no internal dividers; hunk headers use one pale background. Group and
  line checks remain visible, with focus outlines and the split-pane divider retained.
  Hover/focus emphasize controls without changing hit targets or native scrolling.
  Group event payloads are encoded once per parsed patch and shared by row callbacks;
  scrolling does not serialize or copy the whole group. Selection changes reuse them,
  while replacing the patch rebuilds them with the new coordinates.
  `native/diff-inclusion.patch` adds `selectionEnabled`, `selectionDisabled`, `includedLines`
  and `onToggleChange` to the cached native viewer. Coordinates (`-:oldLine`, `+:newLine`)
  remain stable across context expansion. React owns selection, not native row state.
  History, Stashes and Compare stay read-only. Binary, renamed, mode-only and symlink
  changes use whole-file inclusion. While whitespace changes are hidden, the gutter
  stays visible; activating a line or group offers **Show whitespace changes**.
  Confirming changes only the diff preference, retaining existing inclusion choices.
  Partial selection saves the unfiltered reviewed patch. Git rechecks it before committing;
  changed files require review. Excluded lines remain as unstaged working changes after
  success; staging for unchecked files is retained. A HEAD change clears partial choices
  and excludes those files until reviewed. Inclusion choices are not persisted.
  There is no staged/unstaged commit mode. Checking a file includes all its current
  changes, not just its Git index content.
  Submodules, unresolved conflicts,
  active merge/rebase operations, and ambiguous file/directory changes are also
  blocked. HEAD and branch are rechecked before committing; stale state requires
  a refresh and review.
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
  selected base, loaded automatically in pages of 50 as the list scrolls. The
  default file list shows the combined changes from their common ancestor to
  the selected branch. This is not a preview of the eventual merge result or a
  conflict check.
- Select an individual commit to browse its first-parent changes; select it again
  to return to the combined branch changes (also works with Enter/Space). File
  selection automatically previews the first file, reusing text diffs and image previews.
  Endpoint commits and image blobs remain pinned if branches move externally.
- **Back** restores the underlying Changes/History/Stashes view and draft.
  Comparison is temporary and is not restored after restarting. Reopen it to
  capture newer branch tips. Unborn HEADs cannot compare; unrelated histories or
  multiple merge bases report an explicit error rather than a misleading diff.

## Pull and merge requests

- Right-click (or Control-click/Shift+F10) the sync rail button and choose
  **Preview pull request…**, or use the same action in Compare's toolbar. The
  existing Compare layout shows committed changes from the target's common
  ancestor to the current branch; staged/unstaged edits and the commit draft are
  not included or changed. Existing diff preferences apply here too.
- Targets are remote-tracking branches on the current upstream remote, otherwise
  `origin` or the sole remote. The provider's default branch is initially selected
  when available; otherwise the remote's known default is used. Fetch/select a
  target when no default is known. This is a snapshot, not a merge-conflict check.
- **Refresh**, beside **Back**, fetches the remote and reloads the preview; it
  never uploads commits or opens the browser.
- **Publish branch…** or **Push changes…** uses the existing guarded, non-forcing
  sync operation. Uploading requires an explicit click and never opens the
  browser automatically. Afterwards, **Continue on GitHub/GitLab** fetches and
  rechecks the reviewed branches before opening the provider's creation page.
  Changed branches require another review; failed fetches stop the handoff.
- A matching open request from the same repository offers **View pull/merge
  request #N** instead. Metadata uses the selected connected account (or the
  sole matching account in Automatic mode), without changing System Git/SSH
  authentication. If metadata is unavailable, the app shows a notice and the
  provider performs the final check in your browser.
- Choose the title, description, draft status and reviewers on the provider's
  website. 1git never submits a request automatically. This first version supports
  same-repository GitHub/GitLab requests, including configured custom hosts;
  remotes with different fetch/push repositories require the provider's fork flow.
  **Back** restores the underlying workspace and its draft.

## Browsing History

- **View File History** in a single file's Changes, History or Stashes context
  menu opens a filtered History view. It follows Git-detected renames along the
  first-parent history and previews that file's exact saved diff in each commit,
  including deletion. Saved-file menus start at that commit/stash, while Changes
  starts at the refreshed HEAD (using the old path for an uncommitted rename).
  Search and infinite paging stay within the file scope. **Back** restores the
  full History list, selection and scroll; drafts and commit inclusion stay intact.
  The file scope survives tab/view switches but is not restored after restart.
- History search uses the toolbar search icon or Command+F. It matches full commit
  messages, author names/emails, and full or partial hashes case-insensitively as
  literal text. It scans history reachable from the refreshed HEAD in cancellable
  batches, not just the loaded rows, and returns pages of 50 matches. Typing is
  debounced; large histories can take longer to search. Escape clears the filter
  (restoring the cached full list when outside file history). Repository/HEAD
  changes invalidate the search cache.
- The History title shows the full current-branch commit count in muted parentheses,
  independently of loaded pages or search results. The redundant Recent commits
  row is omitted. Counts load separately without delaying the list, remain cached
  per workspace through navigation/search/pagination, and refresh when HEAD changes
  or you explicitly refresh. `(…)` means counting; `(—)` means the count failed
  and Refresh retries without blocking history. Shallow clones use `(≥N)` because
  older commits may not exist locally; unborn branches show `(0)` without a query.
- History lazily loads real commits reachable from the last refreshed HEAD, with
  the summary, author, authored date and short SHA. Scroll near the end for the
  next 50 commits. Pagination is anchored to that
  HEAD, so external commits cannot shift page offsets while browsing.
- Unpushed commits have a muted up-arrow at the row's right edge, with reserved
  space beside subjects/tags. Loaded IDs are checked together against all known
  remote branches, including merge parents, without fetching. Push, fetch and
  refresh recheck status even when HEAD is unchanged; failed reads offer Retry
  instead of guessing. Another tool/device's push is only known after fetching.
- Select a commit in the upper sidebar to read its changed paths and automatically
  preview its first changed file. Choose any other path below to inspect it.
  File lists are fetched on demand without loading
  every patch; completed lists/pages are retained for the workspace tab's lifetime.
- The selected commit's details appear above the file toolbar: full title with the
  Appearance badge preference, author, authored date/time, copyable SHA and local
  tags. The description excludes the subject paragraph and preserves paragraphs
  and trailers. The collapsed preview fits the first paragraph, capped at three
  lines; **Show more** beside the metadata opens the full description in a bounded,
  independently scrolling area. Short/absent descriptions have no disclosure/empty area.
  Switching files retains disclosure; selecting a different commit resets it.
  Empty commits still show their details. This uses already-loaded metadata without
  fetching or editing commits, and does not move metadata into the native diff.
- Committed diffs compare with the first parent (the empty tree for root commits).
  Merge commits use the same first-parent comparison, not a combined/conflict diff.
  Empty commits and unborn repositories have explicit empty states.
- The existing native text diff and PNG/JPEG/WebP/SVG previews are reused. Image
  versions come from the exact committed blobs, independently of the current index
  or working files. SVG **Preview / Source**, original metadata, size limits and
  binary/unsupported notices work here too. These previews remain read-only.
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

### Release tags

- Right-click a History commit (Control-click or Shift+F10 also works) and choose
  **Create tag…**. Enter its name and optional annotation, then confirm. An empty
  annotation becomes `Release <name>`. Creation is local only, always targets the
  exact clicked commit and never changes the branch, index or working files.
  Dirty and detached worktrees are supported; active Git operations are not.
- History shows a compact tag badge beside the commit summary. Multiple tags use
  one name plus a count; all names are available in accessibility text and the
  **Push tag…** submenu. Local annotated and lightweight commit tags are shown;
  a badge does not claim that a tag has been published. Refresh reloads mutable
  tags even when HEAD and cached commit pages are unchanged. Tag read failures
  offer Retry without hiding commits.
- **Push tag… → <tag>** opens a separate confirmation. Choose a remote and review
  its push destination. Only that tag object is sent; no branches, other tags,
  mirror/force pushes or submodule recursion. Multiple push URLs are refused.
  Existing remote tags cannot be replaced, and moved local tags or changed
  destinations require another review. This uses the same account/SSH/System Git
  authentication as branch pushes. It does not create a GitHub/GitLab release page.
- The window owns writes and keeps related tabs/close protected until all refreshes
  finish. Drafts and inclusion choices survive. Errors stay in the confirmation;
  uncertain outcomes must be inspected before manually retrying. Signing and
  pre-push hooks remain enabled, so their configuration or provider rules can
  reject tags. App locks do not exclude concurrent external Git processes.

### Cherry-picking a commit

- Right-click a History commit (Control-click or Shift+F10 also works) and choose
  **Cherry-pick commit…**. Search and select a local destination branch, then confirm.
  Confirmation identifies the clicked commit even when a different row is selected.
- The app switches to the destination and copies only that commit; the source
  branch remains unchanged. It never pushes, forces a checkout or auto-stashes.
  Commit or stash local edits first. Remote refs, the current branch, merge commits
  requiring a mainline parent, and branches occupied by another worktree are excluded.
- The Git boundary rechecks source HEAD/branch, commit reachability, destination
  tip and working-copy cleanliness under its instance mutation lock. A commit
  already in the destination's history is rejected before switching. Hooks and
  signing are retained; changes introduced by checkout hooks block the replay.
- After every attempt the app refreshes related tabs and shows the result in
  Changes. Once switching succeeds it stays on the destination, including failures.
  Resolve conflicts with the existing controls, then **Continue cherry-pick** or
  confirm **Abort…**. Abort restores the destination's pre-replay state, not the
  original source branch. Empty/already-applied patches may require Abort or an
  external Git workflow; the app does not skip or create empty commits implicitly.
- Closing and competing app writes remain blocked through all status refreshes.
  A failed refresh blocks further writes. External Git processes are not locked.

### Reverting a commit

- Right-click a History commit (Control-click or Shift+F10 also works) and choose
  **Revert commit…**. Confirmation shows that exact commit and the destination branch.
- Revert creates a new reversing commit, preserving existing and published history.
  It requires a clean working tree/index, a committed named branch and no active
  Git operation. Commit or stash local edits first. Merge commits require mainline
  parent selection and remain an external Git workflow; ordinary and root commits
  are supported.
- The backend rechecks HEAD/branch, exact commit identity and reachability under
  its write lock. Native Git message preparation/signing behavior is retained;
  the app does not stash, reset, stage unrelated files or push automatically.
- After the attempt, Changes shows its result. Conflicts use the existing file
  resolution workflow, **Continue revert** and confirmed **Abort…**.
  Related worktree tabs and window close remain protected until every refresh
  finishes. A failed refresh blocks further writes; inspect the actual repository
  before retrying an uncertain result. External Git processes are not locked.

## Browsing Stashes

- The Stashes title shows the full repository stash count in small, muted
  parentheses, matching History; the redundant Saved work row is omitted.
  The count reuses the complete stash list without a separate Git query or
  scroll work. `(…)` means loading, `(—)` means the read failed, and `(0)` is
  shown only after a successful empty read. Refresh and stash actions update it.
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
diff, with old/new line numbers, hunk headers, addition/deletion colors,
syntax highlighting and selectable text. A local native bridge preserves keyboard
scrolling while using GPUIX's virtualized list; no additional diff library is needed.

- **Diff settings** in the file header offers **Unified** (default) and **Split**
  (old on the left, new on the right), plus **Hide whitespace changes**. Choices
  are shared across tabs, Changes, History, Stashes and Compare for this window's
  lifetime; they reset on restart. Image previews and conflict resolution do not
  use these text-only controls; SVG Source does.
- Whitespace filtering only changes the displayed patch, including expanded
  context. File checkboxes and whole-file commits still include all changes, and
  header totals remain the unfiltered Git totals. A whitespace-only change shows
  an explicit notice rather than suggesting the file has no changes.
- `native/diff-split.patch` pairs deletion/addition runs with empty cells on the
  shorter side. Both columns share the existing native virtual list and vertical
  scroll; syntax/word highlighting, hunk expansion and text selection stay native.

- A compact header shows the filename first, a muted folder path, and added/deleted
  line counts for the displayed comparison. Folder text yields to the filename
  and totals on narrow panes. Counts come from Git (including untracked files);
  binary files and unavailable counts show no misleading zero totals.
- Changes shows one complete **HEAD → current file** comparison, matching a
  checked-file commit. Intermediate Git index content is not a separate view.
  On an unborn branch, files are compared against an empty tree. A temporary
  preview index handles external additions, renames and removed/recreated files
  without modifying the repository's real index or adding objects.
- New/untracked files, deletions, empty files, renames and mode changes use the
  same viewer. PNG, JPEG, WebP and SVG files have image previews, described below.
  Other binary files have explicit notices instead of
  misleading text. Conflicts use the resolution workflow described below.
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
- Click a hunk separator (`@@ … @@`) to reveal up to 20 unchanged
  lines immediately above that hunk; repeated clicks reveal the next 20. Short
  gaps reveal their remainder and adjacent hunks join when no lines remain hidden.
  The first separator also reveals leading context. With the viewer focused,
  **E** expands the first remaining gap. This does not expose trailing code after
  the final hunk, which has no separator.
  Reads are on demand, deduplicated while pending, and canceled on selection or
  snapshot changes. The existing diff stays visible without a loading screen.
  Changes must still match the displayed patch; external edits require a refresh.
  Expanded previews obey the same size limits. Context is local to the displayed
  snapshot, not stored in the window cache; Git/index state remains untouched.
- Ready previews swap together with their filename, metadata and controls. A cache
  hit displays on the first render. An uncached selection keeps the previous
  preview visible until ready; after **200 ms**, a small header status indicates
  that the new preview is opening. A cold, slow read has a delayed loading state.
  Conflict actions remain disabled while a different file is opening.
- Each window owns one shared preview LRU, retained across view/tab switches:
  **128 entries / 32 MiB estimated retained bytes**, whichever is reached first.
  The budget includes patch strings, prepared image data, retained SVG source and
  a conservative bitmap estimate, not a hard limit on total process/GPU memory.
  Status snapshots invalidate working previews even when Git status letters are
  unchanged; commit/blob IDs keep immutable previews reusable. Closing a root
  releases its entries, and closing the window cancels work and clears the cache.
- After **120 ms** on a ready file, only the next and previous files are warmed,
  serially. Hover/focus intent waits **80 ms**. One background read runs alongside
  foreground selection; selecting an in-flight preview shares its promise instead
  of duplicating Git reads or image decoding. Errors and conflict hashes are not
  retained. SVG pixels and source diffs are prepared concurrently.
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
  Actions open the file in the selected external editor, reveal it in Finder, or copy
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
- **Open in editor** uses the same file-type rules and overall **External editor**
  preference (macOS's default text editor until changed), never a repository-provided shell command.
  Save edits there, then **Refresh preview**.
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

### Merge, squash merge, rebase, revert and cherry-pick completion

- Changes shows the active merge/squash merge/rebase/revert/cherry-pick, conflict count, **Continue** and **Abort…**.
- Continue uses Git's staged resolutions and existing message, retaining hooks
  and signing. It never stages files or uses the commit-inclusion checkboxes.
  Unresolved conflicts or unstaged tracked edits block continuation.
- Abort requires confirmation: Git attempts to restore the pre-operation state,
  and conflict-resolution edits may be lost.
  Squash completion commits staged resolutions with the reviewed message;
  its abort uses `reset --merge` only when `ORIG_HEAD` still matches the current tip.
  Detection uses Git's `SQUASH_MSG`, including squashes started outside 1git.
- Both actions recheck HEAD, branch and an operation-metadata fingerprint.
  Results are refreshed even on failure: a rebase may stop at another conflict.
  Closing and competing app writes remain blocked through the refresh; a failed
  refresh blocks further writes until the repository is reviewed again.
- Skip, interactive rebase editing and cancellation
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
  validation fails. Preview/Source switching does not change commit inclusion.
- Before/after bytes come from the status snapshot's HEAD blob IDs and a
  bounded current-file read, ignoring intermediate index versions.
  Refresh reads new versions; selection/tab changes cancel Git
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
  discarded. Complete initial pixels and validated SVG source share the bounded
  window preview cache above; viewport-specific SVG refinement remains local to
  the visible image.
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

Workspace tabs span the full titlebar after the traffic lights. Below them, a
48px icon rail sits in the tinted window chrome, outside the rounded white
workspace. Changes, History and Stashes switch the active repository's view;
the 310px file/revision panel keeps its title, refresh and search controls.
Welcome, Clone and comparison hide repository-specific rail items. Settings
keeps the active repository's Changes/History/Stashes buttons; choosing one
returns to that view, restoring focus without resetting workspace state.
Rail controls are 32px, with equal 8px horizontal insets and a subtle selected
fill. Account operations temporarily disable rail navigation while pending.
The bottom Settings button opens the existing full Settings view. The account
button opens a native menu with saved accounts, Add account and Manage accounts.
Choosing an account sets the **window-local default for new Clone views** only.
It never changes Git author identity, remotes, push credentials or an existing
Clone draft. Removed accounts fall back to the first saved account (or URL cloning
when none remain). The rail reads public metadata only, never tokens or provider
APIs. Controls have accessible names and hover/focus tooltips.

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
  active rail tab, Settings/account controls, include-all checkbox, focused file and its checkbox, the
  commit editor and enabled preview action, and workspace tab controls.
  Space releases toggle a focused checkbox without
  changing the viewed file. Arrow navigation from a checkbox returns to file
  navigation; offscreen keyboard targets are revealed. In History/Stashes, Tab
  traverses the revision list, divider, and file list before leaving navigation.
- Three compact icon tabs switch views directly. Up/Down (or Left/Right) wrap;
  Home/End select the first/last. Enter/Space activate the focused tab. Only the
  active tab is in the Tab order, with keyboard focus shown in the accent color.
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

Diff tests cover native line-number/text painting, the absence of staging controls,
keyboard/trackpad scrolling on both axes, a bounded painted-row count for 1,800-line
patches, full-width backgrounds, text selection without gutters, native scroll-state
cleanup, errors/retry, stale reads, refresh and preview guards.
Real-Git integration tests also cover the complete current contents of externally staged files,
untracked/empty/deleted/renamed paths, literal special filenames, disabled external
drivers and oversized/binary patches, without changing HEAD or staged content.
