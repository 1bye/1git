# Linux port (work in progress)

Status: first Linux window achieved on branch `linux-port`.
The native addon builds on Linux and `bun run dev:app` opens a real
1git window (see "Verified"). This is still not a finished product:
the window was verified under Xvfb on Ubuntu 24.04, not yet on a real
GNOME X11/Wayland desktop, and the TODO list below still stands.

## Why this port is plausible

The hard part is not the UI engine. 1git is TypeScript + React 19 on
GPUIX (Zed's GPUI bindings), and GPUI itself already has Linux X11 and
Wayland backends. Evidence in this repo:

- `bun.lock` already pins `@gpuix/native-linux-x64-gnu 0.10.0` as an
  optional dependency of `@gpuix/native 0.10.0`.
- GPUIX upstream ships Linux examples and AppImage packaging via
  `cargo-packager`.
- The SSH remote helper already builds static Linux glibc/musl binaries
  (`apps/gpuix/native/build-remote-helpers.ts`), and the `packages/git`
  layer is plain Git subprocess work, not macOS code.
- Session and avatar-cache paths already fall through to
  `XDG_STATE_HOME` / `XDG_CACHE_HOME` on non-macOS platforms.

The blockers were 1git's own macOS gates, not the engine:

- `apps/gpuix/native/build.ts` threw unless `darwin/arm64`.
- `src/platform/browser.ts` / `clipboard.ts` threw unless macOS
  (`/usr/bin/open`, `pbcopy`).
- File actions, editor launching and SSH prompts hard-coded
  `/usr/bin/open`, `/usr/bin/open -a`, and `osascript` dialogs.
- Packaging, signing and updates were macOS-only (`.app`, codesign,
  Sparkle, Keychain copy in UI strings).

## What this branch changes

- `native/build.ts`: allow Linux x64/arm64; copy `libgpuix_native.so`
  instead of `.dylib`. The `*-platform` patches that target
  `crates/gpui_macos` still apply (those files exist in the checkout)
  but are not compiled into the Linux addon, so the patch stack is not
  forked.
- `native/package-linux.ts` + `package:linux` scripts: a self-contained
  tarball (`build/linux/1git-linux-<arch>.tar.gz`) reusing the macOS
  bundle's relative layout (`bin/1git`, `Frameworks/gpuix-native.node`,
  `Resources/app.js`, `Resources/remote-helpers`), so
  `native/packaged-main.ts` works unchanged. No signing, no Sparkle;
  `AppUpdater.start()` already no-ops off macOS.
- `native/package-resources.ts`: `copyImageRuntimeLinux()` copies the
  glibc sharp runtime (`@img/sharp-linux-<arch>`,
  `@img/sharp-libvips-linux-<arch>`), not the darwin one and not musl.
- `src/platform/browser.ts`: `xdg-open` on Linux.
- `src/platform/clipboard.ts`: `wl-copy`, then `xclip`, then `xsel`.
  Note: `Bun.spawn` throws when a binary is missing instead of exiting
  non-zero, so each candidate is wrapped in try/catch (found by a
  smoke test, see below).
- `src/feature/repository-workspace/lib/repository-file-actions.ts`:
  open/reveal via `xdg-open` (reveal opens the parent folder; xdg-open
  has no `-R` equivalent).
- `src/feature/machines/ssh-connection.ts`: SSH host-trust/password
  prompts via `zenity` on Linux instead of `osascript`.
- `src/feature/editor-settings/external-editors.ts`: on Linux, an
  explicit executable path is run directly, otherwise `xdg-open`.
  Editor catalog discovery is still macOS-only (see TODO).
- `src/window-options.ts`: no blurred background or traffic lights on
  Linux; the compositor's native decorations are used.
- `native/macos-napi-methods-linux.patch` (Linux only, applied last):
  moves five macOS-only `#[napi]` methods (`get_font_families`,
  `get_system_appearance`, `set_window_appearance`, `set_close_blocked`,
  `take_close_requested`) out of the main `GpuixRenderer` impl into a
  macOS-only impl block. napi-derive registers `cfg`'d methods from
  the main impl even on Linux, where their callbacks do not exist,
  so the addon failed to compile without this move (five `E0425`
  errors). A `cfg_attr` workaround was tried first and did not work.
  On Linux those five methods are absent, and the TS callers already
  guard them with `"method" in renderer` (system appearance falls back
  to light, close protection and font list are unavailable, window
  appearance is skipped). macOS keeps the original patch stack.
- Changeset: `.changeset/linux-port-initial.md` (`@1git/gpuix`, minor).

## Ubuntu 20.04: the floor, and the build rule

Target: Ubuntu 20.04 LTS x64, glibc 2.31, Git 2.25, X11 by default
(Wayland session optional).

**Build on 20.04 to ship for 20.04.** glibc is forward-compatible
only: a Rust/Bun binary built on Ubuntu 24.04 (glibc 2.39) will refuse
to run on 20.04. Do the release build in a 20.04 container or on a
20.04 host, and verify with `ldd` that no `GLIBC_2.32+` symbol is
required. This VM (Ubuntu 24.04) is therefore fine for development
checks, but not for a 20.04 release binary.

Other 20.04 notes to verify on a real 20.04 machine (not assumed here):

- Bun 1.4.2: its Linux binary is known to require at least
  GLIBC_2.29, which 2.31 satisfies, but the exact 1.4.2 binary must
  still be run on 20.04 before claiming support.
- Sharp 0.35.4 linux-x64 (glibc) prebuilt runtime: check it loads on
  2.31; do not substitute the linuxmusl build on Ubuntu.
- Git 2.25 covers `switch`/`restore`/worktrees; audit any newer Git
  flag in `packages/git` before release.
- `curl --unix-socket` (used by the SSH askpass script) exists in
  20.04's curl 7.68. `zenity` and `xdg-utils` are the new runtime
  dependencies to document, not bundle.

Runtime dependencies for the tarball (to install, not bundle):
`git`, `xdg-utils`, `zenity`, `wl-clipboard` (Wayland) or `xclip`
(X11), plus the desktop's Wayland/X11 libraries and a Vulkan driver
(or Mesa lavapipe for software rendering).

## Verified in this session (Ubuntu 24.04, Xvfb, Rust 1.97.1)

- `bun install --frozen-lockfile`: ok (616 packages).
- `bun run build` (turbo, all 5 tasks): ok.
- `bun run --cwd apps/gpuix check-types`: ok after the workspace build.
- `bun x oxfmt --check` and `bun x oxlint` on the changed files: clean.
- Shim smoke test (Bun, no display): invalid URL still rejected;
  clipboard on a machine with no wl-copy/xclip/xsel now fails with the
  intended "install wl-clipboard or xclip" message instead of a raw
  spawn error.
- **Native build:** `bun run --cwd apps/gpuix build:native` succeeds
  and writes a 51 MB `apps/gpuix/.cache/native/gpuix-native.node`.
  System deps needed: Rust 1.97.1 (rustup, pinned by GPUIX),
  `libx11-xcb-dev`, `libxkbcommon-x11-dev`, `libxcb*-dev`,
  `libwayland-dev`, `libfontconfig-dev`, `libvulkan1`,
  `mesa-vulkan-drivers`. Two environment traps, both hit in this
  session and worth knowing: (a) this VM's egress proxy credential
  rotates on every new exec session, so a `cargo fetch` that shares
  its session with later commands stalls on downloads; fetch once in
  a single session, then build with `CARGO_NET_OFFLINE=true`.
  (b) VM whole-machine replacements wipe the apt layer (this session
  lost `mesa-vulkan-drivers` and the `-dev` symlinks mid-build, which
  surfaced as `rust-lld: unable to find library -lxkbcommon-x11` and
  as a Vulkan surface failure); reinstall the deps after a
  replacement, before rebuilding.
- **First window:** `DISPLAY=:99 bun --preload ./native/preload.ts
  --hot src/main.tsx` under Xvfb (1920x1080) opens a 1280x820 window
  titled "1git" with the real onboarding flow: "Welcome to 1git",
  Light/Dark/Auto cards, step 1 of 4, "Skip setup" / "Continue".
  Rendering uses llvmpipe (Mesa software Vulkan, no GPU in this VM).
  Non-fatal log line under Xvfb: `Found no xinput mouse pointers`
  (Xvfb has no input devices; a real desktop has them).
  Screenshot: `~/workspace/your_files/1git-linux-first-window.png`.
- **Packaged tarball (2026-10-26):** `bun run --cwd apps/gpuix
  package:linux` produces `build/linux/1git-linux-x64.tar.gz`
  (76 MB, sha256 `10a7ceb4…bfb`). Contents: `bin/1git` (Bun
  compiled, 105 MB), `Frameworks/gpuix-native.node` (51 MB),
  `Resources/app.js`, sharp Linux runtime, and Linux remote
  helpers only. Two packaging fixes landed with it:
  `package-linux.ts` now builds/copies only `linux-*` remote
  helpers (the darwin helpers cannot be cross-built from Linux),
  and the tarball README states the real glibc floor (see below).
  The extracted copy was smoke-tested under Xvfb and opens the
  same Welcome screen as the dev build.
- **glibc floor, verified by symbol scan:** `gpuix-native.node`
  requires up to `GLIBC_2.39`, so this development tarball runs on
  Ubuntu 24.04+ only, **not** on 20.04 (glibc 2.31), despite the
  original 20.04 target. A 20.04 tarball must be built on 20.04
  itself; that is still pending and is the main blocker for the
  stated minimum version.

## Not yet verified / TODO

1. **Real desktop run.** The window was verified under Xvfb only
   (dev build and packaged tarball alike). Next: run on a real
   GNOME X11 session and a Wayland session, including
   mouse/keyboard input, window resize, and HiDPI.
2. **Ubuntu 20.04 build.** Rebuild `build:native` and
   `package:linux` on a 20.04 host/container and verify the
   tarball's glibc ceiling is 2.31 before claiming 20.04 support.
3. **Cmd -> Ctrl sweep.** Many handlers already accept `cmd || ctrl`,
   but pure `cmd` checks (quick switcher, Cmd-click, settings
   shortcuts) will not fire on Linux, where GPUI reports the Super key
   as `cmd`. Map them to Ctrl on Linux, file by file, with tests.
4. **Editor catalog on Linux.** Discover `code`, `cursor`, `zed`,
   `subl` from PATH and `.desktop` files; the current Linux branch
   only handles an explicit executable path or the default handler.
5. **File-menu labels and icons.** "Reveal in Finder" and the
   Finder.app icon path are still macOS strings; rename to the file
   manager on Linux and drop the Finder icon lookup.
6. **Credentials.** Account secrets go through GPUI's
   `read/write_credentials` (added by `accounts.patch`). Verify it
   against GNOME Keyring and KWallet on Linux, and decide the
   fallback for headless/no-keyring machines. Do not silently fall
   back to plaintext.
7. **Updater.** Sparkle is macOS-only. Either ship Linux with no
   auto-updater (v1, documented in the tarball README) or adopt
   GPUIX's GitHub-Releases `checkUpdate` flow.
8. **Packaging.** The tarball is a stopgap. A `.deb` (or AppImage via
   `cargo-packager`, as GPUIX upstream does) with a real `.desktop`
   file and icon is the proper distribution format.
9. **Tests.** The vibrancy, traffic-light, signing, notarization and
   macOS launch integration suites are macOS-only; they need Linux
   equivalents or explicit skips, not silent passes.
10. **Push decision.** This branch lives only in this workspace.
   Nothing has been pushed to `1bye/1git` and no PR has been opened;
   pushing upstream or forking is a separate decision for the user.
