# GPUIX UI playground

One native GPUIX app demonstrating every component exported by `gpuix-ui`.
It uses the package's public entry points and existing development dependencies;
there is no separate installation or nested workspace package.

From the repository root, after `bun install`:

```sh
bun run --cwd packages/gpuix-ui example
```

Or, from `packages/gpuix-ui`, run `bun run example`. This starts
`example/main.tsx` with Bun hot reload. GPUIX 0.10.0 requires macOS or Windows
with native graphics access.

## Try it

- Switch between dark/light palettes and comfortable/compact density. The
  selections are independent and update the whole playground immediately.
- Activate all Button variants in small and medium sizes. Watch the counter,
  try the disabled button, and reset the counter.
- Compare Text sizes, weights, and tones.
- Use the controlled branch Select, the uncontrolled placeholder Select, and
  the disabled Select. The archived option is disabled in each dropdown.
- Use Tab / Shift+Tab to focus, Enter / Space to activate, arrow keys to navigate
  a Select, and Escape to dismiss its popup.

Changing tokens preserves the counter and Select values. Selections live only
in this example's React state; restarting the app resets to dark/comfortable.
No provider, mutable global theme, persistence, or system-theme detection is used.
Tokens are passed explicitly to every styled control, including each Select part.
The page wraps its panels and scrolls when the window is small.

## Files and checks

- `app.tsx`: component gallery and live token selection.
- `main.tsx`: native window and Tab handling.
- `tsconfig.json`: Bun/React type-checking configuration, separate from the library.

```sh
bun run --cwd packages/gpuix-ui check-types
bun run --cwd packages/gpuix-ui test
```

The package's type check includes this example. Native component tests cover
palette/density changes, preserved demo state, keyboard activation, and disabled
controls. See the package README for the upstream accessibility limitations.
