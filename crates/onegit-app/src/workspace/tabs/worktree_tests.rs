//! Source mappings: workspace-menu.component and repository-branches.integration worktree cases.
use super::branch_tests::{confirm, fixture, picker, settle};
use super::tests::{open, setup};
use super::*;
use crate::workspace::branches::worktrees::Form;
use std::fs;

#[test]
fn creates_and_opens_a_worktree_from_dirty_source_and_keeps_original_tabs_and_drafts() {
    let f = fixture();

    f.write("a.txt", "keep working\\n");
    let before = crate::workspace::tests::contents(&f.root)
        .into_iter()
        .filter(|(path, _)| !path.starts_with(".git/"))
        .collect::<std::collections::BTreeMap<_, _>>();

    let head = f.git(&["rev-parse", "HEAD"]);
    let index = fs::read(f.root.join(".git/index")).unwrap();
    let (mut cx, view) = setup(&f);
    let first = open(&mut cx, view, &f.root);

    first.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |input, cx| input.set_text("Keep draft", cx))
    });
    let second = open(&mut cx, view, &f.root);
    let p = picker(&mut cx, view);
    let destination = f.directory.path().join("new checkout");

    view.update(&mut cx, |_, window, cx| {
        p.update(cx, |p, cx| p.create_worktree(window, cx))
    })
    .unwrap();
    p.update(&mut cx, |p, cx| {
        p.worktrees
            .name
            .update(cx, |input, cx| input.set_text("new/worktree", cx));
        p.worktrees.destination = Some(destination.clone());
    });
    super::branch_tests::key(&mut cx, view, "enter");
    assert!(
        !destination.exists(),
        "Enter in the branch field must not accept the creation confirmation"
    );
    confirm(&mut cx, view, &p);
    assert!(destination.join("a.txt").exists());
    assert_eq!(
        crate::workspace::tests::contents(&f.root)
            .into_iter()
            .filter(|(path, _)| !path.starts_with(".git/"))
            .collect::<std::collections::BTreeMap<_, _>>(),
        before
    );
    assert_eq!(f.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(
        first.read_with(&cx, |tab, cx| tab.summary.read(cx).text().to_owned()),
        "Keep draft"
    );
    view.read_with(&cx, |w, cx| {
        assert_eq!(w.tabs.len(), 3);
        assert_eq!(w.tabs[0].workspace.entity_id(), first.entity_id());
        assert_eq!(w.tabs[1].workspace.entity_id(), second.entity_id());

        let RepositoryState::Ready(loaded) = &w.tabs[2].workspace.read(cx).state else {
            panic!("created checkout must open")
        };

        assert_eq!(
            loaded.snapshot.repository.root,
            fs::canonicalize(&destination).unwrap()
        );
        assert_eq!(
            loaded.snapshot.status.head.branch.as_deref(),
            Some("new/worktree")
        );
    })
    .unwrap();
}

#[test]
fn moving_open_duplicate_worktree_tabs_retains_entities_drafts_navigation_and_session_paths() {
    let f = fixture();
    let old = f.directory.path().join("linked checkout");

    f.git(&["worktree", "add", old.to_str().unwrap(), "feature/ui"]);
    fs::write(old.join("a.txt"), "linked work\\n").unwrap();
    let destination = f.directory.path().join("moved checkout");
    let (mut cx, view) = setup(&f);
    let linked = open(&mut cx, view, &old);
    let duplicate = open(&mut cx, view, &old);

    linked.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |input, cx| input.set_text("Linked draft", cx));
        tab.filter
            .update(cx, |input, cx| input.set_text("a.txt", cx));
    });
    let original = linked.read_with(&cx, |tab, _| {
        (
            tab.selected.clone(),
            tab.history.clone(),
            tab.graph.clone(),
            tab.diff_state.as_ref().map(|state| state.entity_id()),
        )
    });

    open(&mut cx, view, &f.root);
    let p = picker(&mut cx, view);

    let target = p.read_with(&cx, |p, _| {
        p.worktrees
            .items
            .iter()
            .find(|t| t.path == fs::canonicalize(&old).unwrap())
            .unwrap()
            .clone()
    });

    view.update(&mut cx, |_, window, cx| {
        p.update(cx, |p, cx| p.edit_worktree(target, Form::Move, window, cx))
    })
    .unwrap();
    p.update(&mut cx, |p, cx| {
        p.worktrees.path.update(cx, |input, cx| {
            input.set_text(destination.to_string_lossy(), cx)
        })
    });
    confirm(&mut cx, view, &p);
    assert!(!old.exists());
    assert_eq!(
        fs::read(destination.join("a.txt")).unwrap(),
        b"linked work\\n"
    );

    for tab in [&linked, &duplicate] {
        tab.read_with(&cx, |tab, _| {
            let RepositoryState::Ready(loaded) = &tab.state else {
                panic!("moved tab must remain ready")
            };

            assert_eq!(
                loaded.snapshot.repository.root,
                fs::canonicalize(&destination).unwrap()
            );
        });
    }

    linked.read_with(&cx, |tab, cx| {
        assert_eq!(tab.summary.read(cx).text(), "Linked draft");
        assert_eq!(tab.selected, original.0);
        assert_eq!(tab.history.entity_id(), original.1.entity_id());
        assert_eq!(tab.graph.entity_id(), original.2.entity_id());
        assert_eq!(
            tab.diff_state.as_ref().map(|state| state.entity_id()),
            original.3
        );
        assert_eq!(tab.filter.read(cx).text(), "a.txt");
    });
    view.read_with(&cx, |w, cx| {
        assert!(
            !format!(
                "{:?}",
                w.tabs
                    .iter()
                    .filter_map(|tab| session::SavedTab::capture(tab.workspace.read(cx), cx))
                    .collect::<Vec<_>>()
            )
            .contains(old.to_str().unwrap())
        )
    })
    .unwrap();
}

#[test]
fn removal_keeps_tabs_drafts_and_selection_but_never_removes_dirty_or_stale_targets() {
    let f = fixture();
    let linked_path = f.directory.path().join("removable checkout");

    f.git(&[
        "worktree",
        "add",
        linked_path.to_str().unwrap(),
        "feature/ui",
    ]);
    let (mut cx, view) = setup(&f);
    let linked = open(&mut cx, view, &linked_path);

    linked.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |input, cx| input.set_text("Retained draft", cx))
    });
    let origin = open(&mut cx, view, &f.root);
    let p = picker(&mut cx, view);

    let target = p.read_with(&cx, |p, _| {
        p.worktrees
            .items
            .iter()
            .find(|t| t.path == fs::canonicalize(&linked_path).unwrap())
            .unwrap()
            .clone()
    });

    view.update(&mut cx, |_, window, cx| {
        p.update(cx, |p, cx| {
            p.edit_worktree(target, Form::Remove, window, cx)
        })
    })
    .unwrap();
    fs::write(linked_path.join("untracked"), "keep").unwrap();
    confirm(&mut cx, view, &p);
    assert!(linked_path.exists());
    assert!(p.read_with(&cx, |p, _| p.error.is_some()));
    fs::remove_file(linked_path.join("untracked")).unwrap();
    view.update(&mut cx, |_, window, cx| {
        p.update(cx, |p, cx| p.close(window, cx))
    })
    .unwrap();
    origin.update(&mut cx, |tab, cx| tab.refresh(cx));
    settle(&mut cx, view);
    let p = picker(&mut cx, view);

    let target = p.read_with(&cx, |p, _| {
        p.worktrees
            .items
            .iter()
            .find(|t| t.path == fs::canonicalize(&linked_path).unwrap())
            .unwrap()
            .clone()
    });

    view.update(&mut cx, |_, window, cx| {
        p.update(cx, |p, cx| {
            p.edit_worktree(target, Form::Remove, window, cx)
        })
    })
    .unwrap();
    confirm(&mut cx, view, &p);
    assert!(!linked_path.exists());
    assert_eq!(
        linked.read_with(&cx, |tab, cx| tab.summary.read(cx).text().to_owned()),
        "Retained draft"
    );
    assert!(linked.read_with(&cx, |tab, _| matches!(
        tab.state,
        RepositoryState::Failed { .. }
    )));
    assert!(origin.read_with(&cx, |tab, _| matches!(tab.state, RepositoryState::Ready(_))));
    assert_eq!(view.read_with(&cx, |w, _| w.tabs.len()).unwrap(), 2);
    assert_eq!(
        String::from_utf8(f.git(&["rev-parse", "feature/ui"])).unwrap(),
        String::from_utf8(f.git(&["rev-parse", "main"])).unwrap()
    );
    settle(&mut cx, view);
}

#[test]
fn worktree_submenu_keyboard_open_reuses_tab_focus_and_flips_inside_window_without_idle_motion() {
    for reduced in [false, true] {
        let f = fixture();
        let linked_path = f.directory.path().join("keyboard checkout");

        f.git(&[
            "worktree",
            "add",
            linked_path.to_str().unwrap(),
            "feature/ui",
        ]);
        let (mut cx, view) = setup(&f);

        cx.update(|cx| cx.set_reduce_motion(reduced));
        let linked = open(&mut cx, view, &linked_path);
        let origin = open(&mut cx, view, &f.root);
        let _ = picker(&mut cx, view);

        super::branch_tests::click(&mut cx, view, "worktrees-trigger");
        settle(&mut cx, view);
        let mut visual = gpui::VisualTestContext::from_window(view.into(), &cx);

        let popup = visual
            .debug_bounds("worktree-submenu")
            .expect("worktree submenu must paint");

        let trigger = visual.debug_bounds("worktrees-trigger").unwrap();

        assert_eq!(
            trigger.top(),
            px(180.),
            "source sidebar grouping retains a 4px gap before Worktrees"
        );
        assert!(
            popup.left() >= trigger.right(),
            "popup {popup:?}, trigger {trigger:?}"
        );
        assert!(popup.right() <= px(1280.));
        super::branch_tests::key(&mut cx, view, "down");
        super::branch_tests::key(&mut cx, view, "enter");
        settle(&mut cx, view);
        view.read_with(&cx, |w, _| {
            assert_eq!(w.tabs.len(), 2);
            assert_eq!(
                w.tabs
                    .iter()
                    .find(|t| Some(t.id) == w.active)
                    .unwrap()
                    .workspace
                    .entity_id(),
                linked.entity_id()
            );
        })
        .unwrap();
        assert_ne!(linked.entity_id(), origin.entity_id());
        let p = picker(&mut cx, view);

        view.update(&mut cx, |workspace, window, cx| {
            workspace.open_branches(Some(gpui::point(px(980.), px(84.))), window, cx);
        })
        .unwrap();
        settle(&mut cx, view);
        view.update(&mut cx, |_, window, cx| {
            p.update(cx, |p, cx| {
                p.show_worktrees(true, window, cx);
            })
        })
        .unwrap();
        settle(&mut cx, view);
        let mut visual = gpui::VisualTestContext::from_window(view.into(), &cx);
        let popup = visual.debug_bounds("worktree-submenu").unwrap();
        let trigger = visual.debug_bounds("worktrees-trigger").unwrap();

        assert!(popup.right() <= trigger.left());
        super::branch_tests::key(&mut cx, view, "left");
        settle(&mut cx, view);
        assert!(
            gpui::VisualTestContext::from_window(view.into(), &cx)
                .debug_bounds("worktree-submenu")
                .is_none()
        );
        cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
            .unwrap();
        settle(&mut cx, view);
        assert_eq!(
            cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
                .unwrap(),
            0
        );
    }
}
