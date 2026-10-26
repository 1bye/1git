//! Covers: canonical repository identity, linked worktrees, read-only snapshots and failures.
//! Real: Git CLI, local repositories, symlinks and metadata/filesystem reads.
//! Doubles: one malformed-output executable; Git configuration is isolated per child.
//! Requires: Git and temporary storage; no network, user configuration or credentials.

#[cfg(unix)]
use common::PermissionsExt;
use common::symlink;
use std::ffi::OsString;
use std::fs;
use std::path::Path;

#[cfg(unix)]
use onegit_git::GitProcess;
use onegit_git::{Cancellation, FileStatus, GitError, OperationState, Repository, RepositoryError};

mod common;

use common::{Fixture, files_under};

#[test]
fn opens_nested_files_and_symlink_aliases_to_the_same_canonical_identity() {
    let fixture = Fixture::new();

    fs::create_dir(fixture.root.join("nested")).unwrap();
    fs::write(fixture.root.join("nested/file"), "content").unwrap();

    let alias = fixture.temporary.path().join("alias");

    symlink(&fixture.root, &alias).unwrap();

    let file =
        Repository::open(&fixture.root.join("nested/file"), fixture.process(), None).unwrap();

    let aliased = Repository::open(&alias, fixture.process(), None).unwrap();
    let canonical = fs::canonicalize(&fixture.root).unwrap();

    assert_eq!(file.info(), aliased.info());
    assert_eq!(file.info().root, canonical);
    assert_eq!(file.info().git_directory, canonical.join(".git"));
    assert_eq!(file.info().common_directory, canonical.join(".git"));
    assert!(!file.info().is_shallow);
}

#[test]
fn reads_unborn_and_ignored_state_without_changing_any_repository_files() {
    let fixture = Fixture::new();

    fixture.write(".gitignore", "ignored\n");
    fixture.write("ignored", "not tracked\n");

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let before = files_under(&fixture.root);
    let ordinary = repository.snapshot(false, None).unwrap();
    let ignored = repository.snapshot(true, None).unwrap();

    assert!(ordinary.status.head.is_unborn());
    assert_eq!(ordinary.status.head.branch.as_deref(), Some("main"));
    assert_eq!(ordinary.operation, OperationState::Normal);
    assert!(ordinary.operation_token.is_none());
    assert_eq!(ordinary.status.files.len(), 1);
    assert_eq!(ignored.status.files.len(), 2);
    assert!(
        ignored
            .status
            .files
            .iter()
            .any(|file| file.worktree_status == FileStatus::Ignored)
    );
    assert_eq!(files_under(&fixture.root), before);
}

#[test]
fn reads_fresh_mixed_state_without_writing_the_index_files_or_refs() {
    let fixture = Fixture::new();

    fixture.write("tracked", "initial\n");
    fixture.commit("initial");

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    assert!(
        repository
            .snapshot(false, None)
            .unwrap()
            .status
            .files
            .is_empty()
    );

    fixture.write("tracked", "staged\n");
    fixture.git(&["add", "--", "tracked"]);
    fixture.write("tracked", "unstaged\n");
    fixture.write("untracked", "new\n");

    let before = files_under(&fixture.root);
    let snapshot = repository.snapshot(false, None).unwrap();

    let tracked = snapshot
        .status
        .files
        .iter()
        .find(|file| file.path == common::git_path("tracked"))
        .unwrap();

    assert_eq!(tracked.index_status, FileStatus::Modified);
    assert_eq!(tracked.worktree_status, FileStatus::Modified);
    assert_eq!(snapshot.repository, *repository.info());
    assert_eq!(files_under(&fixture.root), before);
}

#[test]
fn keeps_linked_worktree_identity_and_operation_markers_separate() {
    let fixture = Fixture::new();

    fixture.write("tracked", "initial\n");
    fixture.commit("initial");

    let linked_path = fixture.temporary.path().join("linked");

    fixture.git_os([
        "worktree".into(),
        "add".into(),
        "-b".into(),
        "linked".into(),
        linked_path.as_os_str().to_owned(),
    ]);

    let main = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let linked = Repository::open(&linked_path, fixture.process(), None).unwrap();

    assert_eq!(main.info().common_directory, linked.info().common_directory);
    assert_ne!(main.info().git_directory, linked.info().git_directory);
    assert_ne!(main.info().root, linked.info().root);

    let oid = fixture.git(&["rev-parse", "HEAD"]);

    fs::write(linked.info().git_directory.join("MERGE_HEAD"), &oid).unwrap();

    let before = files_under(fixture.temporary.path());
    let main_state = main.snapshot(false, None).unwrap();
    let linked_state = linked.snapshot(false, None).unwrap();

    assert_eq!(main_state.operation, OperationState::Normal);
    assert_eq!(linked_state.operation, OperationState::Merge);
    assert!(linked_state.operation_token.is_some());
    assert_eq!(files_under(fixture.temporary.path()), before);
}

#[test]
fn rejects_bare_missing_non_repository_invalid_and_cancelled_paths() {
    let fixture = Fixture::new();
    let bare = fixture.temporary.path().join("bare");

    fixture.git_os(["init".into(), "--bare".into(), bare.as_os_str().to_owned()]);

    assert!(matches!(
        Repository::open(&bare, fixture.process(), None),
        Err(RepositoryError::BareRepository)
    ));
    assert!(matches!(
        Repository::open(&fixture.root.join("missing"), fixture.process(), None),
        Err(RepositoryError::Io(_))
    ));
    assert!(matches!(
        Repository::open(fixture.temporary.path(), fixture.process(), None),
        Err(RepositoryError::Git(GitError::CommandFailed { .. }))
    ));
    assert!(matches!(
        Repository::open(Path::new(""), fixture.process(), None),
        Err(RepositoryError::InvalidPath)
    ));

    let cancellation = Cancellation::default();

    cancellation.cancel();

    assert!(matches!(
        Repository::open(&fixture.root, fixture.process(), Some(&cancellation)),
        Err(RepositoryError::Git(GitError::Cancelled))
    ));
}

#[test]
fn snapshot_cancellation_is_an_error_instead_of_a_clean_tree() {
    let fixture = Fixture::new();
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let cancellation = Cancellation::default();

    cancellation.cancel();

    assert!(matches!(
        repository.snapshot(false, Some(&cancellation)),
        Err(RepositoryError::Git(GitError::Cancelled))
    ));
}

#[test]
#[cfg(unix)]
fn malformed_git_output_cannot_become_a_successful_clean_snapshot() {
    let fixture = Fixture::new();
    let executable = fixture.temporary.path().join("malformed-git");

    fs::write(
        &executable,
        r#"#!/bin/sh
case "$*" in
  *--is-bare-repository*|*--is-shallow-repository*) printf 'false\n';;
  *--show-toplevel*) printf '%s\n' "$PWD";;
  *--git-common-dir*|*--git-dir*) printf '%s/.git\n' "$PWD";;
  *status*) printf '1 invalid\000';;
  *) exit 2;;
esac
"#,
    )
    .unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();

    let repository =
        Repository::open(&fixture.root, GitProcess::new(executable, 1024), None).unwrap();

    let before = files_under(&fixture.root);

    assert!(matches!(
        repository.snapshot(false, None),
        Err(RepositoryError::Status(_))
    ));
    assert_eq!(files_under(&fixture.root), before);
}

#[test]
fn detects_shallow_history_using_only_a_local_file_remote() {
    let fixture = Fixture::new();

    fixture.write("tracked", "initial\n");
    fixture.commit("initial");
    fixture.write("tracked", "second\n");
    fixture.commit("second");

    let shallow = fixture.temporary.path().join("shallow");
    let mut file_url = OsString::from("file://");

    file_url.push(fs::canonicalize(&fixture.root).unwrap().as_os_str());
    fixture.git_os([
        "-c".into(),
        "protocol.file.allow=always".into(),
        "clone".into(),
        "--depth=1".into(),
        "--".into(),
        file_url,
        shallow.as_os_str().to_owned(),
    ]);

    let repository = Repository::open(&shallow, fixture.process(), None).unwrap();

    assert!(repository.info().is_shallow);
    assert!(
        repository
            .snapshot(false, None)
            .unwrap()
            .status
            .files
            .is_empty()
    );
}
