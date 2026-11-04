//! Source branch integration reviews run against real Git and retained native tabs.
use super::branch_tests::{choose, click, confirm, fixture, key, picker, settle};
use super::tests::{draw, open, setup};
use super::*;
use crate::workspace::{Preview, PreviewState, branches::Phase, conflicts};
use crate::workspace::{Section, tests::Fixture};
use onegit_git::{ConflictSide, FinishKind, OperationState};
use rake::gpui::EntityInputHandler;
use std::time::Duration;

fn diverged() -> Fixture {
    let f = fixture();

    f.git(&["switch", "feature/ui"]);
    f.write("topic.txt", "topic\n");
    f.commit();
    f.git(&["switch", "main"]);
    f.write("main.txt", "main\n");
    f.commit();

    f
}

#[test]
fn merge_picker_requires_confirmation_and_preserves_duplicate_and_linked_tab_drafts() {
    let f = diverged();
    let old = f.git(&["rev-parse", "HEAD"]);
    let linked = f.directory.path().join("integration-linked");

    f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    let (mut cx, view) = setup(&f);
    let first = open(&mut cx, view, &f.root);
    let second = open(&mut cx, view, &f.root);
    let third = open(&mut cx, view, &linked);

    for (tab, draft) in [
        (&first, "First draft"),
        (&second, "Second draft"),
        (&third, "Linked draft"),
    ] {
        tab.update(&mut cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text(draft, cx));
            tab.change_section(&"history".into(), cx);
        });
    }

    view.update(&mut cx, |workspace, _, cx| {
        workspace.active = Some(workspace.tabs[0].id);
        cx.notify();
    })
    .unwrap();
    let p = picker(&mut cx, view);

    click(&mut cx, view, "branch-integrate");
    settle(&mut cx, view);
    choose(&mut cx, view, &p, "feature/ui");
    assert_eq!(f.git(&["rev-parse", "HEAD"]), old);
    confirm(&mut cx, view, &p);
    assert_ne!(f.git(&["rev-parse", "HEAD"]), old);
    assert_eq!(
        String::from_utf8(f.git(&["show", "-s", "--format=%P"]))
            .unwrap()
            .split_whitespace()
            .count(),
        2
    );
    assert_eq!(
        f.git(&["for-each-ref", "--format=%(objectname)", "refs/1git/merge/"]),
        old
    );

    for (tab, draft) in [
        (&first, "First draft"),
        (&second, "Second draft"),
        (&third, "Linked draft"),
    ] {
        tab.read_with(&cx, |tab, cx| {
            assert_eq!(tab.summary.read(cx).text(), draft);
            assert_eq!(tab.section, Section::History);
            assert!(tab.write_job.is_none());
        });
    }

    view.read_with(&cx, |workspace, cx| {
        assert!(!workspace.branch_host.is_open(cx))
    })
    .unwrap();
}

#[test]
fn integration_search_clears_consent_keyboard_selects_occupied_target_and_modes_fit_with_settled_motion()
 {
    let f = diverged();
    let linked = f.directory.path().join("target-worktree");

    f.git(&["worktree", "add", linked.to_str().unwrap(), "feature/ui"]);
    let old = f.git(&["rev-parse", "HEAD"]);
    let (mut cx, view) = setup(&f);

    open(&mut cx, view, &f.root);
    let p = picker(&mut cx, view);

    click(&mut cx, view, "branch-integrate");
    settle(&mut cx, view);
    p.update(&mut cx, |picker, cx| {
        picker
            .integration_query
            .update(cx, |input, cx| input.set_text("FEATURE/UI", cx))
    });
    settle(&mut cx, view);
    key(&mut cx, view, "down");
    key(&mut cx, view, "space");
    assert!(p.read_with(&cx, |picker, _| matches!(
        picker.phase,
        Phase::Integrate {
            target: Some(_),
            ..
        }
    )));

    for mode in [
        "integration-mode-merge",
        "integration-mode-rebase",
        "integration-mode-squash-merge",
    ] {
        click(&mut cx, view, mode);
        settle(&mut cx, view);
        let mut visual = gpui::VisualTestContext::from_window(view.into(), &cx);
        let form = visual.debug_bounds("branch-integration-form").unwrap();
        let list = visual.debug_bounds("integration-target-list").unwrap();
        let footer = visual.debug_bounds("integration-actions").unwrap();
        let guidance = visual.debug_bounds("integration-guidance").unwrap();

        assert_eq!(form.size.width, px(280.));
        assert!(list.size.height > px(50.));
        assert!(guidance.bottom() <= footer.top());
        assert!(footer.bottom() <= form.bottom());
    }

    p.update(&mut cx, |picker, cx| {
        picker
            .integration_query
            .update(cx, |input, cx| input.set_text("missing", cx))
    });
    settle(&mut cx, view);
    confirm(&mut cx, view, &p);
    assert_eq!(f.git(&["rev-parse", "HEAD"]), old);
    assert!(p.read_with(&cx, |picker, _| matches!(
        picker.phase,
        Phase::Integrate { target: None, .. }
    ) && picker.visible.is_empty()));
    key(&mut cx, view, "escape");
    assert!(p.read_with(&cx, |picker, _| matches!(picker.phase, Phase::List)));
    cx.update(|cx| cx.set_reduce_motion(true));
    click(&mut cx, view, "branch-integrate");
    draw(&mut cx, view);
    assert_eq!(
        gpui::VisualTestContext::from_window(view.into(), &cx)
            .debug_bounds("workspace-branch-body")
            .unwrap()
            .size
            .height,
        px(440.)
    );
    cx.executor().advance_clock(Duration::from_secs(1));
    draw(&mut cx, view);
    cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
            .unwrap(),
        0
    );
    p.update(&mut cx, |picker, cx| {
        picker
            .integration_query
            .update(cx, |input, cx| input.set_text("feature/ui", cx))
    });
    settle(&mut cx, view);
    key(&mut cx, view, "down");
    key(&mut cx, view, "space");
    key(&mut cx, view, "enter");
    settle(&mut cx, view);
    assert_ne!(f.git(&["rev-parse", "HEAD"]), old);
    assert_eq!(f.git(&["symbolic-ref", "--short", "HEAD"]), b"main\n");
}

#[test]
fn integration_modes_confirm_once_preserve_drafts_and_keep_exact_recovery_tips() {
    for (mode, prefix) in [
        ("integration-mode-rebase", "rebase"),
        ("integration-mode-squash-merge", "squash-merge"),
    ] {
        let f = diverged();
        let old = f.git(&["rev-parse", "HEAD"]);
        let target = f.git(&["rev-parse", "feature/ui"]);
        let (mut cx, view) = setup(&f);
        let tab = open(&mut cx, view, &f.root);

        tab.update(&mut cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text("Ordinary draft", cx))
        });
        let p = picker(&mut cx, view);

        click(&mut cx, view, "branch-integrate");
        settle(&mut cx, view);
        click(&mut cx, view, mode);
        choose(&mut cx, view, &p, "feature/ui");
        settle(&mut cx, view);

        if prefix == "squash-merge" {
            view.update(&mut cx, |_, _, cx| {
                let state = p.read(cx).integration_message.clone();

                state.update(cx, |input, cx| {
                    input.select(0..0, cx);
                });
                cx.notify();
            })
            .unwrap();
            draw(&mut cx, view);
            view.update(&mut cx, |_, window, cx| {
                let state = p.read(cx).integration_message.clone();

                state.update(cx, |input, cx| {
                    let start = input
                        .bounds_for_range(0..0, Default::default(), window, cx)
                        .unwrap();

                    let len = input.text().encode_utf16().count();

                    let end = input
                        .bounds_for_range(len..len, Default::default(), window, cx)
                        .unwrap();

                    assert_eq!(
                        start.top(),
                        end.top(),
                        "reference compact message fits one visual line"
                    );
                    assert_eq!(
                        start.size.height,
                        gpui::px(16.),
                        "reference uses small text leading"
                    );
                });
            })
            .unwrap();
            p.update(&mut cx, |picker, cx| {
                picker
                    .integration_message
                    .update(cx, |input, cx| input.set_text("  ", cx))
            });
            confirm(&mut cx, view, &p);
            assert_eq!(f.git(&["rev-parse", "HEAD"]), old);
            p.update(&mut cx, |picker, cx| {
                picker
                    .integration_message
                    .update(cx, |input, cx| input.set_text("Combined topic", cx))
            });
        }

        view.update(&mut cx, |_, window, cx| {
            p.update(cx, |picker, cx| {
                picker.confirm(window, cx);
                picker.confirm(window, cx);
            });
        })
        .unwrap();
        view.update(&mut cx, |workspace, window, cx| {
            workspace.close(workspace.tabs[0].id, window, cx)
        })
        .unwrap();
        view.read_with(&cx, |workspace, cx| {
            assert_eq!(workspace.tabs.len(), 1);
            assert!(workspace.branch_host.is_open(cx));
            assert!(p.read(cx).busy);
        })
        .unwrap();
        key(&mut cx, view, "escape");
        settle(&mut cx, view);
        assert_eq!(
            f.git(&[
                "for-each-ref",
                "--format=%(objectname)",
                &format!("refs/1git/{prefix}/")
            ]),
            old
        );

        if prefix == "rebase" {
            assert_eq!(f.git(&["rev-parse", "HEAD^"]), target);
        } else {
            assert_eq!(f.git(&["log", "-1", "--format=%s"]), b"Combined topic\n");
        }

        tab.read_with(&cx, |tab, cx| {
            assert_eq!(tab.summary.read(cx).text(), "Ordinary draft")
        });
    }
}

#[test]
fn integration_rejects_stale_tips_and_published_rebase_without_replaying_or_creating_recovery_refs()
{
    for scenario in ["target", "source", "published"] {
        let f = diverged();
        let (mut cx, view) = setup(&f);
        let tab = open(&mut cx, view, &f.root);

        tab.update(&mut cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text("Keep draft", cx))
        });
        let p = picker(&mut cx, view);

        click(&mut cx, view, "branch-integrate");
        settle(&mut cx, view);
        click(&mut cx, view, "integration-mode-rebase");
        choose(&mut cx, view, &p, "feature/ui");
        settle(&mut cx, view);

        match scenario {
            "target" => {
                f.git(&["update-ref", "refs/heads/feature/ui", "HEAD"]);
            }
            "source" => {
                f.git(&["commit", "--allow-empty", "-m", "External advance"]);
            }
            _ => {
                f.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
            }
        }

        let before = f.git(&["rev-parse", "HEAD"]);

        confirm(&mut cx, view, &p);
        assert_eq!(f.git(&["rev-parse", "HEAD"]), before);
        assert!(
            f.git(&["for-each-ref", "--format=%(refname)", "refs/1git/"])
                .is_empty()
        );
        assert!(p.read_with(&cx, |picker, _| {
            picker
                .error
                .as_ref()
                .unwrap()
                .contains("Close and reopen Branches")
        }));
        confirm(&mut cx, view, &p);
        assert_eq!(f.git(&["rev-parse", "HEAD"]), before);
        tab.read_with(&cx, |tab, cx| {
            assert_eq!(tab.summary.read(cx).text(), "Keep draft")
        });
    }
}

#[test]
fn integration_pauses_in_changes_and_existing_resolution_continue_and_abort_keep_drafts_and_recovery()
 {
    for (mode, prefix, operation) in [
        ("integration-mode-merge", "merge", OperationState::Merge),
        ("integration-mode-rebase", "rebase", OperationState::Rebase),
        (
            "integration-mode-squash-merge",
            "squash-merge",
            OperationState::SquashMerge,
        ),
    ] {
        let f = fixture();

        f.git(&["switch", "feature/ui"]);
        f.write("a.txt", "topic\n");
        f.commit();
        f.git(&["switch", "main"]);
        f.write("a.txt", "main\n");
        f.commit();
        let old = f.git(&["rev-parse", "HEAD"]);
        let (mut cx, view) = setup(&f);
        let tab = open(&mut cx, view, &f.root);
        let duplicate = open(&mut cx, view, &f.root);

        tab.update(&mut cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text("Keep ordinary draft", cx));
            tab.change_section(&"history".into(), cx);
        });
        view.update(&mut cx, |workspace, window, cx| {
            workspace.activate(1, window, cx)
        })
        .unwrap();
        let p = picker(&mut cx, view);

        click(&mut cx, view, "branch-integrate");
        settle(&mut cx, view);
        click(&mut cx, view, mode);
        choose(&mut cx, view, &p, "feature/ui");
        confirm(&mut cx, view, &p);
        view.read_with(&cx, |workspace, cx| {
            assert!(!workspace.branch_host.is_open(cx))
        })
        .unwrap();

        for tab in [&tab, &duplicate] {
            tab.read_with(&cx, |tab, _| {
                let RepositoryState::Ready(source) = &tab.state else {
                    panic!("ready conflict");
                };

                assert_eq!(source.snapshot.operation, operation);
            });
        }

        tab.read_with(&cx, |tab, cx| {
            assert_eq!(tab.section, Section::Changes);
            assert_eq!(tab.summary.read(cx).text(), "Keep ordinary draft");
        });
        assert!(
            gpui::VisualTestContext::from_window(view.into(), &cx)
                .debug_bounds("operation-abort-button")
                .is_some()
        );

        if operation != OperationState::Rebase {
            let resolution = tab.read_with(&cx, |tab, _| {
                let PreviewState::Ready(Preview::Conflict(preview)) = &tab.preview else {
                    panic!("conflict preview");
                };

                preview.resolve(Some(ConflictSide::Theirs))
            });

            view.update(&mut cx, |workspace, window, cx| {
                workspace.submit_conflict(1, &conflicts::Submit(resolution), window, cx)
            })
            .unwrap();
            draw(&mut cx, view);
        }

        let finish = tab.read_with(&cx, |tab, _| {
            let RepositoryState::Ready(source) = &tab.state else {
                panic!("ready");
            };

            conflicts::finish_request(
                &source.snapshot,
                if operation == OperationState::Rebase {
                    FinishKind::Abort
                } else {
                    FinishKind::Continue
                },
            )
            .unwrap()
        });

        view.update(&mut cx, |workspace, window, cx| {
            workspace.submit_conflict(1, &conflicts::Submit(finish), window, cx)
        })
        .unwrap();
        draw(&mut cx, view);
        tab.read_with(&cx, |tab, cx| {
            let RepositoryState::Ready(source) = &tab.state else {
                panic!("ready");
            };

            assert_eq!(source.snapshot.operation, OperationState::Normal);
            assert_eq!(tab.summary.read(cx).text(), "Keep ordinary draft");
        });
        assert_eq!(
            f.git(&[
                "for-each-ref",
                "--format=%(objectname)",
                &format!("refs/1git/{prefix}/")
            ]),
            old
        );

        if operation == OperationState::Rebase {
            assert_eq!(f.git(&["rev-parse", "HEAD"]), old);
        }
    }
}

#[test]
fn integration_preserves_immutable_history_file_and_nonzero_split_diff_scroll() {
    use rake::gpui::InputEvent as _;
    let f = Fixture::new();

    f.write(
        "a.txt",
        &(0..220)
            .map(|n| format!("line {n} {}\n", "a".repeat(180)))
            .collect::<String>(),
    );
    f.commit();
    let base = String::from_utf8(f.git(&["rev-parse", "HEAD"]))
        .unwrap()
        .trim()
        .to_owned();

    f.git(&["switch", "-c", "feature/ui"]);
    f.write("topic.txt", "topic\n");
    f.commit();
    f.git(&["switch", "main"]);
    f.write("main.txt", "main\n");
    f.commit();
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    view.update(&mut cx, |_, window, cx| {
        tab.update(cx, |tab, cx| {
            let mut saved = tab.history.read(cx).session(cx);

            saved.commit = Some(base.clone());
            saved.file = Some(b"a.txt".to_vec());
            saved.split_diff = true;
            tab.history.update(cx, |history, cx| {
                history.restore_preferences(&saved, window, cx);
                history.restore_selection(&saved, cx);
            });
            tab.change_section(&"history".into(), cx);
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
        );
    })
    .unwrap();
    draw(&mut cx, view);
    let before = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("diff-new-11")
        .unwrap();

    let saved = tab.read_with(&cx, |tab, cx| tab.history.read(cx).session(cx));
    let p = picker(&mut cx, view);

    click(&mut cx, view, "branch-integrate");
    settle(&mut cx, view);
    click(&mut cx, view, "integration-mode-rebase");
    choose(&mut cx, view, &p, "feature/ui");
    confirm(&mut cx, view, &p);
    let after = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("diff-new-11")
        .unwrap();

    assert_eq!(after.origin, before.origin);
    let after = tab.read_with(&cx, |tab, cx| tab.history.read(cx).session(cx));

    assert_eq!(after.commit, saved.commit);
    assert_eq!(after.file, saved.file);
    assert_eq!(after.split_diff, saved.split_diff);
    assert_eq!(after.sidebar, saved.sidebar);
    assert_eq!(after.detail_fraction, saved.detail_fraction);
    assert_eq!(after.range, saved.range);
}

#[test]
fn integration_is_unavailable_for_dirty_detached_and_paused_repositories() {
    for scenario in ["dirty", "detached", "paused"] {
        let f = diverged();

        match scenario {
            "dirty" => {
                f.write("keep.txt", "untracked work\n");
            }
            "detached" => {
                f.git(&["checkout", "--detach", "HEAD"]);
            }
            _ => {
                f.git(&["merge", "--no-commit", "feature/ui"]);
            }
        }

        let before = f.git(&["status", "--porcelain=v1", "-z"]);
        let head = f.git(&["rev-parse", "HEAD"]);
        let (mut cx, view) = setup(&f);

        open(&mut cx, view, &f.root);
        let p = picker(&mut cx, view);

        click(&mut cx, view, "branch-integrate");
        settle(&mut cx, view);
        assert!(p.read_with(&cx, |picker, _| matches!(picker.phase, Phase::List)));
        assert_eq!(f.git(&["status", "--porcelain=v1", "-z"]), before);
        assert_eq!(f.git(&["rev-parse", "HEAD"]), head);
    }
}

#[test]
fn acknowledged_integration_reports_recovery_and_requires_review_when_a_peer_refresh_fails() {
    use crate::workspace::write;
    use onegit_git::{BranchIdentity, IntegrationKind, IntegrationRequest, Repository};
    let f = diverged();
    let linked = f.directory.path().join("broken-integration-peer");

    f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    let source = f.load();
    let peer = std::sync::Arc::new(Repository::open(&linked, f.process(), None).unwrap());

    std::fs::remove_file(linked.join(".git")).unwrap();
    let target = source
        .repository
        .branches(None)
        .unwrap()
        .branches
        .into_iter()
        .find(|branch| branch.name == "feature/ui")
        .unwrap();

    let expected = BranchIdentity::from_snapshot(&source.snapshot);

    let outcome = write::run(
        source,
        write::Operation::Integration {
            request: IntegrationRequest {
                kind: IntegrationKind::Merge,
                target: target.full_name,
                expected_target: target.oid,
                reviewed_source: Some(expected.clone()),
                expected,
                message: None,
            },
            peers: vec![peer],
        },
    );

    let detail = outcome.result.unwrap_err();

    assert!(detail.contains("Recovery ref: refs/1git/merge/"));
    assert!(detail.contains("could not be refreshed"));
    assert!(outcome.branch_action.unwrap().needs_review);
    assert!(
        !f.git(&["for-each-ref", "--format=%(refname)", "refs/1git/merge/"])
            .is_empty()
    );
    assert_eq!(
        String::from_utf8(f.git(&["show", "-s", "--format=%P"]))
            .unwrap()
            .split_whitespace()
            .count(),
        2
    );
}
