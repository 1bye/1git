//! Real immutable history reads and native workspace interactions share disposable Git fixtures.
use super::*;

use crate::workspace::{
    read::Preview,
    tests::{Fixture, contents},
};

use onegit_git::GitPath;
use std::fs;

fn document(source: &Loaded, oid: &str, path: &str) -> onegit_ui::DiffDocument {
    let files = source.repository.commit_files(oid, None).unwrap();

    let file = files
        .iter()
        .find(|file| file.path.as_bytes() == path.as_bytes())
        .unwrap();

    match read::patch(&source.repository, oid, file, &Cancellation::default()).unwrap() {
        Preview::Patch(doc) => doc,
        _ => panic!("expected a committed patch"),
    }
}

#[test]
fn pages_are_anchored_to_a_commit_and_survive_new_commits_without_duplicates() {
    let f = Fixture::new();

    for index in 0..53 {
        f.git(&["commit", "--allow-empty", "-m", &format!("Commit {index}")]);
    }

    let source = f.load();

    let first = read::page(
        &source,
        0,
        CommitListData::default(),
        &Cancellation::default(),
    )
    .unwrap();

    assert_eq!(first.commits.len(), 50);
    assert_eq!(first.total, Some(53));
    assert_eq!(first.next_offset, Some(50));
    assert_eq!(first.commits[0].summary, "Commit 52");
    f.git(&[
        "commit",
        "--allow-empty",
        "-m",
        "New commit after the first page",
    ]);
    let before = contents(&f.root);

    let last = read::page(
        &source,
        first.next_offset.unwrap(),
        first.data,
        &Cancellation::default(),
    )
    .unwrap();

    assert_eq!(last.commits.len(), 3);
    assert_eq!(last.data.items().len(), 53);
    assert_eq!(last.commits[0].summary, "Commit 2");
    assert_eq!(last.commits[2].summary, "Commit 0");
    assert!(last.next_offset.is_none());
    assert_eq!(contents(&f.root), before);
    let refreshed = read::page(
        &f.load(),
        0,
        CommitListData::default(),
        &Cancellation::default(),
    )
    .unwrap();

    assert_eq!(
        refreshed.commits[0].summary,
        "New commit after the first page"
    );
    let cancel = Cancellation::default();

    cancel.cancel();
    assert!(read::page(&source, 0, CommitListData::default(), &cancel).is_err());
}

#[test]
fn root_rename_deletion_binary_and_literal_path_patches_preserve_repository_bytes() {
    let f = Fixture::new();

    f.write("old.txt", "unique rename content\n");
    f.write("delete.txt", "delete content\n");
    f.commit();
    let root = String::from_utf8(f.git(&["rev-parse", "HEAD"]))
        .unwrap()
        .trim()
        .to_owned();

    f.git(&["mv", "old.txt", "new.txt"]);
    f.write("literal[1].txt", "literal brackets\n");
    f.write("literal1.txt", "a different filename\n");
    fs::remove_file(f.root.join("delete.txt")).unwrap();
    fs::write(f.root.join("image.bin"), [0, 1, 2]).unwrap();
    f.commit();
    let source = f.load();
    let tip = source.snapshot.status.head.oid.as_deref().unwrap();
    let before = contents(&f.root);

    assert_eq!(document(&source, &root, "old.txt").added_lines(), 1);
    assert!(
        document(&source, tip, "new.txt")
            .patch()
            .contains("rename from old.txt")
    );
    assert_eq!(document(&source, tip, "delete.txt").deleted_lines(), 1);
    assert!(document(&source, tip, "image.bin").is_binary());
    let literal = document(&source, tip, "literal[1].txt");

    assert!(literal.patch().contains("+literal brackets"));
    assert!(!literal.patch().contains("a different filename"));
    assert_eq!(contents(&f.root), before);
}

#[test]
fn merge_details_and_patches_show_only_changes_against_the_first_parent() {
    let f = Fixture::new();

    f.write("base.txt", "base\n");
    f.commit();
    f.git(&["switch", "-c", "feature"]);
    f.write("feature.txt", "feature\n");
    f.commit();
    f.git(&["switch", "main"]);
    f.write("main.txt", "main\n");
    f.commit();
    f.git(&["merge", "--no-ff", "feature", "-m", "Merge feature"]);
    let source = f.load();
    let tip = source.snapshot.status.head.oid.as_deref().unwrap();
    let before = contents(&f.root);
    let commit = source.repository.commit(tip, None).unwrap();
    let files = source.repository.commit_files(tip, None).unwrap();

    assert_eq!(commit.parent_oids.len(), 2);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, GitPath::new("feature.txt").unwrap());
    assert!(
        document(&source, tip, "feature.txt")
            .patch()
            .contains("+feature")
    );
    assert_eq!(contents(&f.root), before);
}

#[test]
fn unborn_history_and_oversized_committed_patches_have_explicit_results() {
    let f = Fixture::new();

    let page = read::page(
        &f.load(),
        0,
        CommitListData::default(),
        &Cancellation::default(),
    )
    .unwrap();

    assert!(page.data.items().is_empty());
    assert!(page.next_offset.is_none());
    f.write("large.txt", &"long line of content\n".repeat(10000));
    f.commit();
    let source = crate::workspace::read::load(
        &f.root,
        f.process_with_limit(8192),
        &Cancellation::default(),
    )
    .unwrap();

    let tip = source.snapshot.status.head.oid.as_deref().unwrap();
    let files = source.repository.commit_files(tip, None).unwrap();

    assert!(matches!(
        read::patch(&source.repository, tip, &files[0], &Cancellation::default()).unwrap(),
        Preview::Notice {
            title: "Patch is too large to display",
            ..
        }
    ));
}

#[cfg(feature = "test-support")]
mod native {
    use super::*;
    use crate::workspace::{RepositoryState, RepositoryWorkspace, Section};
    use onegit_ui::Theme;
    use rake::gpui::{InputEvent as _, prelude::*};

    fn setup(
        f: &Fixture,
    ) -> (
        gpui::TestAppContext,
        gpui::WindowHandle<RepositoryWorkspace>,
    ) {
        let mut cx = gpui::TestAppContext::single();

        cx.update(|cx| Theme::dark().install(cx));
        let window = cx.open_window(gpui::size(px(1080.), px(740.)), |window, cx| {
            let mut workspace = RepositoryWorkspace::new(window, cx, None);

            workspace.process = f.process();
            workspace.open(f.root.clone(), None, cx);

            workspace
        });

        draw(&mut cx, window);

        (cx, window)
    }

    fn draw(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<RepositoryWorkspace>) {
        for _ in 0..2 {
            cx.run_until_parked();
            cx.update_window(v.into(), |_, window, cx| window.draw(cx).clear(cx))
                .unwrap();
        }

        cx.run_until_parked();
    }

    fn click(
        cx: &mut gpui::TestAppContext,
        v: gpui::WindowHandle<RepositoryWorkspace>,
        selector: &'static str,
    ) {
        let position = gpui::VisualTestContext::from_window(v.into(), cx)
            .debug_bounds(selector)
            .expect("history control is mounted")
            .center();

        cx.update_window(v.into(), |_, window, cx| {
            window.dispatch_event(
                gpui::MouseDownEvent {
                    button: gpui::MouseButton::Left,
                    position,
                    modifiers: Default::default(),
                    click_count: 1,
                    first_mouse: false,
                }
                .to_platform_input(),
                cx,
            );
            window.dispatch_event(
                gpui::MouseUpEvent {
                    button: gpui::MouseButton::Left,
                    position,
                    modifiers: Default::default(),
                    click_count: 1,
                }
                .to_platform_input(),
                cx,
            );
        })
        .unwrap();
        draw(cx, v);
    }

    fn history(
        v: gpui::WindowHandle<RepositoryWorkspace>,
        cx: &gpui::TestAppContext,
    ) -> gpui::Entity<HistoryWorkspace> {
        v.read_with(cx, |view, _| view.history.clone()).unwrap()
    }

    fn patch_text(v: gpui::WindowHandle<RepositoryWorkspace>, cx: &gpui::TestAppContext) -> String {
        v.read_with(cx, |view, cx| match &view.history.read(cx).preview {
            PreviewState::Ready(Preview::Patch(doc)) => doc.patch().into(),
            _ => panic!("loaded history patch"),
        })
        .unwrap()
    }

    #[test]
    fn real_history_tabs_select_commits_files_and_diff_modes_and_keep_the_commit_draft() {
        let f = Fixture::new();

        f.write("a.txt", "alpha\n");
        f.write("b.txt", "beta\n");
        f.commit();
        let first = String::from_utf8(f.git(&["rev-parse", "HEAD"]))
            .unwrap()
            .trim()
            .to_owned();

        f.write("a.txt", "new alpha\n");
        f.commit();
        f.write("a.txt", "uncommitted alpha\n");
        let (mut cx, v) = setup(&f);

        v.update(&mut cx, |view, _, cx| {
            view.summary
                .update(cx, |input, cx| input.set_text("Keep my draft", cx))
        })
        .unwrap();
        click(&mut cx, v, "tab-history");
        assert!(
            v.read_with(&cx, |view, _| view.section == Section::History)
                .unwrap()
        );
        assert!(patch_text(v, &cx).contains("+new alpha"));
        let history = history(v, &cx);

        history.update(&mut cx, |history, cx| {
            history.select_commit(first.into(), cx)
        });
        draw(&mut cx, v);
        click(&mut cx, v, "history-file-1");
        assert!(patch_text(v, &cx).contains("+beta"));
        // Both lists retain selections while focus returns to their common workspace ancestor.
        // In a native window with AccessKit active, neither list may claim active-descendant focus here.
        v.update(&mut cx, |view, window, cx| window.focus(&view.focus, cx))
            .unwrap();
        draw(&mut cx, v);
        history.read_with(&cx, |history, _| {
            assert!(history.selected.is_some());
            assert_eq!(history.file.as_ref().unwrap().as_bytes(), b"b.txt");
        });
        v.update(&mut cx, |view, window, cx| {
            assert!(view.focus.is_focused(window));
            assert!(!view.history.read(cx).files_focus.is_focused(window));
        })
        .unwrap();
        history.update(&mut cx, |history, cx| {
            history.view = DiffView::Split;
            cx.notify();
        });
        draw(&mut cx, v);
        assert!(
            gpui::VisualTestContext::from_window(v.into(), &cx)
                .debug_bounds("diff-after")
                .is_some()
        );
        click(&mut cx, v, "tab-changes");
        assert_eq!(
            v.read_with(&cx, |view, cx| view.summary.read(cx).text().to_owned())
                .unwrap(),
            "Keep my draft"
        );
        click(&mut cx, v, "tab-history");
        assert!(patch_text(v, &cx).contains("+beta"));
        assert!(!patch_text(v, &cx).contains("uncommitted alpha"));
    }

    #[test]
    fn a_new_commit_invalidates_history_and_manual_refresh_recovers_from_read_failures() {
        let f = Fixture::new();

        f.write("a.txt", "base\n");
        f.commit();
        let (mut cx, v) = setup(&f);

        click(&mut cx, v, "tab-history");
        click(&mut cx, v, "tab-changes");
        f.write("a.txt", "new commit\n");
        f.git(&["add", "--all"]);
        v.update(&mut cx, |view, _, cx| view.refresh(cx)).unwrap();
        draw(&mut cx, v);
        v.update(&mut cx, |view, window, cx| {
            view.summary
                .update(cx, |input, cx| input.set_text("Created in the app", cx));
            view.commit(window, cx);
        })
        .unwrap();
        draw(&mut cx, v);
        click(&mut cx, v, "tab-history");
        assert!(
            v.read_with(&cx, |view, cx| view.history.read(cx).data.items()[0]
                .summary
                == "Created in the app")
                .unwrap()
        );
        assert!(patch_text(v, &cx).contains("+new commit"));
        v.update(&mut cx, |view, _, cx| {
            view.process = onegit_git::GitProcess::new("/missing-git-history-fixture", 1024);
            view.refresh(cx);
        })
        .unwrap();
        draw(&mut cx, v);
        assert!(
            v.read_with(&cx, |view, _| matches!(
                view.state,
                RepositoryState::Failed { .. }
            ))
            .unwrap()
        );
        v.update(&mut cx, |view, _, cx| {
            view.process = f.process();
            view.refresh(cx);
        })
        .unwrap();
        draw(&mut cx, v);
        assert!(patch_text(v, &cx).contains("+new commit"));
    }

    #[test]
    fn superseded_history_reads_cannot_replace_new_selections_or_a_new_repository() {
        let f = Fixture::new();

        f.write("a.txt", "first\n");
        f.write("b.txt", "second\n");
        f.commit();
        let first = String::from_utf8(f.git(&["rev-parse", "HEAD"]))
            .unwrap()
            .trim()
            .to_owned();

        f.write("a.txt", "latest\n");
        f.commit();
        let (mut cx, v) = setup(&f);

        click(&mut cx, v, "tab-history");
        let history = history(v, &cx);
        let latest = history.read_with(&cx, |history, _| history.selected.clone().unwrap());

        let old_cancel = history.update(&mut cx, |history, cx| {
            history.select_commit(first.into(), cx);

            history.detail_job.as_ref().unwrap().cancel.clone()
        });

        history.update(&mut cx, |history, cx| history.select_commit(latest, cx));
        assert!(old_cancel.is_cancelled());
        draw(&mut cx, v);
        assert!(patch_text(v, &cx).contains("+latest"));
        history.update(&mut cx, |history, cx| {
            history.select_commit(history.selected.clone().unwrap(), cx)
        });
        let cancel = history.read_with(&cx, |history, _| {
            history.detail_job.as_ref().unwrap().cancel.clone()
        });

        let other = Fixture::new();

        other.write("other.txt", "another repository\n");
        other.commit();
        v.update(&mut cx, |view, _, cx| {
            view.open(other.root.clone(), None, cx)
        })
        .unwrap();
        assert!(cancel.is_cancelled());
        draw(&mut cx, v);
        assert!(patch_text(v, &cx).contains("+another repository"));
    }

    #[test]
    fn pagination_keeps_rows_on_failure_and_keyboard_reaches_the_appended_page() {
        let f = Fixture::new();

        for index in 0..52 {
            f.git(&["commit", "--allow-empty", "-m", &format!("Commit {index}")]);
        }

        let (mut cx, v) = setup(&f);

        click(&mut cx, v, "tab-history");
        let history = history(v, &cx);

        assert_eq!(
            history.read_with(&cx, |history, _| history.data.items().len()),
            50
        );
        fs::rename(
            f.root.join(".git/objects"),
            f.root.join(".git/objects-fixture"),
        )
        .unwrap();
        history.update(&mut cx, |history, cx| history.load_page(cx));
        draw(&mut cx, v);
        history.read_with(&cx, |history, _| {
            assert!(history.page_error.is_some());
            assert_eq!(history.data.items().len(), 50);
            assert_eq!(history.next_offset, Some(50));
        });
        fs::rename(
            f.root.join(".git/objects-fixture"),
            f.root.join(".git/objects"),
        )
        .unwrap();
        history.update(&mut cx, |history, cx| history.load_page(cx));
        draw(&mut cx, v);
        assert_eq!(
            history.read_with(&cx, |history, _| history.data.items().len()),
            52
        );
        let first_row = gpui::VisualTestContext::from_window(v.into(), &cx)
            .debug_bounds("commit-list")
            .unwrap();

        let position = gpui::point(first_row.left() + px(20.), first_row.top() + px(20.));

        cx.update_window(v.into(), |_, window, cx| {
            window.dispatch_event(
                gpui::MouseDownEvent {
                    button: gpui::MouseButton::Left,
                    position,
                    modifiers: Default::default(),
                    click_count: 1,
                    first_mouse: false,
                }
                .to_platform_input(),
                cx,
            );
            window.dispatch_event(
                gpui::MouseUpEvent {
                    button: gpui::MouseButton::Left,
                    position,
                    modifiers: Default::default(),
                    click_count: 1,
                }
                .to_platform_input(),
                cx,
            );
            window.dispatch_event(
                gpui::KeyDownEvent {
                    keystroke: gpui::Keystroke::parse("end").unwrap(),
                    is_held: false,
                    prefer_character_input: false,
                }
                .to_platform_input(),
                cx,
            );
        })
        .unwrap();
        draw(&mut cx, v);
        history.read_with(&cx, |history, _| {
            assert!(history.page_error.is_none());
            assert!(history.next_offset.is_none());

            let DetailState::Ready(details) = &history.detail else {
                panic!("selected last commit");
            };

            assert_eq!(details.commit.summary, "Commit 0");
        });
    }

    #[test]
    fn commit_and_patch_errors_are_retryable_and_old_patch_reads_are_cancelled() {
        let f = Fixture::new();

        f.write("a.txt", "alpha\n");
        f.write("b.txt", "beta\n");
        f.commit();
        let (mut cx, v) = setup(&f);

        click(&mut cx, v, "tab-history");
        let history = history(v, &cx);
        let oid = history.read_with(&cx, |history, _| history.selected.clone().unwrap());

        fs::rename(
            f.root.join(".git/objects"),
            f.root.join(".git/objects-fixture"),
        )
        .unwrap();
        history.update(&mut cx, |history, cx| {
            history.select_commit(oid.clone(), cx)
        });
        draw(&mut cx, v);
        assert!(history.read_with(&cx, |history, _| matches!(
            history.detail,
            DetailState::Failed(_)
        )));
        fs::rename(
            f.root.join(".git/objects-fixture"),
            f.root.join(".git/objects"),
        )
        .unwrap();
        history.update(&mut cx, |history, cx| history.select_commit(oid, cx));
        draw(&mut cx, v);
        assert!(patch_text(v, &cx).contains("+alpha"));
        fs::rename(
            f.root.join(".git/objects"),
            f.root.join(".git/objects-fixture"),
        )
        .unwrap();
        history.update(&mut cx, |history, cx| {
            history.select_file(GitPath::new("b.txt").unwrap(), cx)
        });
        draw(&mut cx, v);
        assert!(history.read_with(&cx, |history, _| matches!(
            history.preview,
            PreviewState::Failed(_)
        )));
        fs::rename(
            f.root.join(".git/objects-fixture"),
            f.root.join(".git/objects"),
        )
        .unwrap();
        let old_cancel = history.update(&mut cx, |history, cx| {
            history.select_file(GitPath::new("a.txt").unwrap(), cx);

            history.patch_job.as_ref().unwrap().cancel.clone()
        });

        history.update(&mut cx, |history, cx| {
            history.select_file(GitPath::new("b.txt").unwrap(), cx)
        });
        assert!(old_cancel.is_cancelled());
        draw(&mut cx, v);
        assert!(patch_text(v, &cx).contains("+beta"));
        cx.update(|cx| cx.set_reduce_motion(true));
        cx.executor()
            .advance_clock(std::time::Duration::from_secs(1));
        cx.update_window(v.into(), |_, window, cx| window.simulate_next_frame(cx))
            .unwrap();
        draw(&mut cx, v);
        assert_eq!(
            cx.update_window(v.into(), |_, window, cx| window.simulate_next_frame(cx))
                .unwrap(),
            0
        );
    }
}
