//! Consent scopes and reviewed restore use real disposable Git state.
mod common;

use common::Fixture;

use onegit_git::{
    BranchIdentity, DiscardFiles, DiscardRecovery, DiscardScope, Repository, WritePhase,
};

use std::fs;

fn setup() -> (Fixture, Repository) {
    let f = Fixture::new();

    f.write("a[1].txt", "base\n");
    f.commit("Base");
    let repo = Repository::open(&f.root, f.process(), None).unwrap();

    (f, repo)
}

fn request(f: &Fixture, repo: &Repository, paths: &[&str]) -> DiscardFiles {
    DiscardFiles {
        paths: paths.iter().map(common::git_path).collect(),
        allow_destructive: true,
        recovery: Some(DiscardRecovery {
            directory: f.temporary.path().join("recovery"),
            expected: BranchIdentity::from_snapshot(&repo.snapshot(false, None).unwrap()),
        }),
    }
}

#[test]
fn tracked_consent_never_removes_untracked_files_and_untracked_consent_never_discards_staged_work()
{
    let (f, repo) = setup();

    f.write("new.txt", "new\n");
    let untracked = request(&f, &repo, &["new.txt"]);

    let error = repo
        .discard_reviewed(&untracked, DiscardScope::Tracked, None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(!untracked.recovery.as_ref().unwrap().directory.exists());
    assert_eq!(fs::read(f.root.join("new.txt")).unwrap(), b"new\n");
    f.git(&["add", "new.txt"]);
    let error = repo
        .discard_reviewed(&untracked, DiscardScope::Untracked, None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert_eq!(f.git(&["show", ":new.txt"]), b"new\n");
}

#[test]
fn scoped_discard_and_reviewed_restore_keep_index_working_and_excluded_bytes() {
    let (f, repo) = setup();

    f.write("a[1].txt", "staged\n");
    f.git(&["add", "a[1].txt"]);
    f.write("a[1].txt", "working\n");
    f.write("keep.txt", "keep\n");
    let selection = request(&f, &repo, &["a[1].txt"]);
    let expected = selection.recovery.as_ref().unwrap().expected.clone();

    let result = repo
        .discard_reviewed(&selection, DiscardScope::Tracked, None)
        .unwrap();

    assert_eq!(fs::read(f.root.join("a[1].txt")).unwrap(), b"base\n");
    assert_eq!(fs::read(f.root.join("keep.txt")).unwrap(), b"keep\n");
    f.git(&["switch", "-c", "other"]);
    let error = repo
        .restore_discard(&result.undo.token, &expected, None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert_eq!(fs::read(f.root.join("a[1].txt")).unwrap(), b"base\n");
    f.git(&["switch", "main"]);
    repo.restore_discard(&result.undo.token, &expected, None)
        .unwrap();
    assert_eq!(f.git(&["show", ":a[1].txt"]), b"staged\n");
    assert_eq!(fs::read(f.root.join("a[1].txt")).unwrap(), b"working\n");
    assert!(
        repo.restore_discard(&result.undo.token, &expected, None)
            .is_err()
    );
    assert!(result.recovery.directory.join("README.txt").exists());
}

#[test]
fn untracked_deletion_is_literal_and_restorable_and_requires_a_review() {
    let (f, repo) = setup();

    f.write("new[1].txt", "untracked\n");
    let selection = request(&f, &repo, &["new[1].txt"]);
    let expected = selection.recovery.as_ref().unwrap().expected.clone();
    let mut unreviewed = selection.clone();

    unreviewed.recovery = None;
    assert!(
        repo.discard_reviewed(&unreviewed, DiscardScope::Untracked, None)
            .is_err()
    );
    let result = repo
        .discard_reviewed(&selection, DiscardScope::Untracked, None)
        .unwrap();

    assert!(!f.root.join("new[1].txt").exists());
    repo.restore_discard(&result.undo.token, &expected, None)
        .unwrap();
    assert_eq!(fs::read(f.root.join("new[1].txt")).unwrap(), b"untracked\n");
    assert!(f.git(&["ls-files", "--", "new[1].txt"]).is_empty());
}
