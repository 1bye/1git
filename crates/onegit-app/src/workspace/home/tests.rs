//! Home ports library validation, non-destructive discovery and retained native navigation.
use super::*;
use std::{fs, path::Path};

#[test]
fn imports_legacy_local_library_in_order_without_writing_it_and_roundtrips_own_preferences() {
    let temp = tempfile::tempdir().unwrap();
    let legacy = temp.path().join("legacy");

    fs::create_dir_all(legacy.join("repository-discovery-v1")).unwrap();
    let a = temp.path().join("repos/a");
    let b = temp.path().join("repos/b");
    let root = temp.path().join("repos");
    let source = serde_json::json!({"version":1,"activeSpaceId":"local","spaces":[{"id":"local","repositories":[a,"/@1git-ssh/test/home/remote"],"library":{"folder":root,"view":"list","starred":[b]},"discovery":{"folders":[root],"hidden":[]}}]});
    let original = serde_json::to_vec(&source).unwrap();

    fs::write(legacy.join("session.json"), &original).unwrap();
    fs::write(
        legacy.join("machines.json"),
        br#"{"version":1,"machines":[{"name":"devbox-ts"}]}"#,
    )
    .unwrap();
    fs::write(
        legacy.join("repository-discovery-v1/cache.json"),
        serde_json::to_vec(&serde_json::json!({"canonicalPath":root,"progress":{"paths":[a,b]}}))
            .unwrap(),
    )
    .unwrap();
    let own = temp.path().join("rust/home.json");
    let library = Library::load(&legacy, &own).unwrap();

    assert_eq!(library.paths, [a.clone(), b.clone()]);
    assert_eq!(library.layout, Layout::List);
    assert_eq!(library.scope(), [a, b]);
    assert_eq!(library.machines, ["devbox-ts"]);
    library.save(&own).unwrap();
    let restored = Library::load(&legacy, &own).unwrap();

    assert_eq!(restored.paths, library.paths);
    assert_eq!(restored.folder, library.folder);
    assert_eq!(fs::read(legacy.join("session.json")).unwrap(), original);
}

#[test]
fn invalid_or_oversized_rust_library_is_reported_without_falling_back_or_overwriting() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("home.json");

    fs::write(&path, "broken").unwrap();
    assert!(Library::load(temp.path(), &path).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"broken");
    fs::write(&path, vec![b' '; 2 * 1024 * 1024 + 1]).unwrap();
    assert!(Library::load(temp.path(), &path).is_err());
}

#[test]
fn scanning_skips_build_folders_and_descendant_symlinks_and_respects_cancellation() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();

    fs::create_dir_all(root.join("project/.git")).unwrap();
    fs::create_dir_all(root.join("target/hidden/.git")).unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root, root.join("loop")).unwrap();
    }
    let (found, skipped) = library::scan(&[root.into()], &Cancellation::default());

    assert_eq!(found, [root.join("project")]);
    assert_eq!(skipped, 0);
    let cancel = Cancellation::default();

    cancel.cancel();
    assert!(library::scan(&[root.into()], &cancel).0.is_empty());
}

#[cfg(feature = "test-support")]
mod native {
    use super::*;
    use onegit_ui::Theme;

    fn draw(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Home>) {
        for _ in 0..3 {
            cx.run_until_parked();
            cx.update_window(view.into(), |_, window, cx| window.draw(cx).clear(cx))
                .unwrap();
        }
    }

    #[test]
    fn home_matches_reference_geometry_and_search_keeps_layout_and_folder_intent() {
        let mut cx = gpui::TestAppContext::single();

        cx.update(|cx| Theme::light().install(cx));
        let view = cx.open_window(gpui::size(px(1226.), px(772.)), |window, cx| {
            let mut home = Home::new(window, cx, None);

            home.library.paths = vec![
                Path::new("/missing/family").into(),
                Path::new("/missing/ace").into(),
            ];
            home.library.folders = vec![PathBuf::from("/missing")];
            home.library.folder = Some(Folder::Path(Path::new("/missing").into()));
            home.filter(cx);

            home
        });

        draw(&mut cx, view);
        let mut visual = gpui::VisualTestContext::from_window(view.into(), &cx);
        let columns = visual.debug_bounds("home-columns").unwrap();
        let sidebar = visual.debug_bounds("home-sidebar").unwrap();
        let search = visual.debug_bounds("home-search-toolbar").unwrap();
        let card = visual.debug_bounds("home-repository-0").unwrap();

        assert_eq!(columns.left(), px(123.));
        assert_eq!(sidebar.size.width, px(220.));
        assert_eq!(search.left(), sidebar.right() + px(64.));
        assert_eq!(search.size.height, px(40.));
        assert_eq!(card.size.width, px(160.));
        assert_eq!(card.size.height, px(112.));
        assert_eq!(card.top(), px(96.));
        let next = visual.debug_bounds("home-repository-1").unwrap();

        assert_eq!(next.top(), card.top());
        assert_eq!(next.left(), card.right() + px(12.));
        view.update(&mut cx, |home, _, cx| {
            home.query.update(cx, |query, cx| query.set_text("ACE", cx))
        })
        .unwrap();
        draw(&mut cx, view);
        assert_eq!(
            view.read_with(&cx, |home, _| home.matches.clone()).unwrap(),
            [PathBuf::from("/missing/ace")]
        );
        view.update(&mut cx, |home, window, cx| {
            home.layout(Layout::List, window, cx)
        })
        .unwrap();
        draw(&mut cx, view);
        let mut visual = gpui::VisualTestContext::from_window(view.into(), &cx);

        assert_eq!(
            visual
                .debug_bounds("home-repository-0")
                .unwrap()
                .size
                .height,
            px(54.)
        );
        view.update(&mut cx, |home, _, cx| home.back(cx)).unwrap();
        draw(&mut cx, view);
        assert!(
            view.read_with(&cx, |home, _| home.library.folder.is_none())
                .unwrap()
        );
        view.update(&mut cx, |home, _, cx| {
            home.star(PathBuf::from("/missing/ace"), cx)
        })
        .unwrap();
        draw(&mut cx, view);
        assert_eq!(
            view.read_with(&cx, |home, _| home.matches.clone()).unwrap(),
            [PathBuf::from("/missing/ace")]
        );
        view.update(&mut cx, |home, _, cx| {
            home.forget(Path::new("/missing/ace"), cx)
        })
        .unwrap();
        draw(&mut cx, view);
        assert!(
            view.read_with(&cx, |home, _| home.library.starred.is_empty()
                && !home.library.paths.contains(&PathBuf::from("/missing/ace")))
                .unwrap()
        );
    }

    #[test]
    fn create_and_local_clone_use_real_git_and_refuse_an_existing_destination() {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("created");
        let source = crate::workspace::tests::Fixture::new();

        source.write("tracked.txt", "base\n");
        source.commit();
        let mut cx = gpui::TestAppContext::single();

        cx.update(|cx| Theme::light().install(cx));
        let view = cx.open_window(gpui::size(px(900.), px(600.)), |window, cx| {
            Home::new(window, cx, None)
        });

        draw(&mut cx, view);
        view.update(&mut cx, |home, window, cx| {
            home.destination.update(cx, |input, cx| {
                input.set_text(destination.to_string_lossy(), cx)
            });
            home.show(Form::Create, window, cx);
            home.submit(window, cx);
        })
        .unwrap();
        draw(&mut cx, view);
        assert!(destination.join(".git").is_dir());
        assert!(
            view.read_with(&cx, |home, _| home.setup_job.is_none()
                && home.form_error.is_none())
                .unwrap()
        );
        fs::write(destination.join("keep.txt"), "keep").unwrap();
        view.update(&mut cx, |home, window, cx| home.submit(window, cx))
            .unwrap();
        draw(&mut cx, view);
        assert_eq!(fs::read(destination.join("keep.txt")).unwrap(), b"keep");
        assert!(
            view.read_with(&cx, |home, _| home.form_error.is_some())
                .unwrap()
        );
        let clone = temp.path().join("clone");

        view.update(&mut cx, |home, window, cx| {
            home.remote.update(cx, |input, cx| {
                input.set_text(source.root.to_string_lossy(), cx)
            });
            home.destination
                .update(cx, |input, cx| input.set_text(clone.to_string_lossy(), cx));
            home.show(Form::Clone, window, cx);
            home.submit(window, cx);
        })
        .unwrap();
        draw(&mut cx, view);
        assert_eq!(fs::read(clone.join("tracked.txt")).unwrap(), b"base\n");
        assert!(
            view.read_with(&cx, |home, _| home.form_error.is_none())
                .unwrap()
        );
    }

    #[test]
    fn disposed_app_scope_rejects_setup_before_git_creates_the_folder() {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("must-not-exist");

        let scope = {
            let router = rake::router::Router::<rake::router::NoRoute>::new(Default::default());

            router.app().tasks()
        };

        let mut cx = gpui::TestAppContext::single();

        cx.update(|cx| Theme::light().install(cx));
        let view = cx.open_window(gpui::size(px(900.), px(600.)), |window, cx| {
            Home::new(window, cx, Some(scope))
        });

        draw(&mut cx, view);
        view.update(&mut cx, |home, window, cx| {
            home.destination.update(cx, |input, cx| {
                input.set_text(destination.to_string_lossy(), cx)
            });
            home.show(Form::Create, window, cx);
            home.submit(window, cx);
        })
        .unwrap();
        draw(&mut cx, view);
        assert!(!destination.exists());
        assert!(
            view.read_with(&cx, |home, _| home.form_error.is_some()
                && home.setup_job.is_none())
                .unwrap()
        );
    }
}

#[test]
fn folder_groups_use_the_deepest_root_and_other_scope_roundtrips() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("repos");
    let nested = root.join("nested");

    let mut library = Library {
        folders: vec![root.clone(), nested.clone()],
        paths: vec![
            root.join("a"),
            nested.join("b"),
            temp.path().join("outside"),
        ],
        folder: Some(Folder::Path(root.clone())),
        ..Default::default()
    };

    assert_eq!(library.scope(), [root.join("a")]);
    library.folder = Some(Folder::Other);
    assert_eq!(library.scope(), [temp.path().join("outside")]);
    let file = temp.path().join("home.json");

    library.save(&file).unwrap();
    let restored = Library::load(temp.path(), &file).unwrap();

    assert_eq!(restored.folder, Some(Folder::Other));
    assert_eq!(restored.scope(), library.scope());
}
