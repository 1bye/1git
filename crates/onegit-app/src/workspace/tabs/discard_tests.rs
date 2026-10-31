//! Discard integration runs only against disposable Git fixtures and test recovery storage.
use super::tests::{draw, open, setup};
use super::*;

use crate::workspace::{
    discard,
    read::{ChangeKey, Side},
    tests::Fixture,
};

use onegit_git::{DiscardScope, GitPath};
use onegit_ui::DiffView;
use std::fs;

fn submit(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    id: u64,
    action: discard::Action,
) {
    view.update(cx, |workspace, window, cx| {
        workspace.submit_discard(id, &discard::Submit(action), window, cx)
    })
    .unwrap();
    draw(cx, view);
}

#[test]
fn discard_and_restore_refresh_related_tabs_and_keep_drafts_selection_filter_mode_and_sizes() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();
    let linked = f.directory.path().join("linked");

    f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    fs::write(linked.join("a.txt"), "linked edits\n").unwrap();
    f.write("a.txt", "staged\n");
    f.git(&["add", "a.txt"]);
    f.write("a.txt", "working\n");
    f.write("keep.txt", "keep\n");
    let (mut cx, view) = setup(&f);
    let a = open(&mut cx, view, &f.root);
    let b = open(&mut cx, view, &f.root);
    let c = open(&mut cx, view, &linked);

    for (tab, label) in [
        (&a, "First draft"),
        (&b, "Second draft"),
        (&c, "Linked draft"),
    ] {
        tab.update(&mut cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text(label, cx));
            tab.description
                .update(cx, |input, cx| input.set_text("Keep body", cx));
        });
    }

    view.update(&mut cx, |_, window, cx| {
        b.update(cx, |tab, cx| {
            tab.filter_visible = true;
            tab.filter
                .update(cx, |input, cx| input.set_text("keep", cx));
            tab.select(
                ChangeKey {
                    path: GitPath::new("keep.txt").unwrap(),
                    side: Side::Working,
                },
                cx,
            );
            tab.view = DiffView::Split;
            tab.split
                .update(cx, |split, cx| split.resize(px(355.), window, cx));
        })
    })
    .unwrap();
    draw(&mut cx, view);
    let selection = a.read_with(&cx, |tab, _| {
        let RepositoryState::Ready(source) = &tab.state else {
            panic!("ready repository");
        };

        discard::Selection::new(source, None, DiscardScope::Tracked).unwrap()
    });

    submit(
        &mut cx,
        view,
        1,
        discard::Action::Discard {
            selection,
            parent: f.directory.path().join("recovery"),
        },
    );
    assert_eq!(fs::read(f.root.join("a.txt")).unwrap(), b"base\n");
    assert_eq!(fs::read(f.root.join("keep.txt")).unwrap(), b"keep\n");
    let saved = a.read_with(&cx, |tab, cx| {
        tab.discard.read(cx).recovery.clone().unwrap()
    });

    submit(&mut cx, view, 1, discard::Action::Restore(saved.clone()));
    assert_eq!(fs::read(f.root.join("a.txt")).unwrap(), b"working\n");
    assert_eq!(f.git(&["show", ":a.txt"]), b"staged\n");
    assert!(saved.backup.directory.join("README.txt").exists());

    for (tab, label) in [
        (&a, "First draft"),
        (&b, "Second draft"),
        (&c, "Linked draft"),
    ] {
        tab.read_with(&cx, |tab, cx| {
            assert_eq!(tab.summary.read(cx).text(), label);
            assert_eq!(tab.description.read(cx).text(), "Keep body");
            assert!(!tab.repository_busy);
            assert!(!tab.refresh_blocked);
        });
    }

    b.read_with(&cx, |tab, cx| {
        assert_eq!(tab.selected.as_ref().unwrap().path.as_bytes(), b"keep.txt");
        assert_eq!(tab.filter.read(cx).text(), "keep");
        assert_eq!(tab.view, DiffView::Split);
        assert_eq!(tab.split.read(cx).preferred_size(), px(355.));
    });
    assert_eq!(fs::read(linked.join("a.txt")).unwrap(), b"linked edits\n");
}

#[test]
fn stale_confirmation_rejects_without_losing_drafts_and_untracked_deletion_keeps_tracked_edits() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();
    f.write("a.txt", "working\n");
    f.write("new[1].txt", "new\n");
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    let selection = tab.read_with(&cx, |tab, _| {
        let RepositoryState::Ready(source) = &tab.state else {
            panic!("ready");
        };

        discard::Selection::new(source, None, DiscardScope::Untracked).unwrap()
    });

    submit(
        &mut cx,
        view,
        1,
        discard::Action::Discard {
            selection,
            parent: f.directory.path().join("recovery"),
        },
    );
    assert!(!f.root.join("new[1].txt").exists());
    assert_eq!(fs::read(f.root.join("a.txt")).unwrap(), b"working\n");
    let stale = tab.read_with(&cx, |tab, _| {
        let RepositoryState::Ready(source) = &tab.state else {
            panic!("ready");
        };

        discard::Selection::new(source, None, DiscardScope::Tracked).unwrap()
    });

    f.git(&["switch", "-c", "other"]);
    submit(
        &mut cx,
        view,
        1,
        discard::Action::Discard {
            selection: stale,
            parent: f.directory.path().join("second"),
        },
    );
    assert_eq!(fs::read(f.root.join("a.txt")).unwrap(), b"working\n");
}

fn key(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Workspace>, value: &str) {
    use gpui::InputEvent as _;
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

fn pointer(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    selector: &'static str,
    button: gpui::MouseButton,
) {
    use gpui::InputEvent as _;
    let position = gpui::VisualTestContext::from_window(view.into(), cx)
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("missing {selector}"))
        .center();

    cx.update_window(view.into(), |_, window, cx| {
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
                button,
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
                button,
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

#[test]
fn right_click_targets_its_file_keeps_selection_and_keyboard_confirmation_defaults_to_cancel() {
    let f = Fixture::new();

    f.write("a.txt", "base a\n");
    f.write("b.txt", "base b\n");
    f.commit();
    f.write("a.txt", "changed a\n");
    f.write("b.txt", "changed b\n");
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| {
            tab.discard.update(cx, |form, _| {
                form.recovery_parent = Some(f.directory.path().join("recovery"))
            });
            tab.select(
                ChangeKey {
                    path: GitPath::new("b.txt").unwrap(),
                    side: Side::Working,
                },
                cx,
            );
            window.focus(&tab.files_focus, cx);
        })
    })
    .unwrap();
    draw(&mut cx, view);
    pointer(&mut cx, view, "workspace-file-0", gpui::MouseButton::Right);
    key(&mut cx, view, "end");
    key(&mut cx, view, "enter");
    assert!(
        view.read_with(&cx, |workspace, cx| workspace.branch_host.is_open(cx))
            .unwrap()
    );
    key(&mut cx, view, "enter");
    assert!(
        !view
            .read_with(&cx, |workspace, cx| workspace.branch_host.is_open(cx))
            .unwrap()
    );
    assert_eq!(fs::read(f.root.join("a.txt")).unwrap(), b"changed a\n");
    pointer(&mut cx, view, "workspace-file-0", gpui::MouseButton::Right);
    key(&mut cx, view, "end");
    key(&mut cx, view, "enter");
    pointer(
        &mut cx,
        view,
        "discard-cancel-button",
        gpui::MouseButton::Left,
    );
    assert!(
        !view
            .read_with(&cx, |workspace, cx| workspace.branch_host.is_open(cx))
            .unwrap()
    );
    assert_eq!(fs::read(f.root.join("a.txt")).unwrap(), b"changed a\n");

    pointer(&mut cx, view, "workspace-file-0", gpui::MouseButton::Right);
    key(&mut cx, view, "end");
    key(&mut cx, view, "enter");
    pointer(
        &mut cx,
        view,
        "discard-confirm-button",
        gpui::MouseButton::Left,
    );
    assert_eq!(fs::read(f.root.join("a.txt")).unwrap(), b"base a\n");
    assert_eq!(fs::read(f.root.join("b.txt")).unwrap(), b"changed b\n");
    tab.read_with(&cx, |tab, _| {
        assert_eq!(tab.selected.as_ref().unwrap().path.as_bytes(), b"b.txt")
    });
    view.update(&mut cx, |_, window, cx| {
        let focus = tab.read(cx).files_focus.clone();

        window.focus(&focus, cx);
    })
    .unwrap();
    key(&mut cx, view, "shift-f10");
    key(&mut cx, view, "end");
    key(&mut cx, view, "enter");
    assert!(
        view.read_with(&cx, |workspace, cx| workspace.branch_host.is_open(cx))
            .unwrap()
    );
    key(&mut cx, view, "escape");
    assert_eq!(fs::read(f.root.join("b.txt")).unwrap(), b"changed b\n");
}
