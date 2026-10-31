//! Controlled tab navigation and bounded split geometry through real native input dispatch.
use onegit_ui::{
    Button, ResizableSplit, SplitAxis, SplitEvent, SplitState, TabItem, TabVariant, Tabs, Theme,
};

use rake::gpui::{self, Focusable, InputEvent as _, prelude::*, px};

rake::theme!(Theme);

struct Workbench {
    root: gpui::FocusHandle,
    before: gpui::FocusHandle,
    after: gpui::FocusHandle,
    split: gpui::Entity<SplitState>,
    items: Vec<TabItem>,
    selected: Option<gpui::ElementId>,
    choices: usize,
    closes: usize,
    resized: usize,
    last_preference: Option<gpui::Pixels>,
    axis: SplitAxis,
    disabled: bool,
    divider_size: gpui::Pixels,
    mounted: bool,
    width: gpui::Pixels,
    variant: TabVariant,
    _subscription: gpui::Subscription,
}

impl Render for Workbench {
    fn render(&mut self, _: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let first = gpui::div()
            .size_full()
            .debug_selector(|| "first-pane".into())
            .into_any_element();

        let second = gpui::div()
            .size_full()
            .debug_selector(|| "second-pane".into())
            .into_any_element();

        rake::view! {
            <div class="size-full flex flex-col" focus={&self.root} tab-navigation={true}>
                <Button focus={Some(self.before.clone())} {..Button::new("before", "Before")}/>
                <div class="h-[120px] w-full shrink-0">
                    <Tabs selected={self.selected.clone()} variant={self.variant}
                        on_select={Some(Box::new(cx.listener(|this, id: &gpui::ElementId, _, cx| {this.choices += 1; this.selected = Some(id.clone()); cx.notify();})))}
                        on_close={Some(Box::new(cx.listener(|this, id: &gpui::ElementId, _, cx| {
                            this.closes += 1;
                            if let Some(index) = this.items.iter().position(|item| item.id == *id) {
                                this.items.remove(index);
                                if this.selected.as_ref() == Some(id) {
                                    this.selected = this.items.iter().skip(index).chain(this.items.iter()).find(|item| !item.disabled).map(|item| item.id.clone());
                                }
                            }
                            cx.notify();
                        })))} {..Tabs::new("tabs", "Preview tabs", self.items.clone())}>
                        <div class="size-full" style={|s| s.debug_selector(|| "active-panel".into())}/>
                    </Tabs>
                </div>
                if self.mounted {
                    <div style={|s| s.w(self.width).h(px(220.)).flex_shrink_0()}>
                        <ResizableSplit divider_size={self.divider_size} axis={self.axis} disabled={self.disabled} min_first={px(80.)} min_second={px(100.)}
                            first={first} second={second} {..ResizableSplit::new("split", &self.split, "Main size")}/>
                    </div>
                }
                <Button focus={Some(self.after.clone())} {..Button::new("after", "After")}/>
            </div>
        }
    }
}

fn setup() -> (gpui::TestAppContext, gpui::WindowHandle<Workbench>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::dark().install(cx));
    let view = cx.open_window(gpui::size(px(600.), px(500.)), |window, cx| {
        let root = cx.focus_handle();

        window.focus(&root, cx);
        window.activate_window();
        let split = cx.new(|cx| SplitState::new(px(160.), window, cx));

        let subscription = cx.subscribe(&split, |this: &mut Workbench, _, event, cx| {
            let SplitEvent::Resized(size) = event;

            this.last_preference = Some(*size);
            this.resized += 1;
            cx.notify();
        });

        Workbench {
            root,
            before: cx.focus_handle(),
            after: cx.focus_handle(),
            split,
            items: vec![
                TabItem::new("a", "Changes"),
                TabItem {
                    disabled: true,
                    ..TabItem::new("b", "Unavailable")
                },
                TabItem {
                    closable: true,
                    ..TabItem::new("c", "History")
                },
                TabItem {
                    closable: true,
                    ..TabItem::new("d", "A long file name · 日本語.rs")
                },
            ],
            selected: Some("a".into()),
            choices: 0,
            closes: 0,
            resized: 0,
            last_preference: None,
            axis: SplitAxis::Horizontal,
            disabled: false,
            divider_size: px(6.),
            mounted: true,
            width: px(500.),
            variant: TabVariant::Underline,
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
    cx.update_window(v.into(), |_, window, cx| {
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
    draw(cx, v);
}

fn bounds(
    cx: &gpui::TestAppContext,
    v: gpui::WindowHandle<Workbench>,
    selector: &'static str,
) -> gpui::Bounds<gpui::Pixels> {
    gpui::VisualTestContext::from_window(v.into(), cx)
        .debug_bounds(selector)
        .expect("component is mounted")
}

fn pointer(
    cx: &mut gpui::TestAppContext,
    v: gpui::WindowHandle<Workbench>,
    position: gpui::Point<gpui::Pixels>,
    phase: &str,
) {
    cx.update_window(v.into(), |_, window, cx| {
        let event = match phase {
            "down" => gpui::MouseDownEvent {
                button: gpui::MouseButton::Left,
                position,
                modifiers: Default::default(),
                click_count: 1,
                first_mouse: false,
            }
            .to_platform_input(),
            "up" => gpui::MouseUpEvent {
                button: gpui::MouseButton::Left,
                position,
                modifiers: Default::default(),
                click_count: 1,
            }
            .to_platform_input(),
            "move" => gpui::MouseMoveEvent {
                position,
                pressed_button: Some(gpui::MouseButton::Left),
                modifiers: Default::default(),
            }
            .to_platform_input(),
            _ => unreachable!("test pointer phase"),
        };

        window.dispatch_event(event, cx);
    })
    .unwrap();
    draw(cx, v);
}

fn selected(cx: &gpui::TestAppContext, v: gpui::WindowHandle<Workbench>, id: &'static str) -> bool {
    v.read_with(cx, |v, _| v.selected.as_ref() == Some(&id.into()))
        .unwrap()
}

#[test]
fn tabs_roving_focus_skips_disabled_wraps_and_activates_once() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    assert!(v.update(&mut cx, |v, w, _| v.before.is_focused(w)).unwrap());
    key(&mut cx, v, "tab");
    key(&mut cx, v, "right");
    assert!(selected(&cx, v, "c"));
    key(&mut cx, v, "enter");
    key(&mut cx, v, "space");
    assert_eq!(
        v.read_with(&cx, |v, _| v.choices).unwrap(),
        1,
        "selected tabs do not emit duplicate choices"
    );
    key(&mut cx, v, "end");
    assert!(selected(&cx, v, "d"));
    key(&mut cx, v, "right");
    assert!(selected(&cx, v, "a"));
    key(&mut cx, v, "left");
    assert!(selected(&cx, v, "d"));
    key(&mut cx, v, "home");
    assert!(selected(&cx, v, "a"));
    key(&mut cx, v, "tab");
    key(&mut cx, v, "right");
    assert!(
        selected(&cx, v, "a"),
        "the panel does not hijack tab-list keys"
    );
}

#[test]
fn pointer_selection_disabled_tabs_and_close_requests_remain_independent() {
    let (mut cx, v) = setup();
    let disabled = bounds(&cx, v, "tab-b").center();

    pointer(&mut cx, v, disabled, "down");
    pointer(&mut cx, v, disabled, "up");
    assert!(selected(&cx, v, "a"));
    let history = bounds(&cx, v, "tab-c").center();

    pointer(&mut cx, v, history, "down");
    pointer(&mut cx, v, history, "up");
    assert!(selected(&cx, v, "c"));
    key(&mut cx, v, "delete");
    assert!(selected(&cx, v, "d"));
    assert_eq!(v.read_with(&cx, |v, _| v.closes).unwrap(), 1);
    key(&mut cx, v, "left");
    assert!(
        selected(&cx, v, "a"),
        "closing the focused tab keeps navigation usable"
    );
    key(&mut cx, v, "delete");
    assert_eq!(
        v.read_with(&cx, |v, _| v.closes).unwrap(),
        1,
        "fixed tabs cannot close"
    );
}

#[test]
fn themes_variants_reordering_and_empty_tabs_preserve_application_control() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    key(&mut cx, v, "tab");
    key(&mut cx, v, "end");
    cx.update(|cx| Theme::light().install(cx));
    v.update(&mut cx, |v, _, cx| {
        v.variant = TabVariant::Segmented;
        v.items.reverse();
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(selected(&cx, v, "d"));
    key(&mut cx, v, "right");
    assert!(selected(&cx, v, "c"));
    v.update(&mut cx, |v, _, cx| {
        v.items.clear();
        v.selected = None;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "right");
    assert_eq!(v.read_with(&cx, |v, _| v.selected.clone()).unwrap(), None);
    key(&mut cx, v, "tab");
}

#[test]
fn split_drag_tracks_outside_hitbox_and_clamps_both_panes() {
    let (mut cx, v) = setup();
    let start = bounds(&cx, v, "split-Main size").center();

    pointer(&mut cx, v, start, "down");
    pointer(&mut cx, v, start + gpui::point(px(90.), px(0.)), "move");
    assert_eq!(
        v.read_with(&cx, |v, cx| v.split.read(cx).size()).unwrap(),
        px(250.)
    );
    assert_eq!(bounds(&cx, v, "first-pane").size.width, px(250.));
    pointer(&mut cx, v, start + gpui::point(px(1000.), px(0.)), "move");
    assert_eq!(bounds(&cx, v, "first-pane").size.width, px(394.));
    assert_eq!(bounds(&cx, v, "second-pane").size.width, px(100.));
    pointer(&mut cx, v, start + gpui::point(px(-1000.), px(0.)), "move");
    assert_eq!(bounds(&cx, v, "first-pane").size.width, px(80.));
    pointer(&mut cx, v, start + gpui::point(px(-1000.), px(0.)), "up");
    assert!(
        v.update(&mut cx, |_, w, _| w.captured_hitbox().is_none())
            .unwrap()
    );
    assert!(v.read_with(&cx, |v, _| v.resized > 0).unwrap());
}

#[test]
fn split_keyboard_and_vertical_geometry_are_immediate() {
    let (mut cx, v) = setup();

    v.update(&mut cx, |v, w, cx| {
        w.focus(&v.split.read(cx).focus_handle(cx), cx);
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "right");
    assert_eq!(bounds(&cx, v, "first-pane").size.width, px(170.));
    key(&mut cx, v, "shift-right");
    assert_eq!(bounds(&cx, v, "first-pane").size.width, px(210.));
    key(&mut cx, v, "home");
    assert_eq!(bounds(&cx, v, "first-pane").size.width, px(80.));
    key(&mut cx, v, "end");
    assert_eq!(bounds(&cx, v, "second-pane").size.width, px(100.));
    v.update(&mut cx, |v, _, cx| {
        v.axis = SplitAxis::Vertical;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "home");
    key(&mut cx, v, "down");
    assert_eq!(bounds(&cx, v, "first-pane").size.height, px(90.));
    assert_eq!(bounds(&cx, v, "second-pane").size.height, px(124.));
    let start = bounds(&cx, v, "split-Main size").center();

    pointer(&mut cx, v, start, "down");
    pointer(&mut cx, v, start + gpui::point(px(0.), px(20.)), "move");
    pointer(&mut cx, v, start + gpui::point(px(0.), px(20.)), "up");
    assert_eq!(bounds(&cx, v, "first-pane").size.height, px(110.));
}

#[test]
fn constrained_windows_preserve_preferred_size_and_do_not_emit_preference_changes() {
    let (mut cx, v) = setup();

    v.update(&mut cx, |v, _, cx| {
        v.width = px(120.);
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    let first = bounds(&cx, v, "first-pane").size.width;
    let second = bounds(&cx, v, "second-pane").size.width;

    assert!((f32::from(first + second) - 114.).abs() < 0.001);
    assert!(first >= px(0.) && second >= px(0.));
    assert_eq!(v.read_with(&cx, |v, _| v.resized).unwrap(), 0);
    v.update(&mut cx, |v, _, cx| {
        v.width = px(500.);
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert_eq!(bounds(&cx, v, "first-pane").size.width, px(160.));
    v.update(&mut cx, |v, w, cx| {
        v.split
            .update(cx, |state, cx| state.resize(px(f32::NAN), w, cx));
    })
    .unwrap();
    draw(&mut cx, v);
    assert_eq!(bounds(&cx, v, "first-pane").size.width, px(80.));
}

#[test]
fn escape_deactivation_disabling_and_unmounting_cancel_drag_capture() {
    for action in ["escape", "inactive", "disabled", "unmount"] {
        let (mut cx, v) = setup();
        let start = bounds(&cx, v, "split-Main size").center();

        pointer(&mut cx, v, start, "down");
        pointer(&mut cx, v, start + gpui::point(px(40.), px(0.)), "move");

        match action {
            "escape" => key(&mut cx, v, "escape"),
            "inactive" => gpui::VisualTestContext::from_window(v.into(), &cx).deactivate_window(),
            "disabled" => v
                .update(&mut cx, |v, _, cx| {
                    v.disabled = true;
                    cx.notify();
                })
                .unwrap(),
            "unmount" => v
                .update(&mut cx, |v, _, cx| {
                    v.mounted = false;
                    cx.notify();
                })
                .unwrap(),
            _ => unreachable!(),
        }

        draw(&mut cx, v);
        assert!(
            v.update(&mut cx, |_, w, _| w.captured_hitbox().is_none())
                .unwrap(),
            "{action}"
        );
        assert_eq!(
            v.read_with(&cx, |v, cx| v.split.read(cx).size()).unwrap(),
            px(160.),
            "{action}"
        );
        pointer(&mut cx, v, start + gpui::point(px(200.), px(0.)), "up");
        assert_eq!(
            v.read_with(&cx, |v, cx| v.split.read(cx).size()).unwrap(),
            px(160.),
            "{action} must not finish a cancelled drag"
        );
    }
}

#[test]
fn settled_and_reduced_motion_layouts_do_not_request_continuous_frames() {
    let (mut cx, v) = setup();

    cx.update(|cx| cx.set_reduce_motion(true));
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(1));
    cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, v);
    assert_eq!(
        cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
            .unwrap(),
        0
    );
}

#[test]
fn a_pointer_close_keeps_focus_on_the_next_tab_and_disabled_focus_moves_to_an_enabled_item() {
    let (mut cx, v) = setup();
    let tab = bounds(&cx, v, "tab-c").center();

    pointer(&mut cx, v, tab, "down");
    pointer(&mut cx, v, tab, "up");
    let close = bounds(&cx, v, "tab-close-c").center();

    pointer(&mut cx, v, close, "down");
    pointer(&mut cx, v, close, "up");
    assert!(selected(&cx, v, "d"));
    key(&mut cx, v, "left");
    assert!(selected(&cx, v, "a"));
    v.update(&mut cx, |v, _, cx| {
        v.items[0].disabled = true;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "enter");
    assert!(selected(&cx, v, "d"));
}

#[test]
fn selected_tabs_scroll_into_view_and_tab_reaches_the_divider() {
    let (mut cx, v) = setup();

    v.update(&mut cx, |v, _, cx| {
        v.items = (0usize..10)
            .map(|index| TabItem::new(("long", index), format!("A longer tab label {index}")))
            .collect();
        v.selected = Some(("long", 9usize).into());
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    let last = bounds(&cx, v, "tab-long-9");

    assert!(
        last.right() <= px(600.) && last.left() >= px(0.),
        "selected tabs stay within the strip"
    );
    key(&mut cx, v, "tab");
    key(&mut cx, v, "tab");
    key(&mut cx, v, "tab");
    key(&mut cx, v, "tab");
    assert!(
        v.update(&mut cx, |v, w, cx| v
            .split
            .read(cx)
            .focus_handle(cx)
            .is_focused(w))
            .unwrap(),
        "the divider is a native Tab stop"
    );
    key(&mut cx, v, "right");
    assert_eq!(bounds(&cx, v, "first-pane").size.width, px(170.));
}

#[test]
fn shrinking_during_a_drag_restores_the_saved_preference_and_releases_capture() {
    let (mut cx, v) = setup();
    let start = bounds(&cx, v, "split-Main size").center();

    pointer(&mut cx, v, start, "down");
    pointer(&mut cx, v, start + gpui::point(px(40.), px(0.)), "move");
    v.update(&mut cx, |v, _, cx| {
        v.width = px(120.);
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(
        v.update(&mut cx, |_, w, _| w.captured_hitbox().is_none())
            .unwrap()
    );
    assert_eq!(
        v.read_with(&cx, |v, _| v.last_preference).unwrap(),
        Some(px(160.)),
        "cancellation preserves the original preference rather than the constrained viewport size"
    );
    v.update(&mut cx, |v, _, cx| {
        v.width = px(500.);
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert_eq!(bounds(&cx, v, "first-pane").size.width, px(160.));
}

#[test]
fn hairline_splits_keep_a_wide_pointer_target_and_resize_both_panes() {
    let (mut cx, v) = setup();

    v.update(&mut cx, |view, _, cx| {
        view.divider_size = px(1.);
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    let first = bounds(&cx, v, "first-pane");
    let second = bounds(&cx, v, "second-pane");
    let divider = bounds(&cx, v, "split-Main size");

    assert_eq!(second.left() - first.right(), px(1.));
    assert!(divider.size.width >= px(6.));
    let origin = gpui::point(divider.right() - px(1.), divider.center().y);

    pointer(&mut cx, v, origin, "down");
    pointer(&mut cx, v, origin + gpui::point(px(30.), px(0.)), "move");
    pointer(&mut cx, v, origin + gpui::point(px(30.), px(0.)), "up");
    assert_eq!(
        bounds(&cx, v, "first-pane").size.width,
        first.size.width + px(30.)
    );
    assert_eq!(
        bounds(&cx, v, "second-pane").size.width,
        second.size.width - px(30.)
    );
}

#[test]
fn proportional_split_preserves_user_share_when_the_viewport_changes() {
    let (mut cx, view) = setup();

    view.update(&mut cx, |this, window, cx| {
        this.split = cx.new(|cx| SplitState::proportional(0.5, window, cx));
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(bounds(&cx, view, "first-pane").size.width, px(247.));
    view.update(&mut cx, |this, _, cx| {
        this.width = px(400.);
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(bounds(&cx, view, "first-pane").size.width, px(197.));
    view.update(&mut cx, |this, window, cx| {
        this.split
            .update(cx, |split, cx| split.resize(px(118.2), window, cx))
    })
    .unwrap();
    draw(&mut cx, view);
    view.update(&mut cx, |this, _, cx| {
        this.width = px(500.);
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, view);
    assert!((f32::from(bounds(&cx, view, "first-pane").size.width) - 148.2).abs() < 0.51);
}
