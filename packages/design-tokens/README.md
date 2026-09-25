# @1git/design-tokens

One source for the shell's light colors and pixel measurements. It has no React,
GPUIX, CSS-variable resolver, or theme runtime. Other web-only tokens stay in
`@1git/ui`; this package contains the values shared by both renderers today.

```ts
import { lightColors, workspaceLayout } from "@1git/design-tokens";

const surface = {
  backgroundColor: lightColors.editorSurface,
  borderRadius: workspaceLayout.workspaceSurfaceRadius,
};
```

Web consumers import the generated equivalent (already imported by `@1git/ui`):

```css
@import "@1git/design-tokens/light.css";

.workspace {
  background: var(--editor-surface);
  border-radius: var(--workspace-surface-radius);
}
```

Edit `src/tokens.ts`, then run `bun run --cwd packages/design-tokens generate`.
Commit the generated CSS too. `check-types` checks it for drift without writing.
Camel-case keys become kebab-case CSS variables; numeric layout values get `px`.
Existing web dark-mode overrides remain owned by `@1git/ui`.
