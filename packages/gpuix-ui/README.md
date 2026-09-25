# @1git/gpuix-ui

Styled React controls for GPUIX, built with `@1git/gpuix-stylesheet`. Includes
Button, Text, and Select with fixed dark colors. No theme provider is required.

## Setup

Add `"@1git/gpuix-ui": "workspace:*"` to the consuming app's dependencies and run
`bun install`. The package exports TypeScript source, matching the GPUIX app's
Bun runtime. Pin both `@gpuix/react` and `@gpuix/native` to `0.10.0`, matching
this package's peer dependencies. React 19.2.4 or later within React 19 is supported.

GPUIX 0.10 moves shared runtime APIs into `@gpuix/native/host`,
`@gpuix/native/testing`, and `@gpuix/native/automation`. The React adapters and
re-exports remain supported, including the `@gpuix/react/select` primitives used
here. Upgrade the React and native packages together; see the
[upstream release notes](https://github.com/remorses/gpuix/blob/main/CHANGELOG.md).

Use `"jsx": "react-jsx"` and `"jsxImportSource": "@gpuix/react"` in the app's
TypeScript configuration. Imports use explicit entry points:

```tsx
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@1git/gpuix-ui/select";
```

GPUIX requires the application to bind Tab at the window boundary. Bind it once:

```tsx
import { render } from "@gpuix/react";

render(<App />, {
  title: "My app",
  onKeyDown(event, renderer) {
    if (event.key !== "tab") return;
    if (event.modifiers?.shift) renderer.focusPrevious?.();
    else renderer.focusNext?.();
  },
});
```

## Button

```tsx
<Button variant="primary" size="sm" disabled={!canCommit} onPress={handleCommit}>
  Commit changes
</Button>
```

`ButtonProps` is exported from `/button`.

| Prop | Values / purpose | Default |
| --- | --- | --- |
| `children` | React content; string and number children get a styled label | — |
| `variant` | `primary`, `secondary`, `ghost` | `primary` |
| `size` | `sm`, `md` | `md` |
| `disabled` | Blocks activation and removes the button from the Tab order | `false` |
| `onPress` | `() => void`; mouse click, Enter press, or Space release | — |
| `style` | GPUIX `StyleDesc` for the root | — |
| `textStyle` | GPUIX `StyleDesc` for generated text labels | — |
| `aria-label` | Accessible name; inferred from direct string/number children | — |
| `aria-description`, `aria-id` | Native accessibility metadata | — |
| `ref` | GPUIX `PublicInstance` ref, not a DOM element | — |
| `testId`, `tabIndex`, `autoFocus` | Native host props | Tab index `0` |

Key repeats do not repeatedly activate the button. Space is cancelled by blur or
disabling the button. Focus is visibly outlined. Caller styles override the base
appearance; focus, keyboard-press, and disabled styles are applied afterward.
Disabled buttons suppress native hover and active styles.

Plain text children are joined into one label, including interpolated numbers.
Custom children retain their own styling. Give icon-only or custom-content
buttons an explicit accessible name:

```tsx
<Button aria-label="Open repository" variant="ghost" onPress={openRepository}>
  <FolderIcon />
</Button>
```

## Text

```tsx
<Text size="lg" weight="semibold">Repositories</Text>
<Text tone="muted">Showing {count} repositories</Text>
<Text tone="danger" style={{ fontSize: 13 }}>Could not open repository</Text>
```

`TextProps` is exported from `/text`.

| Prop | Values / purpose | Default |
| --- | --- | --- |
| `children` | Strings, numbers, conditional empty values, or an array of them | — |
| `size` | `sm` (12px), `md` (14px), `lg` (20px) | `md` |
| `tone` | `default`, `muted`, `danger` | `default` |
| `weight` | `regular` (400), `medium` (500), `semibold` (600) | `regular` |
| `style` | Final GPUIX style overrides | — |

Other GPUIX host props, including refs and accessibility metadata, pass through.
Text segments are joined before rendering because separate native text nodes do
not behave like inline HTML. Rich React elements are not accepted as text
children. The component sets its own color: GPUIX does not inherit a text color
from a parent container.

## Select

The five Select parts wrap `@gpuix/react/select`. They retain GPUIX's native
selection, keyboard navigation, disabled-option handling, popup positioning,
outside-click dismissal, and focus restoration.

```tsx
const branches = [
  { value: "main", label: "Main branch" },
  { value: "develop", label: "Development" },
];

<Select value={branch} onValueChange={setBranch} items={branches}>
  <SelectTrigger aria-label="Branch">
    <SelectValue placeholder="Choose a branch" />
  </SelectTrigger>
  <SelectContent>
    {branches.map((item) => (
      <SelectItem key={item.value} value={item.value}>
        {item.label}
      </SelectItem>
    ))}
    <SelectItem value="archived" disabled>Archived</SelectItem>
  </SelectContent>
</Select>
```

Each part exports its corresponding props type: `SelectProps`,
`SelectTriggerProps`, `SelectValueProps`, `SelectContentProps`, and
`SelectItemProps`. These derive from the installed GPUIX primitives, preserving
their full supported props.

| Component | Main props |
| --- | --- |
| `Select` | `value`, `defaultValue`, `onValueChange`, `open`, `defaultOpen`, `onOpenChange`, `disabled`, `items` |
| `SelectTrigger` | `disabled`, `asChild`, `style`, host props/ref; provide `aria-label` |
| `SelectValue` | `placeholder`, `children` override, `style`, host props/ref |
| `SelectContent` | `side`, `align`, `sideOffset` (default 6px), `alignOffset`, `collisionPadding`, `onEscapeKeyDown`, host props/ref |
| `SelectItem` | Required `value`, `disabled`, `asChild`, `children`, `style`, host props/ref |

Omit `value` and use `defaultValue` for an uncontrolled select. The root's
`items` maps values to displayed labels; without it, `SelectValue` displays the
selected value string. Item children alone do not register display labels.

Trigger and item styles can be objects or functions. Trigger state contains
`open`, `disabled`, and `placeholder`; item state contains `selected`,
`highlighted`, and `disabled`. Item children can also be a function of item state.
Custom child elements must provide their own text styles.

```tsx
<SelectTrigger
  aria-label="Branch"
  style={({ open }) => ({ backgroundColor: open ? "#30304a" : "#242427" })}
>
  <SelectValue placeholder="Choose a branch" />
</SelectTrigger>
```

Defaults and selection styles apply before caller overrides. Focus and disabled
styles apply last. Native refs and callbacks are forwarded by the wrappers.

### Accessibility boundary

Button exposes its button role and name; Select parts expose combobox, listbox,
and option roles. GPUIX 0.10.0 does not expose `aria-disabled` in host props, and
its headless Select does not automatically expose expanded/selected state to
assistive technology. These wrappers do not claim complete accessibility for
those states. Native keyboard behavior and visible disabled/focus states are
implemented independently of that upstream limitation.

## Development

```bash
bun run --cwd packages/gpuix-ui check-types
bun run --cwd packages/gpuix-ui test
bun run --cwd apps/gpuix dev
```

Tests run offline against React and the real GPUIX native test renderer. They
require macOS or Windows with graphics access; unsupported environments fail
explicitly. Native test results are not cached by Turbo. The focus test supplies
focus/blur notifications at the native event boundary because inactive offscreen
GPUI windows suppress those notifications. A regression test also batches key
events at that boundary, matching a live window's asynchronous delivery. Other
tested input uses native hit testing and keyboard dispatch. The app provides an
interactive component showcase.
