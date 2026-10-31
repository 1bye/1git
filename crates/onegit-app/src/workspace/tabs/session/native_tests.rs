//! Restart contracts use fresh native windows and real, disposable Git repositories.
use super::*;

use crate::workspace::{
    tabs::{
        Request,
        tests::{draw, open, setup},
    },
    tests::{Fixture, contents},
};

use std::{fs, time::Duration};

fn enable(
    view: gpui::WindowHandle<Workspace>,
    cx: &mut gpui::TestAppContext,
    path: &std::path::Path,
) {
    view.update(cx, |workspace, _, _| {
        workspace.session = Some(Session {
            store: Store::new(path.into()),
            timer: None,
            quitting: false,
        })
    })
    .unwrap();
}

fn restart(
    f: &Fixture,
    path: &std::path::Path,
) -> (gpui::TestAppContext, gpui::WindowHandle<Workspace>) {
    let (mut cx, view) = setup(f);

    view.update(&mut cx, |workspace, _, cx| {
        workspace.load_session_from(path.into(), cx)
    })
    .unwrap();
    draw(&mut cx, view);

    (cx, view)
}

fn close(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Workspace>) {
    cx.update_window(view.into(), |_, window, _| window.remove_window())
        .unwrap();
    cx.run_until_parked();
}

#[test]
fn restart_restores_order_duplicate_root_drafts_selections_modes_filters_and_panes() {
    let f = Fixture::new();

    f.write("a.txt", "initial a\n");
    f.write("b.txt", "initial b\n");
    f.commit();
    f.write("a.txt", "staged a\n");
    f.git(&["add", "a.txt"]);
    f.write("a.txt", "working a\n");
    f.write("b.txt", "working b\n");
    let before = contents(&f.root);
    let store_dir = tempfile::tempdir().unwrap();
    let path = store_dir.path().join("workspace.json");
    let (mut cx, view) = setup(&f);

    enable(view, &mut cx, &path);
    let first = open(&mut cx, view, &f.root);
    let second = open(&mut cx, view, &f.root);

    view.update(&mut cx, |workspace, window, cx| {
        first.update(cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text("First draft ✨", cx));
            tab.description.update(cx, |input, cx| {
                input.set_text("Body\nwith blank line\n\n", cx)
            });
            tab.filter_visible = true;
            tab.filter
                .update(cx, |input, cx| input.set_text("a.txt", cx));
            tab.view = DiffView::Split;
            tab.select(
                ChangeKey {
                    path: GitPath::new("a.txt").unwrap(),
                    side: Side::Staged,
                },
                cx,
            );
            tab.split
                .update(cx, |split, cx| split.resize(px(365.), window, cx));
            cx.notify();
        });
        second.update(cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text("Second draft", cx));
            tab.change_section(&gpui::ElementId::from("history"), cx);
        });
        let a = workspace.tabs[0].id;
        let b = workspace.tabs[1].id;

        workspace.request(&Request::Move(b, a), window, cx);
        workspace.request(&Request::Activate(a), window, cx);
    })
    .unwrap();
    draw(&mut cx, view);
    view.update(&mut cx, |_, window, cx| {
        second.update(cx, |tab, cx| {
            tab.history.update(cx, |history, cx| {
                let mut saved = history.session(cx);

                saved.file = Some(b"b.txt".to_vec());
                saved.split_diff = true;
                saved.sidebar = 387.;
                saved.detail_fraction = 0.62;
                history.restore_preferences(&saved, window, cx);
                history.restore_selection(&saved, cx);
            })
        })
    })
    .unwrap();
    draw(&mut cx, view);
    let expected = view
        .update(&mut cx, |workspace, _, cx| workspace.capture_session(cx))
        .unwrap();

    close(&mut cx, view);
    assert_eq!(
        Store::load(&path).unwrap(),
        Some(expected.clone()),
        "close flushes without advancing the debounce clock"
    );
    // Fresh Git data, rather than a serialized snapshot, must be used on the next launch.
    f.write("new-after-close.txt", "fresh status\n");
    let (mut next, restored) = restart(&f, &path);

    let actual = restored
        .update(&mut next, |workspace, _, cx| {
            assert_eq!(workspace.tabs.len(), 2);
            assert!(
                workspace
                    .tabs
                    .iter()
                    .all(|tab| matches!(tab.workspace.read(cx).state, RepositoryState::Ready(_)))
            );

            workspace.capture_session(cx)
        })
        .unwrap();

    assert_eq!(actual, expected);
    restored.update(&mut next,|workspace,_,cx| {
        let tab=workspace.tabs[1].workspace.read(cx);

        assert!(matches!(&tab.state,RepositoryState::Ready(loaded) if loaded.files.iter().any(|f|f.key.path.as_bytes()==b"new-after-close.txt")));
        assert!(workspace.tabs.iter().all(|tab|tab.workspace.read(cx).write_job.is_none()));
    }).unwrap();
    close(&mut next, restored);
    fs::remove_file(f.root.join("new-after-close.txt")).unwrap();
    assert_eq!(
        contents(&f.root),
        before,
        "session recovery must never mutate repository bytes, index, or refs"
    );
}

#[test]
fn home_and_intentionally_empty_session_survive_restart() {
    let f = Fixture::new();

    f.write("a", "a");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.json");
    let (mut cx, view) = setup(&f);

    enable(view, &mut cx, &path);
    open(&mut cx, view, &f.root);
    view.update(&mut cx, |workspace, window, cx| {
        workspace.request(&Request::Home, window, cx)
    })
    .unwrap();
    close(&mut cx, view);
    let (mut cx, view) = restart(&f, &path);

    view.update(&mut cx, |workspace, window, cx| {
        assert!(workspace.active.is_none());
        assert_eq!(workspace.tabs.len(), 1);
        workspace.request(&Request::Close(workspace.tabs[0].id), window, cx);
    })
    .unwrap();
    close(&mut cx, view);
    let (mut cx, view) = restart(&f, &path);

    view.update(&mut cx, |workspace, _, _| {
        assert!(workspace.active.is_none());
        assert!(workspace.tabs.is_empty());
    })
    .unwrap();
    close(&mut cx, view);
}

#[test]
fn unavailable_repository_keeps_draft_and_selection_for_retry_and_another_restart() {
    let f = Fixture::new();

    f.write("a", "changed");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.json");
    let (mut cx, view) = setup(&f);

    enable(view, &mut cx, &path);
    let tab = open(&mut cx, view, &f.root);

    cx.update(|cx| {
        tab.update(cx, |tab, cx| {
            tab.summary.update(cx, |input, cx| {
                input.set_text("Keep missing repo draft", cx)
            })
        })
    });
    let expected = view
        .update(&mut cx, |workspace, _, cx| workspace.capture_session(cx))
        .unwrap();

    close(&mut cx, view);
    let moved = f.directory.path().join("moved");

    fs::rename(&f.root, &moved).unwrap();
    let (mut cx, view) = restart(&f, &path);

    view.update(&mut cx, |workspace, _, cx| {
        assert!(matches!(
            workspace.tabs[0].workspace.read(cx).state,
            RepositoryState::Failed { .. }
        ));
        assert_eq!(workspace.capture_session(cx), expected);
    })
    .unwrap();
    close(&mut cx, view);
    fs::rename(&moved, &f.root).unwrap();
    let (mut cx, view) = restart(&f, &path);

    view.update(&mut cx, |workspace, _, cx| {
        assert_eq!(workspace.capture_session(cx), expected);
        assert!(matches!(
            workspace.tabs[0].workspace.read(cx).state,
            RepositoryState::Ready(_)
        ));
    })
    .unwrap();
    close(&mut cx, view);
}

#[test]
fn corrupt_session_disables_saving_and_debounce_saves_latest_input_without_render_writes() {
    let f = Fixture::new();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.json");

    fs::write(&path, "{broken draft").unwrap();
    let (mut cx, view) = restart(&f, &path);

    view.update(&mut cx, |workspace, _, _| {
        assert!(workspace.session.is_none());
        assert!(workspace.session_error.is_some());
    })
    .unwrap();
    open(&mut cx, view, &f.root);
    close(&mut cx, view);
    assert_eq!(fs::read_to_string(&path).unwrap(), "{broken draft");
    fs::remove_file(&path).unwrap();
    let (mut cx, view) = restart(&f, &path);
    let tab = open(&mut cx, view, &f.root);

    for value in ["d", "dr", "draft"] {
        cx.update(|cx| {
            tab.update(cx, |tab, cx| {
                tab.summary
                    .update(cx, |input, cx| input.set_text(value, cx))
            })
        });
    }

    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_millis(300));
    draw(&mut cx, view);
    assert_eq!(
        Store::load(&path).unwrap().unwrap().tabs[0].summary,
        "draft"
    );
    let modified = fs::metadata(&path).unwrap().modified().unwrap();

    draw(&mut cx, view);
    cx.executor().advance_clock(Duration::from_secs(1));
    draw(&mut cx, view);
    assert_eq!(
        fs::metadata(&path).unwrap().modified().unwrap(),
        modified,
        "unchanged renders must not write session files"
    );
    close(&mut cx, view);
}

#[test]
fn queued_startup_and_quit_keep_all_tab_intent_before_reads_finish() {
    let f = Fixture::new();

    f.write("a", "data");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.json");
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);
    let saved = cx.read(|cx| SavedTab::capture(tab.read(cx), cx).unwrap());
    let mut tabs = Vec::new();

    for index in 0..9 {
        let mut tab = saved.clone();

        tab.summary = format!("Queued {index}");
        tabs.push(tab);
    }

    let expected = Document {
        version: 1,
        active: Some(7),
        tabs,
    };

    close(&mut cx, view);
    let (mut cx, view) = setup(&f);

    enable(view, &mut cx, &path);
    view.update(&mut cx, |workspace, window, cx| {
        workspace.restore_session(expected.clone(), window, cx);
        assert_eq!(
            workspace
                .tabs
                .iter()
                .filter(|tab| tab.workspace.read(cx).load_job.is_some())
                .count(),
            4
        );
        assert_eq!(
            workspace.capture_session(cx),
            expected,
            "queued tabs retain drafts and navigation immediately"
        );
        // The app-quit hook must save even before a frame or debounce interval.
    })
    .unwrap();
    cx.update(|cx| cx.shutdown());
    assert_eq!(Store::load(&path).unwrap(), Some(expected));
    let (mut restored_cx, restored) = restart(&f, &path);

    restored
        .update(&mut restored_cx, |workspace, _, cx| {
            assert_eq!(workspace.tabs.len(), 9);
            assert!(
                workspace
                    .tabs
                    .iter()
                    .all(|tab| matches!(tab.workspace.read(cx).state, RepositoryState::Ready(_)))
            );
        })
        .unwrap();
    close(&mut restored_cx, restored);
}

#[test]
fn history_restores_an_exact_commit_outside_the_first_page_after_head_changes() {
    let f = Fixture::new();

    f.write("a.txt", "first a\n");
    f.write("b.txt", "first b\n");
    f.commit();
    let oid = String::from_utf8(f.git(&["rev-parse", "HEAD"]))
        .unwrap()
        .trim()
        .to_owned();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.json");
    let (mut cx, view) = setup(&f);

    enable(view, &mut cx, &path);
    let tab = open(&mut cx, view, &f.root);

    view.update(&mut cx, |_, _, cx| {
        tab.update(cx, |view, cx| {
            view.change_section(&gpui::ElementId::from("history"), cx)
        })
    })
    .unwrap();
    draw(&mut cx, view);
    close(&mut cx, view);

    for index in 0..53 {
        f.git(&["commit", "--allow-empty", "-m", &format!("New {index}")]);
    }

    let before = contents(&f.root);
    let (mut cx, view) = restart(&f, &path);

    view.update(&mut cx, |workspace, _, cx| {
        let history = workspace.tabs[0].workspace.read(cx).history.read(cx);
        let restored = history.session(cx);

        assert_eq!(restored.commit.as_deref(), Some(oid.as_str()));
        assert_eq!(restored.file.as_deref(), Some(b"a.txt".as_slice()));
        assert!(
            history.session_preview_ready(),
            "exact old commit patch is read even outside the restored list page"
        );
    })
    .unwrap();
    close(&mut cx, view);
    assert_eq!(contents(&f.root), before);
}

#[test]
fn removed_nested_git_directory_does_not_attach_draft_to_parent_repository() {
    let f = Fixture::new();
    let nested = f.root.join("nested");

    fs::create_dir(&nested).unwrap();
    f.process()
        .run(onegit_git::GitCommand::new(
            &nested,
            ["init", "--initial-branch=main"],
        ))
        .unwrap();
    fs::write(nested.join("a"), "nested").unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace.json");
    let (mut cx, view) = setup(&f);

    enable(view, &mut cx, &path);
    let tab = open(&mut cx, view, &nested);

    cx.update(|cx| {
        tab.update(cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text("Nested draft", cx))
        })
    });
    close(&mut cx, view);
    fs::rename(nested.join(".git"), dir.path().join("nested-git")).unwrap();
    let (mut cx, view) = restart(&f, &path);

    view.update(&mut cx,|workspace,_,cx|{let view=workspace.tabs[0].workspace.read(cx);

        assert!(matches!(&view.state,RepositoryState::Failed{error,..}if error.contains("same repository root")));assert_eq!(view.summary.read(cx).text(),"Nested draft");}).unwrap();
    close(&mut cx, view);
}
