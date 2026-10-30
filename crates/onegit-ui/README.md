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
| `TextInput` | Single-line editing, label, placeholder, description, validation, sizes |
| `SearchField` | Single-line search, search glyph, undoable clear action, Escape to clear |
| `TextArea` | Soft-wrapped multiline editing, visible rows and vertical scrolling |
| `Tooltip` | Delayed hover or immediate focus hint, optional shortcut caption, Escape dismissal |
| `DropdownMenu` | Branch choices and actions, icons, shortcut captions, separators, disabled/danger states |
| `Dialog` | Standard/confirmation modal, title/description, body/footer, initial focus, busy and dismissal policies |
| `Tabs` | Underline/segmented variants, sizes, disabled and closable tabs, controlled selection and panel |
| `DiffViewer` | Immutable patch document, old/new line numbers, unified/split modes and synchronized virtualized rows |
| `ResizableSplit` | Horizontal/vertical panes, minimum sizes, retained dimensions and keyboard divider |
| `Toast` / `ToastHost` | Success/error/progress feedback, action/dismissal, bounded stack, paused expiration and live regions |

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

## Native inputs

Create one `Entity<InputState>` per logical field outside render and retain it in
the owner. A state belongs to its construction window and must be mounted in only
one field at a time. Selection, composition, scroll position and undo history live
in that entity, so ordinary rerenders and theme changes preserve editing state.
Install `Theme` before creating the state, as for other components.

```no_run
use onegit_ui::{InputState, TextInput};
use rake::gpui::{App, AppContext, Entity, IntoElement, Window};

fn create_field(window: &mut Window, cx: &mut App) -> Entity<InputState> {
    cx.new(|cx| InputState::new("feature/native-inputs", window, cx))
}

fn field(state: &Entity<InputState>) -> impl IntoElement {
    rake::view! {
        <TextInput placeholder={"feature/my-change".into()}
            {..TextInput::new("branch", state, "Branch name")}/>
    }
}
```

`SearchField::new` and `TextArea::new` take the same identity, state and label.
All three expose `show_label`, `placeholder`, `description`, `size`, `availability`
and `validation`. Labels remain accessible when hidden. `TextArea` also exposes
`rows` (default five, minimum one). The application supplies
`InputValidation::Invalid(message)`; validation never blocks editing.

Subscribe once with `cx.subscribe(&state, |owner, state, event, cx| ...)`, and retain
the subscription. `InputEvent::Changed` means the value changed, including native
composition updates; read `state.read(cx).text()` for the value.
`InputEvent::Submitted` means Enter in a single-line field or Cmd+Enter on macOS /
Ctrl+Enter on Windows and Linux in a text area. Enter adds a line in `TextArea`.
Submission is suppressed while an IME is accepting a candidate.

Navigation, Shift selection, word/line movement, mouse selection, clipboard and
undo/redo share the same Unicode buffer. Arrow movement and deletion respect
extended graphemes such as composed accents and family emoji. Native IME queries
use UTF-16 ranges; application `selection()` / `select(...)` use UTF-8 byte offsets.
Undo retains up to 100 edits; one composition transaction is one undo step.
`set_text(...)` replaces the application value and resets history;
`clear(...)` is an undoable user edit. Single-line fields convert pasted or
programmatically supplied line breaks to spaces; text areas preserve them.

`InputAvailability::ReadOnly` permits focus, selection and copying, while
`Disabled` blocks editing and skips Tab. Search clearing is disabled in either
state. Escape clears a non-empty editable search; an empty search leaves Escape to
its parent. The clear action returns focus to the editor. Multiline fields scroll
and wrap at the available width; the active caret is kept visible. Only the focused
field in the active window runs a caret timer. Text, caret and selection updates
are immediate, independent of decorative animation settings.

The **Inputs** gallery section includes live filtering, a commit message, submit
counts, validation, read-only and disabled examples, and a reset action. These are
local sample values. Inputs are designed for short form text and commit messages.

## Tooltips and dropdown menus

Wrap a single control in `Tooltip`. The hint opens after 350 ms of hover or
immediately on keyboard focus, stays open while the pointer enters its surface,
and closes on Escape, activation, outside clicks or blur. It never takes focus.
`text` adds a description; the wrapped control still needs a meaningful accessible
name. `shortcut` is an optional display caption, not a key binding.

```no_run
use onegit_ui::{DropdownMenu, IconButton, IconName, MenuEntry, MenuItem, Tooltip};
use rake::gpui::IntoElement;

fn refresh() -> impl IntoElement {
    rake::view! {
        <Tooltip {..Tooltip::new("refresh-hint", "Refresh repository status")}>
            <IconButton {..IconButton::new("refresh", IconName::Refresh, "Refresh repository")}/>
        </Tooltip>
    }
}

fn branches() -> impl IntoElement {
    let entries = vec![
        MenuItem { selected: Some(true), ..MenuItem::new("main", "main") }.into(),
        MenuItem { selected: Some(false), ..MenuItem::new("feature", "feature/native-ui") }.into(),
        MenuEntry::Separator,
        MenuItem::new("create", "Create branch…").into(),
    ];
    rake::view! {
        <DropdownMenu entries={entries} icon={Some(IconName::Branch)}
            {..DropdownMenu::new("branches", "main")}/>
    }
}
```

`DropdownMenu` owns transient UI state under its stable `id`; no retained state
must be created by the host. Item IDs must be unique within a menu. `on_select`
receives the enabled item's `ElementId` once, after dismissal and focus restoration.
The application updates `MenuItem::selected` and the trigger label for controlled
branch choices. `None` means a plain action; `Some(false/true)` means an unchecked /
checked mutually exclusive choice. `tone`, `disabled`, `icon` and `shortcut` describe
individual entries. Shortcut captions do not install bindings.

Enter/Space opens the menu. Down opens at the checked item (or first enabled item),
Up opens at the last. Within the menu, Up/Down wrap through enabled items, Home/End
jump, typing finds a label, and Enter/Space activates. Repeated initial letters
cycle matches; the search prefix resets after 700 ms. Escape restores trigger focus;
Tab dismisses and continues to the previous/next control. Outside clicks dismiss and
are consumed. Switching focus elsewhere preserves that new focus. Disabled/busy
triggers cannot open and skip Tab.

Popups use the installed palette, small corners, compact rows and a subtle shadow.
`MenuAlignment::End` aligns file actions to their trigger's trailing edge. Width and
height are capped to the window, long menus scroll, and keyboard navigation reveals
the active row. Deferred native rendering avoids scroll-container clipping. Ordinary
rerenders/theme switches preserve open state and navigation; unmounting releases it.
There is no continuous overlay timer or transition loop. Trigger resizing reuses the
same 120 ms measured animation as buttons; focus, selection and dismissal are immediate.
The **Menus & hints** gallery demonstrates branch choices and file actions on local
sample state. It performs no repository mutations.

## Dialogs

Create one `DialogHostState` in the window owner and one retained `DialogState`
entity for each logical dialog. Mount `DialogHost` at the window root. Put the
normal application view and its background key contexts in `body`; mount dialogs
as sibling children. The host hides the background from assistive technology,
blocks pointer interaction with a scrim, and contains keyboard focus in the modal.
Only one dialog is open per host: opening another replaces the first and inherits
its original return-focus target. This is a replacement flow, not a nested dialog stack.

```no_run
use onegit_ui::{Button, Dialog, DialogHost, DialogHostState, DialogState};
use rake::gpui::{Context, Entity, IntoElement};

fn retained<T: 'static>(cx: &mut Context<T>) -> (DialogHostState, Entity<DialogState>) {
    let host = DialogHostState::new(cx);
    let dialog = host.dialog(cx);
    (host, dialog)
}

fn content(host: &DialogHostState, dialog: &Entity<DialogState>) -> impl IntoElement {
    let open = dialog.clone();
    let close = dialog.clone();
    let body = rake::view! {
        <Button on_press={Some(Box::new(move |_, window, cx| {
            open.update(cx, |state, cx| { state.open(window, cx); });
        }))} {..Button::new("open", "Create branch")}/>
    }.into_any_element();
    let footer = rake::view! {
        <Button on_press={Some(Box::new(move |_, window, cx| {
            close.update(cx, |state, cx| { state.close(window, cx); });
        }))} {..Button::new("cancel", "Cancel")}/>
    }.into_any_element();
    rake::view! {
        <DialogHost state={host.clone()} body={body}>
            <Dialog footer={Some(footer)} {..Dialog::new("create", dialog, "Create branch")}>
                <p>"Your retained input or form goes here."</p>
            </Dialog>
        </DialogHost>
    }
}
```

Keep dialogs mounted while the host exists; closed dialogs render no surface.
Removing a mounted open dialog closes it during frame reconciliation.
`DialogEvent::Closed` fires once per open-to-closed transition, including replacement
or unmount. The host automatically redraws its owner when modal state changes;
subscribe separately only for application lifecycle reactions. Values, validation
and asynchronous work remain application-owned. Closing never starts or cancels work.

`initial_focus` may target a retained input's `Focusable::focus_handle(...)` or a
`Button`'s optional `focus` handle. After mount, the dialog focuses that target if
present, otherwise its first focusable control. Confirmations should start on the
safe action, such as **Keep changes**. Tab and Shift+Tab wrap, including when a child
moves focus directly; a modal with no controls keeps focus on its surface. Child
controls get the first opportunity to handle keys, so Escape closes an open dropdown
before it closes the dialog. Closing restores a still-mounted opener, or the host's
mounted application fallback if the opener disappeared. Theme changes preserve focus
and retained form state.

`DialogKind::Confirmation` announces an alert dialog; footer buttons independently
choose their semantic tone. `DialogDismissal::Escape` is the default: Escape and the
close button dismiss while outside clicks are consumed. `EscapeAndOutside` also
allows outside-click dismissal; `Explicit` hides the close button and requires an
application-owned action. `DialogAvailability::Busy` suppresses all incidental
dismissal and announces busy state. The application also disables its Cancel/action
buttons and input editing while work is pending. Explicit `DialogState::close` remains
available to complete or recover from work.

The panel defaults to 440 logical pixels and is capped to the window with 16-pixel
margins. The body scrolls independently of the header and footer. Presentation uses
the same compact typography, borders, corners and palette as the other controls.
Opening, focus changes and dismissal are immediate; buttons retain their existing
fast feedback and size animations. No dialog polling loop or animation timer runs.

The **Dialogs** gallery includes Create branch validation and a Discard changes
confirmation for two sample files. **Simulate a slow operation** demonstrates busy
states with a short local delay. These examples never modify a repository; their
simple branch-name checks demonstrate UI validation rather than Git's full ref rules.

## Tabs and resizable layouts

`Tabs` owns transient focus and scroll state under its stable `id`. The application
owns `items`, `selected`, and the active `children` panel. Both `Underline` and
`Segmented` variants use the shared control sizes and palette. IDs must be unique.

```no_run
use onegit_ui::{TabHandler, TabItem, Tabs, Text};
use rake::gpui::{ElementId, IntoElement};

fn previews(selected: ElementId, choose: TabHandler, close: TabHandler) -> impl IntoElement {
    let items = vec![
        TabItem::new("changes", "Changes"),
        TabItem { closable: true, ..TabItem::new("readme", "README.md") },
    ];
    rake::view! {
        <Tabs selected={Some(selected)} on_select={Some(choose)} on_close={Some(close)}
            {..Tabs::new("previews", "Repository previews", items)}>
            <Text {..Text::new("content", "The owner supplies the selected preview.")}/>
        </Tabs>
    }
}
```

Tab enters the selected enabled tab, or the first enabled tab if selection is
missing. Left/Right wrap through enabled items; Home/End jump. Navigation focuses
and requests selection immediately. Enter/Space on an already selected tab emits
no duplicate callback. Delete requests closing a focused closable tab; its pointer
close action is separate and never selects the tab. Closers are exposed to assistive
technology; keyboard users use Delete. Disabled items cannot select or close.
Tab leaves the strip for the active panel, whose content keeps normal keyboard input.

Callbacks receive stable IDs and run outside retained-state borrows. `on_close`
does not remove items: the owner chooses the new list and selection. Removing or
disabling the focused tab moves focus to a nearby enabled item, or the list scope
when none remain. Missing/disabled selections show the optional `empty` slot instead
of an active tab panel. Changing the theme, variant or item order preserves identity.
The strip scrolls horizontally and keyboard navigation reveals the focused item.
Retain input entities in the owner when their inactive panels should keep edits.

`ResizableSplit` fills a bounded parent and accepts arbitrary `first` / `second`
slots. `SplitAxis::Horizontal` arranges panes side by side; `Vertical` stacks them.
Create one retained `SplitState` per split, in its owning window:

```no_run
use onegit_ui::{ResizableSplit, SplitState, Text};
use rake::gpui::{App, AppContext, Entity, IntoElement, Window, px};

fn retained(window: &mut Window, cx: &mut App) -> Entity<SplitState> {
    cx.new(|cx| SplitState::new(px(220.), window, cx))
}

fn workspace(state: &Entity<SplitState>) -> impl IntoElement {
    let sidebar = rake::view! {<Text {..Text::new("sidebar", "Repository")}/>}.into_any_element();
    let preview = rake::view! {<Text {..Text::new("preview", "Selected file")}/>}.into_any_element();
    rake::view! {
        <div class="w-full h-[400px]">
            <ResizableSplit first={sidebar} second={preview} min_first={px(140.)} min_second={px(200.)}
                {..ResizableSplit::new("workspace", state, "Repository sidebar width")}/>
        </div>
    }
}
```

Drag the six-pixel divider, or focus it with Tab. Arrows along its resize axis move
10 logical pixels; Shift moves 40, and Home/End reach the available limits. Escape
cancels a drag and restores its original preference. Pointer capture follows the
drag outside moving hitboxes; window deactivation, disabling, changing axis,
unmounting, or shrinking below the combined minimums cancels it. `disabled` skips resizing and sequential keyboard navigation.
The accessible divider exposes its orientation, size, bounds and adjustment actions.

`min_first` and `min_second` constrain both panes. If the parent cannot fit both
minimums, the panes share the available space proportionally without overflowing.
Shrinking a window does not overwrite the preferred size; widening it restores that
preference when possible. `size()` reads the effective size after layout, and
`resize(...)` changes the preference within current limits. Nonfinite/negative inputs
become zero before constraints apply. Subscribe to `SplitEvent::Resized` to save
user/API size changes; viewport changes alone do not emit preference changes.
Persistence belongs to the application. Mount each state in only one split.

Resizing follows the pointer immediately, including nested splits. Only divider/tab
hover feedback uses the shared 80 ms color motion; neither geometry nor text is
stretched. Reduced motion is respected and settled layouts schedule no frames.
The **Layout** gallery combines a repository sidebar, selectable/includable files,
closable preview tabs, a disabled tab and an editable commit message. It demonstrates
both split orientations, both tab variants, pane-size reset and reopening closed files.
The example uses local sample values and makes no Git calls.

## Toasts

Retain one `Entity<ToastState>` per window, created outside render, and mount one
`ToastHost` for it. Pass the normal application's mounted focus scope as the
fallback. With dialogs, mount the host **after** the dialog components inside
`DialogHost` and set `paused` while a modal is open. Notifications remain visible
above the scrim, but their controls are hidden and expiration pauses so they do
not compete with modal focus.

```no_run
use onegit_ui::{Toast, ToastHost, ToastKind, ToastState};
use rake::gpui::{App, AppContext, Entity, FocusHandle, IntoElement, Window};

fn retained(window: &mut Window, cx: &mut App) -> Entity<ToastState> {
    cx.new(|cx| ToastState::new(window, cx))
}

fn show_progress(state: &Entity<ToastState>, window: &mut Window, cx: &mut App) {
    let id = state.update(cx, |state, cx| {
        state.show(Toast::new(ToastKind::Progress, "Fetching branches…"), window, cx)
    });
    // The application's operation publishes this update when it finishes.
    state.update(cx, |state, cx| {
        let _ = state.update(id, Toast::new(ToastKind::Success, "Branches fetched"), window, cx);
    });
}

fn notifications(state: &Entity<ToastState>, application_focus: &FocusHandle) -> impl IntoElement {
    rake::view! {
        <ToastHost {..ToastHost::new("notifications", state, application_focus)}/>
    }
}
```

`Toast::new(kind, title)` supplies the default lifetime. Success expires after five
seconds of active display; error and progress remain until dismissed, updated or
displaced by a newer notification. `description`, `action` and `lifetime` are typed
properties. `ToastLifetime::Timed(duration)` customizes expiration and `Persistent`
disables it. Progress uses the native work glyph without a continuous animation
or an inferred percentage.

`show` returns a `ToastId`. Update that ID to resolve progress in place; an update
restarts the lifetime while keeping the card and control focus handles stable.
`get`, `len` and `is_empty` expose current content. `update` returns false for stale
IDs and never resurrects dismissed/expired feedback. Dismissing progress never
cancels its application operation. `clear` removes notifications without invoking
their callbacks. One state belongs to its construction window and one mounted host.

The bottom-right stack holds at most three cards. At capacity it displaces the
oldest unfocused timed card, otherwise the oldest unfocused card. Focused and
currently dragged cards are protected. This is transient feedback rather than notification history; important
failures must also remain in application state. Width defaults to 340 logical
pixels, capped to the window with 16-pixel margins; short windows can scroll the stack.
Titles and descriptions are visually limited to two/three lines while accessibility
retains their full contents.

Expiration pauses across the whole stack during hover, dragging, keyboard focus,
an inactive window, a modal (`paused`), or host unmount. Remounting resumes the remaining time.
One deadline task services timed cards and retires brief exit presentations;
settled persistent-only and idle stacks have no task or polling loop. Show and update do not move focus into a toast.
If an update removes a currently focused action, focus moves to that card's dismiss
button. Escape or dismissal of a focused card moves to the next card, then restores
a still-mounted application target or the provided fallback when the stack is empty.
Pointer dismissal of an unfocused card preserves the current application focus.

`ToastAction::new(label, callback)` is optional. The card is removed and focused
controls are restored **before** the callback runs, so recovery can publish another
toast safely. It runs once on activation, never on timeout or ordinary dismissal.
Success/progress use polite native status live regions; errors use assertive alerts.
Announcements do not request keyboard focus. The host supplies no global Escape
handler, so unrelated controls retain their own dismissal behavior.

Drag the card body horizontally to dismiss it in either direction. Small pulls
settle back with a brief overshoot; vertical gestures yield to stack scrolling.
Recovery and dismiss buttons operate independently of dragging. Pointer capture
keeps a pull attached outside the card; losing activation, opening a modal, or
unmounting cancels it. Dismissal takes effect immediately for IDs, focus and actions;
a noninteractive, accessibility-hidden presentation finishes its 120 ms exit.
Entrance and snap-back take 160 ms, and stack positions follow in 140 ms. Native
GPUI offsets move paint and hitboxes together without stretching text. Reduced
motion snaps transitions, and settled cards stop requesting animation frames.

The **Toasts** gallery has standalone states and progress resolution controls. Its
adjacent Create branch / Discard changes dialogs publish progress and resolve the
same notification after the sample operation. **Simulate a failed operation** creates
an error with Retry; retry reruns the sample operation successfully. **Simulate a slow
operation** makes its progress visible. No repository or network operation runs.

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

## Read-only diffs

Parse a single-file unified patch once when data changes and retain the resulting
`DiffDocument` in the owner. Cloning a document shares its immutable data. The
viewer has no Git dependency; loading patches and handling parse errors belong to
the application. Pass a stable viewer ID and a parent with bounded height.

```no_run
use onegit_ui::{DiffDocument, DiffParseError, DiffView, DiffViewer};
use rake::gpui::IntoElement;

fn load_patch(patch: &str) -> Result<DiffDocument, DiffParseError> {
    DiffDocument::parse(patch)
}

fn preview(document: &DiffDocument, view: DiffView) -> impl IntoElement {
    rake::view! {
        <div class="h-[360px] min-w-0">
            <DiffViewer view={view}
                {..DiffViewer::new("preview", "theme.rs", document.clone())}/>
        </div>
    }
}
```

Unified mode has separate old/new number gutters. Split mode pairs deleted and
added lines in each contiguous change block, leaving blank cells for unequal
counts. It does not attempt semantic or intra-line matching. Context, hunk headers
and metadata appear on both sides. Both axes scroll together; only visible rows
are rendered. The widest source row sets the horizontal extent, so long lines
scroll without wrapping. Changing mode anchors near the same source line;
replacing the document resets scroll. Retain the same document across ordinary
rerenders and theme changes to preserve position.

Tab or a pointer click focuses the viewer. Up/Down, Page Up/Down and Home/End
navigate rows; scroll wheel/trackpad handles both axes. Accessible row descriptions
include change kind, coordinates, raw source text and missing-final-newline state.
Color is supplemented by +/− markers. Tabs and CR characters are shown as `→` and
`␍`; `lines()` and `patch()` retain the exact source text for application-owned copy
actions. This is a read-only surface with no text selection, editing or staging.

The parser validates hunk counts and ranges, supports additions/deletions, binary
notices and metadata-only changes, and rejects combined or multiple-file patches.
Budgets are 16 MiB per patch, 200,000 patch lines and 64 KiB per line. Binary payloads
are retained in `patch()` but are not displayed as text. Pass files separately and
show parse errors in the surrounding application UI.

The gallery's **Diffs** section covers unequal replacements, multiple hunks,
Unicode/CR/newline markers, 5,000 replacements, binary changes and an empty state.
The repository layout also uses the same viewer inside its retained file tabs.

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

Repository history and application integration are subsequent slices. No changeset is needed for this unreleased Rust crate
(`publish = false`).
