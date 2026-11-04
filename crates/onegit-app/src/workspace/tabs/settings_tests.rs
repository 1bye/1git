//! Source Git settings component/integration behavior with real isolated Git and retained native tabs.
use super::branch_tests::{fixture, settle};
use super::tests::{open, setup};
use super::*;
use crate::workspace::read::ChangeKey;
use crate::workspace::settings::{Editor, Page, Panel};
use onegit_git::{GitCommand, GitPath, GlobalGitIdentity};
use std::fs;

fn panel(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
) -> gpui::Entity<Panel> {
    let panel = view
        .update(cx, |w, window, cx| {
            w.open_settings(window, cx);

            w.settings.clone()
        })
        .unwrap();

    settle(cx, view);

    panel
}

fn edit(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    panel: &gpui::Entity<Panel>,
    editor: Editor,
) {
    view.update(cx, |_, window, cx| {
        panel.update(cx, |p, cx| p.edit(editor, window, cx))
    })
    .unwrap();
    settle(cx, view);
}

#[test]
fn git_settings_identity_saves_explicitly_and_preserves_related_tab_drafts_selections_and_viewports()
 {
    let f = fixture();

    f.git(&["config", "user.name", "Before"]);
    f.git(&["config", "user.email", "before@example.invalid"]);
    f.write("a.txt", "working\n");
    let linked = f.directory.path().join("linked-settings");

    f.git(&["worktree", "add", linked.to_str().unwrap(), "feature/ui"]);
    let (mut cx, view) = setup(&f);
    let linked_tab = open(&mut cx, view, &linked);
    let first = open(&mut cx, view, &f.root);

    first.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |i, cx| i.set_text("Retained draft", cx));
        tab.select(
            ChangeKey {
                path: GitPath::new("a.txt").unwrap(),
                side: crate::workspace::read::Side::Working,
            },
            cx,
        );
    });
    let second = open(&mut cx, view, &f.root);
    let before = first.read_with(&cx, |tab, cx| session::SavedTab::capture(tab, cx).unwrap());
    let index = fs::read(f.root.join(".git/index")).unwrap();
    let head = f.git(&["rev-parse", "HEAD"]);
    let p = panel(&mut cx, view);

    edit(&mut cx, view, &p, Editor::Identity);
    p.update(&mut cx, |p, cx| {
        p.name.update(cx, |i, cx| i.set_text("After", cx));
        p.email
            .update(cx, |i, cx| i.set_text("after@example.invalid", cx));
    });
    assert_eq!(f.git(&["config", "user.name"]), b"Before\n");
    p.update(&mut cx, |p, cx| p.save(cx));
    settle(&mut cx, view);
    assert_eq!(f.git(&["config", "user.name"]), b"After\n");
    assert!(linked_tab.read_with(&cx, |tab, _| matches!(tab.state, RepositoryState::Ready(_))));
    assert_eq!(fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(head, f.git(&["rev-parse", "HEAD"]));
    assert_eq!(
        fs::read_to_string(f.root.join("a.txt")).unwrap(),
        "working\n"
    );
    let after = first.read_with(&cx, |tab, cx| session::SavedTab::capture(tab, cx).unwrap());

    assert_eq!(after, before);
    assert!(second.read_with(&cx, |tab, _| matches!(tab.state, RepositoryState::Ready(_))));
    assert!(p.read_with(&cx, |p, _| p.error.is_none()));
}

#[test]
fn git_settings_stale_save_retains_input_and_cannot_overwrite_external_configuration() {
    let f = fixture();

    f.git(&["config", "user.name", "Before"]);
    f.git(&["config", "user.email", "before@example.invalid"]);
    let (mut cx, view) = setup(&f);
    let _ = open(&mut cx, view, &f.root);
    let p = panel(&mut cx, view);

    edit(&mut cx, view, &p, Editor::Identity);
    p.update(&mut cx, |p, cx| {
        p.name.update(cx, |i, cx| i.set_text("Draft", cx));
        p.email
            .update(cx, |i, cx| i.set_text("draft@example.invalid", cx));
    });
    f.git(&["config", "user.name", "External"]);
    p.update(&mut cx, |p, cx| p.save(cx));
    settle(&mut cx, view);
    assert_eq!(f.git(&["config", "user.name"]), b"External\n");
    assert_eq!(
        p.read_with(&cx, |p, cx| p.name.read(cx).text().to_owned()),
        "Draft"
    );
    assert!(p.read_with(&cx, |p, _| p.error.as_ref().unwrap().contains("changed")));
    p.update(&mut cx, |p, cx| p.save(cx));
    settle(&mut cx, view);
    assert_eq!(f.git(&["config", "user.name"]), b"External\n");
}

#[test]
fn git_settings_remote_save_is_explicit_and_removal_cancel_keeps_connection() {
    let f = fixture();
    let (mut cx, view) = setup(&f);
    let _ = open(&mut cx, view, &f.root);
    let p = panel(&mut cx, view);

    p.update(&mut cx, |p, cx| p.choose(Page::Remotes, cx));
    settle(&mut cx, view);
    edit(&mut cx, view, &p, Editor::Add);
    p.update(&mut cx, |p, cx| {
        p.remote_name.update(cx, |i, cx| i.set_text("origin", cx));
        p.remote_url.update(cx, |i, cx| {
            i.set_text("https://example.invalid/repo.git", cx)
        });
    });
    assert!(f.git(&["remote"]).is_empty());
    p.update(&mut cx, |p, cx| {
        p.remote_url.update(cx, |input, cx| {
            input.set_text("https://user:secret@example.invalid/repo.git", cx)
        })
    });
    p.update(&mut cx, |p, cx| p.save(cx));
    settle(&mut cx, view);
    assert!(f.git(&["remote"]).is_empty());
    assert!(p.read_with(&cx, |p, _| p.error.is_some()));
    p.update(&mut cx, |p, cx| {
        p.remote_url.update(cx, |input, cx| {
            input.set_text("https://example.invalid/repo.git", cx)
        })
    });
    p.update(&mut cx, |p, cx| p.save(cx));
    settle(&mut cx, view);
    assert_eq!(f.git(&["remote"]), b"origin\n");
    view.update(&mut cx, |_, window, cx| {
        p.update(cx, |p, cx| p.remove("origin".into(), window, cx))
    })
    .unwrap();
    settle(&mut cx, view);
    assert_eq!(f.git(&["remote"]), b"origin\n");
    super::branch_tests::key(&mut cx, view, "escape");
    settle(&mut cx, view);
    assert_eq!(f.git(&["remote"]), b"origin\n");
    edit(&mut cx, view, &p, Editor::Edit("origin".into()));
    p.update(&mut cx, |p, cx| {
        p.remote_url.update(cx, |i, cx| {
            i.set_text("https://example.invalid/changed.git", cx)
        })
    });
    p.update(&mut cx, |p, cx| p.save(cx));
    settle(&mut cx, view);
    assert_eq!(
        f.git(&["remote", "get-url", "origin"]),
        b"https://example.invalid/changed.git\n"
    );
}

#[test]
fn git_settings_global_save_uses_isolated_config_and_cancel_keeps_saved_values() {
    let f = fixture();
    let config = f.directory.path().join("isolated-global");

    let process = f
        .process()
        .with_environment([("GIT_CONFIG_GLOBAL".into(), config.as_os_str().to_owned())]);

    let (mut cx, view) = setup(&f);

    view.update(&mut cx, |w, _, _| w.process = process.clone())
        .unwrap();
    let p = panel(&mut cx, view);

    edit(&mut cx, view, &p, Editor::Identity);
    p.update(&mut cx, |p, cx| {
        p.name.update(cx, |i, cx| i.set_text("Global default", cx));
        p.email
            .update(cx, |i, cx| i.set_text("default@example.invalid", cx));
    });
    assert!(!config.exists());
    p.update(&mut cx, |p, cx| p.save(cx));
    settle(&mut cx, view);
    let global = GlobalGitIdentity::new(process.clone(), f.directory.path().to_owned());

    assert_eq!(
        global.read(None).unwrap().identity.name.as_deref(),
        Some("Global default")
    );
    edit(&mut cx, view, &p, Editor::Identity);
    p.update(&mut cx, |p, cx| {
        p.name.update(cx, |i, cx| i.set_text("Discarded", cx))
    });
    view.update(&mut cx, |_, window, cx| {
        p.update(cx, |p, cx| p.cancel(window, cx))
    })
    .unwrap();
    assert_eq!(
        process
            .run(GitCommand::new(
                &f.root,
                ["config", "--global", "--get", "user.name"]
            ))
            .unwrap()
            .stdout,
        b"Global default\n"
    );
}

#[test]
fn git_settings_editor_matches_equal_pane_layout_and_settles_without_idle_frames() {
    for reduced in [false, true] {
        let f = fixture();
        let (mut cx, view) = setup(&f);

        cx.update(|cx| cx.set_reduce_motion(reduced));
        let _ = open(&mut cx, view, &f.root);
        let p = panel(&mut cx, view);

        edit(&mut cx, view, &p, Editor::Identity);
        let mut visual = gpui::VisualTestContext::from_window(view.into(), &cx);
        let editor = visual.debug_bounds("git-settings-editor").unwrap();

        assert_eq!(editor.size.width, px(513.));
        assert_eq!(editor.right(), px(1274.));
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

#[test]
fn git_settings_unsaved_editor_keeps_its_repository_context_across_tab_changes() {
    let f = fixture();

    f.git(&["config", "user.name", "First"]);
    f.git(&["config", "user.email", "first@example.invalid"]);
    let other = fixture();
    let (mut cx, view) = setup(&f);
    let _ = open(&mut cx, view, &f.root);
    let p = panel(&mut cx, view);

    edit(&mut cx, view, &p, Editor::Identity);
    p.update(&mut cx, |p, cx| {
        p.name.update(cx, |i, cx| i.set_text("Kept draft", cx))
    });
    let _ = open(&mut cx, view, &other.root);

    view.update(&mut cx, |w, window, cx| {
        w.request(&Request::Activate(2), window, cx)
    })
    .unwrap();
    assert!(!p.read_with(&cx, |p, _| p.visible));
    let reopened = panel(&mut cx, view);

    assert_eq!(p, reopened);
    assert_eq!(
        p.read_with(&cx, |p, cx| p.name.read(cx).text().to_owned()),
        "Kept draft"
    );
    p.update(&mut cx, |p, cx| p.save(cx));
    settle(&mut cx, view);
    assert_eq!(f.git(&["config", "user.name"]), b"Kept draft\n");
    assert!(
        other
            .process()
            .run(GitCommand::new(
                &other.root,
                ["config", "--local", "--get", "user.name"]
            ))
            .is_err()
    );
}

#[test]
fn git_settings_unavailable_repository_never_falls_back_to_global_editor() {
    let f = fixture();
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    tab.update(&mut cx, |tab, _| {
        tab.state = RepositoryState::Failed {
            path: f.root.clone(),
            error: "Unavailable".into(),
        }
    });
    view.update(&mut cx, |w, window, cx| {
        w.open_settings(window, cx);
        assert!(!w.settings.read(cx).visible);
    })
    .unwrap();
}

#[test]
fn git_settings_switching_scope_ignores_cancelled_reads_and_keeps_the_final_identity() {
    let f = fixture();

    f.git(&["config", "user.name", "Repository author"]);
    f.git(&["config", "user.email", "repo@example.invalid"]);
    let (mut cx, view) = setup(&f);
    let _ = open(&mut cx, view, &f.root);
    let p = panel(&mut cx, view);

    p.update(&mut cx, |p, cx| {
        p.choose(Page::Global, cx);
        p.choose(Page::Identity, cx);
    });
    settle(&mut cx, view);
    assert!(p.read_with(&cx, |p, _| p.error.is_none()));
    edit(&mut cx, view, &p, Editor::Identity);
    assert_eq!(
        p.read_with(&cx, |p, cx| p.name.read(cx).text().to_owned()),
        "Repository author"
    );
}
