# Linux port (work in progress)

Status: scaffolding landed on branch `linux-port`, commit `feat(linux)`.
This is **not** a finished, runnable Linux app yet. The TypeScript side
builds and type-checks on Linux; the native GUI build has not been run
to a window yet (see "Not yet verified").

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

## Verified in this session (Ubuntu 24.04, no display, no Rust)

- `bun install --frozen-lockfile`: ok (616 packages).
- `bun run build` (turbo, all 5 tasks): ok.
- `bun run --cwd apps/gpuix check-types`: ok after the workspace build.
- `bun x oxfmt --check` and `bun x oxlint` on the changed files: clean.
- Shim smoke test (Bun, no display): invalid URL still rejected;
  clipboard on a machine with no wl-copy/xclip/xsel now fails with the
  intended "install wl-clipboard or xclip" message instead of a raw
  spawn error.

## Not yet verified / TODO

1. **Native build and first window.** Install Rust (GPUIX pins
   1.97.1 in its `rust-toolchain.toml`) and the GPUI Linux system
   libraries, then run `bun run --cwd apps/gpuix build:native` and
   `bun run dev:app` under Xvfb and then on a real GNOME X11 and
   Wayland session. Expect Vulkan/fontconfig issues to surface here
   first. This is the main remaining risk.
2. **Cmd -> Ctrl sweep.** Many handlers already accept `cmd || ctrl`,
   but pure `cmd` checks (quick switcher, Cmd-click, settings
   shortcuts) will not fire on Linux, where GPUI reports the Super key
   as `cmd`. Map them to Ctrl on Linux, file by file, with tests.
3. **Editor catalog on Linux.** Discover `code`, `cursor`, `zed`,
   `subl` from PATH and `.desktop` files; the current Linux branch
   only handles an explicit executable path or the default handler.
4. **File-menu labels and icons.** "Reveal in Finder" and the
   Finder.app icon path are still macOS strings; rename to the file
   manager on Linux and drop the Finder icon lookup.
5. **Credentials.** Account secrets go through GPUI's
   `read/write_credentials` (added by `accounts.patch`). Verify it
   against GNOME Keyring and KWallet on Linux, and decide the
   fallback for headless/no-keyring machines. Do not silently fall
   back to plaintext.
6. **Updater.** Sparkle is macOS-only. Either ship Linux with no
   auto-updater (v1, documented in the tarball README) or adopt
   GPUIX's GitHub-Releases `checkUpdate` flow.
7. **Packaging.** The tarball is a stopgap. A `.deb` (or AppImage via
   `cargo-packager`, as GPUIX upstream does) with a real `.desktop`
   file and icon is the proper distribution format.
8. **Tests.** The vibrancy, traffic-light, signing, notarization and
   macOS launch integration suites are macOS-only; they need Linux
   equivalents or explicit skips, not silent passes.
9. **Push decision.** This branch lives only in this workspace.
   Nothing has been pushed to `1bye/1git` and no PR has been opened;
   pushing upstream or forking is a separate decision for the user.
