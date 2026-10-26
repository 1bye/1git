//! Covers: unpublished-tip undo, root commits, worktrees and exact data preservation.
//! Real: public Rust APIs, local Git, indexes/files/refs and disposable bare remotes.
//! Doubles: explicit race/failure executable wrappers in the outcomes module.
//! Requires: Git, POSIX shell and writable temporary storage; no credentials/network.

mod common;

use common::{Fixture, files_under};

use onegit_git::{
    BranchIdentity, Cancellation, ErrorCode, GitCommand, GitProcess, Repository, WritePhase,
};

use std::fs;
use std::path::{Path, PathBuf};

#[path = "commit_recovery/outcomes.rs"]
mod outcomes;

fn open(fixture: &Fixture) -> Repository {
    Repository::open(&fixture.root, fixture.process(), None).unwrap()
}

fn review(repository: &Repository) -> BranchIdentity {
    BranchIdentity::from_snapshot(&repository.snapshot(false, None).unwrap())
}

fn text(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes)
        .unwrap()
        .trim_end_matches('\n')
        .to_owned()
}

fn base_and_tip(fixture: &Fixture) -> (String, String) {
    fixture.write("README.md", "base\n");
    fixture.commit("base");
    let parent = text(fixture.git(&["rev-parse", "HEAD"]));

    fixture.write("a.txt", "committed\n");
    fixture.commit("Feature\n\nDetails");

    (parent, text(fixture.git(&["rev-parse", "HEAD"])))
}

fn unchanged_working(fixture: &Fixture) -> impl FnOnce() {
    let root = fixture.root.clone();
    let mut before = files_under(&root);

    before.retain(|path, _| !path.starts_with(".git"));

    move || {
        let mut after = files_under(&root);

        after.retain(|path, _| !path.starts_with(".git"));
        assert_eq!(
            before, after,
            "working bytes and modification times remain exact"
        );
    }
}

fn executable(path: &Path, script: &str) {
    use std::os::unix::fs::PermissionsExt;

    fs::write(path, script).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
}

fn process(fixture: &Fixture, executable: impl Into<PathBuf>) -> GitProcess {
    GitProcess::new(executable, 64 * 1024 * 1024).with_environment([
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        (
            "FIXTURE_DIRECTORY".into(),
            fixture.temporary.path().as_os_str().to_owned(),
        ),
    ])
}

#[test]
fn undo_keeps_files_mtimes_symlinks_index_other_refs_and_full_message() {
    let fixture = Fixture::new();
    let (parent, tip) = base_and_tip(&fixture);

    fixture.write("a.txt", "additional edits\n");
    fixture.write("excluded.txt", "staged\n");
    fixture.git_os(["add".into(), "--".into(), "excluded.txt".into()]);
    fixture.write("excluded.txt", "working\n");
    std::os::unix::fs::symlink("a.txt", fixture.root.join("alias")).unwrap();
    fixture.git(&["update-ref", "refs/heads/other", &tip]);
    let repository = open(&fixture);
    let expected = review(&repository);
    let index = repository.info().git_directory.join("index");
    let index_bytes = fs::read(&index).unwrap();
    let index_modified = fs::metadata(&index).unwrap().modified().unwrap();
    let verify_working = unchanged_working(&fixture);

    assert_eq!(
        repository.review_last_commit(&expected, None).unwrap().body,
        "Feature\n\nDetails"
    );
    let result = repository.undo_last_commit(&expected, None).unwrap();

    assert_eq!(
        result.snapshot.unwrap().status.head.oid.as_deref(),
        Some(parent.as_str())
    );
    assert_eq!(result.message, "Feature\n\nDetails");
    assert_eq!(result.warning, None);
    assert!(result.recovery_ref.starts_with("refs/1git/undo/"));
    assert_eq!(text(fixture.git(&["rev-parse", &result.recovery_ref])), tip);
    assert_eq!(text(fixture.git(&["rev-parse", "refs/heads/other"])), tip);
    assert_eq!(fs::read(&index).unwrap(), index_bytes);
    assert_eq!(
        fs::metadata(&index).unwrap().modified().unwrap(),
        index_modified
    );
    assert_eq!(fixture.git(&["show", ":excluded.txt"]), b"staged\n");
    assert_eq!(
        fs::read_link(fixture.root.join("alias")).unwrap(),
        PathBuf::from("a.txt")
    );
    verify_working();
}

#[test]
fn first_commit_undo_retains_named_unborn_head_files_and_exact_index() {
    let fixture = Fixture::new();

    fixture.write("README.md", "# Test repository\n");
    fixture.commit("Initial");
    let repository = open(&fixture);
    let expected = review(&repository);
    let index = fs::read(repository.info().git_directory.join("index")).unwrap();
    let verify_working = unchanged_working(&fixture);
    let result = repository.undo_last_commit(&expected, None).unwrap();
    let snapshot = result.snapshot.unwrap();

    assert!(snapshot.status.head.oid.is_none());
    assert_eq!(snapshot.status.head.branch.as_deref(), Some("main"));
    assert_eq!(
        text(fixture.git(&["symbolic-ref", "HEAD"])),
        "refs/heads/main"
    );
    assert_eq!(
        fs::read(repository.info().git_directory.join("index")).unwrap(),
        index
    );
    assert_eq!(
        fixture.git(&["show", &format!("{}:README.md", result.recovery_ref)]),
        b"# Test repository\n"
    );
    assert!(result.warning.is_none());
    verify_working();
}

#[test]
fn known_published_tip_without_upstream_refuses_review_and_undo_without_changes() {
    let fixture = Fixture::new();

    base_and_tip(&fixture);
    let remote = fixture.temporary.path().join("bare.git");

    fixture.git(&["init", "--bare", remote.to_str().unwrap()]);
    fixture.git(&["remote", "add", "origin", remote.to_str().unwrap()]);
    fixture.git(&["push", "origin", "main"]);
    let repository = open(&fixture);
    let expected = review(&repository);
    let all = files_under(&fixture.root);

    for result in [
        repository.review_last_commit(&expected, None).map(|_| ()),
        repository.undo_last_commit(&expected, None).map(|_| ()),
    ] {
        let error = result.unwrap_err();

        assert_eq!(error.phase, WritePhase::BeforeCommand);
        assert_eq!(error.failure.code, ErrorCode::InvalidInput);
        assert!(error.failure.message.contains("already published"));
    }

    assert_eq!(files_under(&fixture.root), all);
}

#[test]
fn stale_detached_and_active_operations_cannot_move_refs() {
    let fixture = Fixture::new();

    base_and_tip(&fixture);
    let repository = open(&fixture);
    let stale = review(&repository);

    fixture.write("next.txt", "next\n");
    fixture.commit("Next");
    assert_eq!(
        repository.undo_last_commit(&stale, None).unwrap_err().phase,
        WritePhase::BeforeCommand
    );
    let expected = review(&repository);

    fixture.git(&["checkout", "--detach"]);
    assert_eq!(
        repository
            .undo_last_commit(&expected, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    fixture.git(&["checkout", "main"]);

    for marker in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"] {
        fs::write(
            repository.info().git_directory.join(marker),
            format!("{}\n", stale.oid.as_deref().unwrap()),
        )
        .unwrap();
        let error = repository.undo_last_commit(&expected, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::BeforeCommand);
        assert!(
            error
                .failure
                .message
                .contains("Finish the current Git operation")
        );
        fs::remove_file(repository.info().git_directory.join(marker)).unwrap();
    }

    assert_eq!(
        text(fixture.git(&["rev-parse", "HEAD"])),
        expected.oid.unwrap()
    );
    assert!(
        fixture
            .git(&["for-each-ref", "--format=%(refname)", "refs/1git/undo/"])
            .is_empty()
    );
}

#[test]
fn linked_worktree_undo_keeps_main_checkout_and_both_indexes() {
    let fixture = Fixture::new();
    let (_, main) = base_and_tip(&fixture);
    let linked = fixture.temporary.path().join("linked");

    fixture.git(&["worktree", "add", "-b", "feature", linked.to_str().unwrap()]);
    fs::write(linked.join("new.txt"), b"new\n").unwrap();

    for args in [vec!["add", "new.txt"], vec!["commit", "-m", "Feature"]] {
        fixture
            .process()
            .run(GitCommand::new(&linked, args))
            .unwrap();
    }

    let repository = Repository::open(&linked, fixture.process(), None).unwrap();
    let expected = review(&repository);
    let index = fs::read(repository.info().git_directory.join("index")).unwrap();
    let main_index = fs::read(fixture.root.join(".git/index")).unwrap();
    let result = repository.undo_last_commit(&expected, None).unwrap();

    assert_eq!(
        result.snapshot.unwrap().status.head.oid.as_deref(),
        Some(main.as_str())
    );
    assert_eq!(text(fixture.git(&["rev-parse", "HEAD"])), main);
    assert_eq!(fs::read(linked.join("new.txt")).unwrap(), b"new\n");
    assert_eq!(
        fs::read(repository.info().git_directory.join("index")).unwrap(),
        index
    );
    assert_eq!(
        fs::read(fixture.root.join(".git/index")).unwrap(),
        main_index
    );
    assert_eq!(
        text(fixture.git(&["rev-parse", &result.recovery_ref])),
        expected.oid.unwrap()
    );
}

#[test]
fn cancellation_and_merge_tip_refuse_before_any_recovery_ref_or_branch_change() {
    let fixture = Fixture::new();

    base_and_tip(&fixture);
    let repository = open(&fixture);
    let expected = review(&repository);
    let cancellation = Cancellation::default();

    cancellation.cancel();
    let error = repository
        .undo_last_commit(&expected, Some(&cancellation))
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert_eq!(error.failure.code, ErrorCode::Aborted);
    assert!(std::error::Error::source(&error).is_some());
    fixture.git(&["checkout", "-b", "other"]);
    fixture.write("other.txt", "other\n");
    fixture.commit("Other");
    fixture.git(&["checkout", "main"]);
    fixture.git(&["merge", "--no-ff", "other", "-m", "Merge"]);
    let expected = review(&repository);
    let error = repository.undo_last_commit(&expected, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert_eq!(
        error.failure.message,
        "Editing merge commits requires external Git tools."
    );
    assert_eq!(
        text(fixture.git(&["rev-parse", "HEAD"])),
        expected.oid.unwrap()
    );
    assert!(
        fixture
            .git(&["for-each-ref", "--format=%(refname)", "refs/1git/undo/"])
            .is_empty()
    );
}
