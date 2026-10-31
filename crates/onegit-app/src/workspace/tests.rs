//! Real Git fixtures verify repository operations; native events cover async workspace state.
#[path = "write_tests.rs"]
mod writes;

use super::*;
use onegit_git::{GitCommand, GitPath};

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

pub(super) struct Fixture {
    pub(super) directory: tempfile::TempDir,
    pub(super) root: PathBuf,
}

impl Fixture {
    pub(super) fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("repository été");

        fs::create_dir(&root).unwrap();
        let fixture = Self { directory, root };

        fixture.git(&["init", "--initial-branch=main"]);

        fixture
    }

    pub(super) fn process(&self) -> GitProcess {
        self.process_with_limit(16 * 1024 * 1024)
    }

    pub(super) fn process_with_limit(&self, limit: usize) -> GitProcess {
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };

        GitProcess::new("git", limit).with_environment([
            ("GIT_CONFIG_GLOBAL".into(), null.into()),
            ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
            ("GIT_CONFIG_COUNT".into(), "2".into()),
            ("GIT_CONFIG_KEY_0".into(), "core.hooksPath".into()),
            ("GIT_CONFIG_VALUE_0".into(), null.into()),
            ("GIT_CONFIG_KEY_1".into(), "commit.gpgsign".into()),
            ("GIT_CONFIG_VALUE_1".into(), "false".into()),
            ("GIT_AUTHOR_NAME".into(), "Fixture".into()),
            ("GIT_AUTHOR_EMAIL".into(), "fixture@example.invalid".into()),
            ("GIT_COMMITTER_NAME".into(), "Fixture".into()),
            (
                "GIT_COMMITTER_EMAIL".into(),
                "fixture@example.invalid".into(),
            ),
        ])
    }

    pub(super) fn git(&self, args: &[&str]) -> Vec<u8> {
        self.process()
            .run(GitCommand::new(&self.root, args.iter().copied()))
            .unwrap()
            .stdout
    }

    pub(super) fn write(&self, path: &str, text: &str) {
        fs::write(self.root.join(path), text).unwrap();
    }

    pub(super) fn commit(&self) {
        self.git(&["add", "--all"]);
        self.git(&["commit", "-m", "Fixture"]);
    }

    pub(super) fn load(&self) -> Arc<Loaded> {
        read::load(&self.root, self.process(), &Cancellation::default()).unwrap()
    }
}

fn key(path: &str, side: read::Side) -> ChangeKey {
    ChangeKey {
        path: GitPath::new(path).unwrap(),
        side,
    }
}

fn patch(loaded: &Loaded, key: &ChangeKey) -> onegit_ui::DiffDocument {
    match read::preview(
        &loaded.repository,
        loaded.file(key).unwrap(),
        &Cancellation::default(),
    )
    .unwrap()
    {
        Preview::Patch(document) => document,
        Preview::Notice { title, detail } => panic!("expected patch: {title}: {detail}"),
    }
}

pub(super) fn contents(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn visit(root: &Path, path: &Path, result: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for entry in fs::read_dir(path).unwrap() {
            let entry = entry.unwrap();

            if entry.file_type().unwrap().is_dir() {
                visit(root, &entry.path(), result);
            } else {
                result.insert(
                    entry.path().strip_prefix(root).unwrap().to_owned(),
                    fs::read(entry.path()).unwrap(),
                );
            }
        }
    }
    let mut result = BTreeMap::new();

    visit(root, root, &mut result);

    result
}

#[test]
fn real_status_and_each_side_preview_preserve_repository_bytes() {
    let f = Fixture::new();

    f.write("partial.txt", "base\n");
    f.write("deleted.txt", "delete me\n");
    f.write("old.txt", "unique rename content\n");
    f.commit();
    f.write("partial.txt", "staged\n");
    f.git(&["add", "partial.txt"]);
    f.write("partial.txt", "working\n");
    fs::remove_file(f.root.join("deleted.txt")).unwrap();
    f.git(&["mv", "old.txt", "new.txt"]);
    f.write("old.txt", "new untracked source name\n");
    f.write("literal[1].txt", "literal brackets\n");
    f.write("literal1.txt", "different filename\n");
    f.write("empty.txt", "");
    fs::write(f.root.join("image.bin"), b"binary\0bytes").unwrap();
    let before = contents(&f.root);
    let loaded = f.load();

    assert_eq!(loaded.snapshot.status.head.branch.as_deref(), Some("main"));
    assert_eq!(
        loaded.snapshot.repository.root,
        fs::canonicalize(&f.root).unwrap()
    );
    let staged = patch(&loaded, &key("partial.txt", read::Side::Staged));

    assert!(staged.patch().contains("-base\n+staged"));
    let working = patch(&loaded, &key("partial.txt", read::Side::Working));

    assert!(working.patch().contains("-staged\n+working"));
    assert!(
        patch(&loaded, &key("deleted.txt", read::Side::Working))
            .patch()
            .contains("-delete me")
    );
    assert!(
        patch(&loaded, &key("new.txt", read::Side::Staged))
            .patch()
            .contains("rename from old.txt")
    );
    assert!(
        patch(&loaded, &key("old.txt", read::Side::Working))
            .patch()
            .contains("+new untracked source name")
    );
    assert!(
        patch(&loaded, &key("literal[1].txt", read::Side::Working))
            .patch()
            .contains("+literal brackets")
    );
    assert!(
        !patch(&loaded, &key("literal[1].txt", read::Side::Working))
            .patch()
            .contains("different filename")
    );
    assert!(patch(&loaded, &key("image.bin", read::Side::Working)).is_binary());
    assert_eq!(
        patch(&loaded, &key("empty.txt", read::Side::Working)).added_lines(),
        0
    );
    assert_eq!(
        contents(&f.root),
        before,
        "reading status and previews must preserve files, index, objects and refs"
    );
}

#[cfg(unix)]
#[test]
fn symlink_to_regular_file_type_changes_show_both_patch_sections() {
    let f = Fixture::new();

    f.write("target", "target contents\n");
    std::os::unix::fs::symlink("target", f.root.join("changed")).unwrap();
    f.commit();
    fs::remove_file(f.root.join("changed")).unwrap();
    f.write("changed", "regular contents\n");
    let before = contents(&f.root);
    let loaded = f.load();
    let selected = key("changed", read::Side::Working);

    assert_eq!(
        loaded.file(&selected).unwrap().status,
        onegit_git::FileStatus::TypeChanged
    );
    let document = patch(&loaded, &selected);

    assert!(document.patch().contains("deleted file mode 120000"));
    assert!(document.patch().contains("new file mode 100644"));
    assert_eq!((document.deleted_lines(), document.added_lines()), (1, 1));
    assert_eq!(contents(&f.root), before);
}

#[test]
fn copied_file_preview_does_not_include_changes_to_its_source() {
    let f = Fixture::new();

    f.write("source.txt", "original content\n");
    f.commit();
    f.write("source.txt", "source changed independently\n");
    f.write("copy.txt", "original content\n");
    f.git(&["add", "--all"]);
    let loaded = f.load();

    let mut file = loaded
        .file(&key("copy.txt", read::Side::Staged))
        .unwrap()
        .clone();

    file.status = onegit_git::FileStatus::Copied;
    file.original = Some(GitPath::new("source.txt").unwrap());
    let preview = read::preview(&loaded.repository, &file, &Cancellation::default()).unwrap();

    let Preview::Patch(document) = preview else {
        panic!("a copied file should have its own text preview");
    };

    assert!(document.patch().contains("+original content"));
    assert!(!document.patch().contains("source changed independently"));
}

#[test]
fn empty_and_unborn_repositories_errors_cancellation_and_omitted_patches_are_explicit() {
    let f = Fixture::new();
    let loaded = f.load();

    assert!(loaded.files.is_empty());
    assert!(loaded.snapshot.status.head.is_unborn());
    let cancel = Cancellation::default();

    cancel.cancel();
    assert!(read::load(&f.root, f.process(), &cancel).is_err());
    assert!(read::load(f.directory.path(), f.process(), &Cancellation::default()).is_err());
    let missing = GitProcess::new(f.directory.path().join("missing-git"), 1024);

    assert!(
        read::load(&f.root, missing, &Cancellation::default())
            .err()
            .expect("missing Git must fail")
            .contains("Git")
    );
    f.write("large.txt", &"a long changed line\n".repeat(2000));
    let loaded = read::load(
        &f.root,
        f.process_with_limit(1024),
        &Cancellation::default(),
    )
    .unwrap();

    let file = loaded.file(&key("large.txt", read::Side::Working)).unwrap();

    assert!(matches!(
        read::preview(&loaded.repository, file, &Cancellation::default()).unwrap(),
        Preview::Notice {
            title: "Patch is too large to display",
            ..
        }
    ));
}

#[test]
fn conflicts_are_not_presented_as_an_empty_or_successful_text_patch() {
    let f = Fixture::new();

    f.write("conflict.txt", "base\n");
    f.commit();
    f.git(&["checkout", "-b", "other"]);
    f.write("conflict.txt", "other\n");
    f.commit();
    f.git(&["checkout", "main"]);
    f.write("conflict.txt", "main\n");
    f.commit();
    assert!(
        f.process()
            .run(GitCommand::new(&f.root, ["merge", "other"]))
            .is_err()
    );
    let before = contents(&f.root);
    let loaded = f.load();

    assert!(
        loaded
            .file(&key("conflict.txt", read::Side::Staged))
            .is_none()
    );
    let file = loaded
        .file(&key("conflict.txt", read::Side::Working))
        .unwrap();

    assert!(matches!(
        read::preview(&loaded.repository, file, &Cancellation::default()).unwrap(),
        Preview::Notice {
            title: "Unresolved merge conflict",
            ..
        }
    ));
    assert_eq!(contents(&f.root), before);
}

#[test]
fn path_labels_escape_controls_without_changing_git_identity() {
    assert_eq!(
        read::path_label(&GitPath::new("日本語\nfile\t.txt").unwrap()),
        "日本語\\nfile\\t.txt"
    );
    assert_eq!(
        read::path_label(&GitPath::new(b"bad\xff.txt").unwrap()),
        "bad\\xff.txt"
    );
    assert_ne!(
        read::path_label(&GitPath::new(b"bad\xff.txt").unwrap()),
        read::path_label(&GitPath::new(b"bad\\xff.txt").unwrap())
    );
}

#[cfg(target_os = "linux")]
#[test]
fn non_utf8_paths_with_identical_lossy_labels_select_their_exact_files() {
    use std::os::unix::ffi::OsStringExt;
    let f = Fixture::new();

    for (name, text) in [
        (b"name\xff.txt".as_slice(), "first bytes\n"),
        (b"name\xfe.txt".as_slice(), "second bytes\n"),
    ] {
        fs::write(
            f.root.join(std::ffi::OsString::from_vec(name.to_vec())),
            text,
        )
        .unwrap();
    }

    let loaded = f.load();

    assert_ne!(loaded.files[0].label, loaded.files[1].label);
    let first = ChangeKey {
        path: GitPath::new(b"name\xff.txt").unwrap(),
        side: read::Side::Working,
    };

    let second = ChangeKey {
        path: GitPath::new(b"name\xfe.txt").unwrap(),
        side: read::Side::Working,
    };

    assert!(patch(&loaded, &first).patch().contains("+first bytes"));
    assert!(patch(&loaded, &second).patch().contains("+second bytes"));
}

#[cfg(feature = "test-support")]
mod native {
    use super::*;
    use gpui::InputEvent as _;
    use onegit_ui::Theme;

    fn setup(
        f: &Fixture,
    ) -> (
        gpui::TestAppContext,
        gpui::WindowHandle<RepositoryWorkspace>,
    ) {
        let mut cx = gpui::TestAppContext::single();

        cx.update(|cx| Theme::dark().install(cx));
        let v = cx.open_window(gpui::size(px(1000.), px(640.)), |window, cx| {
            window.activate_window();
            let mut v = RepositoryWorkspace::new(window, cx, None);

            v.process = f.process();

            v
        });

        draw(&mut cx, v);

        (cx, v)
    }

    fn draw(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<RepositoryWorkspace>) {
        for _ in 0..2 {
            cx.run_until_parked();
            cx.update_window(v.into(), |_, w, cx| w.draw(cx).clear(cx))
                .unwrap();
        }

        cx.run_until_parked();
    }

    fn choose(
        cx: &mut gpui::TestAppContext,
        v: gpui::WindowHandle<RepositoryWorkspace>,
        path: Option<PathBuf>,
    ) {
        v.update(cx, |v, _, cx| v.choose_repository(cx)).unwrap();
        assert!(cx.did_prompt_for_paths());
        cx.simulate_path_prompt_response(|options| {
            assert!(options.directories && !options.files && !options.multiple);

            path.map(|path| vec![path])
        });
        draw(cx, v);
    }

    fn patch_text(cx: &gpui::TestAppContext, v: gpui::WindowHandle<RepositoryWorkspace>) -> String {
        v.read_with(cx, |v, _| match &v.preview {
            PreviewState::Ready(Preview::Patch(doc)) => doc.patch().to_owned(),
            _ => panic!("expected a loaded patch"),
        })
        .unwrap()
    }

    fn click_file(
        cx: &mut gpui::TestAppContext,
        v: gpui::WindowHandle<RepositoryWorkspace>,
        selector: &'static str,
    ) {
        let position = gpui::VisualTestContext::from_window(v.into(), cx)
            .debug_bounds(selector)
            .unwrap()
            .center();

        cx.update_window(v.into(), |_, w, cx| {
            w.dispatch_event(
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
            w.dispatch_event(
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

    #[test]
    fn folder_picker_cancel_open_file_selection_and_view_switch_use_real_repository_data() {
        let f = Fixture::new();

        f.write("a.txt", "alpha\n");
        f.write("b.txt", "beta\n");
        let (mut cx, v) = setup(&f);

        choose(&mut cx, v, None);
        assert!(
            v.read_with(&cx, |v, _| matches!(v.state, RepositoryState::Welcome))
                .unwrap()
        );
        choose(&mut cx, v, Some(f.root.clone()));
        assert!(patch_text(&cx, v).contains("+alpha"));
        click_file(&mut cx, v, "workspace-file-1");
        assert!(patch_text(&cx, v).contains("+beta"));
        cx.update_window(v.into(), |_, w, cx| {
            w.dispatch_event(
                gpui::KeyDownEvent {
                    keystroke: gpui::Keystroke::parse("home").unwrap(),
                    is_held: false,
                    prefer_character_input: false,
                }
                .to_platform_input(),
                cx,
            )
        })
        .unwrap();
        draw(&mut cx, v);
        assert!(patch_text(&cx, v).contains("+alpha"));
        v.update(&mut cx, |v, _, cx| {
            v.view = DiffView::Split;
            cx.notify();
        })
        .unwrap();
        draw(&mut cx, v);
        assert!(
            gpui::VisualTestContext::from_window(v.into(), &cx)
                .debug_bounds("diff-after")
                .is_some()
        );
    }

    #[test]
    fn refresh_keeps_selection_when_available_and_reaches_clean_and_error_states() {
        let f = Fixture::new();

        f.write("a.txt", "base\n");
        f.commit();
        f.write("a.txt", "changed\n");
        f.write("b.txt", "untracked\n");
        let (mut cx, v) = setup(&f);

        choose(&mut cx, v, Some(f.root.clone()));
        click_file(&mut cx, v, "workspace-file-1");
        v.update(&mut cx, |v, _, cx| v.refresh(cx)).unwrap();
        draw(&mut cx, v);
        assert!(patch_text(&cx, v).contains("+untracked"));
        fs::remove_file(f.root.join("b.txt")).unwrap();
        v.update(&mut cx, |v, _, cx| v.refresh(cx)).unwrap();
        draw(&mut cx, v);
        assert!(patch_text(&cx, v).contains("+changed"));
        f.write("a.txt", "base\n");
        v.update(&mut cx, |v, _, cx| v.refresh(cx)).unwrap();
        draw(&mut cx, v);
        assert!(
            v.read_with(
                &cx,
                |v, _| matches!(&v.state,RepositoryState::Ready(data) if data.files.is_empty())
                    && v.selected.is_none()
                    && matches!(v.preview, PreviewState::Empty)
            )
            .unwrap()
        );
        choose(&mut cx, v, Some(f.directory.path().to_owned()));
        assert!(
            v.read_with(&cx, |v, _| matches!(
                v.state,
                RepositoryState::Failed { .. }
            ))
            .unwrap()
        );
        choose(&mut cx, v, Some(f.root.clone()));
        assert!(
            v.read_with(&cx, |v, _| matches!(v.state, RepositoryState::Ready(_)))
                .unwrap()
        );
    }

    #[test]
    fn file_navigation_virtualizes_rows_and_the_settled_workspace_has_no_frame_loop() {
        let f = Fixture::new();

        for index in 0..64 {
            f.write(&format!("file-{index:02}.txt"), &format!("line {index}\n"));
        }

        let (mut cx, v) = setup(&f);

        v.update(&mut cx, |v, _, cx| {
            v.open(f.root.clone(), None, cx);
            assert!(matches!(v.state, RepositoryState::Loading(_)));
        })
        .unwrap();
        draw(&mut cx, v);
        assert!(
            gpui::VisualTestContext::from_window(v.into(), &cx)
                .debug_bounds("workspace-file-63")
                .is_none()
        );
        v.update(&mut cx, |v, window, cx| window.focus(&v.files_focus, cx))
            .unwrap();
        cx.update_window(v.into(), |_, w, cx| {
            w.dispatch_event(
                gpui::KeyDownEvent {
                    keystroke: gpui::Keystroke::parse("end").unwrap(),
                    is_held: false,
                    prefer_character_input: false,
                }
                .to_platform_input(),
                cx,
            )
        })
        .unwrap();
        draw(&mut cx, v);
        assert!(patch_text(&cx, v).contains("+line 63"));
        assert!(
            gpui::VisualTestContext::from_window(v.into(), &cx)
                .debug_bounds("workspace-file-63")
                .is_some()
        );
        cx.update(|cx| cx.set_reduce_motion(true));
        cx.executor()
            .advance_clock(std::time::Duration::from_secs(1));
        cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
            .unwrap();
        draw(&mut cx, v);
        assert_eq!(
            cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
                .unwrap(),
            0
        );
    }

    #[test]
    fn superseded_reads_cannot_replace_a_new_repository_or_a_new_file_preview() {
        let first = Fixture::new();

        first.write("same.txt", "first repository\n");
        let second = Fixture::new();

        second.write("same.txt", "second repository\n");
        second.write("z.txt", "new selection\n");
        let (mut cx, v) = setup(&first);
        let old_loaded = first.load();

        let old_cancel = v
            .update(&mut cx, |v, _, cx| {
                v.open(first.root.clone(), None, cx);

                v.load_job.as_ref().unwrap().cancel.clone()
            })
            .unwrap();

        v.update(&mut cx, |v, _, cx| v.open(second.root.clone(), None, cx))
            .unwrap();
        assert!(old_cancel.is_cancelled());
        v.update(&mut cx, |v, _, cx| {
            v.finish_open(&old_cancel, first.root.clone(), None, Ok(old_loaded), cx)
        })
        .unwrap();
        draw(&mut cx, v);
        assert!(patch_text(&cx, v).contains("+second repository"));
        let (old_key, old_diff_cancel) = v
            .update(&mut cx, |v, _, cx| {
                let key = v.selected.clone().unwrap();

                v.select(key.clone(), cx);

                (key, v.diff_job.as_ref().unwrap().cancel.clone())
            })
            .unwrap();

        let new_key = key("z.txt", read::Side::Working);

        v.update(&mut cx, |v, _, cx| {
            v.select(new_key.clone(), cx);
            v.finish_preview(&old_diff_cancel, &old_key, Err("stale error".into()), cx);
        })
        .unwrap();
        draw(&mut cx, v);
        assert!(old_diff_cancel.is_cancelled());
        assert!(patch_text(&cx, v).contains("+new selection"));
        let final_cancel = v
            .update(&mut cx, |v, _, cx| {
                v.select(new_key.clone(), cx);

                v.diff_job.as_ref().unwrap().cancel.clone()
            })
            .unwrap();

        cx.update_window(v.into(), |_, w, _| w.remove_window())
            .unwrap();
        cx.run_until_parked();
        assert!(final_cancel.is_cancelled());
    }

    fn set_message(
        cx: &mut gpui::TestAppContext,
        v: gpui::WindowHandle<RepositoryWorkspace>,
        summary: &str,
        description: &str,
    ) {
        v.update(cx, |v, _, cx| {
            v.summary
                .update(cx, |input, cx| input.set_text(summary, cx));
            v.description
                .update(cx, |input, cx| input.set_text(description, cx));
        })
        .unwrap();
        draw(cx, v);
    }

    #[test]
    fn staging_refreshes_selection_and_keyboard_submit_commits_only_once() {
        let f = Fixture::new();

        f.write("a.txt", "base\n");
        f.commit();
        f.write("a.txt", "changed\n");
        let (mut cx, v) = setup(&f);

        choose(&mut cx, v, Some(f.root.clone()));
        set_message(&mut cx, v, "Commit from workspace", "A real description");
        assert!(!v.read_with(&cx, |v, cx| v.can_commit(cx)).unwrap());
        v.update(&mut cx, |v, window, cx| {
            let RepositoryState::Ready(loaded) = &v.state else {
                panic!("loaded repository");
            };

            let file = loaded.file(v.selected.as_ref().unwrap()).unwrap().clone();

            v.start_write(write::Operation::File(file), window, cx);
            assert!(v.write_job.is_some());
            assert!(!v.can_write());
            v.refresh(cx);
            v.choose_repository(cx);
        })
        .unwrap();
        draw(&mut cx, v);
        assert_eq!(
            v.read_with(&cx, |v, _| v.selected.clone()).unwrap(),
            Some(key("a.txt", read::Side::Staged))
        );
        assert!(patch_text(&cx, v).contains("+changed"));
        assert!(v.read_with(&cx, |v, cx| v.can_commit(cx)).unwrap());
        v.update(&mut cx, |v, window, cx| {
            window.focus(&v.description.read(cx).focus_handle(cx), cx);
        })
        .unwrap();
        draw(&mut cx, v);
        cx.update_window(v.into(), |_, window, cx| {
            let keystroke = gpui::Keystroke::parse(if cfg!(target_os = "macos") {
                "cmd-enter"
            } else {
                "ctrl-enter"
            })
            .unwrap();

            for _ in 0..2 {
                window.dispatch_event(
                    gpui::KeyDownEvent {
                        keystroke: keystroke.clone(),
                        is_held: false,
                        prefer_character_input: false,
                    }
                    .to_platform_input(),
                    cx,
                );
            }
        })
        .unwrap();
        draw(&mut cx, v);
        assert_eq!(f.git(&["rev-list", "--count", "HEAD"]), b"2\n");
        v.read_with(&cx, |v, cx| {
            assert!(matches!(&v.state, RepositoryState::Ready(loaded) if loaded.files.is_empty()));
            assert!(v.summary.read(cx).text().is_empty());
            assert!(v.description.read(cx).text().is_empty());
            assert!(!v.can_commit(cx));
            assert!(v.write_job.is_none());
        })
        .unwrap();
    }

    #[test]
    fn failed_commit_preserves_draft_and_refresh_and_reopen_keep_the_right_draft() {
        let f = Fixture::new();

        f.write("a.txt", "base\n");
        f.commit();
        f.write("a.txt", "changed\n");
        f.git(&["add", "--all"]);
        let (mut cx, v) = setup(&f);

        choose(&mut cx, v, Some(f.root.clone()));
        set_message(&mut cx, v, "   ", "Keep this body");
        assert!(!v.read_with(&cx, |v, cx| v.can_commit(cx)).unwrap());
        set_message(&mut cx, v, "Keep this summary", "Keep this body");
        fs::write(f.root.join(".git/index.lock"), "other writer").unwrap();
        v.update(&mut cx, |v, window, cx| v.commit(window, cx))
            .unwrap();
        draw(&mut cx, v);
        assert_eq!(f.git(&["rev-list", "--count", "HEAD"]), b"1\n");
        v.read_with(&cx, |v, cx| {
            assert_eq!(v.summary.read(cx).text(), "Keep this summary");
            assert_eq!(v.description.read(cx).text(), "Keep this body");
            assert!(v.can_commit(cx));
            assert!(matches!(&v.state, RepositoryState::Ready(loaded) if write::staged_count(loaded) == 1));
            assert!(!v.toasts.read(cx).is_empty());
        }).unwrap();
        fs::remove_file(f.root.join(".git/index.lock")).unwrap();
        v.update(&mut cx, |v, _, cx| v.refresh(cx)).unwrap();
        draw(&mut cx, v);
        assert_eq!(
            v.read_with(&cx, |v, cx| v.summary.read(cx).text().to_owned())
                .unwrap(),
            "Keep this summary"
        );
        let other = Fixture::new();

        choose(&mut cx, v, Some(other.root.clone()));
        assert!(
            v.read_with(&cx, |v, cx| v.summary.read(cx).text().is_empty()
                && v.description.read(cx).text().is_empty())
                .unwrap()
        );
    }

    #[test]
    fn closing_the_window_does_not_cancel_an_accepted_commit() {
        let f = Fixture::new();

        f.write("first.txt", "first\n");
        f.git(&["add", "--all"]);
        let (mut cx, v) = setup(&f);

        let router = rake::router::Router::<rake::router::NoRoute>::new(Default::default());
        let driven = router.clone();

        let _driver = cx.update(|cx| {
            cx.foreground_executor().spawn(async move {
                driven.run().await.unwrap();
            })
        });

        v.update(&mut cx, |v, _, _| {
            v.write_scope = Some(router.app().tasks())
        })
        .unwrap();
        choose(&mut cx, v, Some(f.root.clone()));
        set_message(&mut cx, v, "First commit", "");
        v.update(&mut cx, |v, window, cx| {
            v.commit(window, cx);
            assert!(v.write_job.is_some());
            window.remove_window();
        })
        .unwrap();
        let _quit = router.quit(Default::default());

        cx.run_until_parked();
        assert_eq!(f.git(&["log", "-1", "--format=%s"]), b"First commit\n");
        assert_eq!(f.git(&["rev-list", "--count", "HEAD"]), b"1\n");
        assert_eq!(router.quit_status().phase, rake::quit::QuitPhase::Ready);
    }

    #[test]
    fn a_disposed_application_scope_rejects_a_write_before_git_starts() {
        let f = Fixture::new();

        f.write("a.txt", "untracked\n");
        let (mut cx, v) = setup(&f);

        let scope = {
            let router = rake::router::Router::<rake::router::NoRoute>::new(Default::default());

            router.app().tasks()
        };

        choose(&mut cx, v, Some(f.root.clone()));
        v.update(&mut cx, |v, window, cx| {
            v.write_scope = Some(scope);
            v.start_write(write::Operation::StageAll, window, cx);
            assert!(v.write_job.is_none());
        })
        .unwrap();
        draw(&mut cx, v);
        assert_eq!(write::staged_count(&f.load()), 0);
        assert_eq!(fs::read(f.root.join("a.txt")).unwrap(), b"untracked\n");
    }

    #[test]
    fn home_and_repository_tab_preserve_the_active_patch_selection_and_commit_draft() {
        let f = Fixture::new();

        f.write("a.txt", "alpha\n");
        f.write("b.txt", "beta\n");
        let (mut cx, v) = setup(&f);

        choose(&mut cx, v, Some(f.root.clone()));
        click_file(&mut cx, v, "workspace-file-1");
        set_message(&mut cx, v, "Keep summary", "Keep description");
        click_file(&mut cx, v, "workspace-home");
        assert!(v.read_with(&cx, |view, _| view.home_visible).unwrap());
        click_file(&mut cx, v, "workspace-repository-tab");
        assert!(!v.read_with(&cx, |view, _| view.home_visible).unwrap());
        assert!(patch_text(&cx, v).contains("+beta"));
        v.read_with(&cx, |view, cx| {
            assert_eq!(view.summary.read(cx).text(), "Keep summary");
            assert_eq!(view.description.read(cx).text(), "Keep description");
        })
        .unwrap();
    }

    #[test]
    fn original_shell_measurements_and_compact_file_rows_match_the_reference() {
        let f = Fixture::new();

        f.write("a.txt", "alpha\n");
        f.write("b.txt", "beta\n");
        let (mut cx, v) = setup(&f);

        choose(&mut cx, v, Some(f.root.clone()));
        let mut visual = gpui::VisualTestContext::from_window(v.into(), &cx);
        // apps/gpuix design tokens and repository-list.tsx define these logical-pixel measurements.
        let titlebar = visual.debug_bounds("workspace-titlebar").unwrap();
        let rail = visual.debug_bounds("workspace-rail").unwrap();
        let surface = visual.debug_bounds("workspace-surface").unwrap();
        let row = visual.debug_bounds("workspace-file-0").unwrap();
        let composer = visual.debug_bounds("workspace-commit-composer").unwrap();
        let toolbar = visual.debug_bounds("workspace-patch-toolbar").unwrap();

        assert_eq!(titlebar.size.height, px(42.));
        assert_eq!(rail.size.width, px(48.));
        assert_eq!(surface.left(), px(48.));
        assert_eq!(surface.top(), px(42.));
        assert_eq!(surface.bottom(), px(634.));
        assert_eq!(row.size.height, px(28.));
        assert_eq!(composer.size.height, px(140.));
        assert_eq!(toolbar.size.height, px(36.));
        assert_eq!(toolbar.left(), surface.left() + px(311.));
    }

    #[test]
    fn row_checkboxes_stage_and_unstage_without_changing_the_viewed_file_or_draft() {
        let f = Fixture::new();

        f.write("a.txt", "base\n");
        f.commit();
        f.write("a.txt", "changed\n");
        f.write("b.txt", "untracked\n");
        let (mut cx, v) = setup(&f);

        choose(&mut cx, v, Some(f.root.clone()));
        set_message(&mut cx, v, "Keep draft", "Keep description");
        click_file(&mut cx, v, "workspace-stage-1");
        assert_eq!(f.git(&["show", ":b.txt"]), b"untracked\n");
        assert_eq!(
            v.read_with(&cx, |view, _| view.selected.clone()).unwrap(),
            Some(key("a.txt", read::Side::Working))
        );
        assert!(patch_text(&cx, v).contains("+changed"));
        click_file(&mut cx, v, "workspace-stage-0");
        assert_eq!(write::staged_count(&f.load()), 0);
        assert_eq!(fs::read(f.root.join("b.txt")).unwrap(), b"untracked\n");
        assert_eq!(
            v.read_with(&cx, |view, cx| view.summary.read(cx).text().to_owned())
                .unwrap(),
            "Keep draft"
        );
    }

    #[test]
    fn filtering_keeps_keyboard_selection_in_results_and_stage_all_uses_the_entire_repository() {
        let f = Fixture::new();

        f.write("a.txt", "alpha\n");
        f.write("b.txt", "beta\n");
        let (mut cx, v) = setup(&f);

        choose(&mut cx, v, Some(f.root.clone()));
        v.update(&mut cx, |view, window, cx| {
            view.toggle_filter(window, cx);
            view.filter
                .update(cx, |input, cx| input.set_text("b.txt", cx));
        })
        .unwrap();
        draw(&mut cx, v);
        assert_eq!(
            v.read_with(&cx, |view, _| view.visible_files.len())
                .unwrap(),
            1
        );
        assert!(patch_text(&cx, v).contains("+beta"));
        click_file(&mut cx, v, "workspace-stage-all");
        assert_eq!(write::staged_count(&f.load()), 2);
        assert_eq!(
            v.read_with(&cx, |view, _| view.visible_files.len())
                .unwrap(),
            1
        );
        v.update(&mut cx, |view, window, cx| view.toggle_filter(window, cx))
            .unwrap();
        draw(&mut cx, v);
        assert_eq!(
            v.read_with(&cx, |view, _| view.visible_files.len())
                .unwrap(),
            2
        );
        v.update(&mut cx, |view, window, cx| {
            window.focus(&view.section_focus[0], cx)
        })
        .unwrap();
        cx.update_window(v.into(), |_, window, cx| {
            window.dispatch_event(
                gpui::KeyDownEvent {
                    keystroke: gpui::Keystroke::parse("down").unwrap(),
                    is_held: false,
                    prefer_character_input: false,
                }
                .to_platform_input(),
                cx,
            );
        })
        .unwrap();
        draw(&mut cx, v);
        assert!(
            v.read_with(&cx, |view, _| view.section == Section::History)
                .unwrap()
        );
    }
}
