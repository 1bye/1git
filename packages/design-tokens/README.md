# @1git/design-tokens

One source for visual defaults: typography, leading, spacing, rounding, icon and
control sizes, light colors, and shell measurements. Plain readonly TypeScript
values: no React, GPUIX dependency, theme provider, or CSS-variable resolver.
The native app and `@1git/gpuix-ui` import these values directly; Electron can
use the generated CSS without replacing its existing Tailwind theme.

## Native styles

```ts
import { fontWeight, lightColors, radius, spacing, typography } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";

const styles = StyleSheet.create({
  heading: {
    ...typography.lg,
    fontWeight: fontWeight.medium,
    color: lightColors.editorInk,
  },
  card: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: lightColors.editorSurface,
  },
});
```

Spread a typography preset so size and leading stay paired. Use `fontWeight`
for emphasis, not a new font size. `Text` accepts the same size names, including
`size="2xl"`. Caller styles still take precedence.

| Size | Font / leading (px) | Use |
| --- | --- | --- |
| `2xs` | 9 / 12 | Tiny metadata |
| `xs` | 10 / 14 | Captions |
| `sm` | 11 / 16 | Secondary copy and compact lists |
| `md` | 12 / 18 | Body, fields, control labels |
| `lg` | 14 / 20 | Section headings |
| `xl` | 18 / 24 | View headings |
| `2xl` | 20 / 28 | Prominent headings |

These are **compact desktop** sizes, not Tailwind's web font values. All sizes
and line heights are logical pixels (GPUIX handles display scaling), not rems or
line-height multipliers. The app keeps the platform font. `codeTypography` is
the separate monospace diff default, with deliberately looser leading.

- `fontWeight`: `regular`, `medium`, `semibold`, `bold`.
- `spacing`: four-pixel steps, e.g. `[1] = 4`, `[1.5] = 6`, `[3] = 12`.
- `radius`: `none`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `full`.
- `iconSize`: `xs` through `2xl`.
- `controlSize`: small/medium/large controls, checkbox, list items and rail buttons.
- `controlLayout`: compact and comfortable density presets built from those scales.
- `lightColors`: shared light surfaces; native dark palettes remain in `gpuix-ui`.
- `workspaceLayout`: shell geometry, separate from ordinary component styling.

Prefer a shared scale over a one-off visual value. List strides, viewport bounds,
window geometry, image aspect ratios and illustration paths remain explicit:
they are measurements, not generic padding or typography. Do not change a virtual
list's stride merely to match a spacing token.

## Shell and CSS

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
Camel-case keys become kebab-case CSS variables; numeric measurements get `px`,
weights stay unitless. New scale variables are namespaced (`--1git-text-md`,
`--1git-leading-md`, `--1git-space-1-5`, `--1git-radius-lg`) so importing the sheet
does not overwrite Tailwind's text/radius utilities. Existing color and shell
variable names are unchanged. Web dark-mode overrides remain owned by `@1git/ui`.
