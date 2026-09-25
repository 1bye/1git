# 1git GPUIX

Native app shell with an interactive `@1git/gpuix-ui` component showcase.
Both `@gpuix/react` and `@gpuix/native` are pinned to `0.10.0`; upgrade them
together, as required by the [GPUIX release notes](https://github.com/remorses/gpuix/blob/main/CHANGELOG.md).

GPUIX 0.10 moved shared runtime APIs into `@gpuix/native`, while retaining the
React adapters used by this app. Tab navigation is still bound at the window
boundary in `src/main.tsx`.

`App` accepts an optional `tokens` prop and passes it to the showcase controls.
It defaults to the original dark/comfortable appearance. To choose other presets
at the app boundary, import from `@1git/gpuix-ui/tokens`:

```tsx
import { densities, palettes, type UiTokens } from "@1git/gpuix-ui/tokens";

const tokens: UiTokens = {
  colors: palettes.light,
  layout: densities.compact,
};

// Use this element in the existing render call in src/main.tsx.
<App tokens={tokens} />
```

There is no theme-switching UI or persisted setting yet.

Run it from the repository root:

```sh
bun run --cwd apps/gpuix dev
```
