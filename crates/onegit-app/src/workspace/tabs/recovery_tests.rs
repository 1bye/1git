//! Source: repository-commit/commit.component.test.tsx and repository-workspace.unit.test.ts.
use super::tests::{draw, open, setup};
use super::*;
use crate::workspace::{recovery, tests::Fixture};

fn draft(tab: &gpui::Entity<RepositoryWorkspace>, cx: &gpui::TestAppContext) -> recovery::Draft {
    tab.read_with(cx, recovery::Draft::capture)
}

fn review(tab: &gpui::Entity<RepositoryWorkspace>, cx: &gpui::TestAppContext) -> recovery::Review {
    tab.read_with(cx, |tab, _| match &tab.state {
        RepositoryState::Ready(source) => recovery::Review::new(source).unwrap(),
        _ => panic!("ready"),
    })
}

fn set_draft(
    tab: &gpui::Entity<RepositoryWorkspace>,
    cx: &mut gpui::TestAppContext,
    summary: &str,
    body: &str,
) {
    tab.update(cx, |tab, cx| {
        recovery::Draft {
            summary: summary.into(),
            description: body.into(),
        }
        .restore(tab, cx)
    });
}

fn accept(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    tab: &gpui::Entity<RepositoryWorkspace>,
) {
    tab.read_with(cx, |tab, _| tab.recovery.clone())
        .update(cx, |form, cx| form.submit(cx));
    draw(cx, view);
}

#[test]
fn amend_cancel_and_success_restore_previous_draft_and_message_only_keeps_staging_and_scroll_state()
{
    let f = Fixture::new();

    f.write("a", "base\n");
    f.commit();
    f.write("a", "committed\n");
    f.git(&["add", "."]);
    f.git(&["commit", "-m", "Original", "-m", "Details"]);
    f.write("a", "staged\n");
    f.git(&["add", "a"]);
    f.write("a", "working\n");
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    set_draft(&tab, &mut cx, "Ordinary draft", "Keep body");
    let previous = draft(&tab, &cx);
    let reviewed = review(&tab, &cx);
    let diff = tab.read_with(&cx, |tab, _| tab.diff_state.clone());
    let selection = tab.read_with(&cx, |tab, _| tab.selected.clone());

    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| tab.begin_amend(reviewed.clone(), window, cx))
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        draft(&tab, &cx),
        recovery::Draft {
            summary: "Original".into(),
            description: "Details".into()
        }
    );
    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| tab.cancel_amend(window, cx))
    })
    .unwrap();
    assert_eq!(draft(&tab, &cx), previous);
    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| tab.begin_amend(reviewed, window, cx))
    })
    .unwrap();
    set_draft(&tab, &mut cx, "Revised", "New details");
    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| tab.commit(window, cx))
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        f.git(&["log", "-1", "--format=%s"]),
        b"Original\n",
        "opening confirmation never writes"
    );
    tab.read_with(&cx, |tab, _| tab.recovery.clone())
        .update(&mut cx, |form, _| form.include_staged = false);
    accept(&mut cx, view, &tab);
    assert_eq!(f.git(&["log", "-1", "--format=%s"]), b"Revised\n");
    assert_eq!(f.git(&["show", "HEAD:a"]), b"committed\n");
    assert_eq!(f.git(&["show", ":a"]), b"staged\n");
    assert_eq!(std::fs::read(f.root.join("a")).unwrap(), b"working\n");
    assert_eq!(draft(&tab, &cx), previous);
    tab.read_with(&cx, |tab, _| {
        assert!(tab.amend.is_none());
        assert_eq!(tab.diff_state, diff);
        assert_eq!(tab.selected, selection);
    });
}

#[test]
fn undo_requires_confirmation_refreshes_duplicate_and_linked_tabs_and_restores_only_empty_origin_draft()
 {
    let f = Fixture::new();

    f.write("a", "base\n");
    f.commit();
    f.write("a", "tip\n");
    f.git(&["add", "."]);
    f.git(&["commit", "-m", "Original", "-m", "Details"]);
    let parent = f.git(&["rev-parse", "HEAD^"]);
    let linked = f.directory.path().join("linked");

    f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    f.write("a", "staged\n");
    f.git(&["add", "a"]);
    f.write("a", "working\n");
    let before = std::fs::read(f.root.join(".git/index")).unwrap();
    let (mut cx, view) = setup(&f);
    let a = open(&mut cx, view, &f.root);
    let b = open(&mut cx, view, &f.root);
    let c = open(&mut cx, view, &linked);

    set_draft(&b, &mut cx, "Other draft", "Other body");
    set_draft(&c, &mut cx, "Linked draft", "");
    let reviewed = review(&a, &cx);

    view.update(&mut cx, |_, window, cx| {
        a.update(cx, |tab, cx| tab.review_undo(reviewed, window, cx))
    })
    .unwrap();
    assert_ne!(f.git(&["rev-parse", "HEAD"]), parent);
    accept(&mut cx, view, &a);
    assert_eq!(f.git(&["rev-parse", "HEAD"]), parent);
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), before);
    assert_eq!(std::fs::read(f.root.join("a")).unwrap(), b"working\n");
    assert_eq!(
        draft(&a, &cx),
        recovery::Draft {
            summary: "Original".into(),
            description: "Details".into()
        }
    );
    assert_eq!(draft(&b, &cx).summary, "Other draft");
    assert_eq!(draft(&c, &cx).summary, "Linked draft");

    for tab in [&a, &b, &c] {
        tab.read_with(&cx, |tab, _| {
            assert!(!tab.refresh_blocked);
            assert!(tab.write_job.is_none());
        });
    }
}

#[test]
fn published_and_stale_confirmations_never_rewrite_and_keep_the_amend_draft() {
    let f = Fixture::new();

    f.write("a", "base\n");
    f.commit();
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);
    let reviewed = review(&tab, &cx);
    let undo_review = reviewed.clone();

    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| tab.begin_amend(reviewed, window, cx))
    })
    .unwrap();
    set_draft(&tab, &mut cx, "Attempted", "");
    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| tab.commit(window, cx))
    })
    .unwrap();
    f.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
    let before = f.git(&["rev-parse", "HEAD"]);

    accept(&mut cx, view, &tab);
    assert_eq!(f.git(&["rev-parse", "HEAD"]), before);
    assert_eq!(draft(&tab, &cx).summary, "Attempted");
    tab.read_with(&cx, |tab, cx| {
        assert!(tab.amend.is_some());
        assert!(tab.recovery.read(cx).error.is_some());
    });
    f.git(&["update-ref", "-d", "refs/remotes/origin/main"]);
    let action = recovery::Action::Undo(undo_review);

    f.git(&["commit", "--allow-empty", "-m", "External"]);
    let before = f.git(&["rev-parse", "HEAD"]);

    view.update(&mut cx, |workspace, window, cx| {
        workspace.submit_recovery(1, &recovery::Submit(action), window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(f.git(&["rev-parse", "HEAD"]), before);
    assert_eq!(draft(&tab, &cx).summary, "Attempted");
}

#[test]
fn native_amend_confirms_includes_staging_once_and_session_keeps_the_ordinary_draft() {
    use super::discard_tests::{key, pointer};
    let f = Fixture::new();

    f.write("a", "base\n");
    f.commit();
    f.write("a", "staged\n");
    f.git(&["add", "a"]);
    f.write("a", "working\n");
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    set_draft(&tab, &mut cx, "Ordinary", "Saved body");
    pointer(&mut cx, view, "commit-amend", gpui::MouseButton::Left);
    let saved = tab.read_with(&cx, |tab, cx| {
        super::session::SavedTab::capture(tab, cx).unwrap()
    });

    assert_eq!(
        (saved.summary.as_str(), saved.description.as_str()),
        ("Ordinary", "Saved body")
    );
    set_draft(&tab, &mut cx, "Revised", "Details");
    pointer(
        &mut cx,
        view,
        "workspace-commit-submit",
        gpui::MouseButton::Left,
    );
    let before = f.git(&["rev-parse", "HEAD"]);

    key(&mut cx, view, "enter"); // Cancel has initial focus.
    assert_eq!(f.git(&["rev-parse", "HEAD"]), before);
    pointer(
        &mut cx,
        view,
        "workspace-commit-submit",
        gpui::MouseButton::Left,
    );
    let form = tab.read_with(&cx, |tab, _| tab.recovery.clone());

    form.update(&mut cx, |form, cx| {
        form.submit(cx);
        form.submit(cx);
    });
    draw(&mut cx, view);
    let info = tab.read_with(&cx, |tab, cx| {
        (
            tab.amend.is_some(),
            tab.recovery.read(cx).error.clone(),
            tab.recovery.read(cx).busy,
            tab.recovery.read(cx).include_staged,
        )
    });

    assert_eq!(f.git(&["show", "HEAD:a"]), b"staged\n", "{info:?}");
    assert_eq!(std::fs::read(f.root.join("a")).unwrap(), b"working\n");
    assert_eq!(f.git(&["log", "-1", "--format=%s"]), b"Revised\n");
    assert_eq!(
        String::from_utf8(f.git(&["for-each-ref", "--format=%(refname)", "refs/1git/amend/"]))
            .unwrap()
            .lines()
            .count(),
        1
    );
    assert_eq!(draft(&tab, &cx).summary, "Ordinary");
}

#[test]
fn native_undo_cancel_and_first_commit_keep_an_existing_draft_index_and_working_bytes() {
    use super::discard_tests::{key, pointer};
    let f = Fixture::new();

    f.write("a", "base\n");
    f.commit();
    f.write("a", "staged\n");
    f.git(&["add", "a"]);
    f.write("a", "working\n");
    let before = std::fs::read(f.root.join(".git/index")).unwrap();
    let head = f.git(&["rev-parse", "HEAD"]);
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    set_draft(&tab, &mut cx, "Preserve", "All text");
    pointer(&mut cx, view, "commit-undo", gpui::MouseButton::Left);
    key(&mut cx, view, "escape");
    assert_eq!(f.git(&["rev-parse", "HEAD"]), head);
    pointer(&mut cx, view, "commit-undo", gpui::MouseButton::Left);
    pointer(
        &mut cx,
        view,
        "recovery-confirm-button",
        gpui::MouseButton::Left,
    );
    assert!(f.git(&["for-each-ref", "refs/heads/"]).is_empty());
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), before);
    assert_eq!(std::fs::read(f.root.join("a")).unwrap(), b"working\n");
    assert_eq!(
        draft(&tab, &cx),
        recovery::Draft {
            summary: "Preserve".into(),
            description: "All text".into()
        }
    );
    tab.read_with(&cx,|tab,_|assert!(matches!(&tab.state,RepositoryState::Ready(source) if source.snapshot.status.head.is_unborn())));
}

#[test]
fn stale_undo_confirmation_rejects_external_head_movement_and_keeps_the_draft() {
    let f = Fixture::new();

    f.write("a", "base\n");
    f.commit();
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    set_draft(&tab, &mut cx, "Keep", "");
    let reviewed = review(&tab, &cx);

    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| tab.review_undo(reviewed, window, cx))
    })
    .unwrap();
    f.git(&["commit", "--allow-empty", "-m", "External"]);
    let head = f.git(&["rev-parse", "HEAD"]);

    accept(&mut cx, view, &tab);
    assert_eq!(f.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(draft(&tab, &cx).summary, "Keep");
    tab.read_with(&cx, |tab, cx| {
        assert!(tab.recovery.read(cx).error.is_some())
    });
    assert!(f.git(&["for-each-ref", "refs/1git/undo/"]).is_empty());
}

#[cfg(unix)]
#[test]
fn a_rejected_amend_hook_keeps_both_drafts_and_reports_the_actual_failure() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();

    f.write("a", "base\n");
    f.commit();
    let hook = f.root.join(".git/hooks/commit-msg");

    std::fs::write(
        &hook,
        "#!/bin/sh\necho 'Hook rejected this message' >&2\nexit 1\n",
    )
    .unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (mut cx, view) = setup(&f);

    view.update(&mut cx, |workspace, _, _| {
        workspace.process = f
            .process()
            .with_environment([("GIT_CONFIG_VALUE_0".into(), ".git/hooks".into())])
    })
    .unwrap();
    let tab = open(&mut cx, view, &f.root);

    set_draft(&tab, &mut cx, "Ordinary", "Saved");
    let reviewed = review(&tab, &cx);

    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| tab.begin_amend(reviewed, window, cx))
    })
    .unwrap();
    set_draft(&tab, &mut cx, "Rejected", "Edited body");
    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| tab.commit(window, cx))
    })
    .unwrap();
    let head = f.git(&["rev-parse", "HEAD"]);

    accept(&mut cx, view, &tab);
    assert_eq!(f.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(draft(&tab, &cx).summary, "Rejected");
    tab.read_with(&cx, |tab, cx| {
        assert_eq!(tab.amend.as_ref().unwrap().previous.summary, "Ordinary");
        assert!(
            tab.recovery
                .read(cx)
                .error
                .as_deref()
                .unwrap()
                .contains("Hook rejected")
        );
    });
}

#[test]
fn confirmation_and_composer_motion_settle_and_reduce_motion_snaps() {
    use super::discard_tests::pointer;

    for reduced in [false, true] {
        let f = Fixture::new();

        f.write("a", "base\n");
        f.commit();
        let (mut cx, view) = setup(&f);
        let tab = open(&mut cx, view, &f.root);

        cx.update(|cx| cx.set_reduce_motion(reduced));
        pointer(&mut cx, view, "commit-amend", gpui::MouseButton::Left);
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(200));
        cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
            .unwrap();
        draw(&mut cx, view);
        let bounds = gpui::VisualTestContext::from_window(view.into(), &cx)
            .debug_bounds("workspace-commit-composer")
            .unwrap();

        assert_eq!(bounds.size.height, px(172.));
        view.update(&mut cx, |_, window, cx| {
            tab.update(cx, |tab, cx| tab.commit(window, cx))
        })
        .unwrap();
        draw(&mut cx, view);
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(200));
        cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
            .unwrap();
        draw(&mut cx, view);
        assert_eq!(
            cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
                .unwrap(),
            0,
            "settled confirmation requests no idle frames"
        );
    }
}

#[test]
fn amend_keeps_the_native_diff_pixel_anchor_horizontal_scroll_selection_filter_and_pane_size() {
    use gpui::InputEvent as _;
    let f = Fixture::new();

    f.write(
        "a",
        &(0..200)
            .map(|n| format!("line {n} {}\n", "a".repeat(180)))
            .collect::<String>(),
    );
    f.write("other", "base\n");
    f.commit();
    f.write("other", "staged\n");
    f.git(&["add", "other"]);
    f.write(
        "a",
        &(0..200)
            .map(|n| format!("working {n} {}\n", "b".repeat(180)))
            .collect::<String>(),
    );
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| {
            tab.view = onegit_ui::DiffView::Split;
            tab.filter_visible = true;
            tab.filter.update(cx, |filter, cx| filter.set_text("a", cx));
            tab.split
                .update(cx, |split, cx| split.resize(px(355.), window, cx));
        })
    })
    .unwrap();
    draw(&mut cx, view);
    let position = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("diff-aligned")
        .unwrap()
        .center();

    cx.update_window(view.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::ScrollWheelEvent {
                position,
                delta: gpui::ScrollDelta::Pixels(gpui::point(px(-90.), px(-200.))),
                modifiers: Default::default(),
                touch_phase: gpui::TouchPhase::Moved,
            }
            .to_platform_input(),
            cx,
        )
    })
    .unwrap();
    draw(&mut cx, view);
    let before = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("diff-old-11")
        .unwrap();

    let selected = tab.read_with(&cx, |tab, _| tab.selected.clone());
    let reviewed = review(&tab, &cx);

    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| tab.begin_amend(reviewed, window, cx))
    })
    .unwrap();
    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| tab.commit(window, cx))
    })
    .unwrap();
    accept(&mut cx, view, &tab);
    let after = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("diff-old-11")
        .unwrap();

    assert_eq!(after.origin, before.origin);
    tab.read_with(&cx, |tab, cx| {
        assert_eq!(tab.selected, selected);
        assert_eq!(tab.view, onegit_ui::DiffView::Split);
        assert!(tab.filter_visible);
        assert_eq!(tab.filter.read(cx).text(), "a");
        assert_eq!(tab.split.read(cx).size(), px(355.));
    });
}

#[test]
fn an_old_confirmation_cannot_retarget_a_new_root_with_the_same_head() {
    let f = Fixture::new();

    f.write("a", "base\n");
    f.commit();
    let other = f.directory.path().join("other");

    f.git(&[
        "clone",
        "--no-hardlinks",
        f.root.to_str().unwrap(),
        other.to_str().unwrap(),
    ]);
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);
    let reviewed = review(&tab, &cx);
    let action = recovery::Action::Undo(reviewed);

    tab.update(&mut cx, |tab, cx| tab.open(other, None, cx));
    draw(&mut cx, view);
    let head = f.git(&["rev-parse", "HEAD"]);

    view.update(&mut cx, |workspace, window, cx| {
        workspace.submit_recovery(1, &recovery::Submit(action), window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(f.git(&["rev-parse", "HEAD"]), head);
    let repo = tab.read_with(&cx, |tab, _| match &tab.state {
        RepositoryState::Ready(source) => source.repository.clone(),
        _ => panic!("ready"),
    });

    assert_eq!(
        repo.snapshot(false, None)
            .unwrap()
            .status
            .head
            .oid
            .as_deref(),
        Some(std::str::from_utf8(&head).unwrap().trim())
    );
}
