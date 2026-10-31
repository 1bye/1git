//! Native saved-work state maps source stash state and component suites to real Git fixtures.
use super::*;
use crate::workspace::tests::{Fixture, contents};
use onegit_ui::Theme;
use rake::gpui::{self, InputEvent as _, prelude::*, px};
use std::time::Duration;

fn fixture() -> Fixture {
    let f = Fixture::new();

    f.write("a.txt", "base a\n");
    f.write("b.txt", "base b\n");
    f.commit();
    f.write("a.txt", "saved a\n");
    f.write("b.txt", "saved b\n");
    f.git(&["stash", "push", "-m", "First"]);

    f
}

fn draw(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Stashes>) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update_window(view.into(), |_, window, cx| window.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

fn setup(f: &Fixture) -> (gpui::TestAppContext, gpui::WindowHandle<Stashes>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::light().install(cx));
    let view = cx.open_window(gpui::size(px(1100.), px(760.)), |window, cx| {
        let mut state = Stashes::new(None, window, cx);

        state.source(Some(f.load()), cx);
        state.configure(false, cx);

        state
    });

    (cx, view)
}

#[test]
fn reads_lazily_selects_first_files_keeps_immutable_selection_and_patch_after_renumbering() {
    let f = fixture();
    let before = contents(&f.root);
    let (mut cx, view) = setup(&f);

    draw(&mut cx, view);
    view.update(&mut cx, |state, _, cx| {
        assert!(!state.loaded);
        assert!(state.entries.is_empty());
        state.activate(cx);
    })
    .unwrap();
    draw(&mut cx, view);
    let oid = view
        .update(&mut cx, |state, _, cx| {
            assert_eq!(state.entries.len(), 1);

            let Files::Ready(files) = &state.files else {
                panic!("files ready")
            };

            assert_eq!(files.len(), 2);
            state.select_file(files[1].clone(), cx);
            state.view = DiffView::Split;
            state
                .scroll
                .0
                .borrow()
                .base_handle
                .set_offset(gpui::point(px(0.), px(-12.)));

            state.selected.clone().unwrap()
        })
        .unwrap();

    draw(&mut cx, view);
    let selected_diff = view
        .read_with(&cx, |state, _| state.diff_state.clone())
        .unwrap();

    view.update(&mut cx, |state, window, cx| {
        state.navigate(
            false,
            &gpui::KeyDownEvent {
                keystroke: gpui::Keystroke::parse("up").unwrap(),
                is_held: false,
                prefer_character_input: false,
            },
            window,
            cx,
        );
    })
    .unwrap();
    draw(&mut cx, view);
    view.read_with(&cx, |state, _| {
        assert_eq!(state.file.as_ref().unwrap().file.path.as_bytes(), b"b.txt");
        assert_eq!(state.diff_state, selected_diff);
    })
    .unwrap();
    assert_eq!(contents(&f.root), before);
    f.write("a.txt", "newer saved\n");
    f.git(&["stash", "push", "-m", "Second"]);
    let before = contents(&f.root);

    let diff = view
        .read_with(&cx, |state, _| state.diff_state.clone())
        .unwrap();

    view.update(&mut cx, |state, _, cx| state.source(Some(f.load()), cx))
        .unwrap();
    draw(&mut cx, view);
    view.read_with(&cx,|state,_|{assert_eq!(state.selected.as_deref(),Some(oid.as_str()));assert_eq!(state.entries[1].reference,"stash@{1}");assert_eq!(state.file.as_ref().unwrap().file.path.as_bytes(),b"b.txt");assert_eq!(state.diff_state,diff);assert_eq!(state.view,DiffView::Split);assert!(matches!(&state.preview,PreviewState::Ready(Preview::Patch(doc)) if doc.patch().contains("saved b")));}).unwrap();
    assert_eq!(contents(&f.root), before);
    f.git(&["stash", "drop", "stash@{1}"]);
    view.update(&mut cx, |state, _, cx| state.load(cx)).unwrap();
    draw(&mut cx, view);
    view.read_with(&cx, |state, _| {
        assert_eq!(
            state.selected.as_deref(),
            Some(state.entries[0].oid.as_str())
        )
    })
    .unwrap();
    f.git(&["stash", "clear"]);
    view.update(&mut cx, |state, _, cx| state.load(cx)).unwrap();
    draw(&mut cx, view);
    view.read_with(&cx, |state, _| {
        assert!(state.entries.is_empty());
        assert!(state.selected.is_none());
        assert!(state.file.is_none());
        assert!(state.diff_state.is_none());
    })
    .unwrap();
}

#[test]
fn repository_replacement_cancels_obsolete_list_and_file_reads() {
    let first = fixture();
    let other = Fixture::new();
    let (mut cx, view) = setup(&first);

    view.update(&mut cx, |state, _, cx| {
        state.activate(cx);
        state.source(Some(other.load()), cx);
    })
    .unwrap();
    draw(&mut cx, view);
    view.read_with(&cx, |state, _| {
        assert!(state.loaded);
        assert!(state.entries.is_empty());
        assert!(state.selected.is_none());
        assert!(state.cache.is_empty());
    })
    .unwrap();
    view.update(&mut cx, |state, _, cx| {
        state.source(Some(first.load()), cx);
        state.replace(
            vec![Stash {
                oid: "a".repeat(40),
                reference: "stash@{0}".into(),
                summary: "Unavailable".into(),
                created_at: String::new(),
            }],
            cx,
        );
    })
    .unwrap();
    draw(&mut cx, view);
    // A fresh list can replace an obsolete invalid entry before its late file read completes.
    view.update(&mut cx, |state, _, cx| {
        state.source(Some(other.load()), cx);
    })
    .unwrap();
    draw(&mut cx, view);
    view.read_with(&cx, |state, _| {
        assert!(state.entries.is_empty());
        assert!(state.selected.is_none());
        assert!(matches!(state.files, Files::Empty));
    })
    .unwrap();
}

#[test]
fn restoration_uses_exact_saved_revision_and_retains_diff_mode_and_panes() {
    let f = fixture();
    let (mut cx, view) = setup(&f);

    view.update(&mut cx, |state, _, cx| state.activate(cx))
        .unwrap();
    draw(&mut cx, view);
    let saved = view
        .update(&mut cx, |state, window, cx| {
            let Files::Ready(files) = &state.files else {
                panic!()
            };

            state.select_file(files[1].clone(), cx);
            state.view = DiffView::Split;
            state
                .sidebar
                .update(cx, |split, cx| split.resize(px(370.), window, cx));

            state.session(cx)
        })
        .unwrap();

    draw(&mut cx, view);
    let (mut next, restored) = setup(&f);

    restored
        .update(&mut next, |state, window, cx| {
            state.restore(&saved, window, cx);
            state.activate(cx);
        })
        .unwrap();
    draw(&mut next, restored);
    restored
        .read_with(&next, |state, cx| {
            let current = state.session(cx);

            assert_eq!(current.selected, saved.selected);
            assert_eq!(current.file, saved.file);
            assert!(current.split_diff);
            assert_eq!(current.sidebar, 370.);
            assert!(matches!(state.preview, PreviewState::Ready(_)));
        })
        .unwrap();
}

#[test]
fn opening_and_escaping_confirmation_never_mutates_git() {
    use onegit_git::StashAction;
    let f = fixture();
    let (mut cx, view) = setup(&f);

    view.update(&mut cx, |state, _, cx| state.activate(cx))
        .unwrap();
    draw(&mut cx, view);
    let source_before = contents(&f.root);

    view.update(&mut cx, |state, window, cx| {
        let oid = state.selected.clone().unwrap();

        state.request(StashAction::Delete(oid), window, cx);
    })
    .unwrap();
    draw(&mut cx, view);
    // Opening/cancelling is read-only. The shared modal hides background controls and restores focus.
    assert_eq!(contents(&f.root), source_before);
    cx.update_window(view.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::KeyDownEvent {
                keystroke: gpui::Keystroke::parse("escape").unwrap(),
                is_held: false,
                prefer_character_input: false,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    cx.executor().advance_clock(Duration::from_millis(200));
    draw(&mut cx, view);
    assert_eq!(contents(&f.root), source_before);
}

#[test]
fn restoring_a_removed_stash_clears_saved_selection_and_empty_scroll_state() {
    let f = fixture();
    let (mut cx, view) = setup(&f);

    view.update(&mut cx, |state, _, cx| state.activate(cx))
        .unwrap();
    draw(&mut cx, view);
    let saved = view.read_with(&cx, |state, cx| state.session(cx)).unwrap();

    assert!(saved.selected.is_some());
    f.git(&["stash", "clear"]);
    let (mut next, restored) = setup(&f);

    restored
        .update(&mut next, |state, window, cx| {
            state.restore(&saved, window, cx);
            state.activate(cx);
        })
        .unwrap();
    draw(&mut next, restored);
    restored
        .read_with(&next, |state, cx| {
            assert!(state.entries.is_empty());
            assert!(state.session(cx).selected.is_none());
            assert!(state.session(cx).file.is_none());
            assert_eq!(state.scroll.0.borrow().base_handle.offset().y, px(0.));
        })
        .unwrap();
}

#[test]
fn source_action_row_stays_horizontal_above_files_without_moving_when_forms_open() {
    let f = fixture();
    let (mut cx, view) = setup(&f);

    view.update(&mut cx, |state, _, cx| state.activate(cx))
        .unwrap();
    draw(&mut cx, view);

    for width in [1100., 640.] {
        cx.update_window(view.into(), |_, window, _| {
            window.resize(gpui::size(px(width), px(480.)));
        })
        .unwrap();
        draw(&mut cx, view);
        let bounds = |selector| {
            gpui::VisualTestContext::from_window(view.into(), &cx)
                .debug_bounds(selector)
                .unwrap()
        };

        let row = bounds("stash-row-0");
        let title = bounds("stash-title-0");
        let date = bounds("stash-date-0");

        assert_eq!(title.left(), date.left());
        assert_eq!(title.left(), row.left() + px(9.));
        assert_eq!(title.size.height, px(16.));
        assert_eq!(date.size.height, px(12.));
        let actions = bounds("stash-actions");
        let apply = bounds("stash-apply-trigger");
        let more = bounds("stash-more-trigger");
        let create = bounds("stash-create-trigger");
        let files = bounds("stash-files-heading");

        assert_eq!(actions.size.height, px(40.));
        assert_eq!(apply.size.height, px(24.));
        assert_eq!(apply.top(), more.top());
        assert_eq!(more.top(), create.top());
        assert!(more.right() < create.left());
        assert!(create.right() <= actions.right() - px(14.));
        assert!(create.bottom() <= files.top());
        view.update(&mut cx, |state, window, cx| {
            state.request(
                onegit_git::StashAction::Delete(state.selected.clone().unwrap()),
                window,
                cx,
            )
        })
        .unwrap();
        draw(&mut cx, view);
        assert_eq!(
            gpui::VisualTestContext::from_window(view.into(), &cx)
                .debug_bounds("stash-actions")
                .unwrap(),
            actions
        );
        cx.update_window(view.into(), |_, window, cx| {
            window.dispatch_event(
                gpui::KeyDownEvent {
                    keystroke: gpui::Keystroke::parse("escape").unwrap(),
                    is_held: false,
                    prefer_character_input: false,
                }
                .to_platform_input(),
                cx,
            );
        })
        .unwrap();
        draw(&mut cx, view);
    }
}

#[test]
fn pane_selection_follows_its_own_keyboard_focus_and_never_creates_row_tab_stops() {
    let f = fixture();
    let (mut cx, view) = setup(&f);

    view.update(&mut cx, |state, _, cx| state.activate(cx))
        .unwrap();
    draw(&mut cx, view);
    let before = contents(&f.root);

    view.update(&mut cx, |state, window, cx| {
        window.focus(&state.list_focus, cx);
        assert!(state.list_focus.is_focused(window));
        assert!(!state.files_focus.is_focused(window));
    })
    .unwrap();
    draw(&mut cx, view);
    view.update(&mut cx, |state, window, cx| {
        window.focus(&state.files_focus, cx);
        assert!(state.files_focus.is_focused(window));
        assert!(!state.list_focus.is_focused(window));
        state.navigate(
            true,
            &gpui::KeyDownEvent {
                keystroke: gpui::Keystroke::parse("down").unwrap(),
                is_held: false,
                prefer_character_input: false,
            },
            window,
            cx,
        );
    })
    .unwrap();
    draw(&mut cx, view);
    view.update(&mut cx, |state, window, _| {
        assert_eq!(state.file.as_ref().unwrap().file.path.as_bytes(), b"b.txt");
        assert!(state.files_focus.is_focused(window));
        assert!(!state.list_focus.is_focused(window));
    })
    .unwrap();
    // Tab exits the file list; saved-file rows are not independent buttons in the tab order.
    cx.update_window(view.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::KeyDownEvent {
                keystroke: gpui::Keystroke::parse("tab").unwrap(),
                is_held: false,
                prefer_character_input: false,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(&mut cx, view);
    view.update(&mut cx, |state, window, _| {
        assert!(!state.files_focus.is_focused(window))
    })
    .unwrap();
    assert_eq!(contents(&f.root), before);
}
