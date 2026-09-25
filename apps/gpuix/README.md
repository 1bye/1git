# 1git GPUIX

Native app shell with an interactive `@1git/gpuix-ui` component showcase.
Both `@gpuix/react` and `@gpuix/native` are pinned to `0.10.0`; upgrade them
together, as required by the [GPUIX release notes](https://github.com/remorses/gpuix/blob/main/CHANGELOG.md).

GPUIX 0.10 moved shared runtime APIs into `@gpuix/native`, while retaining the
React adapters used by this app. Tab navigation is still bound at the window
boundary in `src/main.tsx`.

Run it from the repository root:

```sh
bun run --cwd apps/gpuix dev
```
