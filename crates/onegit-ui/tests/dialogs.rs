//! Public modal composition, focus, input and pointer dispatch on GPUI's test platform.
use onegit_ui::{
    Button, ControlState, Dialog, DialogAvailability, DialogDismissal, DialogEvent, DialogHost,
    DialogHostState, DialogKind, DialogState, DropdownMenu, InputState, MenuItem, TextInput, Theme,
};

use rake::gpui::{self, Focusable, InputEvent as _, prelude::*, px};

rake::theme!(Theme);

gpui::actions!(
    dialog_tests,
    [
        /// Background-only action used to verify modal key-context isolation.
        BackgroundAction
    ]
);

struct Workbench {
    host: DialogHostState,
    dialog: gpui::Entity<DialogState>,
    second: gpui::Entity<DialogState>,
    input: gpui::Entity<InputState>,
    root: gpui::FocusHandle,
    opener: gpui::FocusHandle,
    cancel: gpui::FocusHandle,
    show_opener: bool,
    show_dialog: bool,
    busy: bool,
    dismissal: DialogDismissal,
    confirmation: bool,
    with_menu: bool,
    long_body: bool,
    background: usize,
    accepted: usize,
    closed: usize,
    _subscription: gpui::Subscription,
}

impl Render for Workbench {
    fn render(&mut self, _: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let body=rake::view! {
            <div class="size-full flex flex-col items-start" focus={&self.root} tab-navigation={true} key-context="Background"
                on:BackgroundAction={cx.listener(|this,_,_,cx|{this.background+=1;cx.notify();})}>
                if self.show_opener {<Button focus={Some(self.opener.clone())} on_press={Some(Box::new(cx.listener(|this,_,w,cx|{this.dialog.update(cx,|state,cx|{state.open(w,cx);});})))} {..Button::new("open","Open dialog")}/>}
                <Button on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.background+=1;cx.notify();})))} {..Button::new("after","Background action")}/>
            </div>
        }.into_any_element();

        let footer=rake::view! {
            <div class="flex flex-row gap-2">
                <Button focus={Some(self.cancel.clone())} state={if self.busy{ControlState::Disabled}else{ControlState::Enabled}}
                    on_press={Some(Box::new(cx.listener(|this,_,w,cx|{this.dialog.update(cx,|state,cx|{state.close(w,cx);});})))} {..Button::new("cancel","Cancel")}/>
                <Button state={if self.busy{ControlState::Busy}else{ControlState::Enabled}} on_press={Some(Box::new(cx.listener(|this,_,w,cx|{
                    this.accepted+=1;this.dialog.update(cx,|state,cx|{state.close(w,cx);});cx.notify();
                })))} {..Button::new("accept","Accept")}/>
            </div>
        }.into_any_element();

        rake::view! {
            <DialogHost state={self.host.clone()} body={body}>
                if self.show_dialog {
                    <Dialog footer={Some(footer)} width={px(300.)} dismissal={self.dismissal} kind={if self.confirmation{DialogKind::Confirmation}else{DialogKind::Standard}}
                        availability={if self.busy{DialogAvailability::Busy}else{DialogAvailability::Ready}}
                        initial_focus={Some(if self.confirmation{self.cancel.clone()}else{self.input.read(cx).focus_handle(cx)})}
                        {..Dialog::new("dialog",&self.dialog,"Example dialog")}>
                        <TextInput {..TextInput::new("name",&self.input,"Branch name")}/>
                        if self.with_menu {
                            <DropdownMenu entries={vec![MenuItem::new("choice","Choice").into()]} {..DropdownMenu::new("inside","Inside menu")}/>
                        }
                        if self.long_body {for index in 0_usize..40 {<p id={("line",index)} style={|s|s.h(px(30.)).flex_shrink_0()}>"Long modal content"</p>}}
                    </Dialog>
                }
                <Dialog {..Dialog::new("second",&self.second,"Replacement dialog")}><p>"Second dialog"</p></Dialog>
            </DialogHost>
        }
    }
}

fn setup() -> (gpui::TestAppContext, gpui::WindowHandle<Workbench>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| {
        Theme::dark().install(cx);
        cx.bind_keys([gpui::KeyBinding::new(
            "b",
            BackgroundAction,
            Some("Background"),
        )]);
    });
    let view = cx.open_window(gpui::size(px(500.), px(400.)), |w, cx| {
        let host = DialogHostState::new(cx);
        let dialog = host.dialog(cx);
        let second = host.dialog(cx);

        let subscription = cx.subscribe(&dialog, |this: &mut Workbench, _, event, cx| {
            if *event == DialogEvent::Closed {
                this.closed += 1;
                cx.notify();
            }
        });

        let root = cx.focus_handle();

        w.focus(&root, cx);
        w.activate_window();

        Workbench {
            host,
            dialog,
            second,
            input: cx.new(|cx| InputState::new("feature/ui", w, cx)),
            root,
            opener: cx.focus_handle(),
            cancel: cx.focus_handle(),
            show_opener: true,
            show_dialog: true,
            busy: false,
            dismissal: DialogDismissal::Escape,
            confirmation: false,
            with_menu: false,
            long_body: false,
            background: 0,
            accepted: 0,
            closed: 0,
            _subscription: subscription,
        }
    });

    draw(&mut cx, view);

    (cx, view)
}

fn draw(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Workbench>) {
    for _ in 0..2 {
        cx.run_until_parked();
        cx.update_window(v.into(), |_, w, cx| w.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

fn key(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Workbench>, value: &str) {
    cx.update_window(v.into(), |_, w, cx| {
        let keystroke = gpui::Keystroke::parse(value).unwrap();

        w.dispatch_event(
            gpui::KeyDownEvent {
                keystroke: keystroke.clone(),
                is_held: false,
                prefer_character_input: false,
            }
            .to_platform_input(),
            cx,
        );
        w.dispatch_event(gpui::KeyUpEvent { keystroke }.to_platform_input(), cx);
    })
    .unwrap();
    draw(cx, v);
}

fn click(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Workbench>, x: f32, y: f32) {
    cx.update_window(v.into(), |_, w, cx| {
        let position = gpui::point(px(x), px(y));

        w.dispatch_event(
            gpui::MouseMoveEvent {
                position,
                pressed_button: None,
                modifiers: Default::default(),
            }
            .to_platform_input(),
            cx,
        );
        w.dispatch_event(
            gpui::MouseDownEvent {
                position,
                button: gpui::MouseButton::Left,
                modifiers: Default::default(),
                click_count: 1,
                first_mouse: false,
            }
            .to_platform_input(),
            cx,
        );
        w.dispatch_event(
            gpui::MouseUpEvent {
                position,
                button: gpui::MouseButton::Left,
                modifiers: Default::default(),
                click_count: 1,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(cx, v);
}

fn open(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Workbench>) {
    key(cx, v, "tab");
    key(cx, v, "enter");
    assert!(
        v.read_with(cx, |v, cx| v.dialog.read(cx).is_open())
            .unwrap()
    );
}

fn is_open(cx: &gpui::TestAppContext, v: gpui::WindowHandle<Workbench>) -> bool {
    v.read_with(cx, |v, cx| v.dialog.read(cx).is_open())
        .unwrap()
}

#[test]
fn initial_focus_escape_restoration_and_close_notification_are_stable() {
    let (mut cx, v) = setup();

    open(&mut cx, v);
    assert!(
        v.update(&mut cx, |v, w, cx| v
            .input
            .read(cx)
            .focus_handle(cx)
            .is_focused(w))
            .unwrap()
    );
    key(&mut cx, v, "escape");
    assert!(!is_open(&cx, v));
    assert!(v.update(&mut cx, |v, w, _| v.opener.is_focused(w)).unwrap());
    assert_eq!(v.read_with(&cx, |v, _| v.closed).unwrap(), 1);
    v.update(&mut cx, |v, w, cx| {
        assert!(!v.dialog.update(cx, |s, cx| s.close(w, cx)));
    })
    .unwrap();
    key(&mut cx, v, "enter");
    assert!(is_open(&cx, v));
    assert_eq!(
        v.read_with(&cx, |v, cx| v.input.read(cx).text().to_owned())
            .unwrap(),
        "feature/ui"
    );
}

#[test]
fn tab_wraps_and_confirmation_starts_on_the_safe_action() {
    let (mut cx, v) = setup();

    v.update(&mut cx, |v, _, cx| {
        v.confirmation = true;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    open(&mut cx, v);
    assert!(v.update(&mut cx, |v, w, _| v.cancel.is_focused(w)).unwrap());

    for key_name in [
        "tab",
        "tab",
        "tab",
        "tab",
        "shift-tab",
        "shift-tab",
        "shift-tab",
        "shift-tab",
    ] {
        key(&mut cx, v, key_name);
        assert!(
            !v.update(&mut cx, |v, w, _| v.opener.is_focused(w)
                || v.root.is_focused(w))
                .unwrap(),
            "Tab escaped modal"
        );
    }

    key(&mut cx, v, "escape");
    assert_eq!(v.read_with(&cx, |v, _| v.accepted).unwrap(), 0);
}

#[test]
fn dismissal_policy_busy_state_and_background_isolation_are_enforced() {
    let (mut cx, v) = setup();

    open(&mut cx, v);
    click(&mut cx, v, 15., 14.);
    assert!(is_open(&cx, v));
    key(&mut cx, v, "b");
    assert_eq!(v.read_with(&cx, |v, _| v.background).unwrap(), 0);
    v.update(&mut cx, |v, _, cx| {
        v.dismissal = DialogDismissal::EscapeAndOutside;
        v.busy = true;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "escape");
    click(&mut cx, v, 490., 390.);
    assert!(is_open(&cx, v));
    v.update(&mut cx, |v, _, cx| {
        v.busy = false;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    click(&mut cx, v, 490., 390.);
    assert!(!is_open(&cx, v));
    assert_eq!(v.read_with(&cx, |v, _| v.background).unwrap(), 0);
    key(&mut cx, v, "enter");
    v.update(&mut cx, |v, _, cx| {
        v.dismissal = DialogDismissal::Explicit;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "escape");
    assert!(is_open(&cx, v));
    v.update(&mut cx, |v, w, cx| {
        v.dialog.update(cx, |s, cx| {
            s.close(w, cx);
        });
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(!is_open(&cx, v));
}

#[test]
fn unmount_and_missing_openers_close_to_a_mounted_fallback() {
    let (mut cx, v) = setup();

    open(&mut cx, v);
    v.update(&mut cx, |v, _, cx| {
        v.show_opener = false;
        v.show_dialog = false;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(!is_open(&cx, v));
    assert_eq!(v.read_with(&cx, |v, _| v.closed).unwrap(), 1);
    key(&mut cx, v, "tab");
    key(&mut cx, v, "enter");
    assert_eq!(v.read_with(&cx, |v, _| v.background).unwrap(), 1);
}

#[test]
fn replacing_a_modal_preserves_the_original_opener_and_external_focus_is_contained() {
    let (mut cx, v) = setup();

    open(&mut cx, v);
    v.update(&mut cx, |v, w, cx| {
        w.focus(&v.opener, cx);
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(
        v.update(&mut cx, |v, w, cx| v
            .dialog
            .read(cx)
            .focus_handle(cx)
            .contains_focused(w, cx))
            .unwrap(),
        "external focus must return inside the modal"
    );
    v.update(&mut cx, |v, w, cx| {
        v.second.update(cx, |s, cx| {
            s.open(w, cx);
        });
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(!is_open(&cx, v));
    assert!(
        v.read_with(&cx, |v, cx| v.second.read(cx).is_open())
            .unwrap()
    );
    key(&mut cx, v, "escape");
    assert!(v.update(&mut cx, |v, w, _| v.opener.is_focused(w)).unwrap());
}

#[test]
fn a_child_menu_handles_escape_before_the_dialog() {
    let (mut cx, v) = setup();

    v.update(&mut cx, |v, _, cx| {
        v.with_menu = true;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    open(&mut cx, v);
    key(&mut cx, v, "tab");
    key(&mut cx, v, "enter");
    key(&mut cx, v, "escape");
    assert!(is_open(&cx, v));
    key(&mut cx, v, "escape");
    assert!(!is_open(&cx, v));
}

#[test]
fn long_content_fits_the_viewport_and_theme_changes_preserve_focus_and_values() {
    let (mut cx, v) = setup();

    v.update(&mut cx, |v, _, cx| {
        v.long_body = true;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    open(&mut cx, v);
    let bounds = v
        .read_with(&cx, |v, cx| v.dialog.read(cx).bounds().unwrap())
        .unwrap();

    assert!(
        bounds.top() >= px(16.) && bounds.bottom() <= px(384.),
        "modal must fit viewport: {bounds:?}"
    );
    cx.update(|cx| Theme::light().install(cx));
    draw(&mut cx, v);
    assert!(is_open(&cx, v));
    assert!(
        v.update(&mut cx, |v, w, cx| v
            .input
            .read(cx)
            .focus_handle(cx)
            .is_focused(w))
            .unwrap()
    );
    assert_eq!(
        v.read_with(&cx, |v, cx| v.input.read(cx).text().to_owned())
            .unwrap(),
        "feature/ui"
    );
}
