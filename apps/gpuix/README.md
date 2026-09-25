# 1git GPUIX

Native workspace shell, replacing the earlier component showcase. The showcase
is still available in `packages/gpuix-ui/example`.

```sh
bun run --cwd apps/gpuix build:native
bun run --cwd apps/gpuix dev
```

Both GPUIX packages stay pinned to `0.10.0`. This app runs on Bun, React 19,
and GPUIX, not the DOM or Electron. The window uses native macOS blur and
traffic lights, with a translucent light tint and an opaque white workspace.
The connected tab silhouette keeps its shape while moving; it does not port
the desktop's liquid shape-morphing machinery.

## Local native patch

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

The published dependencies are unchanged. `native/preload.ts` selects the
release addon through `NAPI_RS_NATIVE_LIBRARY_PATH` before GPUIX loads.
Source, build outputs, and the patch fingerprint live in ignored `.cache/`;
there is no public fork, committed binary, or `node_modules` modification.
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
- `src/app.tsx`: one window's in-memory tab state.
- `src/fixture/app-shell.tsx`: toolbar and blank workspace composition.
- `src/feature/workspace-tabs/`: tab UI, focus, scrolling, and pure state transitions.
- `src/styles/tokens.ts`: shared desktop colors adapted to `gpuix-ui`.
- `src/styles/workspace-layout.ts`: native top-spacing override; 36px tabs in a 42px toolbar, preserving shared bottom spacing and control sizes.

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

The window temporarily starts with eight sample tabs to try scrolling and
dragging immediately; + adds more. `1git / main` is sample metadata, not a
detected Git repository. New workspaces are numbered in memory; restarting
resets the preview. There is no
repository picker, Git access, sidebar, persistence, theme switch,
or entrance/exit animation yet. Cmd+W remains the native Close Window command.

## Verification

```sh
bun run --cwd apps/gpuix check-types
bun run --cwd apps/gpuix test
bun run --cwd apps/gpuix build
bun x oxlint apps/gpuix
bun x oxfmt --check apps/gpuix
```

Tests include pure tab transitions and real GPUIX native layout, accessibility,
clicks, keyboard focus, captured reordering, cancellation, and overflow. The
native motion clock also checks intermediate positions, settling, reversal,
and grabbing a moving tab without a jump. These
app tests use the patched addon and require macOS graphics access. They dispatch
GPUI events, not physical AppKit events: manually check that tab drags keep the
window still and empty-titlebar drags move it after restarting the app.
Offscreen screenshots do not capture macOS vibrancy; compare
the running window on macOS when adjusting blur/material appearance.
