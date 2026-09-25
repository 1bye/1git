# @1git/gpuix-stylesheet

Small, typed helpers for defining and composing GPUIX styles. The package adds
no theme or styling runtime: styles remain plain GPUIX `StyleDesc` objects.

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
