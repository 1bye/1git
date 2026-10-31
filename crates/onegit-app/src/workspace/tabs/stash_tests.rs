//! Stash writes use disposable repositories; no user repositories or network transports.
use super::tests::{draw, open, setup};
use super::*;

use crate::workspace::{
    Section,
    read::{ChangeKey, Side},
    stashes,
    tests::Fixture,
};

use onegit_git::{BranchIdentity, GitPath, StashAction, StashRequest};
use onegit_ui::DiffView;
use std::fs;

fn fixture() -> Fixture {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();

    f
}

fn submit(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    id: u64,
    action: StashAction,
) {
    view.update(cx, |workspace, window, cx| {
        let target = workspace
            .tabs
            .iter()
            .find(|t| t.id == id)
            .unwrap()
            .workspace
            .read(cx);

        let RepositoryState::Ready(source) = &target.state else {
            panic!()
        };

        let source = BranchIdentity::from_snapshot(&source.snapshot);

        workspace.submit_stash(
            id,
            &stashes::Submit(StashRequest { source, action }),
            window,
            cx,
        );
    })
    .unwrap();
    draw(cx, view);
}

#[test]
fn saving_refreshes_duplicate_and_linked_tabs_preserving_drafts_filters_selections_and_panes() {
    let f = fixture();
    let linked = f.directory.path().join("linked");

    f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    f.write("a.txt", "save tracked\n");
    f.write("keep.txt", "keep untracked\n");
    fs::write(linked.join("a.txt"), "linked edits\n").unwrap();
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
            tab.view = DiffView::Split;
            tab.select(
                ChangeKey {
                    path: GitPath::new("keep.txt").unwrap(),
                    side: Side::Working,
                },
                cx,
            );
            tab.split
                .update(cx, |split, cx| split.resize(px(355.), window, cx));
        });
    })
    .unwrap();
    draw(&mut cx, view);
    submit(
        &mut cx,
        view,
        1,
        StashAction::Save {
            message: "Saved from tab".into(),
            include_untracked: false,
        },
    );

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
        assert!(matches!(&tab.state,RepositoryState::Ready(source) if source.files.len()==1));
    });
    c.read_with(&cx,|tab,_|assert!(matches!(&tab.state,RepositoryState::Ready(source) if source.files.iter().any(|file|file.key.path.as_bytes()==b"a.txt"))));
    assert_eq!(
        fs::read_to_string(linked.join("a.txt")).unwrap(),
        "linked edits\n"
    );
    assert_eq!(f.load().repository.stashes(None).unwrap().len(), 1);
}

#[test]
fn pop_refreshes_related_tabs_and_switches_only_origin_to_changes_without_clearing_drafts() {
    let f = fixture();

    f.write("a.txt", "saved\n");
    f.git(&["stash", "push", "-m", "Saved"]);
    let oid = f.load().repository.stashes(None).unwrap()[0].oid.clone();
    let (mut cx, view) = setup(&f);
    let a = open(&mut cx, view, &f.root);
    let b = open(&mut cx, view, &f.root);

    for tab in [&a, &b] {
        tab.update(&mut cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text("Keep", cx));
            tab.change_section(&gpui::ElementId::from("stashes"), cx);
        });
    }

    draw(&mut cx, view);
    submit(&mut cx, view, 1, StashAction::Pop(oid));
    a.read_with(&cx, |tab, cx| {
        assert_eq!(tab.section, Section::Changes);
        assert_eq!(tab.summary.read(cx).text(), "Keep");
        assert!(matches!(&tab.state,RepositoryState::Ready(source) if source.files.len()==1));
    });
    b.read_with(&cx, |tab, cx| {
        assert_eq!(tab.section, Section::Stashes);
        assert_eq!(tab.summary.read(cx).text(), "Keep");
        assert!(tab.stashes.read(cx).session(cx).selected.is_none());
    });
    assert!(f.load().repository.stashes(None).unwrap().is_empty());
}

#[test]
fn stash_write_guards_cover_linked_tabs_and_failed_refresh_retains_their_views_and_drafts() {
    let f = fixture();
    let linked = f.directory.path().join("linked");

    f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    let (mut cx, view) = setup(&f);
    let a = open(&mut cx, view, &f.root);
    let b = open(&mut cx, view, &linked);

    a.update(&mut cx, |tab, cx| {
        tab.write_job = Some(super::super::WriteJob(None));
        cx.notify();
    });
    draw(&mut cx, view);
    b.read_with(&cx, |tab, _| assert!(tab.repository_busy));
    a.update(&mut cx, |tab, cx| {
        tab.write_job = None;
        cx.notify();
    });
    draw(&mut cx, view);
    b.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |input, cx| input.set_text("Retain", cx));
    });
    let metadata = linked.join(".git");
    let moved = linked.join(".git-offline");

    fs::rename(&metadata, &moved).unwrap();
    view.update(&mut cx, |workspace, window, cx| {
        workspace.stash_completed(
            1,
            &stashes::Completed {
                snapshots: vec![(
                    fs::canonicalize(&linked).unwrap(),
                    Err("Unavailable".into()),
                )],
                result: Err("Unconfirmed".into()),
                applied: false,
            },
            window,
            cx,
        )
    })
    .unwrap();
    draw(&mut cx, view);
    b.read_with(&cx, |tab, cx| {
        assert!(tab.refresh_blocked);
        assert_eq!(tab.summary.read(cx).text(), "Retain");
        assert!(matches!(&tab.state, RepositoryState::Ready(_)));
        assert!(!tab.can_write());
    });
    fs::rename(&moved, &metadata).unwrap();
    view.update(&mut cx, |workspace, _, cx| {
        let root = fs::canonicalize(&linked).unwrap();

        workspace.invalidate(&root, cx);
        workspace.refresh(&root, cx);
    })
    .unwrap();
    draw(&mut cx, view);
    b.read_with(&cx, |tab, cx| {
        assert!(!tab.refresh_blocked);
        assert_eq!(tab.summary.read(cx).text(), "Retain");
    });
}
