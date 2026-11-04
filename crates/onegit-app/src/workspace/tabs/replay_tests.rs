//! Replay refresh retains independent tab navigation and ordinary drafts.
use super::tests::{draw, open, setup};
use super::*;
use crate::workspace::{Section, recovery, replay, tests::Fixture};
use std::{sync::Arc, time::Duration};

#[test]
fn replay_refreshes_duplicate_and_linked_tabs_preserving_drafts_graph_selection_and_viewport() {
    check_refresh(replay::Kind::CherryPick);
}

#[test]
fn reset_refreshes_duplicate_and_linked_tabs_preserving_drafts_graph_selection_and_viewport() {
    check_refresh(replay::Kind::Reset);
}

#[test]
fn squash_refreshes_duplicate_and_linked_tabs_without_replacing_history_or_drafts() {
    check_refresh(replay::Kind::Squash);
}

#[test]
fn reorder_refreshes_duplicate_and_linked_tabs_without_replacing_history_or_drafts() {
    check_refresh(replay::Kind::Reorder);
}

#[test]
fn tag_creation_refreshes_duplicate_and_linked_tabs_preserving_drafts_and_viewports() {
    check_refresh(replay::Kind::CreateTag);
}

#[test]
fn tag_deletion_refreshes_duplicate_and_linked_tabs_preserving_drafts_and_viewports() {
    check_refresh(replay::Kind::DeleteTag);
}

fn check_refresh(kind: replay::Kind) {
    let reset = kind == replay::Kind::Reset;
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

    if kind == replay::Kind::DeleteTag {
        f.git(&["tag", "tag-qa"]);
    }

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
        let review = replay::Review {
            root: source.snapshot.repository.root.clone(),
            expected: onegit_git::BranchIdentity::from_snapshot(&source.snapshot),
            commit: if reset {
                Arc::new(source.repository.commit(&base, None).unwrap())
            } else {
                commit.clone()
            },
        };

        let action = if kind.is_tag() {
            let change = if kind == replay::Kind::CreateTag {
                replay::tags::Change::Create {
                    name: "tag-qa".into(),
                    annotation: Some("QA tag".into()),
                }
            } else {
                replay::tags::Change::Delete(
                    source
                        .local_tags
                        .as_ref()
                        .unwrap()
                        .iter()
                        .find(|t| t.name == "tag-qa")
                        .unwrap()
                        .clone(),
                )
            };

            replay::Action::Tag(replay::tags::Action {
                review,
                change,
                cancel: onegit_git::Cancellation::default(),
            })
        } else if kind.is_rewrite() {
            let commits: Vec<_> = ["HEAD^^", "HEAD^^^"]
                .into_iter()
                .map(|id| Arc::new(source.repository.commit(id, None).unwrap()))
                .collect();

            let mut review = review;

            review.commit = commits[0].clone();
            let review = replay::RangeReview {
                source: review,
                commits,
            };

            if kind == replay::Kind::Squash {
                replay::Action::Squash {
                    review,
                    message: "Combined earlier commits".into(),
                    cancel: onegit_git::Cancellation::default(),
                }
            } else {
                let order = review.commits.iter().map(|c| c.oid.clone()).collect();

                replay::Action::Reorder {
                    review,
                    order,
                    cancel: onegit_git::Cancellation::default(),
                }
            }
        } else if reset {
            replay::Action::Reset(review)
        } else {
            replay::Action::CherryPick {
                review,
                destination: ("target".into(), base.clone()),
            }
        };

        cx.emit(replay::Submit(action));
    });
    draw(&mut cx, v);
    cx.executor().advance_clock(Duration::from_millis(500));
    draw(&mut cx, v);

    for (i, (tab, draft, branch)) in [
        (
            &a,
            "origin",
            if reset || kind.is_rewrite() || kind.is_tag() {
                "main"
            } else {
                "target"
            },
        ),
        (
            &b,
            "duplicate",
            if reset || kind.is_rewrite() || kind.is_tag() {
                "main"
            } else {
                "target"
            },
        ),
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

            if kind.is_tag() {
                assert_eq!(
                    source
                        .local_tags
                        .as_ref()
                        .unwrap()
                        .iter()
                        .any(|t| t.name == "tag-qa"),
                    kind == replay::Kind::CreateTag
                );
            }

            assert!(!tab.refresh_blocked);
            assert!(tab.write_job.is_none());
            assert_eq!(
                tab.section,
                if i == 0 && !kind.is_rewrite() && !kind.is_tag() {
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

    if reset {
        assert_eq!(f.load().snapshot.status.head.oid.as_ref(), Some(&base));
        assert_eq!(std::fs::read(f.root.join("a")).unwrap(), b"feature\n");
        assert!(!f.git(&["for-each-ref", "refs/1git/reset/"]).is_empty());
    }
}
