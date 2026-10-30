//! Native diff virtualization, synchronized scrolling, focus and document/view changes.
use onegit_ui::{DiffDocument, DiffView, DiffViewer, Theme};
use rake::gpui::{self, InputEvent as _, prelude::*, px};

rake::theme!(Theme);

struct Preview {
    root: gpui::FocusHandle,
    document: DiffDocument,
    mode: DiffView,
}

impl Render for Preview {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        rake::view! {
            <div class="size-full" focus={&self.root} tab-navigation={true}>
                <DiffViewer view={self.mode} {..DiffViewer::new("diff", "theme.rs", self.document.clone())}/>
            </div>
        }
    }
}

fn setup(mode: DiffView) -> (gpui::TestAppContext, gpui::WindowHandle<Preview>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::dark().install(cx));
    let mut patch = String::from("@@ -1,1000 +1,1000 @@\n");

    for index in 0..1000 {
        patch.push_str(&format!(
            "-old {index} {}\n+new {index} {}\n",
            "a".repeat(180),
            "b".repeat(180)
        ));
    }

    let document = DiffDocument::parse(&patch).unwrap();

    let v = cx.open_window(gpui::size(px(640.), px(320.)), |window, cx| {
        let root = cx.focus_handle();

        window.focus(&root, cx);
        window.activate_window();

        Preview {
            root,
            document,
            mode,
        }
    });

    draw(&mut cx, v);

    (cx, v)
}

fn draw(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Preview>) {
    for _ in 0..2 {
        cx.run_until_parked();
        cx.update_window(v.into(), |_, window, cx| window.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

fn bounds(
    cx: &gpui::TestAppContext,
    v: gpui::WindowHandle<Preview>,
    selector: &'static str,
) -> Option<gpui::Bounds<gpui::Pixels>> {
    gpui::VisualTestContext::from_window(v.into(), cx).debug_bounds(selector)
}

fn key(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Preview>, text: &str) {
    cx.update_window(v.into(), |_, window, cx| {
        let keystroke = gpui::Keystroke::parse(text).unwrap();

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

fn wheel(
    cx: &mut gpui::TestAppContext,
    v: gpui::WindowHandle<Preview>,
    side: &'static str,
    x: f32,
    y: f32,
) {
    let position = bounds(cx, v, side).unwrap().center();

    cx.update_window(v.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::ScrollWheelEvent {
                position,
                delta: gpui::ScrollDelta::Pixels(gpui::point(px(x), px(y))),
                modifiers: Default::default(),
                touch_phase: gpui::TouchPhase::Moved,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(cx, v);
}

#[test]
fn large_unified_patches_are_virtualized_and_keyboard_navigation_reaches_both_ends() {
    let (mut cx, v) = setup(DiffView::Unified);

    assert!(bounds(&cx, v, "diff-old-1").is_some());
    assert!(bounds(&cx, v, "diff-old-1000").is_none());
    key(&mut cx, v, "tab");
    key(&mut cx, v, "pagedown");
    assert!(bounds(&cx, v, "diff-old-1").is_none());
    key(&mut cx, v, "end");
    assert!(bounds(&cx, v, "diff-old-2000").is_some());
    key(&mut cx, v, "home");
    assert!(bounds(&cx, v, "diff-old-1").is_some());
    key(&mut cx, v, "down");
    key(&mut cx, v, "up");
    key(&mut cx, v, "pageup");
    assert!(bounds(&cx, v, "diff-old-0").is_some());
}

#[test]
fn split_columns_share_both_scroll_axes_without_displacing_the_second_column() {
    let (mut cx, v) = setup(DiffView::Split);
    let before = bounds(&cx, v, "diff-before").unwrap();
    let after = bounds(&cx, v, "diff-after").unwrap();

    assert!(before.right() <= after.left());
    assert!(after.right() <= px(640.));
    assert!(before.size.width > px(300.) && after.size.width > px(300.));
    wheel(&mut cx, v, "diff-before", -120., -240.);
    let old = bounds(&cx, v, "diff-old-11").expect("left virtualized row");
    let new = bounds(&cx, v, "diff-new-11").expect("right virtualized row");

    assert_eq!(old.top(), new.top());
    assert!((old.left() - before.left()) < px(-50.));
    assert!(((old.left() - before.left()) - (new.left() - after.left())).abs() < px(1.));
    wheel(&mut cx, v, "diff-after", -60., -240.);
    let old = bounds(&cx, v, "diff-old-21").expect("left row follows right wheel");
    let new = bounds(&cx, v, "diff-new-21").expect("right row follows right wheel");

    assert_eq!(old.top(), new.top());
    assert!(((old.left() - before.left()) - (new.left() - after.left())).abs() < px(1.));
}

#[test]
fn mode_changes_keep_source_location_and_new_documents_reset_scroll() {
    let (mut cx, v) = setup(DiffView::Unified);

    key(&mut cx, v, "tab");

    for _ in 0..6 {
        key(&mut cx, v, "down");
    }

    // Unified row 6 is the added half of the third replacement; split row 3 pairs it.
    v.update(&mut cx, |v, _, cx| {
        v.mode = DiffView::Split;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    let top = bounds(&cx, v, "diff-before").unwrap().top();

    assert_eq!(bounds(&cx, v, "diff-old-3").unwrap().top(), top);
    assert_eq!(bounds(&cx, v, "diff-new-3").unwrap().top(), top);
    cx.update(|cx| Theme::light().install(cx));
    draw(&mut cx, v);
    assert_eq!(bounds(&cx, v, "diff-old-3").unwrap().top(), top);
    v.update(&mut cx, |v, _, cx| {
        v.document = DiffDocument::parse("@@ -0,0 +1 @@\n+replacement\n").unwrap();
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert_eq!(bounds(&cx, v, "diff-old-0").unwrap().top(), top);
    assert!(bounds(&cx, v, "diff-new-1").is_some());
}

#[test]
fn empty_binary_and_unequal_patches_render_in_both_themes_without_animation_loops() {
    let (mut cx, v) = setup(DiffView::Split);

    for theme in [Theme::light(), Theme::dark()] {
        cx.update(|cx| theme.install(cx));

        for patch in [
            "",
            "Binary files a/icon and b/icon differ\n",
            "@@ -1 +1,2 @@\n-old\n+new\n+extra\n",
        ] {
            v.update(&mut cx, |v, _, cx| {
                v.document = DiffDocument::parse(patch).unwrap();
                cx.notify();
            })
            .unwrap();
            draw(&mut cx, v);

            if patch.contains("extra") {
                let old = bounds(&cx, v, "diff-old-2").unwrap();
                let new = bounds(&cx, v, "diff-new-2").unwrap();

                assert_eq!(old.top(), new.top());
            }
        }
    }

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
fn pointer_click_focuses_the_viewer_for_keyboard_navigation() {
    let (mut cx, v) = setup(DiffView::Unified);
    let position = bounds(&cx, v, "diff-before").unwrap().center();

    cx.update_window(v.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::MouseDownEvent {
                button: gpui::MouseButton::Left,
                position,
                modifiers: Default::default(),
                click_count: 1,
                first_mouse: false,
            }
            .to_platform_input(),
            cx,
        );
        window.dispatch_event(
            gpui::MouseUpEvent {
                button: gpui::MouseButton::Left,
                position,
                modifiers: Default::default(),
                click_count: 1,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "end");
    assert!(bounds(&cx, v, "diff-old-2000").is_some());
}

#[test]
fn short_rows_cover_the_full_viewport_in_each_mode() {
    for mode in [DiffView::Unified, DiffView::Split] {
        let (mut cx, v) = setup(mode);

        v.update(&mut cx, |v, _, cx| {
            v.document = DiffDocument::parse("@@ -1 +1 @@\n-a\n+b\n").unwrap();
            cx.notify();
        })
        .unwrap();
        draw(&mut cx, v);
        let pane = bounds(&cx, v, "diff-before").unwrap();
        let row = bounds(&cx, v, "diff-old-1").unwrap();

        assert!(
            row.size.width >= pane.size.width,
            "{mode:?}: short-row highlighting fills its column"
        );

        if mode == DiffView::Split {
            let pane = bounds(&cx, v, "diff-after").unwrap();
            let row = bounds(&cx, v, "diff-new-1").unwrap();

            assert!(row.size.width >= pane.size.width);
        }
    }
}
