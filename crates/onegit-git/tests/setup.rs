//! Covers: initialization, local clone options, destination preservation, validation and cancellation.
//! Real: Git CLI, disposable repositories/local remotes and process-group cleanup.
//! Doubles: one executable simulates a stalled clone after writing partial destination state.
//! Requires: Git, /bin/sh and temporary storage; no network, accounts or user credentials.

mod common;

#[cfg(unix)]
use common::PermissionsExt;
use std::fs;
use std::path::Path;
#[cfg(unix)]
use std::thread;
#[cfg(unix)]
use std::time::{Duration, Instant};

use common::{Fixture, files_under};

#[cfg(unix)]
use onegit_git::GitProcess;
use onegit_git::{
    Cancellation, CloneOptions, GitError, HistoryOptions, Repository, RepositoryError,
};

#[test]
fn initializes_a_selected_branch_and_retains_existing_project_files() {
    let fixture = Fixture::new();
    let destination = fixture.temporary.path().join("new project");

    fs::create_dir(&destination).unwrap();
    fs::write(destination.join("existing"), "keep me").unwrap();

    let repository =
        Repository::initialize(&destination, Some("chosen/branch"), fixture.process(), None)
            .unwrap();

    let state = repository.snapshot(false, None).unwrap();

    assert_eq!(state.status.head.branch.as_deref(), Some("chosen/branch"));
    assert!(state.status.head.is_unborn());
    assert_eq!(fs::read(destination.join("existing")).unwrap(), b"keep me");
    assert_eq!(state.status.files.len(), 1);
}

#[test]
fn clones_selected_branch_and_depth_from_a_local_file_remote() {
    let fixture = Fixture::new();

    fixture.write("file", "first\n");
    fixture.commit("first");
    fixture.write("file", "second\n");
    fixture.commit("second");
    fixture.git_os(["branch".into(), "topic".into()]);

    let source = common::file_url(&fs::canonicalize(&fixture.root).unwrap());

    let destination = fixture.temporary.path().join("clone");
    let mut options = CloneOptions::new(&source, &destination);

    options.branch = Some("topic");
    options.depth = Some(1);

    let before = files_under(&fixture.root);
    let clone = Repository::clone(options, fixture.process(), None).unwrap();

    assert!(clone.info().is_shallow);
    assert_eq!(
        clone
            .snapshot(false, None)
            .unwrap()
            .status
            .head
            .branch
            .as_deref(),
        Some("topic")
    );
    assert_eq!(
        clone
            .history(HistoryOptions::default(), None)
            .unwrap()
            .commits
            .len(),
        1
    );
    assert_eq!(fs::read(destination.join("file")).unwrap(), b"second\n");
    assert_eq!(files_under(&fixture.root), before);
}

#[test]
fn clones_submodules_only_when_explicitly_requested() {
    let fixture = Fixture::new();
    let child = fixture.temporary.path().join("child");

    Repository::initialize(&child, Some("main"), fixture.process(), None).unwrap();
    fs::write(child.join("nested"), "submodule content").unwrap();

    for args in [vec!["add", "."], vec!["commit", "-m", "child"]] {
        fixture
            .process()
            .run(onegit_git::GitCommand::new(&child, args))
            .unwrap();
    }

    fixture.git_os([
        "-c".into(),
        "protocol.file.allow=always".into(),
        "submodule".into(),
        "add".into(),
        child.into_os_string(),
        "module".into(),
    ]);
    fixture.commit("add submodule");

    for recurse in [false, true] {
        let destination = fixture.temporary.path().join(format!("clone-{recurse}"));
        let mut options = CloneOptions::new(fixture.root.to_str().unwrap(), &destination);

        options.recurse_submodules = recurse;

        let process = fixture.process().with_environment([
            ("GIT_CONFIG_COUNT".into(), "3".into()),
            ("GIT_CONFIG_KEY_2".into(), "protocol.file.allow".into()),
            ("GIT_CONFIG_VALUE_2".into(), "always".into()),
        ]);

        Repository::clone(options, process, None).unwrap();

        assert_eq!(destination.join("module/nested").exists(), recurse);
    }
}

#[test]
fn rejects_nonempty_clone_destinations_and_invalid_input_without_deleting_files() {
    let fixture = Fixture::new();
    let destination = fixture.temporary.path().join("existing");

    fs::create_dir(&destination).unwrap();
    fs::write(destination.join("keep"), "keep me").unwrap();

    let result = Repository::clone(
        CloneOptions::new(fixture.root.to_str().unwrap(), &destination),
        fixture.process(),
        None,
    );

    assert!(matches!(
        result,
        Err(RepositoryError::Git(GitError::CommandFailed { .. }))
    ));
    assert_eq!(fs::read(destination.join("keep")).unwrap(), b"keep me");

    for remote in [
        "",
        "https://user:fixture-secret@example.invalid/repo",
        "https://user@example.invalid/repo",
        "https://[invalid",
        "nul\0remote",
    ] {
        let target = fixture.temporary.path().join("must-not-exist");

        assert!(matches!(
            Repository::clone(CloneOptions::new(remote, &target), fixture.process(), None),
            Err(RepositoryError::InvalidInput(_))
        ));
        assert!(!target.exists());
    }

    for depth in [0, 9_007_199_254_740_992] {
        let target = fixture.temporary.path().join("invalid-depth");
        let mut options = CloneOptions::new("fixture-source", &target);

        options.depth = Some(depth);

        assert!(matches!(
            Repository::clone(options, fixture.process(), None),
            Err(RepositoryError::InvalidInput(_))
        ));
        assert!(!target.exists());
    }

    let cancellation = Cancellation::default();

    cancellation.cancel();

    let target = fixture.temporary.path().join("uncreated-parent/repository");

    assert!(matches!(
        Repository::initialize(
            &target,
            Some("main"),
            fixture.process(),
            Some(&cancellation)
        ),
        Err(RepositoryError::Git(GitError::Cancelled))
    ));
    assert!(!target.parent().unwrap().exists());
    assert!(matches!(
        Repository::initialize(Path::new(""), None, fixture.process(), None),
        Err(RepositoryError::InvalidPath)
    ));
}

#[test]
#[cfg(unix)]
fn cancellation_retains_partial_clone_files_after_owned_process_cleanup() {
    let fixture = Fixture::new();
    let executable = fixture.temporary.path().join("stalled-git");
    let destination = fixture.temporary.path().join("partial");

    fs::write(&executable, "#!/bin/sh\nfor target do :; done\nmkdir -p \"$target\"\nprintf 'partial' > \"$target/retained\"\nsleep 60\n").unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();

    let cancellation = Cancellation::default();

    thread::scope(|scope| {
        let worker = scope.spawn(|| {
            Repository::clone(
                CloneOptions::new("fixture-source", &destination),
                GitProcess::new(executable, 1024),
                Some(&cancellation),
            )
        });

        let start = Instant::now();

        while !destination.join("retained").exists() {
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "partial clone fixture did not start"
            );
            thread::sleep(Duration::from_millis(5));
        }

        cancellation.cancel();

        assert!(matches!(
            worker.join().unwrap(),
            Err(RepositoryError::Git(GitError::Cancelled))
        ));
    });

    assert_eq!(fs::read(destination.join("retained")).unwrap(), b"partial");
}
