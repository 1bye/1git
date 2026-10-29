//! Ports path-scoped stage/unstage/discard hunks, stale review and one-use undo.
mod common;

use common::Fixture;
use onegit_git::{ChangeHunk, DiffOptions, DiffTarget, HunkAction, Repository};

#[test]
fn stages_unstages_and_discards_individual_hunks_with_one_use_undo() {
    let f = Fixture::new();
    let original = (0..30).map(|n| format!("line {n}\n")).collect::<String>();

    f.write("file[1]", &original);
    f.commit("Base");
    let changed = original
        .replace("line 1\n", "FIRST\n")
        .replace("line 25\n", "LAST\n");

    f.write("file[1]", &changed);
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let path = "file[1]".try_into().unwrap();

    r.change_hunk(
        ChangeHunk {
            path: &path,
            hunk_index: 0,
            action: HunkAction::Stage,
            expected_patch: None,
            allow_destructive: false,
        },
        None,
    )
    .unwrap();
    let staged = r
        .diff(DiffOptions::new(DiffTarget::Staged), None)
        .unwrap()
        .patch;

    assert!(staged.contains("+FIRST"));
    assert!(!staged.contains("+LAST"));
    r.change_hunk(
        ChangeHunk {
            path: &path,
            hunk_index: 0,
            action: HunkAction::Unstage,
            expected_patch: Some(&staged),
            allow_destructive: false,
        },
        None,
    )
    .unwrap();
    assert!(
        r.diff(DiffOptions::new(DiffTarget::Staged), None)
            .unwrap()
            .patch
            .is_empty()
    );
    assert!(
        r.change_hunk(
            ChangeHunk {
                path: &path,
                hunk_index: 0,
                action: HunkAction::Discard,
                expected_patch: None,
                allow_destructive: false
            },
            None
        )
        .is_err()
    );
    assert!(
        r.change_hunk(
            ChangeHunk {
                path: &path,
                hunk_index: 0,
                action: HunkAction::Stage,
                expected_patch: Some("stale"),
                allow_destructive: false
            },
            None
        )
        .is_err()
    );
    let undo = r
        .change_hunk(
            ChangeHunk {
                path: &path,
                hunk_index: 0,
                action: HunkAction::Discard,
                expected_patch: None,
                allow_destructive: true,
            },
            None,
        )
        .unwrap()
        .undo
        .unwrap();

    assert_eq!(
        std::fs::read_to_string(f.root.join("file[1]")).unwrap(),
        original.replace("line 25\n", "LAST\n")
    );
    r.undo_discard(&undo.token, None).unwrap();
    assert_eq!(
        std::fs::read_to_string(f.root.join("file[1]")).unwrap(),
        changed
    );
    assert!(r.undo_discard(&undo.token, None).is_err());
}

#[test]
fn refuses_missing_hunks_and_multiple_file_patches_without_changing_index() {
    assert!(onegit_git::select_hunk_patch("", 0).is_err());
    assert!(
        onegit_git::select_hunk_patch(
            "diff --git a/a b/a\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/b b/b\n",
            0
        )
        .is_err()
    );
}

#[test]
fn refuses_diff_prefix_configuration_that_redirects_a_hunk_to_an_unselected_neighbor() {
    let f = Fixture::new();

    std::fs::create_dir(f.root.join("folder")).unwrap();
    f.write("folder/file", "base\n");
    f.write("file", "base\n");
    f.commit("Base");
    f.write("folder/file", "changed\n");
    f.write("file", "changed\n");
    f.git(&["config", "diff.noprefix", "true"]);
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let path = "folder/file".try_into().unwrap();

    assert!(
        r.change_hunk(
            ChangeHunk {
                path: &path,
                hunk_index: 0,
                action: HunkAction::Discard,
                expected_patch: None,
                allow_destructive: true
            },
            None
        )
        .is_err()
    );
    assert_eq!(
        std::fs::read(f.root.join("folder/file")).unwrap(),
        b"changed\n"
    );
    assert_eq!(std::fs::read(f.root.join("file")).unwrap(), b"changed\n");
}
