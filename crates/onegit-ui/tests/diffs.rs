//! Native diff virtualization, synchronized scrolling, focus and document/view changes.
use onegit_ui::{DiffDocument, DiffView, DiffViewer, Theme};
use rake::gpui::{self, InputEvent as _, prelude::*, px};

rake::theme!(Theme);

struct Preview {
    root: gpui::FocusHandle,
    document: DiffDocument,
    mode: DiffView,
    retained: Option<gpui::Entity<onegit_ui::DiffViewerState>>,
    visible: bool,
    layout: onegit_ui::DiffSplitLayout,
    staging: Option<onegit_ui::DiffStageAction>,
    blocked: bool,
    requests: Vec<onegit_ui::DiffStageRequest>,
}

impl Render for Preview {
    fn render(&mut self, _: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        rake::view! {
            <div class="size-full" focus={&self.root} tab-navigation={true}>
                if self.visible {<DiffViewer staging={self.staging} staging_state={if self.blocked {onegit_ui::ControlState::Busy}else{onegit_ui::ControlState::Enabled}}
                    on_stage={Some(Box::new(cx.listener(|this,event:&onegit_ui::DiffStageRequest,_,_|this.requests.push(event.clone()))))}
                    state={self.retained.clone()} view={self.mode} split_layout={self.layout} {..DiffViewer::new("diff", "theme.rs", self.document.clone())}/>}
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
            retained: None,
            visible: true,
            layout: onegit_ui::DiffSplitLayout::Columns,
            staging: None,
            blocked: false,
            requests: Vec::new(),
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
    assert_eq!(bounds(&cx, v, "diff-old-0").unwrap().size.height, px(26.));
    assert_eq!(bounds(&cx, v, "diff-old-1").unwrap().size.height, px(20.));
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
    wheel(&mut cx, v, "diff-before", -120., -200.);
    let old = bounds(&cx, v, "diff-old-11").expect("left virtualized row");
    let new = bounds(&cx, v, "diff-new-11").expect("right virtualized row");

    assert_eq!(old.top(), new.top());
    assert!((old.left() - before.left()) < px(-50.));
    assert!(((old.left() - before.left()) - (new.left() - after.left())).abs() < px(1.));
    wheel(&mut cx, v, "diff-after", -60., -200.);
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

#[test]
fn retained_viewport_survives_hidden_tabs_and_same_file_refresh() {
    let (mut cx, v) = setup(DiffView::Unified);

    v.update(&mut cx, |v, _, cx| {
        v.retained =
            Some(cx.new(|cx| onegit_ui::DiffViewerState::new(v.document.clone(), v.mode, cx)));
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "tab");

    for _ in 0..6 {
        key(&mut cx, v, "down");
    }

    let top = bounds(&cx, v, "diff-before").unwrap().top();
    let before = bounds(&cx, v, "diff-old-6").unwrap().top();

    v.update(&mut cx, |v, _, cx| {
        v.visible = false;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(bounds(&cx, v, "diff-old-6").is_none());
    v.update(&mut cx, |v, _, cx| {
        v.visible = true;
        let document =
            DiffDocument::parse(&v.document.patch().replace("new 2", "updated 2")).unwrap();

        v.retained
            .as_ref()
            .unwrap()
            .update(cx, |state, _| state.refresh(document.clone(), v.mode));
        v.document = document;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert_eq!(bounds(&cx, v, "diff-old-6").unwrap().top(), before);
    assert_eq!(before, top);
}

#[test]
fn aligned_split_keeps_fixed_columns_shared_hunks_and_scrolls_both_versions_together() {
    let (mut cx, v) = setup(DiffView::Split);

    v.update(&mut cx, |view, _, cx| {
        view.layout = onegit_ui::DiffSplitLayout::Aligned;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(bounds(&cx, v, "diff-before").is_none());
    assert!(bounds(&cx, v, "diff-after").is_none());
    assert_eq!(
        bounds(&cx, v, "diff-old-0").unwrap().size.width,
        bounds(&cx, v, "diff-aligned").unwrap().size.width
    );
    assert!(bounds(&cx, v, "diff-new-0").is_none());
    let pane = bounds(&cx, v, "diff-pane-new-1").unwrap();

    assert!(pane.left() > px(300.) && pane.right() <= px(640.));
    wheel(&mut cx, v, "diff-aligned", -120., -200.);
    let old = bounds(&cx, v, "diff-old-11").unwrap();
    let new = bounds(&cx, v, "diff-new-11").unwrap();
    let pane = bounds(&cx, v, "diff-pane-new-11").unwrap();

    assert_eq!(old.top(), new.top());
    assert!(old.left() < px(-50.));
    assert!(pane.left() > px(300.) && pane.right() <= px(640.));
    let old_pane = bounds(&cx, v, "diff-pane-old-11").unwrap();

    assert_eq!(new.left() - old.left(), pane.left() - old_pane.left());
    key(&mut cx, v, "tab");
    key(&mut cx, v, "end");
    assert!(bounds(&cx, v, "diff-new-1000").is_some());
}

fn context_sample() -> DiffDocument {
    let header = "--- a/context.ts\n+++ b/context.ts\n";

    let patch = format!(
        "{header}@@ -37,7 +37,7 @@\n line 37\n line 38\n line 39\n-old 40\n+new 40\n line 41\n line 42\n line 43\n@@ -97,7 +97,7 @@\n line 97\n line 98\n line 99\n-old 100\n+new 100\n line 101\n line 102\n line 103\n"
    );

    let mut full = format!("{header}@@ -1,150 +1,150 @@\n");

    for n in 1..=150 {
        if n == 40 {
            full.push_str("-old 40\n+new 40\n")
        } else if n == 100 {
            full.push_str("-old 100\n+new 100\n")
        } else {
            full.push_str(&format!(" line {n}\n"))
        }
    }

    DiffDocument::parse(&patch)
        .unwrap()
        .with_source("context.ts", "context.ts", Some(&full))
        .without_file_metadata()
}

fn click(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Preview>, selector: &'static str) {
    let position = bounds(cx, v, selector).expect(selector).center();

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
    draw(cx, v);
}

#[test]
fn expansion_preserves_source_pixel_offset_modes_tabs_and_refresh() {
    for (mode, layout) in [
        (DiffView::Unified, onegit_ui::DiffSplitLayout::Columns),
        (DiffView::Split, onegit_ui::DiffSplitLayout::Columns),
        (DiffView::Split, onegit_ui::DiffSplitLayout::Aligned),
    ] {
        let (mut cx, v) = setup(mode);

        v.update(&mut cx, |v, _, cx| {
            v.document = context_sample();
            v.layout = layout;
            v.retained =
                Some(cx.new(|cx| onegit_ui::DiffViewerState::new(v.document.clone(), mode, cx)));
            cx.notify();
        })
        .unwrap();
        draw(&mut cx, v);
        // Click the hunk to reveal 20 lines above. The original first context line stays put.
        let before = bounds(&cx, v, "diff-old-1").unwrap().top();

        click(&mut cx, v, "diff-expand-0");
        assert_eq!(
            bounds(&cx, v, "diff-old-21").unwrap().top(),
            before,
            "{mode:?} {layout:?}"
        );

        if mode == DiffView::Split {
            assert_eq!(bounds(&cx, v, "diff-new-21").unwrap().top(), before);
        }

        v.update(&mut cx, |v, _, cx| {
            v.visible = false;
            cx.notify();
        })
        .unwrap();
        draw(&mut cx, v);
        v.update(&mut cx, |v, _, cx| {
            v.visible = true;
            let document = context_sample();

            v.retained
                .as_ref()
                .unwrap()
                .update(cx, |state, _| state.refresh(document.clone(), mode));
            v.document = document;
            cx.notify();
        })
        .unwrap();
        draw(&mut cx, v);
        assert_eq!(bounds(&cx, v, "diff-old-21").unwrap().top(), before);
        // E reveals the final 16 leading lines; Home now reaches file line 1.
        key(&mut cx, v, "e");
        key(&mut cx, v, "home");
        assert!(
            bounds(&cx, v, "diff-expand-0").is_none(),
            "leading context is exhausted"
        );
        key(&mut cx, v, "end");
        assert!(bounds(&cx, v, "diff-expand-after").is_some());
        click(&mut cx, v, "diff-expand-after");
        key(&mut cx, v, "end");
        click(&mut cx, v, "diff-expand-after");
        key(&mut cx, v, "end");
        click(&mut cx, v, "diff-expand-after");
        key(&mut cx, v, "end");
        assert!(
            bounds(&cx, v, "diff-expand-after").is_none(),
            "known EOF removes trailing control"
        );
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(200));
        cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
            .unwrap();
        draw(&mut cx, v);
        assert_eq!(
            cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
                .unwrap(),
            0,
            "settled context requests no idle frames"
        );
    }
}

fn selectable(
    mode: DiffView,
    layout: onegit_ui::DiffSplitLayout,
    staging: Option<onegit_ui::DiffStageAction>,
) -> (gpui::TestAppContext, gpui::WindowHandle<Preview>) {
    let (mut cx, v) = setup(mode);

    v.update(&mut cx,|v,_,cx|{
        v.document=DiffDocument::parse("diff --git a/a.rs b/a.rs\n--- a/a.rs\n+++ b/a.rs\n@@ -10,3 +10,3 @@\n let context = true;\n-\tlet café = \"old\";\r\n+\tlet café = \"👋 new\";\r\n tail\n\\ No newline at end of file\n").unwrap().without_file_metadata();
        v.layout=layout;v.staging=staging;
        v.retained=Some(cx.new(|cx|onegit_ui::DiffViewerState::new(v.document.clone(),mode,cx)));cx.notify();
    }).unwrap();
    draw(&mut cx, v);

    (cx, v)
}

fn drag_code(
    cx: &mut gpui::TestAppContext,
    v: gpui::WindowHandle<Preview>,
    from: gpui::Point<gpui::Pixels>,
    to: gpui::Point<gpui::Pixels>,
) {
    cx.update_window(v.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::MouseDownEvent {
                button: gpui::MouseButton::Left,
                position: from,
                modifiers: Default::default(),
                click_count: 1,
                first_mouse: false,
            }
            .to_platform_input(),
            cx,
        );
        window.dispatch_event(
            gpui::MouseMoveEvent {
                position: to,
                pressed_button: Some(gpui::MouseButton::Left),
                modifiers: Default::default(),
            }
            .to_platform_input(),
            cx,
        );
        window.dispatch_event(
            gpui::MouseUpEvent {
                button: gpui::MouseButton::Left,
                position: to,
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

fn selected(cx: &gpui::TestAppContext, v: gpui::WindowHandle<Preview>) -> String {
    v.read_with(cx, |v, cx| {
        v.retained.as_ref().unwrap().read(cx).selected_text()
    })
    .unwrap()
}

#[test]
fn drag_and_copy_raw_unicode_tabs_crlf_without_diff_markers_gutters_or_newline_notes() {
    let (mut cx, v) = selectable(DiffView::Unified, onegit_ui::DiffSplitLayout::Columns, None);
    let code = bounds(&cx, v, "diff-code-Old-6").unwrap();

    drag_code(
        &mut cx,
        v,
        gpui::point(code.left(), code.center().y),
        gpui::point(code.right() - px(1.), code.center().y),
    );
    assert_eq!(selected(&cx, v), "\tlet café = \"👋 new\";\r");
    key(
        &mut cx,
        v,
        if cfg!(target_os = "macos") {
            "cmd-c"
        } else {
            "ctrl-c"
        },
    );
    assert_eq!(
        cx.read_from_clipboard().unwrap().text().unwrap(),
        "\tlet café = \"👋 new\";\r"
    );
    key(&mut cx, v, "escape");
    assert!(selected(&cx, v).is_empty());
    key(&mut cx, v, "shift-end");
    assert!(!selected(&cx, v).is_empty());
}

#[test]
fn split_multiline_selection_pins_the_starting_column_even_when_pointer_crosses_divider() {
    for layout in [
        onegit_ui::DiffSplitLayout::Columns,
        onegit_ui::DiffSplitLayout::Aligned,
    ] {
        let (mut cx, v) = selectable(DiffView::Split, layout, None);
        let old = bounds(&cx, v, "diff-code-Old-4").unwrap();
        let new = bounds(&cx, v, "diff-code-New-6").unwrap();

        drag_code(
            &mut cx,
            v,
            gpui::point(old.left(), old.center().y),
            gpui::point(new.right() - px(1.), new.center().y),
        );
        assert_eq!(
            selected(&cx, v),
            "let context = true;\n\tlet café = \"old\";\r",
            "{layout:?}"
        );
        let top = bounds(&cx, v, "diff-code-New-4").unwrap();

        drag_code(
            &mut cx,
            v,
            gpui::point(top.left(), top.center().y),
            gpui::point(new.right() - px(1.), new.center().y),
        );
        assert_eq!(
            selected(&cx, v),
            "let context = true;\n\tlet café = \"👋 new\";\r"
        );
    }
}

#[test]
fn pointer_and_keyboard_stage_only_reviewed_lines_groups_and_hunks_and_busy_disables_controls() {
    let (mut cx, v) = selectable(
        DiffView::Unified,
        onegit_ui::DiffSplitLayout::Columns,
        Some(onegit_ui::DiffStageAction::Stage),
    );

    click(&mut cx, v, "diff-stage-line-Old--:11");
    v.read_with(&cx, |v, _| assert_eq!(v.requests[0].lines, ["-:11"]))
        .unwrap();
    key(&mut cx, v, "space");
    v.read_with(&cx, |v, _| assert_eq!(v.requests.len(), 2))
        .unwrap();
    click(&mut cx, v, "diff-stage-group-Old--:11");
    v.read_with(&cx, |v, _| {
        assert_eq!(v.requests.last().unwrap().lines, ["-:11", "+:11"])
    })
    .unwrap();
    v.update(&mut cx, |v, _, cx| {
        v.blocked = true;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    click(&mut cx, v, "diff-stage-line-Old--:11");
    v.read_with(&cx, |v, _| assert_eq!(v.requests.len(), 3))
        .unwrap();
    v.update(&mut cx, |v, _, cx| {
        v.blocked = false;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    click(&mut cx, v, "diff-stage-line-Old--:11");
    v.update(&mut cx, |v, _, cx| {
        let next = DiffDocument::parse(&v.document.patch().replace("👋 new", "externally changed"))
            .unwrap()
            .without_file_metadata();

        v.retained
            .as_ref()
            .unwrap()
            .update(cx, |state, _| state.refresh(next.clone(), v.mode));
        v.document = next;
    })
    .unwrap();
    // The focused old-frame callback must not stage current data before it has been painted.
    cx.update_window(v.into(), |_, window, cx| {
        let keystroke = gpui::Keystroke::parse("space").unwrap();

        window.dispatch_event(
            gpui::KeyDownEvent {
                keystroke,
                is_held: false,
                prefer_character_input: false,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    v.read_with(&cx, |v, _| assert_eq!(v.requests.len(), 4))
        .unwrap();
}

#[test]
fn hunk_and_text_selection_controls_emit_original_review_and_survive_context_expansion() {
    let (mut cx, v) = selectable(
        DiffView::Unified,
        onegit_ui::DiffSplitLayout::Aligned,
        Some(onegit_ui::DiffStageAction::Stage),
    );

    click(&mut cx, v, "diff-stage-hunk-Old-0");
    v.read_with(&cx, |v, _| {
        assert_eq!(v.requests[0].lines, ["-:11", "+:11"])
    })
    .unwrap();
    let code = bounds(&cx, v, "diff-code-Old-6").unwrap();

    drag_code(
        &mut cx,
        v,
        gpui::point(code.left(), code.center().y),
        gpui::point(code.right() - px(1.), code.center().y),
    );
    click(&mut cx, v, "diff-copy-selection");
    assert_eq!(
        cx.read_from_clipboard().unwrap().text().unwrap(),
        "\tlet café = \"👋 new\";\r"
    );
    click(&mut cx, v, "diff-stage-selection");
    v.read_with(&cx, |v, _| assert_eq!(v.requests[1].lines, ["+:11"]))
        .unwrap();
    v.update(&mut cx, |v, _, cx| {
        v.document = context_sample();
        v.retained =
            Some(cx.new(|cx| onegit_ui::DiffViewerState::new(v.document.clone(), v.mode, cx)));
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    let original = v
        .read_with(&cx, |v, _| v.document.patch().to_owned())
        .unwrap();

    click(&mut cx, v, "diff-code-Old-3");
    key(&mut cx, v, "e");
    key(
        &mut cx,
        v,
        if cfg!(target_os = "macos") {
            "cmd-a"
        } else {
            "ctrl-a"
        },
    );
    click(&mut cx, v, "diff-stage-selection");
    v.read_with(&cx, |v, _| {
        assert_eq!(v.requests.last().unwrap().document.patch(), original)
    })
    .unwrap();
}

#[test]
fn selection_keeps_raw_added_text_when_switching_unified_and_split() {
    let (mut cx, v) = selectable(DiffView::Unified, onegit_ui::DiffSplitLayout::Aligned, None);
    let code = bounds(&cx, v, "diff-code-Old-6").unwrap();

    drag_code(
        &mut cx,
        v,
        gpui::point(code.left(), code.center().y),
        gpui::point(code.right() - px(1.), code.center().y),
    );
    let text = selected(&cx, v);

    for mode in [DiffView::Split, DiffView::Unified] {
        v.update(&mut cx, |v, _, cx| {
            v.mode = mode;
            cx.notify();
        })
        .unwrap();
        draw(&mut cx, v);
        assert_eq!(selected(&cx, v), text);
    }
}

#[test]
fn dragging_beyond_the_viewport_scrolls_and_stops_requesting_frames_on_release() {
    let (mut cx, v) = setup(DiffView::Unified);
    let code = bounds(&cx, v, "diff-code-Old-1").unwrap();
    let from = gpui::point(code.left(), code.center().y);
    let to = gpui::point(from.x, px(340.));

    cx.update_window(v.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::MouseDownEvent {
                button: gpui::MouseButton::Left,
                position: from,
                modifiers: Default::default(),
                click_count: 1,
                first_mouse: false,
            }
            .to_platform_input(),
            cx,
        );
        window.dispatch_event(
            gpui::MouseMoveEvent {
                position: to,
                pressed_button: Some(gpui::MouseButton::Left),
                modifiers: Default::default(),
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();

    for _ in 0..20 {
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(16));
        cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
            .unwrap();
        draw(&mut cx, v);
    }

    assert!(
        bounds(&cx, v, "diff-code-Old-1").is_none(),
        "drag scrolls past the initial source line"
    );
    cx.update_window(v.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::MouseUpEvent {
                button: gpui::MouseButton::Left,
                position: to,
                modifiers: Default::default(),
                click_count: 1,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(&mut cx, v);
    cx.executor()
        .advance_clock(std::time::Duration::from_millis(200));
    cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, v);
    assert_eq!(
        cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
            .unwrap(),
        0,
        "released selection requests no idle frames"
    );
}
