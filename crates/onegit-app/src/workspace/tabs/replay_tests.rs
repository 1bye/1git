//! Replay refresh retains independent tab navigation and ordinary drafts.
use super::tests::{draw, open, setup};
use super::*;
use crate::workspace::{Section, recovery, replay, tests::Fixture};
use std::{sync::Arc, time::Duration};

#[test]
fn replay_refreshes_duplicate_and_linked_tabs_preserving_drafts_graph_selection_and_viewport() {
    let f = Fixture::new();

    f.write("a", "base\n");
    f.commit();
    let base = f.load().snapshot.status.head.oid.clone().unwrap();

    f.git(&["branch", "target"]);

    for i in 0..60 {
        f.git(&["commit", "--allow-empty", "-m", &format!("Earlier {i}")]);
    }

    f.write("a", "feature\n");
    f.commit();
    let source = f.load();
    let commit = Arc::new(source.repository.commit("HEAD", None).unwrap());
    let linked = f.directory.path().join("linked");

    f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    let (mut cx, v) = setup(&f);
    let a = open(&mut cx, v, &f.root);
    let b = open(&mut cx, v, &f.root);
    let c = open(&mut cx, v, &linked);

    for (tab, draft) in [(&a, "origin"), (&b, "duplicate"), (&c, "linked")] {
        v.update(&mut cx, |_, window, cx| {
            tab.update(cx, |tab, cx| {
                recovery::Draft {
                    summary: draft.into(),
                    description: "Keep body".into(),
                }
                .restore(tab, cx);
                let mut saved = tab.graph.read(cx).session(cx);

                saved.selected = true;
                saved.details.commit = Some(commit.oid.clone());
                saved.details.file = Some(b"a".to_vec());
                saved.anchor = Some(commit.oid.clone());
                tab.graph
                    .update(cx, |graph, cx| graph.restore(&saved, window, cx));
                tab.change_section(&"graph".into(), cx);
            })
        })
        .unwrap();
    }

    b.update(&mut cx, |tab, cx| {
        let mut saved = tab.history.read(cx).session(cx);

        saved.commit = Some(commit.oid.clone());
        saved.file = Some(b"a".to_vec());
        saved.tree_layout = true;
        tab.history
            .update(cx, |history, cx| history.restore_selection(&saved, cx));
        tab.change_section(&"history".into(), cx);
    });
    draw(&mut cx, v);
    let history_before = b.read_with(&cx, |tab, cx| tab.history.read(cx).session(cx));

    let before: Vec<_> = [&a, &b, &c]
        .into_iter()
        .map(|tab| tab.read_with(&cx, |tab, cx| tab.graph.read(cx).session(cx)))
        .collect();

    a.update(&mut cx, |_, cx| {
        cx.emit(replay::Submit(replay::Action {
            review: replay::Review {
                root: source.snapshot.repository.root.clone(),
                expected: onegit_git::BranchIdentity::from_snapshot(&source.snapshot),
                commit: commit.clone(),
            },
            destination: Some(("target".into(), base)),
        }))
    });
    draw(&mut cx, v);
    cx.executor().advance_clock(Duration::from_millis(500));
    draw(&mut cx, v);

    for (i, (tab, draft, branch)) in [
        (&a, "origin", "target"),
        (&b, "duplicate", "target"),
        (&c, "linked", "linked"),
    ]
    .into_iter()
    .enumerate()
    {
        tab.read_with(&cx, |tab, cx| {
            assert_eq!(recovery::Draft::capture(tab, cx).summary, draft);
            assert_eq!(recovery::Draft::capture(tab, cx).description, "Keep body");

            let RepositoryState::Ready(source) = &tab.state else {
                panic!("ready");
            };

            assert_eq!(source.snapshot.status.head.branch.as_deref(), Some(branch));
            let after = tab.graph.read(cx).session(cx);

            assert_eq!(after.details.commit, before[i].details.commit);
            assert_eq!(after.details.file, before[i].details.file);
            assert_eq!(after.anchor, before[i].anchor);
            assert_eq!(after.offset, before[i].offset);
            assert!(!tab.refresh_blocked);
            assert!(tab.write_job.is_none());
            assert_eq!(
                tab.section,
                if i == 0 {
                    Section::Changes
                } else if i == 1 {
                    Section::History
                } else {
                    Section::Graph
                }
            );
        });
    }

    b.read_with(&cx, |tab, cx| {
        let after = tab.history.read(cx).session(cx);

        assert_eq!(after.commit, history_before.commit);
        assert_eq!(after.file, history_before.file);
    });
    assert_eq!(std::fs::read(linked.join("a")).unwrap(), b"feature\n");
}
