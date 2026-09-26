# @1git/gpuix-ui

Styled React controls for GPUIX, built with `@1git/gpuix-stylesheet`. Includes
Button, Checkbox, Text, Textarea, and Select with named color and density presets. Controls default
to dark colors and comfortable sizing. No theme provider is required.

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
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { Text } from "@1git/gpuix-ui/text";
import { Textarea } from "@1git/gpuix-ui/textarea";
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
| `focusVisible` | Show the ring when focused; a parent can gate this by pointer/keyboard input without changing focus or activation | `true` |
| `onMouseDown`, `onKeyDown` | Native input notifications, e.g. to track focus visibility; `onKeyDown` runs before built-in activation | — |
| `onMouseEnter`, `onMouseLeave` | Native hover notifications, e.g. to coordinate a surrounding tab's highlight | — |
| `onPress` | `() => void`; mouse click, Enter press, or Space release | — |
| `style` | GPUIX `StyleDesc` for the root | — |
| `textStyle` | GPUIX `StyleDesc` for generated text labels | — |
| `tokens` | Explicit `UiTokens` selection | `defaultTokens` |
| `aria-label` | Accessible name; inferred from direct string/number children | — |
| `aria-description`, `aria-id` | Native accessibility metadata | — |
| `ref` | GPUIX `PublicInstance` ref, not a DOM element | — |
| `testId`, `tabIndex`, `autoFocus` | Native host props | Tab index `0` |

Key repeats do not repeatedly activate the button. Space is cancelled by blur or
disabling the button. Focus is visibly outlined. Caller styles override the base
appearance; focus, keyboard-press, and disabled styles are applied afterward.
Disabled buttons suppress native hover and active styles.

For keyboard-only rings, track input in the owning component. Share that state
across related controls when clicks move focus between them, as in a tab strip:

```tsx
const [focusVisible, setFocusVisible] = useState(true);

<Button
  focusVisible={focusVisible}
  onMouseDown={() => setFocusVisible(false)}
  onKeyDown={() => setFocusVisible(true)}
  onPress={handleCommit}
>
  Commit
</Button>;
```

Import `useState` from React. These handlers observe native input; `onPress`
still owns activation. `focusVisible` only gates the ring, not keyboard access.

Plain text children are joined into one label, including interpolated numbers.
Custom children retain their own styling. Give icon-only or custom-content
buttons an explicit accessible name:

```tsx
<Button aria-label="Open repository" variant="ghost" onPress={openRepository}>
  <FolderIcon />
</Button>
```

## Checkbox

A controlled, standalone checkbox. Compose visible labels beside it and always
provide `aria-label`. It has no internal checked state or Git-specific behavior.

```tsx
const [included, setIncluded] = useState(true);

<Checkbox
  aria-label="Include README.md in commit"
  checked={included}
  onCheckedChange={setIncluded}
  tokens={tokens}
/>
```

`CheckboxProps` and `CheckboxState` are exported from `/checkbox`.

| Prop | Values / purpose | Default |
| --- | --- | --- |
| `checked` | Required `boolean` or `"indeterminate"` | — |
| `onCheckedChange` | Required `(checked: boolean) => void`; mixed activates to `true` | — |
| `aria-label` | Required accessible name | — |
| `disabled` | Blocks input, dims the control, removes it from Tab order | `false` |
| `tokens` | Explicit palette and density | `defaultTokens` |
| `style` | Root `StyleDesc`; state/focus/disabled styling applies afterward | — |
| `ref`, `testId`, `tabIndex`, `autoFocus` | Native host props | Tab index `0` |
| `onFocus`, `onBlur`, `onMouseDown`, `onKeyDown` | Observe input without replacing built-in behavior | — |
| `onMouseEnter`, `onMouseLeave` | Coordinate hover with surrounding UI | — |
| `aria-description`, `aria-id` | Additional native accessibility metadata | — |

The 12px box and 10px mark sit inside a density-sized hit target (24px compact, 28px
comfortable). Pointer clicks toggle once; Space toggles on release. Repeats,
modified Space, and unarmed releases do not toggle. Blur or disabling cancels
a pending Space press. Focus rings appear for keyboard use, not pointer clicks.

For an all-files control, derive its state from inclusion:

```tsx
<Checkbox
  aria-label="Include all changed files in commit"
  checked={includedCount === 0 ? false : includedCount === fileCount ? true : "indeterminate"}
  disabled={fileCount === 0}
  onCheckedChange={setAllIncluded}
/>
```

The component emits `aria-checked` (`true`, `false`, or `"mixed"`) and a textual
state via `aria-valuetext`. This workspace's Bun patch forwards `aria-checked`;
the native app's pinned Rust patch exposes it to AccessKit. A stock GPUIX 0.10.0
addon, including the standalone gallery, only receives the textual state and
checkbox role. Native checked/mixed semantics require the patched addon. Disabled
input is blocked and described as unavailable; native `aria-disabled` remains an
upstream limitation.

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
| `tokens` | Explicit `UiTokens` selection | `defaultTokens` |

Other GPUIX host props, including refs and accessibility metadata, pass through.
Text segments are joined before rendering because separate native text nodes do
not behave like inline HTML. Rich React elements are not accepted as text
children. The component sets its own color: GPUIX does not inherit a text color
from a parent container.

## Textarea

A controlled multiline editor using GPUIX's native typing, selection, clipboard,
scrolling and undo. Supply an accessible name; the placeholder is only a hint.

```tsx
import { useState } from "react";
import { Textarea } from "@1git/gpuix-ui/textarea";

const [message, setMessage] = useState("");

<Textarea
  aria-label="Commit message"
  placeholder="Commit message…"
  value={message}
  onValueChange={setMessage}
  minRows={3}
  maxRows={6}
  tokens={tokens}
/>;
```

`TextareaProps` is exported from `/textarea`.

| Prop | Values / purpose | Default |
| --- | --- | --- |
| `value` | Required complete string, including newlines | — |
| `onValueChange` | Required `(value: string) => void` after native edits | — |
| `aria-label` | Required accessible name | — |
| `placeholder` | Hint shown when empty | — |
| `minRows`, `maxRows` | Native editor height bounds; longer content scrolls | `3`, `6` |
| `readOnly` | Native read-only editing mode | `false` |
| `tokens` | Field colors, padding, caret and focus outline | `defaultTokens` |
| `style` | Native style overrides; focus outline applies afterward | — |
| `theme` | Native theme override, including caret color | Token accent caret |
| `ref`, `testId`, `tabIndex`, `autoFocus` | Native host props | Tab index `0` |
| `onFocus`, `onBlur`, `onKeyDown`, `onKeyUp` | Native input notifications | — |
| `onSubmit` | Native Enter submission; see below | — |
| `aria-description`, `aria-id` | Additional accessibility metadata | — |

Remaining native textarea host props pass through, except children and `onChange`;
use `onValueChange` instead. Text defaults to 14px with 20px line height. Focus is
outlined, including pointer focus, without changing the editor's dimensions.
The native accessibility role is `MultilineTextInput`.

Without `onSubmit`, Enter inserts a newline. Providing `onSubmit` changes Enter
to submission; Shift+Enter still inserts a newline. For a Command+Enter action,
leave `onSubmit` unset and handle the modified key through `onKeyDown`, as the
app's preview composer does. Bind Tab at the window boundary as shown in Setup.
There is no custom text-editing engine, internal draft storage, or Git behavior.

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
| `SelectTrigger` | `tokens`, `disabled`, `asChild`, `style`, host props/ref; provide `aria-label` |
| `SelectValue` | `tokens`, `placeholder`, `children` override, `style`, host props/ref |
| `SelectContent` | `tokens`, `side`, `align`, `sideOffset` (default 6px), `alignOffset`, `collisionPadding`, `onEscapeKeyDown`, host props/ref |
| `SelectItem` | `tokens`, required `value`, `disabled`, `asChild`, `children`, `style`, host props/ref |

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

## Design tokens

The `/tokens` entry point exports:

- `palettes`: `dark` and `light` semantic color presets.
- `densities`: `compact` and `comfortable` layout presets.
- `UiTokens`: a readonly `{ colors, layout }` contract, also accepting custom values.
- `defaultTokens`: `palettes.dark` with `densities.comfortable`, preserving the
  original appearance. Treat this as immutable, not a global theme setter.

Palette and density are independent. Pass a selection explicitly:

```tsx
import { densities, palettes, type UiTokens } from "@1git/gpuix-ui/tokens";

const tokens: UiTokens = {
  colors: palettes.light,
  layout: densities.compact,
};

<Button tokens={tokens}>Commit</Button>
<Text tokens={tokens} tone="muted">Ready</Text>
```

The palette defines background, text/muted/control text, danger, accent and its
interaction states, borders/focus, surfaces, fields, popup backgrounds,
selection/highlight colors, and shadow color. Density defines control heights
and horizontal padding (including small buttons), gaps, item height/padding,
menu padding/gap, and page/section/content spacing. Component `size` still selects
the small or medium button within the chosen density. Typography, radii, and
popup limits remain fixed; no font scaling or automatic system-theme detection
is implemented.

Select has no token provider. Pass the same selection to each **styled part**;
the headless `Select` root takes no `tokens` prop:

```tsx
<Select defaultValue="main">
  <SelectTrigger tokens={tokens} aria-label="Branch">
    <SelectValue tokens={tokens} />
  </SelectTrigger>
  <SelectContent tokens={tokens}>
    <SelectItem tokens={tokens} value="main">main</SelectItem>
  </SelectContent>
</Select>
```

Button forwards tokens to its generated labels. Custom React children keep their
own styling and must receive tokens explicitly where needed. Existing `style`
and `textStyle` overrides keep their documented precedence.

Custom values do not require new presets:

```ts
const customTokens: UiTokens = {
  colors: { ...palettes.dark, accent: "#2563eb" },
  layout: { ...densities.comfortable, controlHeight: 40 },
};
```

Controls resolve their stylesheet functions on every render. Passing a new
selection updates colors and layout without remounting controls. The library
has no global registry, subscription, or persisted settings; mutating the shared
presets does not trigger rendering. The example owns its selection in local React
state. A future provider can supply it without changing these style definitions.

## Interactive example

The [example app](example/README.md) lives in `example/` at this package's root.
It demonstrates every Button variant/size, mixed/checked/disabled Checkboxes, Text size/weight/tone, and controlled,
uncontrolled, and disabled Selects. Palette and density controls update the
whole playground while preserving its interaction state.

```bash
bun run --cwd packages/gpuix-ui example
```

The example runs directly with Bun hot reload and uses the existing package
dependencies. It is not part of the library's public exports.

## Development

```bash
bun run --cwd packages/gpuix-ui check-types
bun run --cwd packages/gpuix-ui test
bun run --cwd packages/gpuix-ui example
```

Tests run offline against React and the real GPUIX native test renderer. They
require macOS or Windows with graphics access; unsupported environments fail
explicitly. Native test results are not cached by Turbo. The focus test supplies
focus/blur notifications at the native event boundary because inactive offscreen
GPUI windows suppress those notifications. A regression test also batches key
events at that boundary, matching a live window's asynchronous delivery. Other
tested input uses native hit testing and keyboard dispatch. The example has its
own native interaction tests and is included in the package's type check.
