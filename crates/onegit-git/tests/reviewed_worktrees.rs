//! Covers: reviewed non-forcing creation/removal, frozen identities and preserved source/target data.
//! Real: local Git, isolated config, filesystem/ref/index state and linked checkout registrations.
//! Doubles: a bounded Git wrapper pauses a result read; outcomes use real disposable repositories.
//! Requires: POSIX Git and writable temporary storage; no network or GUI.

mod common;

use common::{Fixture, files_under};

use onegit_git::{
    BranchIdentity, Cancellation, CreateWorktree, Repository, WorktreeBranch, WorktreeRequest,
    WritePhase,
};

use common::symlink;
use std::fs;
use std::path::{Path, PathBuf};

fn fixture() -> (Fixture, Repository) {
    let fixture = Fixture::new();

    fixture.write("one", "base\n");
    fixture.commit("Fixture");
    fixture.git(&["branch", "feature/ui"]);
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    (fixture, repository)
}

fn path(fixture: &Fixture, name: &str) -> PathBuf {
    fs::canonicalize(fixture.temporary.path())
        .unwrap()
        .join(name)
}

fn identity(repository: &Repository) -> BranchIdentity {
    BranchIdentity::from_snapshot(&repository.snapshot(false, None).unwrap())
}

fn create(repository: &Repository, path: PathBuf, branch: WorktreeBranch) -> WorktreeRequest {
    WorktreeRequest::Create {
        source: identity(repository),
        branch,
        path,
    }
}

fn removal(repository: &Repository, path: &Path) -> WorktreeRequest {
    let target = repository
        .worktrees(None)
        .unwrap()
        .into_iter()
        .find(|item| item.path == path)
        .unwrap();

    WorktreeRequest::Remove {
        path: path.to_owned(),
        expected: BranchIdentity {
            oid: target.head_oid,
            branch: target.branch,
        },
    }
}

#[test]
fn creates_new_existing_and_exact_remote_checkouts_while_preserving_mixed_source_work() {
    let (fixture, repository) = fixture();

    fixture.write("one", "staged\n");
    fixture.git(&["add", "one"]);
    fixture.write("one", "working\n");
    fixture.write("new", "untracked\n");
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let reviewed = identity(&repository);

    fixture.git_os([
        "remote".into(),
        "add".into(),
        "team".into(),
        fixture.root.as_os_str().to_owned(),
    ]);
    fixture.git(&["config", "branch.autoSetupMerge", "false"]);
    fixture.git(&["update-ref", "refs/remotes/team/topic/nested", "HEAD"]);

    for (branch, name) in [
        (WorktreeBranch::New("new/worktree".into()), "new"),
        (WorktreeBranch::Existing("feature/ui".into()), "existing"),
        (
            WorktreeBranch::Remote("refs/remotes/team/topic/nested".into()),
            "remote",
        ),
    ] {
        let destination = path(&fixture, name);

        if name == "existing" {
            fs::create_dir(&destination).unwrap();
        }

        let result = repository
            .change_worktree(&create(&repository, destination.clone(), branch), None)
            .unwrap();

        assert_eq!(result.path, destination);
        assert!(result.worktrees.iter().any(|item| item.path == destination));
        assert_eq!(BranchIdentity::from_snapshot(&result.snapshot), reviewed);
        assert_eq!(fs::read(destination.join("one")).unwrap(), b"base\n");
    }

    assert_eq!(
        fixture.git(&[
            "rev-parse",
            "--symbolic-full-name",
            "topic/nested@{upstream}"
        ]),
        b"refs/remotes/team/topic/nested\n"
    );
    assert_eq!(identity(&repository), reviewed);
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(fixture.root.join("one")).unwrap(), b"working\n");
    assert_eq!(fs::read(fixture.root.join("new")).unwrap(), b"untracked\n");
}

#[test]
fn rejects_stale_sources_invalid_names_occupied_and_missing_choices_before_any_write() {
    let (fixture, repository) = fixture();
    let destination = path(&fixture, "never");
    let before = files_under(&fixture.root);
    let mut old = identity(&repository);

    old.oid = Some("0".repeat(40));
    let mut requests = vec![WorktreeRequest::Create {
        source: old,
        branch: WorktreeBranch::New("new".into()),
        path: destination.clone(),
    }];

    for branch in [
        WorktreeBranch::New("".into()),
        WorktreeBranch::New("bad name".into()),
        WorktreeBranch::New("feature/ui".into()),
        WorktreeBranch::Existing("main".into()),
        WorktreeBranch::Existing("missing".into()),
        WorktreeBranch::Remote("refs/remotes/team/missing".into()),
    ] {
        requests.push(create(&repository, destination.clone(), branch));
    }

    for request in requests {
        assert_eq!(
            repository
                .change_worktree(&request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(files_under(&fixture.root), before);
        assert!(!destination.exists());
    }

    let request = create(
        &repository,
        destination.clone(),
        WorktreeBranch::New("frozen".into()),
    );

    fixture.git(&["switch", "feature/ui"]);
    repository.snapshot(false, None).unwrap();
    let before = files_under(&fixture.root);

    assert_eq!(
        repository
            .change_worktree(&request, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(files_under(&fixture.root), before);
    assert!(!destination.exists());
}

#[test]
fn rejects_remote_name_collisions_and_occupied_linked_branches_without_forcing() {
    let (fixture, repository) = fixture();

    fixture.git_os([
        "remote".into(),
        "add".into(),
        "origin".into(),
        fixture.root.as_os_str().to_owned(),
    ]);
    fixture.git(&["update-ref", "refs/remotes/origin/feature/ui", "HEAD"]);
    let occupied = path(&fixture, "occupied");

    repository
        .create_worktree(
            CreateWorktree {
                revision: Some("feature/ui"),
                ..CreateWorktree::new(&occupied)
            },
            None,
        )
        .unwrap();
    let before = files_under(&fixture.root);

    for branch in [
        WorktreeBranch::Existing("feature/ui".into()),
        WorktreeBranch::Remote("refs/remotes/origin/feature/ui".into()),
    ] {
        let request = create(&repository, path(&fixture, "blocked"), branch);

        assert_eq!(
            repository
                .change_worktree(&request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(files_under(&fixture.root), before);
    }
}

#[test]
fn rejects_nonempty_file_symlink_relative_and_missing_parent_destinations() {
    let (fixture, repository) = fixture();
    let nonempty = path(&fixture, "nonempty");

    fs::create_dir(&nonempty).unwrap();
    fs::write(nonempty.join("keep"), b"preserve\n").unwrap();
    let file = path(&fixture, "file");

    fs::write(&file, b"preserve file\n").unwrap();
    let empty = path(&fixture, "empty");

    fs::create_dir(&empty).unwrap();
    let alias = path(&fixture, "alias");

    symlink(&empty, &alias).unwrap();
    let before = files_under(&fixture.root);

    for destination in [
        nonempty.clone(),
        file.clone(),
        alias,
        PathBuf::from("relative"),
        path(&fixture, "missing/child"),
        fixture.root.clone(),
    ] {
        let request = create(
            &repository,
            destination,
            WorktreeBranch::New("never".into()),
        );

        assert_eq!(
            repository
                .change_worktree(&request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(files_under(&fixture.root), before);
    }

    assert_eq!(fs::read(nonempty.join("keep")).unwrap(), b"preserve\n");
    assert_eq!(fs::read(file).unwrap(), b"preserve file\n");
    assert!(fs::read_dir(empty).unwrap().next().is_none());
}

#[test]
fn resolves_a_symlinked_parent_but_never_accepts_a_symlink_destination() {
    let (fixture, repository) = fixture();
    let parent = path(&fixture, "parent");
    let alias = path(&fixture, "parent alias");

    fs::create_dir(&parent).unwrap();
    symlink(&parent, &alias).unwrap();
    let result = repository
        .change_worktree(
            &create(
                &repository,
                alias.join("child"),
                WorktreeBranch::New("canonical".into()),
            ),
            None,
        )
        .unwrap();

    assert_eq!(result.path, parent.join("child"));
    assert_eq!(fs::read(result.path.join("one")).unwrap(), b"base\n");
}

#[test]
fn removes_only_clean_unlocked_registered_linked_targets_and_preserves_their_branch() {
    let (fixture, repository) = fixture();
    let target = path(&fixture, "removable");

    repository
        .change_worktree(
            &create(
                &repository,
                target.clone(),
                WorktreeBranch::Existing("feature/ui".into()),
            ),
            None,
        )
        .unwrap();
    let request = removal(&repository, &target);

    let WorktreeRequest::Remove { expected, .. } = &request else {
        unreachable!()
    };

    let stale = WorktreeRequest::Remove {
        path: target.clone(),
        expected: BranchIdentity {
            oid: Some("0".repeat(40)),
            branch: expected.branch.clone(),
        },
    };

    for unsafe_request in [
        removal(&repository, &repository.info().root),
        stale,
        WorktreeRequest::Remove {
            path: path(&fixture, "unregistered"),
            expected: expected.clone(),
        },
    ] {
        assert_eq!(
            repository
                .change_worktree(&unsafe_request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert!(target.exists());
    }

    repository.lock_worktree(&target, None, None).unwrap();
    assert!(repository.change_worktree(&request, None).is_err());
    repository.unlock_worktree(&target, None).unwrap();
    let linked = Repository::open(&target, fixture.process(), None).unwrap();

    assert!(linked.change_worktree(&request, None).is_err());
    assert!(
        linked
            .change_worktree(&removal(&repository, &repository.info().root), None)
            .is_err()
    );

    for file in ["one", "untracked"] {
        let old = fs::read(target.join(file)).ok();

        fs::write(target.join(file), b"preserve target\n").unwrap();
        let before = files_under(&fixture.root);

        assert_eq!(
            repository
                .change_worktree(&request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(fs::read(target.join(file)).unwrap(), b"preserve target\n");
        assert_eq!(files_under(&fixture.root), before);

        if let Some(old) = old {
            fs::write(target.join(file), old).unwrap();
        } else {
            fs::remove_file(target.join(file)).unwrap();
        }
    }

    let result = repository.change_worktree(&request, None).unwrap();

    assert_eq!(result.path, target);
    assert!(!target.exists());
    assert!(result.worktrees.iter().all(|item| item.path != target));
    assert!(
        repository
            .branches(None)
            .unwrap()
            .branches
            .iter()
            .any(|item| item.name == "feature/ui")
    );
}

#[test]
fn ignored_only_work_is_never_removed_even_though_plain_git_would_allow_it() {
    let (fixture, repository) = fixture();
    let target = path(&fixture, "ignored-only");

    repository
        .change_worktree(
            &create(
                &repository,
                target.clone(),
                WorktreeBranch::Existing("feature/ui".into()),
            ),
            None,
        )
        .unwrap();
    let request = removal(&repository, &target);

    fixture.write(".git/info/exclude", "private.ignored\n");
    fs::write(target.join("private.ignored"), b"keep ignored fixture\n").unwrap();
    let opened = Repository::open(&target, fixture.process(), None).unwrap();

    assert!(
        opened
            .snapshot(false, None)
            .unwrap()
            .status
            .files
            .is_empty()
    );
    assert!(!opened.snapshot(true, None).unwrap().status.files.is_empty());
    let before = files_under(&fixture.root);

    assert_eq!(
        repository
            .change_worktree(&request, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(
        fs::read(target.join("private.ignored")).unwrap(),
        b"keep ignored fixture\n"
    );
    assert_eq!(files_under(&fixture.root), before);
}

#[test]
fn stale_removal_operation_markers_missing_paths_and_symlink_replacements_preserve_the_checkout() {
    let (fixture, repository) = fixture();
    let target = path(&fixture, "selected");

    repository
        .change_worktree(
            &create(
                &repository,
                target.clone(),
                WorktreeBranch::Existing("feature/ui".into()),
            ),
            None,
        )
        .unwrap();
    let old = removal(&repository, &target);

    fixture.git(&["branch", "other"]);
    fixture.git_os([
        "-C".into(),
        target.as_os_str().to_owned(),
        "switch".into(),
        "other".into(),
    ]);
    assert_eq!(
        repository.change_worktree(&old, None).unwrap_err().phase,
        WritePhase::BeforeCommand
    );
    let request = removal(&repository, &target);
    let opened = Repository::open(&target, fixture.process(), None).unwrap();

    for directory in [
        &repository.info().git_directory,
        &opened.info().git_directory,
    ] {
        let marker = directory.join("MERGE_HEAD");

        fs::write(&marker, fixture.git(&["rev-parse", "HEAD"])).unwrap();
        assert_eq!(
            repository
                .change_worktree(&request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(fs::read(target.join("one")).unwrap(), b"base\n");
        fs::remove_file(marker).unwrap();
    }

    let moved = path(&fixture, "moved-outside-git");

    fs::rename(&target, &moved).unwrap();
    assert_eq!(
        repository
            .change_worktree(&request, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    assert!(
        repository
            .worktrees(None)
            .unwrap()
            .iter()
            .any(|item| item.path == target)
    );
    symlink(&moved, &target).unwrap();
    assert_eq!(
        repository
            .change_worktree(&request, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(fs::read(moved.join("one")).unwrap(), b"base\n");
    assert!(
        fs::symlink_metadata(target)
            .unwrap()
            .file_type()
            .is_symlink()
    );
}

#[test]
fn refuses_operation_markers_unborn_source_and_pre_cancellation() {
    let (fixture, repository) = fixture();

    let request = create(
        &repository,
        path(&fixture, "blocked"),
        WorktreeBranch::New("blocked".into()),
    );

    fixture.write(
        ".git/MERGE_HEAD",
        &String::from_utf8(fixture.git(&["rev-parse", "HEAD"])).unwrap(),
    );
    let before = files_under(&fixture.root);

    assert_eq!(
        repository
            .change_worktree(&request, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(files_under(&fixture.root), before);
    fs::remove_file(fixture.root.join(".git/MERGE_HEAD")).unwrap();
    let cancelled = Cancellation::default();

    cancelled.cancel();
    assert_eq!(
        repository
            .change_worktree(&request, Some(&cancelled))
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    fixture.git(&["symbolic-ref", "HEAD", "refs/heads/unborn"]);
    let request = create(
        &repository,
        path(&fixture, "unborn"),
        WorktreeBranch::New("no-head".into()),
    );

    let before = files_under(&fixture.root);

    assert_eq!(
        repository
            .change_worktree(&request, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(files_under(&fixture.root), before);
}

#[test]
#[cfg(unix)]
fn holds_the_shared_queue_through_created_checkout_metadata_and_source_refresh() {
    #[cfg(unix)]
    use common::PermissionsExt;
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    let (fixture, _) = fixture();
    let executable = path(&fixture, "git-wrapper");
    let entered = path(&fixture, "entered");
    let release = path(&fixture, "release");

    fs::write(&executable, "#!/bin/sh\ncase \" $* \" in *\" worktree list \"*) : > \"$ONEGIT_ENTERED\"; count=0; while [ ! -f \"$ONEGIT_RELEASE\" ]; do count=$((count+1)); [ \"$count\" -lt 1000 ] || exit 93; sleep 0.01; done;; esac\nexec git \"$@\"\n").unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    let process = onegit_git::GitProcess::new(executable, 64 * 1024 * 1024).with_environment([
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_COUNT".into(), "1".into()),
        ("GIT_CONFIG_KEY_0".into(), "core.hooksPath".into()),
        ("GIT_CONFIG_VALUE_0".into(), "/dev/null".into()),
        ("ONEGIT_ENTERED".into(), entered.as_os_str().to_owned()),
        ("ONEGIT_RELEASE".into(), release.as_os_str().to_owned()),
    ]);

    let coordinator = onegit_git::RepositoryCoordinator::default();
    let first = Arc::new(coordinator.open(&fixture.root, process, None).unwrap());

    let second = coordinator
        .open(&fixture.root, fixture.process(), None)
        .unwrap();

    let common = first.info().common_directory.clone();

    fixture.write("one", "worktree change\n");
    let request = create(
        &first,
        path(&fixture, "created-under-lock"),
        WorktreeBranch::New("queued".into()),
    );

    let writer = {
        let first = Arc::clone(&first);

        std::thread::spawn(move || first.change_worktree(&request, None))
    };

    let deadline = Instant::now() + Duration::from_secs(5);

    while !entered.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }

    let paused = entered.exists();
    let later = std::thread::spawn(move || second.stage_all(None));
    let deadline = Instant::now() + Duration::from_secs(5);

    while coordinator.pending_writes(&common) != 2 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }

    let blocked = coordinator.pending_writes(&common) == 2 && !later.is_finished();
    let staged_before_release = fixture.git(&["show", ":one"]);

    fs::write(&release, b"continue\n").unwrap();
    let result = writer.join().unwrap().unwrap();
    let after = later.join().unwrap().unwrap();

    assert!(
        paused && blocked,
        "related write did not wait through the result read"
    );
    assert_eq!(staged_before_release, b"base\n");
    assert_eq!(
        result.snapshot.status.files[0].index_status,
        onegit_git::FileStatus::Unmodified
    );
    assert_eq!(
        after.status.files[0].index_status,
        onegit_git::FileStatus::Modified
    );
    assert_eq!(coordinator.pending_writes(&common), 0);
}
