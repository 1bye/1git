# @1git/gpuix-ui

Styled React controls for GPUIX, built with `@1git/gpuix-stylesheet`. Includes
Button, Checkbox, Text, Textarea, Select, Popover, Tooltip, and a native DiffView. Controls use named color and density presets and default
to dark colors and comfortable sizing. No theme provider is required.

Set `focusVisible: false` on the shared `UiTokens` to hide focus outlines across
Button, Checkbox, SelectTrigger, Textarea and DiffView without removing focus,
keyboard activation, ordinary borders or selection styling. Outlines stay enabled
by default; per-control `focusVisible` can hide them but cannot override a disabled
token setting. Prefer visible focus for keyboard accessibility when choosing an
application's appearance.

## Tooltip

Compose tooltips around native controls, just like Select. Hover delay, focus,
Escape/click dismissal and viewport clamping use the existing GPUIX primitives.
The surface inverts the selected palette (text color for its background,
background color for its text) and does not intercept pointer input.

```tsx
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@1git/gpuix-ui/tooltip";

<TooltipProvider delayDuration={350}>
  <Tooltip>
    <TooltipTrigger asChild>
      <div role="button" tabIndex={0} aria-label="History" onClick={openHistory}>
        <HistoryIcon />
      </div>
    </TooltipTrigger>
    <TooltipContent tokens={tokens} side="right" align="center">History</TooltipContent>
  </Tooltip>
</TooltipProvider>
```

`Tooltip`, `TooltipProvider`, and `TooltipTrigger` retain the native primitive
props; `TooltipContent` adds `tokens`, a `tooltip` role, 12px text, and an 8px side
offset. Caller styles override defaults. An `asChild` control must forward its
native ref and focus, blur, hover, click and key handlers; use a native host if
the custom control does not do so. Always give the trigger an accessible name;
the tooltip is supplemental help, not the control's only label.
GPUIX anchors to the root's box: keep it sized to its trigger (e.g. a flex parent
with `alignItems: "start"`/`"center"`, as in the workspace rail), not stretched
across a full-width block.

Centered placement requires the local `native/anchored-center.patch` in the
GPUIX app's addon. Build it with `bun run --cwd apps/gpuix build:native` and use
the app's native preload. `bun run --cwd packages/gpuix-ui test` loads that
preload for the full controls suite. Test the shared component from the workspace root:

```sh
bun test --preload ./apps/gpuix/native/preload.ts packages/gpuix-ui/tests/tooltip
```

## Popover

An anchored dialog with a dimmed, input-blocking background and a raised trigger.
Uses native motion for enter/exit, not a webview or a glass/refraction effect.
Register `handlePopoverKeyDown` before window shortcuts as shown in Setup below.
The native Bun runtime provides timers for geometry sampling only while open.

```tsx
import { Popover, PopoverTrigger, PopoverContent } from "@1git/gpuix-ui/popover";

<Popover open={open} onOpenChange={setOpen} modal>
  <PopoverTrigger asChild>
    <Button tokens={tokens}>+ New stash</Button>
  </PopoverTrigger>
  <PopoverContent
    tokens={tokens}
    aria-label="New stash"
    side="top"
    align="end"
    dismissible={!pending}
  >
    <StashForm />
  </PopoverContent>
</Popover>
```

- `Popover`: required controlled `open`, `onOpenChange`, and children; `modal`
  defaults to true. Modal surfaces dim/block background pointer input and own
  window keyboard shortcuts. `modal={false}` omits dimming/focus containment;
  outside clicks still dismiss without activating controls underneath.
- `PopoverTrigger`: Button props plus `asChild`; defaults to rendering a Button.
  `asChild` requires one Button-compatible element that forwards `ref` and honors
  `onPress`, `disabled`, and `tabIndex`. Preserves its handler and appearance.
- `PopoverContent`: children and required `aria-label`; `side` is `top` (default)
  or `bottom`, `align` is `start`, `center`, or `end` (default), `width` defaults
  to 300, `tokens` defaults to package tokens, and `testId` defaults to
  `popover-content`. It flips to the roomier side, clamps to window edges, and
  scrolls oversized content. `dismissible` defaults to true; false blocks
  Escape, outside-click and raised-trigger dismissal, but the owner can still
  close it programmatically after success.
- Tab/Shift+Tab stay within modal content. Initial focus goes to its first native
  tab stop; focus returns to the trigger after the exit animation. GPUIX 0.10's
  reverse-wrap fallback traverses forward to find the last field, so focus/blur
  callbacks may run on intermediate controls when wrapping backwards.
- Mount content unconditionally: `PopoverContent` manages presence so closing
  can animate. Unmounting the whole feature closes it immediately. The current
  style targets one active modal layer at a time; nested popovers are not covered.

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
import { handlePopoverKeyDown } from "@1git/gpuix-ui/popover";

render(<App />, {
  title: "My app",
  onKeyDown(event, renderer) {
    if (handlePopoverKeyDown(event, renderer)) return;
    if (event.key !== "tab") return;
    if (event.modifiers?.shift) renderer.focusPrevious?.();
    else renderer.focusNext?.();
  },
});
```

## DiffView

Read-only unified diff with native virtualization, syntax highlighting, selection,
and keyboard/trackpad scrolling. Git reads and filename/comparison toolbars stay
with the application. Import from `@1git/gpuix-ui/diff-view`.

**Requires the local release addon** built by `bun run --cwd apps/gpuix build:native`,
and the existing workspace Bun package patch. Launch with the app's native preload;
the published GPUIX binary alone does not support the new layout/theme props.
Restart after rebuilding native code. Other controls do not require this diff patch.

```tsx
import { DiffView } from "@1git/gpuix-ui/diff-view";

<DiffView
  patch={patch}
  aria-label="Unstaged changes"
  showFileHeader={false}
  style={{ height: 480 }}
  theme={{
    appearance: "light",
    fontMono: "Menlo",
    diffAdd: "#568362",       // markers and line numbers
    diffDel: "#b2676b",
    diffAddBg: "#f5f8f5",     // whole-row backgrounds
    diffDelBg: "#fcf5f5",
    diffAddWordBg: "#d9e8da", // changed words only
    diffDelWordBg: "#f1dadd",
    metrics: {
      diffTextSize: 11,
      diffLineHeight: 20,
      diffRowPaddingX: 14,
      diffGutterWidth: 30,
      diffMarkerWidth: 18,
    },
  }}
/>
```

`DiffViewProps` is exported from `/diff-view`.

| Prop | Purpose | Default |
| --- | --- | --- |
| `patch` | Complete unified Git patch | Required |
| `aria-label` | Accessible name for the focusable viewer | Required |
| `showFileHeader` | Render native filename/stat rows; hide when the app owns its toolbar | `true` |
| `wordDiff` | Highlight changed words within paired lines | `true` |
| `theme` | GPUIX palette, syntax, fonts and `metrics`; four local background overrides accept CSS colors with alpha | Native dark theme |
| `style` | Outer viewport size/layout; provide a bounded height or flex parent | Fill available space |
| `tokens` | `UiTokens` used for the focus outline; code colors come from `theme` | `defaultTokens` |
| `focusVisible` | Show the focus outline; `false` keeps keyboard focus/navigation without the ring | `true` |
| `collapsedPaths` | Paths whose bodies are hidden | None |
| `maxLines` | Limit displayed code rows and show a Show more control | Unlimited |
| `onToggleFile` | Native event with file path in `event.value` | — |
| `onShowMore` | Native event with hidden count in `event.value`; clear/increase `maxLines` to expand | — |
| `onLineClick` | Native event with `value`, `oldLine`, `newLine` | — |
| `onExpandContext` | Opt-in native hunk-gap action; path in `value`, hunk starts in `oldLine`/`newLine`. Caller reads context and replaces `patch`. Requires `diff-context.patch`. | — |
| `expandAfter` | Shows a trailing expansion row in a single-file diff. Its `onExpandContext` event carries `value: "after"`. Requires `diff-trailing-context.patch`. | `false` |
| `aria-description` | Override keyboard instructions for application-owned actions | Standard scroll/copy instructions |
| `testId` | Viewport test ID; native content uses `${testId}-content` | — |

Native measurement accounts for font shaping and visible rows; hidden filenames
and patch metadata never widen the pane. Short backgrounds fill the viewport;
long lines scroll horizontally without wrapping. Measurements are reused while
scrolling or recoloring. Rendering remains one native host node, not a React node
per diff line. Do not put this bounded viewer inside another vertical scroller.

Tab focuses the viewer; arrows, Page Up/Down, Space and Home/End scroll. Drag-select
and Command+C copy code without gutters. Pass `key={comparisonId}` when a new
file/comparison should reset viewport state. The app remains responsible for
patch-size limits, loading, errors, binary-file notices and any Git operations.
Context expansion is opt-in and distinct from `maxLines` truncation. Hunk separators
with omitted lines become clickable only when `onExpandContext` is set, keeping
their original text and styling.
The native element never reads repository files. The app can use `onShortcut` to
provide an equivalent keyboard action (1git uses **E**).
New text files start at the hunk without a "New file" status row. Empty and
binary files, renames and mode changes retain their useful native notices.

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
| `onContextMenu` | `(event: EventPayload) => void`; right-click, Control-click, or Shift-F10, without primary activation | — |
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

A controlled checkbox with an optional clickable `label`. The box and label share
one focus target and toggle once from either area. Without a visible label, provide
`aria-label`. It has no internal checked state or Git-specific behavior.

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

```tsx
<Checkbox
  label="Include untracked files"
  checked={includeUntracked}
  onCheckedChange={setIncludeUntracked}
  tokens={tokens}
/>
```

With `label`, `style` applies to the whole row; text inherits its font and color.
An explicit `aria-label` overrides the visible label's accessible name.

| Prop | Values / purpose | Default |
| --- | --- | --- |
| `checked` | Required `boolean` or `"indeterminate"` | — |
| `onCheckedChange` | Required `(checked: boolean) => void`; mixed activates to `true` | — |
| `label` | Optional visible, clickable text; also supplies the accessible name | — |
| `aria-label` | Accessible name override; required without `label` | `label` |
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
| `size` | `2xs` (9px), `xs` (10px), `sm` (11px), `md` (12px), `lg` (14px), `xl` (18px), `2xl` (20px), each with paired leading | `md` |
| `tone` | `default`, `muted`, `danger` | `default` |
| `weight` | `regular` (400), `medium` (500), `semibold` (600), `bold` (700) | `regular` |
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
- `defaultTokens`: `palettes.dark` with `densities.comfortable`. Treat this as
  immutable, not a global theme setter.

Typography, radii, spacing, icon/control dimensions and the density definitions
live in `@1git/design-tokens`. Import them directly into `StyleSheet.create`;
there is no runtime theme context. Body text, fields and generated button labels
use the compact desktop `md` preset (12px / 18px leading). See the
[shared scale guide](../design-tokens/README.md) for the complete API and CSS names.

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
the small or medium button within the chosen density. Typography and radii use
the shared defaults; popup limits remain component geometry. Caller styles still
override defaults. No automatic system-theme detection is implemented.

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
