# 1git GPUIX

Native workspace shell, replacing the earlier component showcase. The showcase
is still available in `packages/gpuix-ui/example`.

```sh
bun run --cwd apps/gpuix dev
```

Both GPUIX packages stay pinned to `0.10.0`. This app runs on Bun, React 19,
and GPUIX, not the DOM or Electron. The window uses native macOS blur and
traffic lights, with a translucent light tint and an opaque white workspace.
The connected tab silhouette is static; it does not port the desktop's liquid
animation machinery.

## Structure

- `src/main.tsx`: native boot and hot reload.
- `src/window-options.ts`: window chrome and Tab/Shift+Tab traversal.
- `src/app.tsx`: one window's in-memory tab state.
- `src/fixture/app-shell.tsx`: toolbar and blank workspace composition.
- `src/feature/workspace-tabs/`: tab UI, focus, scrolling, and pure state transitions.
- `src/styles/tokens.ts`: shared desktop colors adapted to `gpuix-ui`.
- `src/styles/workspace-layout.ts`: native top-spacing override; 36px tabs in a 42px toolbar, preserving shared bottom spacing and control sizes.

The reusable controls and stylesheet package remain independent of app features.
`@1git/design-tokens` supplies shared colors and shell dimensions to both
Electron (generated CSS and numeric constants) and GPUIX (plain values).
The native app currently uses the platform font; the web's Manrope font import
does not register that font with GPUIX.

## Tabs

- Click a tab to activate it; + adds and selects a new workspace.
- Close with × or Delete/Backspace while its tab is focused.
- Left/Right wrap between tabs; Home/End select the first/last.
- Enter and Space activate a focused tab. Tab/Shift+Tab traverse the active
  tab, its close action, and the add action, with a visible focus outline.
- Horizontal trackpad scrolling handles overflow; selection reveals the entire
  tab and close control.
- Closing the active tab selects the right neighbor, then the left. Closing the
  last tab leaves the white workspace and focuses +.

`1git / main` is initial sample metadata, not a detected Git repository.
New workspaces are numbered in memory; restarting resets them. There is no
repository picker, Git access, sidebar, persistence, theme switch, reordering,
or tab animation yet. Cmd+W remains the native Close Window command.

## Verification

```sh
bun run --cwd apps/gpuix check-types
bun run --cwd apps/gpuix test
bun run --cwd apps/gpuix build
bun x oxlint apps/gpuix
bun x oxfmt --check apps/gpuix
```

Tests include pure tab transitions and real GPUIX native layout, accessibility,
clicks, keyboard focus, and overflow. Native tests require macOS or Windows
graphics access. Offscreen screenshots do not capture macOS vibrancy; compare
the running window on macOS when adjusting blur/material appearance.
