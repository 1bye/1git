//! Reviewed line staging changes only the index.
mod common;

use common::Fixture;

use onegit_git::{
    BranchIdentity, ChangeLines, DiffOptions, DiffTarget, GitPath, LineAction, PartialPatch,
    Repository,
};

fn patch(repo: &Repository, path: &GitPath, target: DiffTarget) -> String {
    let paths = [path.clone()];
    let mut options = DiffOptions::new(target);

    options.paths = Some(&paths);

    repo.diff(options, None).unwrap().patch
}

fn change(repo: &Repository, path: &GitPath, expected: &str, keys: &[&str], action: LineAction) {
    let head = BranchIdentity::from_snapshot(&repo.snapshot(false, None).unwrap());

    repo.change_lines(
        ChangeLines {
            path,
            expected: &head,
            expected_patch: expected,
            lines: &keys.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            action,
        },
        None,
    )
    .unwrap();
}

#[test]
fn stages_and_unstages_selected_additions_and_deletions_without_touching_worktree_or_other_staging()
{
    let f = Fixture::new();

    f.write("file[1].txt", "a\nb\nc\n");
    f.write("keep", "before\n");
    f.commit("Base");
    f.write("keep", "keep staged\n");
    f.git(&["add", "keep"]);
    f.write("file[1].txt", "a\nONE\nTWO\nc\n");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let path = "file[1].txt".try_into().unwrap();
    let initial = patch(&r, &path, DiffTarget::Working);

    change(&r, &path, &initial, &["-:2", "+:2"], LineAction::Stage);
    assert_eq!(f.git(&["show", ":file[1].txt"]), b"a\nONE\nc\n");
    assert_eq!(f.git(&["show", ":keep"]), b"keep staged\n");
    let remaining = patch(&r, &path, DiffTarget::Working);
    let keys = PartialPatch::new(&remaining).unwrap().lines().to_vec();
    let head = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());

    r.change_lines(
        ChangeLines {
            path: &path,
            expected: &head,
            expected_patch: &remaining,
            lines: &keys,
            action: LineAction::Stage,
        },
        None,
    )
    .unwrap();
    let staged = patch(&r, &path, DiffTarget::Staged);

    change(&r, &path, &staged, &["+:2"], LineAction::Unstage);
    assert_eq!(f.git(&["show", ":file[1].txt"]), b"a\nTWO\nc\n");
    assert_eq!(
        std::fs::read(f.root.join("file[1].txt")).unwrap(),
        b"a\nONE\nTWO\nc\n"
    );
}

#[test]
fn stale_patch_branch_and_foreign_lock_reject_without_changing_index() {
    let f = Fixture::new();

    f.write("a", "old\n");
    f.commit("Base");
    f.write("a", "new\n");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let path = "a".try_into().unwrap();
    let expected = patch(&r, &path, DiffTarget::Working);
    let head = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());
    let keys = vec!["+:1".to_owned()];

    let request = ChangeLines {
        path: &path,
        expected: &head,
        expected_patch: &expected,
        lines: &keys,
        action: LineAction::Stage,
    };

    let index = std::fs::read(f.root.join(".git/index")).unwrap();

    f.write("a", "external\n");
    assert!(r.change_lines(request, None).is_err());
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    f.write("a", "new\n");
    f.git(&["switch", "-c", "other"]);
    assert!(r.change_lines(request, None).is_err());
    f.git(&["switch", "main"]);
    let index = std::fs::read(f.root.join(".git/index")).unwrap();

    std::fs::write(f.root.join(".git/index.lock"), b"foreign").unwrap();
    assert!(r.change_lines(request, None).is_err());
    assert_eq!(
        std::fs::read(f.root.join(".git/index.lock")).unwrap(),
        b"foreign"
    );
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
}

#[test]
fn unborn_new_and_partial_deleted_files_preserve_no_final_newline_and_literal_paths() {
    let f = Fixture::new();

    f.write("new[1]", "one\ntwo");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let path = "new[1]".try_into().unwrap();
    let initial = patch(&r, &path, DiffTarget::Working);

    change(&r, &path, &initial, &["+:1"], LineAction::Stage);
    assert_eq!(f.git(&["show", ":new[1]"]), b"one\n");
    let staged = patch(&r, &path, DiffTarget::Staged);

    change(&r, &path, &staged, &["+:1"], LineAction::Unstage);
    assert!(patch(&r, &path, DiffTarget::Staged).is_empty());
    f.commit("Base");
    std::fs::remove_file(f.root.join("new[1]")).unwrap();
    let deleted = patch(&r, &path, DiffTarget::Working);

    change(&r, &path, &deleted, &["-:1"], LineAction::Stage);
    assert_eq!(f.git(&["show", ":new[1]"]), b"two");
}

#[test]
fn noncontiguous_hunks_crlf_cancellation_and_invalid_coordinates_preserve_the_index() {
    let f = Fixture::new();

    let original = (1..=80)
        .map(|n| format!("line {n}\r\n"))
        .collect::<String>();

    f.write("a", &original);
    f.commit("Base");
    f.write(
        "a",
        &original
            .replace("line 2\r\n", "FIRST\r\n")
            .replace("line 70\r\n", "LAST\r\n"),
    );
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let path = "a".try_into().unwrap();
    let expected = patch(&r, &path, DiffTarget::Working);

    assert_eq!(expected.matches("@@ -").count(), 2);
    let head = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());
    let cancelled = onegit_git::Cancellation::default();

    cancelled.cancel();
    let keys = vec![
        "-:2".to_owned(),
        "+:2".to_owned(),
        "-:70".to_owned(),
        "+:70".to_owned(),
    ];

    let mut request = ChangeLines {
        path: &path,
        expected: &head,
        expected_patch: &expected,
        lines: &keys,
        action: LineAction::Stage,
    };

    let index = std::fs::read(f.root.join(".git/index")).unwrap();

    assert_eq!(
        r.change_lines(request, Some(&cancelled)).unwrap_err().phase,
        onegit_git::WritePhase::BeforeCommand
    );
    let invalid = vec!["+:9999".to_owned()];

    request.lines = &invalid;
    assert!(r.change_lines(request, None).is_err());
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    assert!(!f.root.join(".git/index.lock").exists());
    change(
        &r,
        &path,
        &expected,
        &["-:2", "+:2", "-:70", "+:70"],
        LineAction::Stage,
    );
    let staged = patch(&r, &path, DiffTarget::Staged);

    change(&r, &path, &staged, &["-:2", "+:2"], LineAction::Unstage);
    assert_eq!(
        f.git(&["show", ":a"]),
        original.replace("line 70\r\n", "LAST\r\n").as_bytes()
    );
    assert_eq!(
        std::fs::read(f.root.join("a")).unwrap(),
        original
            .replace("line 2\r\n", "FIRST\r\n")
            .replace("line 70\r\n", "LAST\r\n")
            .as_bytes()
    );
}
