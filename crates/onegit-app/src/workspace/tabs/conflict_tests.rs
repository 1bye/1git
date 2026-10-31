//! Native actions and shared worktree refresh preserve tab-owned intent.
use super::discard_tests::{key, pointer};
use super::tests::{draw, open, setup};
use super::*;
use crate::workspace::{Preview, PreviewState};

use crate::workspace::{
    conflicts::{self, tests::paused},
    read::{ChangeKey, Side},
};

use onegit_git::{ConflictSide, FinishKind, GitPath, OperationState};

fn action(tab: &gpui::Entity<RepositoryWorkspace>, cx: &gpui::TestAppContext) -> conflicts::Action {
    tab.read_with(cx, |tab, _| {
        let PreviewState::Ready(Preview::Conflict(preview)) = &tab.preview else {
            panic!("loaded conflict preview");
        };

        preview.resolve(Some(ConflictSide::Theirs))
    })
}

#[test]
fn conflict_resolution_refreshes_duplicate_and_linked_tabs_and_keeps_drafts_and_selection() {
    let f = paused(false);
    let linked = f.directory.path().join("linked");

    f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    std::fs::write(linked.join("keep.txt"), "linked edit\n").unwrap();
    let (mut cx, view) = setup(&f);
    let a = open(&mut cx, view, &f.root);
    let b = open(&mut cx, view, &f.root);
    let c = open(&mut cx, view, &linked);

    for (tab, draft) in [
        (&a, "first draft"),
        (&b, "second draft"),
        (&c, "linked draft"),
    ] {
        tab.update(&mut cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text(draft, cx));
            tab.description
                .update(cx, |input, cx| input.set_text("body", cx));
        });
    }

    view.update(&mut cx, |workspace, window, cx| {
        workspace.activate(1, window, cx);
        b.update(cx, |tab, cx| {
            tab.view = onegit_ui::DiffView::Split;
            tab.filter
                .update(cx, |input, cx| input.set_text("shared", cx));
            tab.filter_visible = true;
            tab.split
                .update(cx, |split, cx| split.resize(px(355.), window, cx));
        });
    })
    .unwrap();
    draw(&mut cx, view);
    let action = action(&a, &cx);

    view.update(&mut cx, |workspace, window, cx| {
        workspace.submit_conflict(1, &conflicts::Submit(action), window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        std::fs::read(f.root.join("shared.txt")).unwrap(),
        b"theirs\n"
    );
    assert_eq!(
        std::fs::read(linked.join("keep.txt")).unwrap(),
        b"linked edit\n"
    );

    for (tab, draft) in [
        (&a, "first draft"),
        (&b, "second draft"),
        (&c, "linked draft"),
    ] {
        tab.read_with(&cx, |tab, cx| {
            assert_eq!(tab.summary.read(cx).text(), draft);
            assert_eq!(tab.description.read(cx).text(), "body");
            assert!(!tab.repository_busy);
            assert!(!tab.refresh_blocked);
        });
    }

    b.read_with(&cx, |tab, cx| {
        assert_eq!(
            tab.selected.as_ref().unwrap().path.as_bytes(),
            b"shared.txt"
        );
        assert_eq!(tab.filter.read(cx).text(), "shared");
        assert_eq!(tab.view, onegit_ui::DiffView::Split);
        assert_eq!(tab.split.read(cx).preferred_size(), px(355.));

        let RepositoryState::Ready(source) = &tab.state else {
            panic!("ready");
        };

        assert_eq!(source.snapshot.operation, OperationState::Merge);
    });
    let next = a.read_with(&cx, |tab, _| {
        let RepositoryState::Ready(source) = &tab.state else {
            panic!("ready");
        };

        conflicts::finish_request(&source.snapshot, FinishKind::Continue).unwrap()
    });

    view.update(&mut cx, |workspace, window, cx| {
        workspace.submit_conflict(1, &conflicts::Submit(next), window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    a.read_with(&cx, |tab, cx| {
        let RepositoryState::Ready(source) = &tab.state else {
            panic!("ready");
        };

        assert_eq!(source.snapshot.operation, OperationState::Normal);
        assert_eq!(tab.summary.read(cx).text(), "first draft");
    });
}

#[test]
fn pointer_replacement_defaults_to_cancel_and_explicit_confirmation_stages_without_continuing() {
    let f = paused(false);
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    tab.update(&mut cx, |tab, cx| {
        tab.select(
            ChangeKey {
                path: GitPath::new("shared.txt").unwrap(),
                side: Side::Working,
            },
            cx,
        )
    });
    draw(&mut cx, view);
    let before = std::fs::read(f.root.join("shared.txt")).unwrap();

    pointer(
        &mut cx,
        view,
        "conflict-compare-theirs-button",
        gpui::MouseButton::Left,
    );
    tab.read_with(&cx, |tab, _| {
        assert_eq!(tab.conflict_side, ConflictSide::Theirs)
    });
    assert_eq!(std::fs::read(f.root.join("shared.txt")).unwrap(), before);
    pointer(
        &mut cx,
        view,
        "conflict-compare-ours-button",
        gpui::MouseButton::Left,
    );
    pointer(
        &mut cx,
        view,
        "conflict-use-version-button",
        gpui::MouseButton::Left,
    );
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
    assert_eq!(std::fs::read(f.root.join("shared.txt")).unwrap(), before);
    pointer(
        &mut cx,
        view,
        "conflict-use-version-button",
        gpui::MouseButton::Left,
    );
    pointer(
        &mut cx,
        view,
        "conflict-confirm-button",
        gpui::MouseButton::Left,
    );
    assert_eq!(std::fs::read(f.root.join("shared.txt")).unwrap(), b"ours\n");
    assert!(f.git(&["ls-files", "--unmerged"]).is_empty());
    tab.read_with(&cx, |tab, _| {
        let RepositoryState::Ready(source) = &tab.state else {
            panic!("ready");
        };

        assert_eq!(source.snapshot.operation, OperationState::Merge);
    });
}

#[test]
fn native_abort_cancel_keeps_the_rebase_and_explicit_abort_finishes_it() {
    let f = paused(true);
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    pointer(
        &mut cx,
        view,
        "operation-abort-button",
        gpui::MouseButton::Left,
    );
    key(&mut cx, view, "escape");
    tab.read_with(&cx, |tab, _| {
        let RepositoryState::Ready(source) = &tab.state else {
            panic!("ready");
        };

        assert_eq!(source.snapshot.operation, OperationState::Rebase);
    });
    pointer(
        &mut cx,
        view,
        "operation-abort-button",
        gpui::MouseButton::Left,
    );
    pointer(
        &mut cx,
        view,
        "conflict-confirm-button",
        gpui::MouseButton::Left,
    );
    tab.read_with(&cx, |tab, cx| {
        let RepositoryState::Ready(source) = &tab.state else {
            panic!("ready");
        };

        assert_eq!(source.snapshot.operation, OperationState::Normal);
        assert!(tab.conflicts.read(cx).error.is_none());
    });
}

#[test]
fn unreadable_related_worktree_retains_its_view_and_blocks_further_writes_after_resolution() {
    let f = paused(false);
    let linked = f.directory.path().join("linked");

    f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    let (mut cx, view) = setup(&f);
    let origin = open(&mut cx, view, &f.root);
    let peer = open(&mut cx, view, &linked);

    peer.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |input, cx| input.set_text("keep draft", cx))
    });
    let action = action(&origin, &cx);

    std::fs::rename(linked.join(".git"), linked.join(".git-offline")).unwrap();
    peer.read_with(&cx, |tab, _| {
        let RepositoryState::Ready(source) = &tab.state else {
            panic!("ready");
        };

        assert!(source.repository.snapshot(false, None).is_err());
    });
    view.update(&mut cx, |workspace, window, cx| {
        workspace.submit_conflict(1, &conflicts::Submit(action), window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        std::fs::read(f.root.join("shared.txt")).unwrap(),
        b"theirs\n"
    );
    assert!(f.git(&["ls-files", "--unmerged"]).is_empty());
    peer.read_with(&cx, |tab, cx| {
        assert!(tab.refresh_blocked);
        assert!(matches!(tab.state, RepositoryState::Ready(_)));
        assert_eq!(tab.summary.read(cx).text(), "keep draft");
    });
    origin.read_with(&cx, |tab, cx| {
        assert!(tab.conflicts.read(cx).error.is_some())
    });
}
