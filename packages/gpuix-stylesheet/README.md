# @1git/gpuix-stylesheet

Small, typed helpers for defining named design-token presets and composing GPUIX
styles. The package adds no theme or styling runtime: tokens remain plain values
and styles remain plain GPUIX `StyleDesc` objects.

This package is checked against GPUIX `0.10.0`. Install `@gpuix/react` and
`@gpuix/native` at that same exact version. GPUIX 0.10 retains the React
`StyleDesc` re-export, so the stylesheet API is unchanged.

## Usage

Add the package as a workspace dependency:

```json
{
  "dependencies": {
    "@1git/gpuix-stylesheet": "workspace:*"
  }
}
```

Define related styles with `StyleSheet.create` and combine them with
`StyleSheet.compose`:

```ts
import { StyleSheet } from "@1git/gpuix-stylesheet";

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#111111",
    display: "flex",
    padding: 12,
  },
  selected: {
    backgroundColor: "#333333",
  },
  disabled: {
    opacity: 0.5,
  },
});

const style = StyleSheet.compose(
  styles.root,
  isSelected && styles.selected,
  isDisabled && styles.disabled,
);
```

Conditional values that resolve to `false`, `null`, or `undefined` are ignored.

## API

### `Tokens.create`

```ts
import { Tokens } from "@1git/gpuix-stylesheet";

const palettes = Tokens.create({
  dark: { background: "#161618", text: "#ededf0" },
  light: { background: "#ffffff", text: "#18181b" },
});

const densities = Tokens.create({
  compact: { control: { height: 28, padding: 8 }, gap: 4 },
  comfortable: { control: { height: 36, padding: 12 }, gap: 8 },
});
```

Defines a named collection of presets and returns the supplied object unchanged.
Every preset in a collection must have the same nested token keys and compatible
value kinds. Values can be strings, numbers, booleans, or nested named groups;
arrays, functions, `null`, and `undefined` are not supported. Categories are not
hard-coded: use separate collections for palettes, density, typography, or other
independent settings.

Preset names and inferred literal values are preserved. Inline definitions are
inferred as readonly by TypeScript, but `create` does not freeze, clone, register,
or mutate the object. Treat definitions as immutable; no active preset is stored.

```ts
// TypeScript error: every preset must provide `text`.
Tokens.create({ dark: { text: "#ffffff" }, light: {} });

// TypeScript error: `padding` cannot change from a number to a string.
Tokens.create({ compact: { padding: 8 }, comfortable: { padding: "12" } });
```

These are compile-time checks, not runtime validation. Strings are not parsed as
colors, font names, or lengths. Validate external configuration before using it.

### `TokenSet`

```ts
import { StyleSheet, type TokenSet } from "@1git/gpuix-stylesheet";

type UiTokens = {
  colors: TokenSet<typeof palettes>;
  layout: TokenSet<typeof densities>;
};

const styles = StyleSheet.create({
  root: ({ colors, layout }: UiTokens) => ({
    backgroundColor: colors.background,
    color: colors.text,
    height: layout.control.height,
    padding: layout.control.padding,
    gap: layout.gap,
  }),
});

const tokens: UiTokens = {
  colors: palettes.dark,
  layout: densities.compact,
};

const rootStyle = styles.root(tokens);
```

`TokenSet<typeof presets>` extracts the readonly token shape, widening literal
values to `string`, `number`, or `boolean`. This allows custom values, not just
the built-in presets:

```ts
const customColors: TokenSet<typeof palettes> = {
  ...palettes.dark,
  text: "#dbeafe",
};
```

Resolve token-dependent styles during rendering. Selecting a different palette
or density and rendering again produces updated styles without changing the
stylesheet definitions. Existing style objects do not update automatically.
State, providers, settings persistence, and rerender notifications belong to
the consuming application, not this package.

### `StyleSheet.create`

```ts
StyleSheet.create(styles);
```

Validates a named collection of GPUIX styles and returns the same object
unchanged. Each entry can be a `StyleDesc` object or a function that returns
one. The original keys and function signatures are preserved by TypeScript.

```ts
const styles = StyleSheet.create({
  icon: {
    opacity: 0.8,
  },
  size: (value: number) => ({
    height: value,
    width: value,
  }),
});

const iconStyle = StyleSheet.compose(styles.icon, styles.size(20));
```

Invalid GPUIX properties are rejected at compile time:

```ts
StyleSheet.create({
  // TypeScript error: `notAStyleProperty` is not part of `StyleDesc`.
  invalid: { notAStyleProperty: true },
});
```

`create` is only a type-safe organizational helper. It does not clone,
register, or otherwise transform the supplied styles.

### `StyleSheet.compose`

```ts
StyleSheet.compose(...styles);
```

Combines concrete GPUIX styles from left to right. Later values override
earlier values, and empty conditional values are skipped.

```ts
const style = StyleSheet.compose(
  { backgroundColor: "#111111", opacity: 1 },
  false,
  { backgroundColor: "#333333" },
);

// {
//   backgroundColor: "#333333",
//   opacity: 1,
// }
```

The `hover` and `active` interaction objects are merged one property level
deep instead of being replaced as a whole:

```ts
const style = StyleSheet.compose(
  {
    active: { opacity: 0.8 },
    hover: { backgroundColor: "#222222", opacity: 0.9 },
  },
  {
    active: { backgroundColor: "#555555" },
    hover: { backgroundColor: "#444444" },
  },
);

// {
//   active: {
//     backgroundColor: "#555555",
//     opacity: 0.8,
//   },
//   hover: {
//     backgroundColor: "#444444",
//     opacity: 0.9,
//   },
// }
```

`compose` does not mutate any supplied style object. With no concrete styles it
returns an empty object; with one concrete style it returns that style
unchanged.

### `StyleInput`

```ts
type StyleInput = StyleDesc | false | null | undefined;
```

The public input type accepted by `StyleSheet.compose`. It is useful when a
helper returns a conditional style:

```ts
import {
  StyleSheet,
  type StyleInput,
} from "@1git/gpuix-stylesheet";

const getSelectionStyle = (selected: boolean): StyleInput =>
  selected ? { backgroundColor: "#333333" } : null;

const style = StyleSheet.compose(
  { backgroundColor: "#111111" },
  getSelectionStyle(isSelected),
);
```

## Tests

```bash
bun run --cwd packages/gpuix-stylesheet test
```
