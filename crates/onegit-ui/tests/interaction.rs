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

fn draw(cx: &mut gpui::TestAppContext, window: gpui::WindowHandle<Controls>) {
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
