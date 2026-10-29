//! Real control rendering and dispatch on GPUI's deterministic test platform.
//! The platform doubles the window/text/GPU backend; native smoke checks remain separate.

use onegit_ui::{Button, CheckState, Checkbox, ControlState, ListRow, Pane, RowSelection, Theme};
use rake::gpui::{self, InputEvent, prelude::*};

rake::theme!(Theme);

struct Controls {
    root: gpui::FocusHandle,
    state: ControlState,
    first: usize,
    second: usize,
    row: usize,
    checked: CheckState,
}

impl Render for Controls {
    fn render(&mut self, _: &mut gpui::Window, cx: &mut Context<Self>) -> impl IntoElement {
        let checkbox = rake::view! {
            <Checkbox checked={self.checked} show_label={false}
                on_change={Some(Box::new(cx.listener(|this, state: &CheckState, _, cx| {
                    this.checked= *state; cx.notify();
                })))} {..Checkbox::new("included", "Include file")}/>
        }
        .into_any_element();
        rake::view! {
            <div class="size-full" focus={&self.root} tab-navigation={true}>
                <Button state={self.state} on_press={Some(Box::new(cx.listener(|this,_,_,cx|{
                    this.first+=1; cx.notify();
                })))} {..Button::new("first","First")}/>
                <Button on_press={Some(Box::new(cx.listener(|this,_,_,cx|{
                    this.second+=1; cx.notify();
                })))} {..Button::new("second","Second")}/>
                <ListRow leading={Some(checkbox)} selection={RowSelection::Selected}
                    on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.row+=1;cx.notify();})))}
                    {..ListRow::new("file","theme.rs")}/>
            </div>
        }
    }
}

fn setup() -> (gpui::TestAppContext, gpui::WindowHandle<Controls>) {
    let mut cx = gpui::TestAppContext::single();
    cx.update(|cx| Theme::dark().install(cx));
    let window = cx.add_window(|window, cx| {
        let root = cx.focus_handle();
        window.focus(&root, cx);
        Controls {
            root,
            state: ControlState::Enabled,
            first: 0,
            second: 0,
            row: 0,
            checked: CheckState::Mixed,
        }
    });
    draw(&mut cx, window);
    (cx, window)
}

fn draw<T: 'static>(cx: &mut gpui::TestAppContext, window: gpui::WindowHandle<T>) {
    cx.run_until_parked();
    cx.update_window(window.into(), |_, window, cx| window.draw(cx).clear(cx))
        .expect("draw controls");
}

fn key(cx: &mut gpui::TestAppContext, window: gpui::WindowHandle<Controls>, key: &str) {
    cx.update_window(window.into(), |_, window, cx| {
        let keystroke = gpui::Keystroke::parse(key).expect("test keystroke");
        window.dispatch_event(
            gpui::KeyDownEvent {
                keystroke: keystroke.clone(),
                is_held: false,
                prefer_character_input: false,
            }
            .to_platform_input(),
            cx,
        );
        window.dispatch_event(gpui::KeyUpEvent { keystroke }.to_platform_input(), cx);
    })
    .expect("dispatch keyboard input");
    draw(cx, window);
}

fn click(cx: &mut gpui::TestAppContext, window: gpui::WindowHandle<Controls>, x: f32, y: f32) {
    cx.update_window(window.into(), |_, window, cx| {
        let position = gpui::point(gpui::px(x), gpui::px(y));
        window.dispatch_event(
            gpui::MouseMoveEvent {
                position,
                pressed_button: None,
                modifiers: Default::default(),
            }
            .to_platform_input(),
            cx,
        );
        window.dispatch_event(
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
        window.dispatch_event(
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
    .expect("dispatch pointer input");
    draw(cx, window);
}

#[test]
fn enter_space_activate_once_and_disabled_or_busy_controls_skip_navigation() {
    let (mut cx, window) = setup();
    key(&mut cx, window, "tab");
    key(&mut cx, window, "enter");
    key(&mut cx, window, "space");
    assert_eq!(window.read_with(&cx, |v, _| v.first).unwrap(), 2);
    for state in [ControlState::Disabled, ControlState::Busy] {
        window
            .update(&mut cx, |v, window, cx| {
                v.state = state;
                window.focus(&v.root, cx);
                cx.notify();
            })
            .unwrap();
        draw(&mut cx, window);
        click(&mut cx, window, 15., 14.);
        assert_eq!(window.read_with(&cx, |v, _| v.first).unwrap(), 2);
        key(&mut cx, window, "tab");
        key(&mut cx, window, "enter");
    }
    assert_eq!(window.read_with(&cx, |v, _| v.second).unwrap(), 2);
}

#[test]
fn checkbox_activation_does_not_select_the_row_or_change_until_the_owner_updates() {
    let (mut cx, window) = setup();
    click(&mut cx, window, 15., 70.);
    assert_eq!(
        window.read_with(&cx, |v, _| (v.checked, v.row)).unwrap(),
        (CheckState::Checked, 0)
    );
    click(&mut cx, window, 100., 70.);
    assert_eq!(
        window.read_with(&cx, |v, _| (v.checked, v.row)).unwrap(),
        (CheckState::Checked, 1)
    );
    key(&mut cx, window, "shift-tab");
    key(&mut cx, window, "space");
    assert_eq!(
        window.read_with(&cx, |v, _| (v.checked, v.row)).unwrap(),
        (CheckState::Unchecked, 1)
    );
}

#[test]
fn replacing_theme_preserves_owner_selection_and_component_values() {
    let (mut cx, window) = setup();
    click(&mut cx, window, 15., 70.);
    let before = Theme::current().surface;
    cx.update(|cx| Theme::light().install(cx));
    draw(&mut cx, window);
    assert_ne!(before, Theme::current().surface);
    assert_eq!(
        window.read_with(&cx, |v, _| v.checked).unwrap(),
        CheckState::Checked
    );
    let pane = rake::view! {
        <Pane header={Some(rake::view! { <p>Header</p> }.into_any_element())} footer={Some(rake::view!{<p>Footer</p>}.into_any_element())}
            {..Pane::new("pane")}>
            <Button {..Button::new("child","Child")}/>
        </Pane>
    };
    assert_eq!(pane.children.len(), 1);
    assert!(pane.header.is_some() && pane.footer.is_some());
}

struct ResizingControl {
    root: gpui::FocusHandle,
    label: gpui::SharedString,
    size: onegit_ui::ControlSize,
    icon: Option<onegit_ui::IconName>,
    measured: std::rc::Rc<std::cell::Cell<gpui::Size<gpui::Pixels>>>,
}

impl Render for ResizingControl {
    fn render(&mut self, _: &mut gpui::Window, _: &mut Context<Self>) -> impl IntoElement {
        let measured = self.measured.clone();
        let marker = gpui::canvas(
            |_, _, _| {},
            move |bounds, _, _, _| {
                measured.set(gpui::size(bounds.origin.x, bounds.origin.y + gpui::px(1.)));
            },
        )
        .size(gpui::px(1.));
        rake::view! {
            <div class="size-full" focus={&self.root} tab-navigation={true}>
                <div class="flex flex-row items-end">
                    <Button size={self.size} icon={self.icon} {..Button::new("resizable",self.label.clone())}/>
                    {marker}
                </div>
            </div>
        }
    }
}

fn resizing_setup() -> (gpui::TestAppContext, gpui::WindowHandle<ResizingControl>) {
    let mut cx = gpui::TestAppContext::single();
    cx.update(|cx| Theme::dark().install(cx));
    let view = cx.add_window(|_, cx| ResizingControl {
        root: cx.focus_handle(),
        label: "Go".into(),
        size: onegit_ui::ControlSize::Small,
        icon: None,
        measured: Default::default(),
    });
    draw(&mut cx, view);
    (cx, view)
}
fn dimensions(
    cx: &gpui::TestAppContext,
    view: gpui::WindowHandle<ResizingControl>,
) -> gpui::Size<gpui::Pixels> {
    view.read_with(cx, |v, _| v.measured.get())
        .expect("read measured control layout")
}
fn resize_frame(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<ResizingControl>,
    millis: u64,
) -> usize {
    cx.executor()
        .advance_clock(std::time::Duration::from_millis(millis));
    let pending = cx
        .update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
        .expect("deliver resize frame");
    draw(cx, view);
    pending
}

#[test]
fn button_size_tracks_real_layout_and_reverses_from_current_dimensions() {
    let (mut cx, view) = resizing_setup();
    let initial = dimensions(&cx, view);
    assert_eq!(initial.height, gpui::px(24.));
    assert!(initial.width > gpui::px(0.));
    assert_eq!(
        resize_frame(&mut cx, view, 0),
        0,
        "first mount must not animate"
    );
    view.update(&mut cx, |v, _, cx| {
        v.label = "Commit selected changes · 日本語".into();
        v.size = onegit_ui::ControlSize::Large;
        v.icon = Some(onegit_ui::IconName::Check);
        cx.notify();
    })
    .expect("expand control");
    draw(&mut cx, view);
    assert_eq!(
        dimensions(&cx, view),
        initial,
        "retargeting must preserve current layout"
    );
    resize_frame(&mut cx, view, 60);
    let midway = dimensions(&cx, view);
    assert!(
        midway.width > initial.width
            && midway.height > initial.height
            && midway.height < gpui::px(34.)
    );
    view.update(&mut cx, |v, _, cx| {
        v.label = "Go".into();
        v.size = onegit_ui::ControlSize::Small;
        v.icon = None;
        cx.notify();
    })
    .expect("reverse resize while moving");
    draw(&mut cx, view);
    assert_eq!(
        dimensions(&cx, view),
        midway,
        "reverse must not jump to either target"
    );
    resize_frame(&mut cx, view, 120);
    assert_eq!(dimensions(&cx, view), initial);
    assert_eq!(
        resize_frame(&mut cx, view, 0),
        0,
        "settled resize must stop scheduling frames"
    );
}

#[test]
fn reduced_motion_resizes_immediately_for_label_icon_and_size_changes() {
    let (mut cx, view) = resizing_setup();
    let initial = dimensions(&cx, view);
    cx.update(|cx| cx.set_reduce_motion(true));
    view.update(&mut cx, |v, _, cx| {
        v.label = "Commit selected changes · 日本語".into();
        v.size = onegit_ui::ControlSize::Large;
        v.icon = Some(onegit_ui::IconName::Check);
        cx.notify();
    })
    .expect("resize with reduced motion");
    draw(&mut cx, view);
    let expanded = dimensions(&cx, view);
    assert!(expanded.width > initial.width);
    assert_eq!(expanded.height, gpui::px(34.));
    assert_eq!(resize_frame(&mut cx, view, 0), 0);
    view.update(&mut cx, |v, _, cx| {
        v.label = "".into();
        v.size = onegit_ui::ControlSize::Small;
        cx.notify();
    })
    .expect("switch to icon geometry");
    draw(&mut cx, view);
    assert_eq!(
        dimensions(&cx, view),
        gpui::size(gpui::px(24.), gpui::px(24.))
    );
}
