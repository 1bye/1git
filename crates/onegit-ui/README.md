# onegit-ui

Reusable native 1git controls on Rake and GPUI. The compact palette and geometry
refine the existing desktop design. This crate has no Git, application-service,
storage or network dependency of its own.

## Run the gallery

```sh
cargo run -p onegit-ui --example gallery --locked
```

The native gallery includes light/dark switching, primary/secondary/ghost actions,
normal/destructive tones, borderless secondary actions, 24/28/34-pixel sizes, disabled/busy states, native path
icons, independent row/checkbox selection, mixed selection and long Unicode labels.
Its actions only update sample entity state. Sections reflow to one column in a
narrow window. No assets need to be installed or registered for the built-in icons.

## Compose with typed properties

Enable Rake's `experimental-view` feature. Declare the shared theme type at the
root of each crate using named theme classes. Install a palette once on the UI
thread before constructing views; use `install` again when appearance changes.
The UI crate declares the same type internally, so app and library share one theme.

```no_run
use onegit_ui::{Button, ButtonVariant, Pane, Text, TextRole, Theme};
use rake::gpui::{App, IntoElement};

rake::theme!(Theme);

fn setup(cx: &mut App) {
    Theme::dark().install(cx);
}

fn content() -> impl IntoElement {
    rake::view! {
        <Pane header={Some(rake::view! { <Text role={TextRole::Title} {..Text::new("title", "Changes")}/> }.into_any_element())}
            {..Pane::new("changes")}>
            <Text {..Text::new("summary", "Review the selected changes.")}/>
            <Button variant={ButtonVariant::Primary}
                {..Button::new("commit", "Commit changes")}/>
        </Pane>
    }
}
```

Uppercase tags construct ordinary Rust structs. Public presentation fields are
typed properties; `{..Component::new(...)}` supplies defaults. There is no implicit
builder lookup, string-based variant selection or automatic callback boxing.
Callbacks use `Some(Box::new(cx.listener(...)))` or ordinary native GPUI closures.
Forward stable IDs derived from data when repeating components; every constructor
requires an ID, and direct loop-root components must also have an explicit `id` prop.

## First component set

| Component | Properties |
| --- | --- |
| `Text` | Body/caption/title/heading/code, semantic tone, optional line limit |
| `Icon` | Built-in line glyph, 12/16/20-pixel size, optional accessible label |
| `Button` | Primary/secondary/ghost, normal/danger tone, 24/28/34-pixel size, leading icon |
| `IconButton` | Same action variants, square geometry, required accessible action label |
| `Checkbox` | Unchecked/checked/mixed, optional visible label, controlled change callback |
| `ListRow` | Label/description, leading/trailing slots, independent selection and activation |
| `Pane` | Header/body/footer slots and standard or edge-to-edge body padding |

`ControlState::{Enabled, Disabled, Busy}` prevents contradictory availability flags.
Busy actions retain their label and show a work glyph; no percentage or completion
is inferred. Unavailable controls suppress activation and skip sequential Tab.
Keyboard focus stays visible and distinct from row selection. Secondary buttons have
no visible resting border; the focus outline remains available. Icon actions need a
meaningful `label`; decorative icons inside controls have no redundant label.

Checkbox changes request a value through `on_change`; the owner updates its state
and calls `cx.notify()`. Mixed toggles to checked. `ListRow` puts interactive slots
beside its main button, so checking a file does not activate the viewed row. Slot
controls own their availability independently of the row's main action.

## Motion

Buttons, checkbox fills and row selection use `gpui-ce-motion` 0.4 with interruptible
80 ms ease-out color transitions. Hovering any part of a row highlights the full
line, including its passive icon and interactive slots. Checkbox and icon actions
also have local hover/press feedback. Activation and inclusion stay independent.

The portable motion engine samples on the CPU; native GPUI paints through its GPU
renderer. No claim is made that interpolation runs in GPU compute shaders. The
crate's optional native adapter targets registry `gpui-ce`, whereas Rake pins git
`gpui_ce`; a private element bridge avoids introducing a second renderer. Animation
history is retained in GPUI's scoped element state under each stable component ID,
and released on unmount. There are no per-control timers or background tasks.

Hover/press feedback changes paint colors without moving hit targets. When button
labels, icons, busy indicators or `ControlSize` change, width and height animate to
measured native content dimensions in 120 ms, with no spring overshoot. The real
layout, background and hit target resize together; text is not scaled. New controls
mount at their natural size immediately. Retain the same component ID when its
content changes. Parent width limits remain authoritative. The gallery's **Commit**
button demonstrates expanding and shrinking; interrupted changes continue from
the current dimensions. Frame requests stop when transitions settle. The native Reduced Motion
setting snaps to the destination and requests no further animation frames. The
gallery's **Reduce motion** control can exercise this policy without changing OS
settings. Keyboard focus remains immediate and visible.

Components use `RenderOnce` and are rebuilt during rendering. Keep editors, focus
handles, scroll handles, mutable application data and any future overlay state in
retained caller-owned entities. Do not create retained controls during render.

`Theme` owns semantic colors, 4-pixel control corners, paired typography and the
monospace font. Palette switching changes colors without changing geometry or
clearing entity state. Colors, typography and font may be customized before install.
Following system appearance and saving preferences belong to the application.

Rake is pinned to a committed remote revision with view defaults, themes and style
presets. Its experimental API is part of this crate's compatibility boundary.
This replaces the earlier GPUI-only stub: hosts now install `Theme`, use `ink` for
foreground color, and consume typed properties rather than per-button theme copies.

## Development frame rates

The workspace development profile optimizes `gpui_ce`, `rake-ui`, `onegit-ui` and
`gpui-ce-motion`, while application code keeps its normal debug profile. An entirely
unoptimized UI stack spends too much time in CPU layout even though painting uses
the GPU. Rebuild the gallery after changing these profile settings; the first build
of optimized dependencies takes longer. A shorter transition duration does not
make expensive frames render faster.

GPUI also caps animation in an inactive window at about 30 FPS. Focus the gallery
when assessing motion smoothness. An idle event-driven window does not continually
redraw, so idle frame counts do not measure animation performance.

## Validation

```sh
cargo fmt -p onegit-ui -p onegit-app --check
cargo test -p onegit-ui --all-features --locked
cargo clippy -p onegit-ui -p onegit-app --all-targets --all-features --locked -- -D warnings
cargo doc -p onegit-ui --no-deps --locked
```

`test-support` enables Rake/GPUI's deterministic test platform. Interaction tests
exercise real component rendering and pointer/keyboard dispatch with a doubled
window/text/GPU backend; they do not establish native screen-reader behavior.
The gallery provides the native appearance and interaction check.

Text editing/IME, menus, popovers, dialogs, split panes and virtualized diff/history
views are subsequent slices. No changeset is needed for this unreleased Rust crate
(`publish = false`).
