//! Public component rendering and native input dispatch on GPUI's deterministic platform.
use onegit_ui::{Button, ControlState, DropdownMenu, MenuEntry, MenuItem, Theme, Tooltip};
use rake::gpui::{self, InputEvent as _, prelude::*, px};
use std::time::Duration;

rake::theme!(Theme);

struct Workbench {
    root: gpui::FocusHandle,
    show: bool,
    state: ControlState,
    selected: Vec<gpui::ElementId>,
    after: usize,
    entries: Vec<MenuEntry>,
}

impl Render for Workbench {
    fn render(&mut self, _: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        rake::view! {
            <div class="size-full flex flex-col items-start" focus={&self.root} tab-navigation={true}>
                if self.show {
                    <DropdownMenu entries={self.entries.clone()} state={self.state}
                        on_select={Some(Box::new(cx.listener(|this,id:&gpui::ElementId,_,cx|{this.selected.push(id.clone());cx.notify();})))}
                        {..DropdownMenu::new("menu","Branches")}/>
                }
                <Tooltip {..Tooltip::new("hint","More information")}>
                    <Button on_press={Some(Box::new(cx.listener(|this,_,_,cx|{this.after+=1;cx.notify();})))} {..Button::new("after","After")}/>
                </Tooltip>
            </div>
        }
    }
}

fn setup() -> (gpui::TestAppContext, gpui::WindowHandle<Workbench>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::dark().install(cx));
    let view = cx.open_window(gpui::size(px(500.), px(400.)), |window, cx| {
        let root = cx.focus_handle();

        window.focus(&root, cx);
        window.activate_window();

        Workbench {
            root,
            show: true,
            state: ControlState::Enabled,
            selected: Vec::new(),
            after: 0,
            entries: vec![
                MenuItem {
                    selected: Some(true),
                    ..MenuItem::new("main", "main")
                }
                .into(),
                MenuItem {
                    disabled: true,
                    ..MenuItem::new("locked", "locked")
                }
                .into(),
                MenuEntry::Separator,
                MenuItem::new("feature", "feature/ui").into(),
                MenuItem::new("fix", "fix/selection").into(),
            ],
        }
    });

    draw(&mut cx, view);

    (cx, view)
}

fn draw(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Workbench>) {
    for _ in 0..2 {
        cx.run_until_parked();
        cx.update_window(view.into(), |_, window, cx| window.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

fn key(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Workbench>, value: &str) {
    cx.update_window(view.into(), |_, window, cx| {
        let keystroke = gpui::Keystroke::parse(value).unwrap();

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
    .unwrap();
    draw(cx, view);
}

fn click(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Workbench>, x: f32, y: f32) {
    cx.update_window(view.into(), |_, window, cx| {
        let position = gpui::point(px(x), px(y));

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
    .unwrap();
    draw(cx, view);
}

fn selected(
    cx: &gpui::TestAppContext,
    view: gpui::WindowHandle<Workbench>,
) -> Vec<gpui::ElementId> {
    view.read_with(cx, |v, _| v.selected.clone()).unwrap()
}

#[test]
fn keyboard_skips_disabled_entries_activates_once_and_restores_trigger() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    key(&mut cx, v, "enter");
    key(&mut cx, v, "down");
    key(&mut cx, v, "space");
    assert_eq!(selected(&cx, v), vec!["feature".into()]);
    key(&mut cx, v, "enter");
    key(&mut cx, v, "end");
    key(&mut cx, v, "enter");
    assert_eq!(selected(&cx, v), vec!["feature".into(), "fix".into()]);
    key(&mut cx, v, "up");
    key(&mut cx, v, "home");
    key(&mut cx, v, "enter");
    assert_eq!(selected(&cx, v).last(), Some(&"main".into()));
}

#[test]
fn typeahead_cycles_matches_and_resets_after_a_pause() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    key(&mut cx, v, "down");
    key(&mut cx, v, "f");
    key(&mut cx, v, "f");
    key(&mut cx, v, "enter");
    assert_eq!(selected(&cx, v), vec!["fix".into()]);
    key(&mut cx, v, "enter");
    key(&mut cx, v, "f");
    key(&mut cx, v, "i");
    key(&mut cx, v, "enter");
    assert_eq!(selected(&cx, v).last(), Some(&"fix".into()));
    key(&mut cx, v, "enter");
    key(&mut cx, v, "f");
    cx.executor().advance_clock(Duration::from_millis(800));
    key(&mut cx, v, "m");
    key(&mut cx, v, "enter");
    assert_eq!(selected(&cx, v).last(), Some(&"main".into()));
}

#[test]
fn escape_tab_and_disabled_triggers_never_activate_a_menu_item() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    key(&mut cx, v, "enter");
    key(&mut cx, v, "escape");
    key(&mut cx, v, "enter");
    key(&mut cx, v, "tab");
    key(&mut cx, v, "enter");
    assert_eq!(v.read_with(&cx, |v, _| v.after).unwrap(), 1);
    assert!(selected(&cx, v).is_empty());

    for state in [ControlState::Disabled, ControlState::Busy] {
        v.update(&mut cx, |v, w, cx| {
            v.state = state;
            w.focus(&v.root, cx);
            cx.notify();
        })
        .unwrap();
        draw(&mut cx, v);
        key(&mut cx, v, "tab");
        key(&mut cx, v, "enter");
    }

    assert_eq!(v.read_with(&cx, |v, _| v.after).unwrap(), 3);
    assert!(selected(&cx, v).is_empty());
}

#[test]
fn pointer_selection_and_outside_dismissal_do_not_activate_background_controls() {
    let (mut cx, v) = setup();

    click(&mut cx, v, 30., 14.);
    click(&mut cx, v, 50., 48.);
    assert_eq!(selected(&cx, v), vec!["main".into()]);
    click(&mut cx, v, 30., 14.);
    click(&mut cx, v, 400., 200.);
    key(&mut cx, v, "enter");
    key(&mut cx, v, "escape");
    assert_eq!(selected(&cx, v), vec!["main".into()]);
    assert_eq!(v.read_with(&cx, |v, _| v.after).unwrap(), 0);
}

#[test]
fn rerenders_keep_navigation_but_unmounting_releases_open_state() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    key(&mut cx, v, "enter");
    key(&mut cx, v, "down");
    cx.update(|cx| Theme::light().install(cx));
    draw(&mut cx, v);
    key(&mut cx, v, "enter");
    assert_eq!(selected(&cx, v), vec!["feature".into()]);
    key(&mut cx, v, "enter");
    v.update(&mut cx, |v, _, cx| {
        v.show = false;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    v.update(&mut cx, |v, w, cx| {
        v.show = true;
        w.focus(&v.root, cx);
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "tab");
    key(&mut cx, v, "enter");
    assert_eq!(selected(&cx, v), vec!["feature".into()]);
    key(&mut cx, v, "enter");
    assert_eq!(selected(&cx, v), vec!["feature".into(), "main".into()]);
}

#[test]
fn changed_entries_and_empty_menus_keep_selection_safe() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    key(&mut cx, v, "enter");
    key(&mut cx, v, "end");
    v.update(&mut cx, |v, _, cx| {
        v.entries.retain(
            |entry| matches!(entry,MenuEntry::Item(item) if item.id==gpui::ElementId::from("main")),
        );
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "enter");
    assert_eq!(selected(&cx, v), vec!["main".into()]);
    v.update(&mut cx, |v, _, cx| {
        v.entries.clear();
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);

    for key_name in ["enter", "up", "end", "f", "enter", "escape"] {
        key(&mut cx, v, key_name);
    }

    assert_eq!(selected(&cx, v), vec!["main".into()]);
}

#[test]
fn moving_focus_outside_dismisses_without_stealing_the_new_focus() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    key(&mut cx, v, "enter");
    v.update(&mut cx, |v, window, cx| {
        window.focus(&v.root, cx);
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "tab");
    key(&mut cx, v, "enter");
    assert!(
        selected(&cx, v).is_empty(),
        "the first Enter should reopen the dismissed menu"
    );
    key(&mut cx, v, "enter");
    assert_eq!(selected(&cx, v), vec!["main".into()]);
}
