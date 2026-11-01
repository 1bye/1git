//! Real partial-index writes refresh related tabs and preserve their intent.
use super::discard_tests::pointer;
use super::tests::{draw, open, setup};
use super::*;
use crate::workspace::{Preview, PreviewState, read::Side, staging, tests::Fixture};
use onegit_git::{BranchIdentity, LineAction};

fn request(
    tab: &gpui::Entity<RepositoryWorkspace>,
    cx: &gpui::TestAppContext,
    keys: &[&str],
) -> staging::Action {
    tab.read_with(cx, |tab, _| {
        let RepositoryState::Ready(source) = &tab.state else {
            panic!("loaded repository")
        };

        let PreviewState::Ready(Preview::Patch { document, .. }) = &tab.preview else {
            panic!("text patch")
        };

        staging::Action {
            root: source.snapshot.repository.root.clone(),
            path: tab.selected.as_ref().unwrap().path.clone(),
            expected: BranchIdentity::from_snapshot(&source.snapshot),
            patch: document.patch().to_owned(),
            lines: keys.iter().map(|s| s.to_string()).collect(),
            direction: LineAction::Stage,
        }
    })
}

#[test]
fn line_and_hunk_writes_refresh_related_tabs_preserve_drafts_and_reject_old_reviews() {
    let f = Fixture::new();
    let original = (1..=80).map(|n| format!("line {n}\n")).collect::<String>();

    f.write("a.txt", &original);
    f.write("other.txt", "base\n");
    f.git(&["add", "."]);
    f.git(&["commit", "-m", "Base"]);
    f.write(
        "a.txt",
        &original
            .replace("line 2\n", "FIRST\n")
            .replace("line 70\n", "LAST\n"),
    );
    f.write("other.txt", "preserve staged\n");
    f.git(&["add", "other.txt"]);
    let linked = f.directory.path().join("linked");

    f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    std::fs::write(
        linked.join("a.txt"),
        original.replace("line 40\n", "LINKED\n"),
    )
    .unwrap();
    let (mut cx, view) = setup(&f);
    let a = open(&mut cx, view, &f.root);
    let b = open(&mut cx, view, &f.root);
    let c = open(&mut cx, view, &linked);

    for (tab, draft) in [(&a, "first"), (&b, "second"), (&c, "linked")] {
        tab.update(&mut cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text(draft, cx));
            tab.description
                .update(cx, |input, cx| input.set_text("body", cx));
            let key = match &tab.state {
                RepositoryState::Ready(source) => source
                    .files
                    .iter()
                    .find(|file| {
                        file.key.path.to_str() == Some("a.txt") && file.key.side == Side::Working
                    })
                    .unwrap()
                    .key
                    .clone(),
                _ => panic!("ready"),
            };

            tab.select(key, cx);
        });
    }

    view.update(&mut cx, |workspace, window, cx| {
        workspace.activate(1, window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    let stale = request(&a, &cx, &["+:2"]);

    pointer(
        &mut cx,
        view,
        "diff-stage-line-Old-+:2",
        gpui::MouseButton::Left,
    );
    draw(&mut cx, view);
    assert_eq!(f.git(&["show", ":other.txt"]), b"preserve staged\n");
    let index = String::from_utf8(f.git(&["show", ":a.txt"])).unwrap();

    assert!(index.contains("line 2\nFIRST\n"));
    assert!(!index.contains("LAST\n"));
    assert_eq!(
        std::fs::read_to_string(f.root.join("a.txt")).unwrap(),
        original
            .replace("line 2\n", "FIRST\n")
            .replace("line 70\n", "LAST\n")
    );

    for (tab, draft) in [(&a, "first"), (&b, "second"), (&c, "linked")] {
        tab.read_with(&cx, |tab, cx| {
            assert_eq!(tab.summary.read(cx).text(), draft);
            assert_eq!(tab.description.read(cx).text(), "body");
            assert!(!tab.refresh_blocked);
            assert!(
                tab.selected
                    .as_ref()
                    .is_some_and(|key| key.path.to_str() == Some("a.txt"))
            );
        });
    }

    let before = f.git(&["show", ":a.txt"]);

    view.update(&mut cx, |workspace, window, cx| {
        workspace.submit_staging(1, &staging::Submit(stale), window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(f.git(&["show", ":a.txt"]), before);
    let action = request(&a, &cx, &["-:2"]);

    view.update(&mut cx, |workspace, window, cx| {
        workspace.submit_staging(1, &staging::Submit(action), window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    assert!(
        String::from_utf8(f.git(&["show", ":a.txt"]))
            .unwrap()
            .starts_with("line 1\nFIRST\nline 3\n")
    );
}

#[test]
fn a_queued_partial_write_never_uses_a_replaced_root_or_preview() {
    let f = Fixture::new();

    f.write("a", "before\n");
    f.git(&["add", "."]);
    f.git(&["commit", "-m", "Base"]);
    f.write("a", "after\n");
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);
    let mut action = request(&tab, &cx, &["+:1"]);

    action.patch = "stale".into();
    let index = std::fs::read(f.root.join(".git/index")).unwrap();

    view.update(&mut cx, |workspace, window, cx| {
        workspace.submit_staging(1, &staging::Submit(action), window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    tab.read_with(&cx, |tab, _| assert!(tab.write_job.is_none()));
}

#[test]
fn a_replaced_repository_with_identical_head_and_patch_cannot_receive_an_old_action() {
    let f = Fixture::new();

    f.write("a", "before\n");
    f.git(&["add", "."]);
    f.git(&["commit", "-m", "Base"]);
    let other = f.directory.path().join("other");

    f.git(&[
        "clone",
        "--no-hardlinks",
        f.root.to_str().unwrap(),
        other.to_str().unwrap(),
    ]);
    f.write("a", "after\n");
    std::fs::write(other.join("a"), "after\n").unwrap();
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);
    let action = request(&tab, &cx, &["+:1"]);

    tab.update(&mut cx, |tab, cx| tab.open(other.clone(), None, cx));
    draw(&mut cx, view);
    let replacement = request(&tab, &cx, &["+:1"]);

    assert_eq!(action.expected, replacement.expected);
    assert_eq!(action.patch, replacement.patch);
    assert_ne!(action.root, replacement.root);
    let old_index = std::fs::read(f.root.join(".git/index")).unwrap();
    let new_index = std::fs::read(other.join(".git/index")).unwrap();

    view.update(&mut cx, |workspace, window, cx| {
        workspace.submit_staging(1, &staging::Submit(action), window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), old_index);
    assert_eq!(std::fs::read(other.join(".git/index")).unwrap(), new_index);
}
