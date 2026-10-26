//! Covers: public CLI-level worktree creation, maintenance, validation and uncertain outcomes.
//! Real: local Git, isolated config, temporary files/refs and existing write coordination.
//! Doubles: a wrapper fails result reads after a real write. No GUI/network/accounts.
//! Requires: POSIX Git and writable temporary storage; no GUI.
//! Reviewed app source/destination/ignored-file guards and remote protocol are separate tests.

mod common;

use common::{Fixture, files_under};

#[cfg(unix)]
use onegit_git::GitProcess;
use onegit_git::{Cancellation, CreateWorktree, Repository, RepositoryError, WritePhase};

#[cfg(unix)]
use common::PermissionsExt;
use std::fs;
use std::path::{Path, PathBuf};

fn fixture() -> (Fixture, Repository) {
    let fixture = Fixture::new();

    fixture.write("one", "base\n");
    fixture.commit("Fixture");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    (fixture, repository)
}

fn path(fixture: &Fixture, name: &str) -> PathBuf {
    fs::canonicalize(fixture.temporary.path())
        .unwrap()
        .join(name)
}

fn create(repository: &Repository, path: &Path, branch: &str) {
    repository
        .create_worktree(
            CreateWorktree {
                new_branch: Some(branch),
                ..CreateWorktree::new(path)
            },
            None,
        )
        .unwrap();
}

#[test]
fn creates_named_existing_detached_tracking_and_locked_worktrees_without_switching_source() {
    let (fixture, repository) = fixture();
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let named = path(&fixture, "named été\n");

    create(&repository, &named, "feature/named");
    fixture.git(&["branch", "existing"]);
    let existing = path(&fixture, "existing");

    repository
        .create_worktree(
            CreateWorktree {
                revision: Some("existing"),
                ..CreateWorktree::new(&existing)
            },
            None,
        )
        .unwrap();
    let detached = path(&fixture, "detached");

    repository
        .create_worktree(
            CreateWorktree {
                detach: true,
                revision: Some("HEAD"),
                new_branch: Some(""),
                ..CreateWorktree::new(&detached)
            },
            None,
        )
        .unwrap();
    fixture.git_os([
        "remote".into(),
        "add".into(),
        "origin".into(),
        fixture.root.as_os_str().to_owned(),
    ]);
    fixture.git(&["update-ref", "refs/remotes/origin/topic", "HEAD"]);
    let tracking = path(&fixture, "tracking");

    repository
        .create_worktree(
            CreateWorktree {
                revision: Some("refs/remotes/origin/topic"),
                new_branch: Some("topic"),
                track: true,
                ..CreateWorktree::new(&tracking)
            },
            None,
        )
        .unwrap();
    let locked = path(&fixture, "locked");
    let automatic = path(&fixture, "automatic");

    repository
        .create_worktree(CreateWorktree::new(&automatic), None)
        .unwrap();
    let result = repository
        .create_worktree(
            CreateWorktree {
                new_branch: Some("locked"),
                lock_reason: Some("external drive\nété"),
                ..CreateWorktree::new(&locked)
            },
            None,
        )
        .unwrap();

    assert_eq!(result.len(), 7);
    assert_eq!(
        result
            .iter()
            .find(|item| item.path == automatic)
            .unwrap()
            .branch
            .as_deref(),
        Some("automatic")
    );
    assert_eq!(
        result
            .iter()
            .find(|item| item.path == named)
            .unwrap()
            .branch
            .as_deref(),
        Some("feature/named")
    );
    assert!(
        result
            .iter()
            .find(|item| item.path == detached)
            .unwrap()
            .detached
    );
    let lock = result.iter().find(|item| item.path == locked).unwrap();

    assert!(lock.locked);
    assert_eq!(lock.lock_reason.as_deref(), Some("external drive\nété"));
    assert_eq!(
        fixture.git(&["rev-parse", "--abbrev-ref", "topic@{upstream}"]),
        b"origin/topic\n"
    );
    assert_eq!(fixture.git(&["branch", "--show-current"]), b"main\n");
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(fixture.root.join("one")).unwrap(), b"base\n");
}

#[test]
fn moves_locks_unlocks_and_removes_without_deleting_branch_refs_or_dirty_files_by_default() {
    let (fixture, repository) = fixture();
    let original = path(&fixture, "before");
    let moved = path(&fixture, "after");

    create(&repository, &original, "move");
    let result = repository.move_worktree(&original, &moved, None).unwrap();

    assert!(result.iter().any(|item| item.path == moved));
    assert!(!original.exists());
    assert_eq!(fs::read(moved.join("one")).unwrap(), b"base\n");
    let result = repository
        .lock_worktree(&moved, Some("maintenance"), None)
        .unwrap();

    assert_eq!(
        result
            .iter()
            .find(|item| item.path == moved)
            .unwrap()
            .lock_reason
            .as_deref(),
        Some("maintenance")
    );
    assert_eq!(
        repository
            .remove_worktree(&moved, false, None)
            .unwrap_err()
            .phase,
        WritePhase::Command
    );
    repository.unlock_worktree(&moved, None).unwrap();
    fs::write(moved.join("dirty"), b"preserve\n").unwrap();
    assert_eq!(
        repository
            .remove_worktree(&moved, false, None)
            .unwrap_err()
            .phase,
        WritePhase::Command
    );
    assert_eq!(fs::read(moved.join("dirty")).unwrap(), b"preserve\n");
    let result = repository.remove_worktree(&moved, true, None).unwrap();

    assert_eq!(result.len(), 1);
    assert!(!moved.exists());
    assert!(
        repository
            .branches(None)
            .unwrap()
            .branches
            .iter()
            .any(|item| item.name == "move")
    );
    let clean = path(&fixture, "clean");

    create(&repository, &clean, "clean");
    assert_eq!(
        repository
            .remove_worktree(&clean, false, None)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn repairs_manual_moves_and_prunes_only_unlocked_stale_registrations() {
    let (fixture, repository) = fixture();
    let old = path(&fixture, "manual-before");
    let new = path(&fixture, "manual-after");

    create(&repository, &old, "manual");
    fs::rename(&old, &new).unwrap();
    let result = repository
        .repair_worktrees(std::slice::from_ref(&new), None)
        .unwrap();

    assert!(result.iter().any(|item| item.path == new));
    let opened = Repository::open(&new, fixture.process(), None).unwrap();

    assert_eq!(
        opened.info().common_directory,
        repository.info().common_directory
    );
    repository.repair_worktrees(&[], None).unwrap();
    repository.lock_worktree(&new, None, None).unwrap();
    fs::remove_dir_all(&new).unwrap();
    assert!(
        repository
            .prune_worktrees(Some("now"), None)
            .unwrap()
            .iter()
            .any(|item| item.path == new)
    );
    repository.unlock_worktree(&new, None).unwrap();
    assert_eq!(
        repository.prune_worktrees(Some("now"), None).unwrap().len(),
        1
    );
    assert!(
        repository
            .branches(None)
            .unwrap()
            .branches
            .iter()
            .any(|item| item.name == "manual")
    );
}

#[test]
fn refuses_invalid_options_and_cancellation_before_any_write() {
    let (fixture, repository) = fixture();
    let target = path(&fixture, "never-created");
    let before = files_under(&fixture.root);

    for options in [
        CreateWorktree {
            detach: true,
            new_branch: Some("invalid"),
            ..CreateWorktree::new(&target)
        },
        CreateWorktree {
            new_branch: Some("--bad"),
            ..CreateWorktree::new(&target)
        },
        CreateWorktree {
            revision: Some("--orphan"),
            ..CreateWorktree::new(&target)
        },
        CreateWorktree {
            lock_reason: Some(""),
            ..CreateWorktree::new(&target)
        },
        CreateWorktree::new(Path::new("")),
    ] {
        assert_eq!(
            repository.create_worktree(options, None).unwrap_err().phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(files_under(&fixture.root), before);
        assert!(!target.exists());
    }

    let cancelled = Cancellation::default();

    cancelled.cancel();
    let error = repository
        .create_worktree(CreateWorktree::new(&target), Some(&cancelled))
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(matches!(
        error.error,
        RepositoryError::Git(onegit_git::GitError::Cancelled)
    ));
    assert_eq!(files_under(&fixture.root), before);
}

#[test]
fn refuses_occupied_branch_unless_force_is_explicit_and_keeps_existing_destination_contents() {
    let (fixture, repository) = fixture();
    let target = path(&fixture, "occupied");

    let options = CreateWorktree {
        revision: Some("main"),
        ..CreateWorktree::new(&target)
    };

    assert_eq!(
        repository.create_worktree(options, None).unwrap_err().phase,
        WritePhase::Command
    );
    assert!(!target.exists());
    repository
        .create_worktree(
            CreateWorktree {
                force: true,
                ..options
            },
            None,
        )
        .unwrap();
    assert_eq!(fs::read(target.join("one")).unwrap(), b"base\n");
    let destination = path(&fixture, "nonempty");

    fs::create_dir(&destination).unwrap();
    fs::write(destination.join("keep"), b"user fixture\n").unwrap();
    assert!(
        repository
            .create_worktree(
                CreateWorktree {
                    new_branch: Some("must-not-overwrite"),
                    ..CreateWorktree::new(&destination)
                },
                None
            )
            .is_err()
    );
    assert_eq!(
        fs::read(destination.join("keep")).unwrap(),
        b"user fixture\n"
    );
}

#[test]
#[cfg(unix)]
fn result_read_failure_keeps_the_created_worktree_without_automatic_replay_or_cleanup() {
    let (fixture, _) = fixture();
    let executable = path(&fixture, "git-wrapper");

    fs::write(
        &executable,
        "#!/bin/sh\ncase \" $* \" in *\" worktree list \"*) exit 71;; esac\nexec git \"$@\"\n",
    )
    .unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    let process = GitProcess::new(&executable, 64 * 1024 * 1024).with_environment([
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_COUNT".into(), "1".into()),
        ("GIT_CONFIG_KEY_0".into(), "core.hooksPath".into()),
        ("GIT_CONFIG_VALUE_0".into(), "/dev/null".into()),
    ]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let target = path(&fixture, "created");

    let error = repository
        .create_worktree(
            CreateWorktree {
                new_branch: Some("created"),
                ..CreateWorktree::new(&target)
            },
            None,
        )
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::Refresh);
    assert_eq!(fs::read(target.join("one")).unwrap(), b"base\n");
    assert_eq!(
        fixture.git(&["rev-parse", "--verify", "created"]),
        fixture.git(&["rev-parse", "HEAD"])
    );
    assert!(
        Repository::open(&fixture.root, fixture.process(), None)
            .unwrap()
            .worktrees(None)
            .unwrap()
            .iter()
            .any(|item| item.path == target)
    );
}

#[test]
fn relative_literal_paths_resolve_from_process_directory_without_shell_interpretation() {
    let (fixture, repository) = fixture();
    let target = path(&fixture, "relative; literal $(echo no)\n--");
    let mut relative = PathBuf::new();

    for _ in std::env::current_dir().unwrap().components().skip(1) {
        relative.push("..");
    }

    relative.push(target.strip_prefix("/").unwrap());
    let result = repository
        .create_worktree(
            CreateWorktree {
                new_branch: Some("relative"),
                ..CreateWorktree::new(&relative)
            },
            None,
        )
        .unwrap();

    assert!(result.iter().any(|item| item.path == target));
    assert_eq!(fs::read(target.join("one")).unwrap(), b"base\n");
    assert_eq!(fixture.git(&["branch", "--show-current"]), b"main\n");
}

#[test]
#[cfg(unix)]
fn ambiguous_nonzero_exit_preserves_real_git_effects_and_does_not_replay_or_remove_them() {
    let (fixture, _) = fixture();
    let executable = path(&fixture, "git-wrapper");

    fs::write(&executable, "#!/bin/sh\ncase \" $* \" in *\" worktree add \"*) git \"$@\" || exit $?; exit 72;; esac\nexec git \"$@\"\n").unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    let process = GitProcess::new(&executable, 64 * 1024 * 1024).with_environment([
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_COUNT".into(), "1".into()),
        ("GIT_CONFIG_KEY_0".into(), "core.hooksPath".into()),
        ("GIT_CONFIG_VALUE_0".into(), "/dev/null".into()),
    ]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let target = path(&fixture, "created-before-failure");

    let error = repository
        .create_worktree(
            CreateWorktree {
                new_branch: Some("partial"),
                ..CreateWorktree::new(&target)
            },
            None,
        )
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::Command);
    assert_eq!(fs::read(target.join("one")).unwrap(), b"base\n");
    assert_eq!(
        fixture.git(&["rev-parse", "partial"]),
        fixture.git(&["rev-parse", "HEAD"])
    );
}
