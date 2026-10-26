//! Covers: real index mutations, literal paths, unborn state, failures, FIFO/shared worktree barriers.
//! Real: public Rust APIs, system Git, child processes and isolated local repositories.
//! Doubles: bounded executable wrappers pause or corrupt selected Git calls.
//! Requires: POSIX Git; no accounts/network/user configuration.

mod common;

#[cfg(unix)]
use common::PermissionsExt;
use std::collections::BTreeSet;
use std::fs;
#[cfg(unix)]
use std::path::Path;
use std::path::PathBuf;
#[cfg(unix)]
use std::sync::{Arc, mpsc};
#[cfg(unix)]
use std::time::{Duration, Instant};

use common::{Fixture, files_under};

use onegit_git::{
    Cancellation, ErrorCode, Failure, FileStatus, GitCommand, GitError, Operation, Repository,
    RepositoryError, WritePhase,
};
#[cfg(unix)]
use onegit_git::{GitProcess, RepositoryCoordinator};

#[test]
#[cfg(unix)]
fn every_public_query_waits_for_the_prior_write_barrier() {
    let fixture = Fixture::new();

    fixture.write("base", "base\n");
    fixture.commit("initial");
    fixture.write("new", "new\n");
    let entered = fixture.temporary.path().join("entered");
    let release = fixture.temporary.path().join("release");

    let wrapper = script(
        &fixture,
        r#"
case " $* " in
  *" add "*)
    : > "$ONEGIT_ENTERED"
    count=0
    while [ ! -f "$ONEGIT_RELEASE" ]; do count=$((count + 1)); [ "$count" -lt 1000 ] || exit 90; sleep 0.01; done ;;
esac
exec git "$@""#,
    );

    let process = process(&fixture, &wrapper).with_environment([
        ("ONEGIT_ENTERED".into(), entered.as_os_str().to_owned()),
        ("ONEGIT_RELEASE".into(), release.as_os_str().to_owned()),
    ]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();

    type Query = fn(&Repository);
    let queries: [Query; 16] = [
        |repo| {
            repo.saved_branch_changes(None).unwrap();
        },
        |repo| {
            repo.snapshot(false, None).unwrap();
        },
        |repo| {
            repo.branches(None).unwrap();
        },
        |repo| {
            repo.tags(None).unwrap();
        },
        |repo| {
            repo.stashes(None).unwrap();
        },
        |repo| {
            repo.worktrees(None).unwrap();
        },
        |repo| {
            repo.remotes(None).unwrap();
        },
        |repo| {
            repo.config("onegit.fixture", onegit_git::ConfigScope::Local, None)
                .unwrap();
        },
        |repo| {
            repo.history(onegit_git::HistoryOptions::default(), None)
                .unwrap();
        },
        |repo| {
            repo.history_count("HEAD", None).unwrap();
        },
        |repo| {
            repo.commit("HEAD", None).unwrap();
        },
        |repo| {
            repo.commit_files("HEAD", None).unwrap();
        },
        |repo| {
            repo.compare_branches("HEAD", "HEAD", None).unwrap();
        },
        |repo| {
            repo.unpushed_commits(&[], None).unwrap();
        },
        |repo| {
            repo.file_content(onegit_git::FileSource::Working, Path::new("base"), None)
                .unwrap();
        },
        |repo| {
            repo.diff(
                onegit_git::DiffOptions::new(onegit_git::DiffTarget::Working),
                None,
            )
            .unwrap();
        },
    ];

    let barrier = std::sync::Barrier::new(queries.len() + 1);

    std::thread::scope(|scope| {
        let write = scope.spawn(|| repository.stage_all(None));

        wait_until("write did not pause", || entered.exists());
        let (sender, results) = mpsc::channel();
        let mut readers = Vec::new();

        for query in queries {
            let sender = sender.clone();
            let barrier = &barrier;
            let repository = &repository;

            readers.push(scope.spawn(move || {
                barrier.wait();
                query(repository);
                sender.send(()).unwrap();
            }));
        }

        barrier.wait();
        assert!(
            results.recv_timeout(Duration::from_millis(150)).is_err(),
            "a public query bypassed the write barrier"
        );
        fs::write(&release, b"continue").unwrap();
        write.join().unwrap().unwrap();

        for reader in readers {
            reader.join().unwrap();
        }

        assert_eq!(results.try_iter().count(), queries.len());
    });
}

fn staged(repository: &Repository) -> BTreeSet<PathBuf> {
    repository
        .snapshot(false, None)
        .unwrap()
        .status
        .files
        .into_iter()
        .filter(|file| {
            file.index_status != FileStatus::Unmodified
                && file.index_status != FileStatus::Untracked
        })
        .map(|file| file.path)
        .collect()
}

#[cfg(unix)]
fn process(fixture: &Fixture, script: &Path) -> GitProcess {
    GitProcess::new(script, 64 * 1024 * 1024).with_environment([
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_COUNT".into(), "1".into()),
        ("GIT_CONFIG_KEY_0".into(), "core.hooksPath".into()),
        ("GIT_CONFIG_VALUE_0".into(), "/dev/null".into()),
        (
            "HOME".into(),
            fixture.temporary.path().as_os_str().to_owned(),
        ),
    ])
}

#[cfg(unix)]
fn script(fixture: &Fixture, text: &str) -> PathBuf {
    let path = fixture.temporary.path().join("git-wrapper");

    fs::write(&path, format!("#!/bin/sh\n{text}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();

    path
}

#[test]
fn stages_and_unstages_selected_paths_without_touching_working_bytes_or_other_staging() {
    let fixture = Fixture::new();

    fixture.write("one", "one\n");
    fixture.write("two", "two\n");
    fixture.commit("initial");
    fixture.write("one", "changed one\n");
    fixture.write("two", "changed two\n");
    fixture.git(&["add", "--", "two"]);
    fixture.write("untracked", "keep\n");
    let before = files_under(&fixture.root);
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let other = fixture.git(&["ls-files", "--stage", "--", "two"]);

    repository
        .stage(&["one".into(), "one".into()], None)
        .unwrap();
    assert_eq!(
        staged(&repository),
        BTreeSet::from(["one".into(), "two".into()])
    );
    repository.unstage(&["one".into()], None).unwrap();
    assert_eq!(staged(&repository), BTreeSet::from(["two".into()]));
    assert_eq!(fixture.git(&["ls-files", "--stage", "--", "two"]), other);
    let after = files_under(&fixture.root);

    for (path, metadata) in before.iter().filter(|(path, _)| !path.starts_with(".git")) {
        assert_eq!(&after[path], metadata, "working file changed: {path:?}");
    }
}

#[test]
fn handles_all_and_selected_unstaging_on_unborn_and_committed_branches() {
    let fixture = Fixture::new();

    fixture.write("one", "one\n");
    fixture.write("two", "two\n");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    assert!(repository.stage_all(None).unwrap().status.head.is_unborn());
    repository.unstage(&["one".into()], None).unwrap();
    assert_eq!(staged(&repository), BTreeSet::from(["two".into()]));
    repository.unstage_all(None).unwrap();
    assert!(staged(&repository).is_empty());
    fixture.commit("initial");
    fixture.write("one", "changed\n");
    fixture.write("three", "new\n");
    repository.stage_all(None).unwrap();
    repository.unstage_all(None).unwrap();
    assert!(staged(&repository).is_empty());
    assert_eq!(fs::read(fixture.root.join("three")).unwrap(), b"new\n");
}

#[test]
fn treats_magic_globs_options_unicode_and_control_characters_as_literal_paths() {
    let fixture = Fixture::new();
    let names = ["*", "[abc]", ":(glob)other*", "-option", "é\t\nfile"];

    for name in names {
        fixture.write(name, "literal\n");
    }

    fixture.write("other-unselected", "keep unstaged\n");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    repository.stage(&["*".into()], None).unwrap();
    assert_eq!(staged(&repository), BTreeSet::from(["*".into()]));
    let paths: Vec<_> = names.iter().map(PathBuf::from).collect();

    repository.stage(&paths, None).unwrap();
    assert_eq!(staged(&repository), paths.iter().cloned().collect());
    repository.unstage(&paths, None).unwrap();
    assert!(staged(&repository).is_empty());
}

#[test]
fn rejects_invalid_cancelled_and_foreign_locked_writes_without_changing_files() {
    let fixture = Fixture::new();

    fixture.write("one", "one\n");
    fixture.commit("initial");
    fixture.write("one", "changed\n");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let before = files_under(&fixture.root);

    for paths in [
        vec![],
        vec![PathBuf::from("../outside")],
        vec![fixture.root.join("one")],
        vec![PathBuf::from("nul\0name")],
    ] {
        let error = repository.stage(&paths, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::BeforeCommand);
    }

    let cancel = Cancellation::default();

    cancel.cancel();
    let error = repository.stage_all(Some(&cancel)).unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(matches!(
        error.error,
        RepositoryError::Git(GitError::Cancelled)
    ));
    assert_eq!(files_under(&fixture.root), before);
    let lock = fixture.root.join(".git/index.lock");

    fs::write(&lock, b"foreign lock").unwrap();
    let before = files_under(&fixture.root);
    let error = repository.stage_all(None).unwrap_err();

    assert_eq!(error.phase, WritePhase::Command);
    assert_eq!(
        Failure::from_repository(Operation::StageAll, &error.error).code,
        ErrorCode::RepositoryLocked
    );
    assert_eq!(files_under(&fixture.root), before);
    fs::remove_file(lock).unwrap();
    repository.stage_all(None).unwrap();
}

#[test]
#[cfg(unix)]
fn distinguishes_a_successful_index_write_from_a_failed_post_write_snapshot() {
    let fixture = Fixture::new();

    fixture.write("one", "one\n");
    let marker = fixture.temporary.path().join("added");

    let wrapper = script(
        &fixture,
        r#"
case " $* " in
  *" add "*) git "$@" || exit $?; : > "$ONEGIT_ADDED" ;;
  *" status "*) if [ -f "$ONEGIT_ADDED" ]; then printf 'malformed\000'; else exec git "$@"; fi ;;
  *) exec git "$@" ;;
esac"#,
    );

    let process = process(&fixture, &wrapper)
        .with_environment([("ONEGIT_ADDED".into(), marker.into_os_string())]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let error = repository.stage_all(None).unwrap_err();

    assert_eq!(error.phase, WritePhase::Refresh);
    assert!(matches!(error.error, RepositoryError::Status(_)));
    assert_eq!(fixture.git(&["ls-files", "--", "one"]), b"one\n");
    assert_eq!(fs::read(fixture.root.join("one")).unwrap(), b"one\n");
}

#[test]
fn pins_process_cwd_and_rejects_a_replaced_repository_before_writing() {
    let fixture = Fixture::new();

    fixture.write("original", "original\n");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let directory = fs::File::open(&fixture.root).unwrap();
    let moved = fixture.temporary.path().join("moved");

    fs::rename(&fixture.root, &moved).unwrap();
    fs::create_dir(&fixture.root).unwrap();
    fs::write(fixture.root.join("replacement"), b"leave alone").unwrap();
    let before = files_under(&fixture.root);

    assert_eq!(
        repository.stage_all(None).unwrap_err().phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(files_under(&fixture.root), before);
    let mut command = GitCommand::new(&fixture.root, ["rev-parse", "--show-toplevel"]);

    command.directory = Some(&directory);
    let output = fixture.process().run(command).unwrap().stdout;

    assert_eq!(
        output,
        [
            fs::canonicalize(moved)
                .unwrap()
                .as_os_str()
                .as_encoded_bytes(),
            b"\n"
        ]
        .concat()
    );
    assert_eq!(files_under(&fixture.root), before);
}

#[cfg(unix)]
fn wait_until(description: &str, predicate: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);

    while !predicate() {
        assert!(Instant::now() < deadline, "{description}");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
#[cfg(unix)]
fn serializes_alias_and_linked_worktree_writes_and_reads_while_other_repositories_proceed() {
    let fixture = Fixture::new();

    fixture.write("base", "base\n");
    fixture.commit("initial");
    let linked = fixture.temporary.path().join("linked");

    fixture.git_os([
        "worktree".into(),
        "add".into(),
        "-b".into(),
        "linked".into(),
        linked.as_os_str().to_owned(),
    ]);
    fixture.write("one", "one\n");
    fixture.write("two", "two\n");
    fs::write(linked.join("three"), b"three\n").unwrap();
    let marker = fixture.temporary.path().join("entered");
    let release = fixture.temporary.path().join("release");
    let log = fixture.temporary.path().join("order");

    let wrapper = script(
        &fixture,
        r#"
case " $* " in
  *" add "*)
    printf '%s\n' "$ONEGIT_TAG" >> "$ONEGIT_LOG"
    if [ "$ONEGIT_TAG" = A ]; then
      : > "$ONEGIT_ENTERED"
      count=0
      while [ ! -f "$ONEGIT_RELEASE" ]; do count=$((count + 1)); [ "$count" -lt 1000 ] || exit 90; sleep 0.01; done
    fi ;;
esac
exec git "$@""#,
    );

    let coordinator = RepositoryCoordinator::default();

    let configured = |tag: &str| {
        process(&fixture, &wrapper).with_environment([
            ("ONEGIT_TAG".into(), tag.into()),
            ("ONEGIT_LOG".into(), log.as_os_str().to_owned()),
            ("ONEGIT_ENTERED".into(), marker.as_os_str().to_owned()),
            ("ONEGIT_RELEASE".into(), release.as_os_str().to_owned()),
        ])
    };

    let first = Arc::new(
        coordinator
            .open(&fixture.root, configured("A"), None)
            .unwrap(),
    );

    let alias = fixture.temporary.path().join("alias");

    common::symlink(&fixture.root, &alias).unwrap();
    let second = coordinator.open(&alias, configured("B"), None).unwrap();
    let third = coordinator.open(&linked, configured("C"), None).unwrap();
    let common = first.info().common_directory.clone();

    std::thread::scope(|scope| {
        let a = scope.spawn(|| first.stage(&["one".into()], None));

        wait_until("first writer did not start", || marker.exists());
        let b = scope.spawn(|| second.stage(&["two".into()], None));

        wait_until("second writer did not queue", || {
            coordinator.pending_writes(&common) == 2
        });
        let c = scope.spawn(|| third.stage(&["three".into()], None));

        wait_until("related worktree writer did not queue", || {
            coordinator.pending_writes(&common) == 3
        });
        let (sender, receiver) = mpsc::channel();
        let read_repository = Arc::clone(&first);

        let reader = scope.spawn(move || {
            sender.send(read_repository.snapshot(false, None)).unwrap();
        });

        assert!(
            receiver.recv_timeout(Duration::from_millis(100)).is_err(),
            "snapshot bypassed pending writes"
        );
        let other = Fixture::new();

        other.write("independent", "independent\n");
        let independent = coordinator
            .open(&other.root, other.process(), None)
            .unwrap();

        independent.stage_all(None).unwrap();
        assert_eq!(coordinator.pending_writes(&common), 3);
        fs::write(&release, b"go").unwrap();
        a.join().unwrap().unwrap();
        b.join().unwrap().unwrap();
        c.join().unwrap().unwrap();
        assert_eq!(
            receiver
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap()
                .status
                .files
                .iter()
                .filter(|file| file.index_status == FileStatus::Added)
                .count(),
            2
        );
        reader.join().unwrap();
    });
    assert_eq!(fs::read_to_string(log).unwrap(), "A\nB\nC\n");
    assert_eq!(coordinator.pending_writes(&common), 0);
    assert_eq!(staged(&third), BTreeSet::from(["three".into()]));
}

#[test]
#[cfg(unix)]
fn retains_the_queue_through_post_write_refresh_and_skips_a_cancelled_queued_command() {
    let fixture = Fixture::new();

    fixture.write("one", "one\n");
    fixture.write("two", "two\n");
    let marker = fixture.temporary.path().join("refresh-entered");
    let release = fixture.temporary.path().join("refresh-release");
    let added = fixture.temporary.path().join("added");
    let log = fixture.temporary.path().join("adds");

    let wrapper = script(
        &fixture,
        r#"
case " $* " in
  *" add "*)
    printf '%s\n' "$ONEGIT_TAG" >> "$ONEGIT_LOG"
    git "$@" || exit $?
    : > "$ONEGIT_ADDED"
    exit 0 ;;
  *" status "*)
    if [ "$ONEGIT_TAG" = A ] && [ -f "$ONEGIT_ADDED" ]; then
      : > "$ONEGIT_ENTERED"
      count=0
      while [ ! -f "$ONEGIT_RELEASE" ]; do count=$((count + 1)); [ "$count" -lt 1000 ] || exit 90; sleep 0.01; done
    fi ;;
esac
exec git "$@""#,
    );

    let coordinator = RepositoryCoordinator::default();

    let configured = |tag: &str| {
        process(&fixture, &wrapper).with_environment([
            ("ONEGIT_TAG".into(), tag.into()),
            ("ONEGIT_LOG".into(), log.as_os_str().to_owned()),
            ("ONEGIT_ADDED".into(), added.as_os_str().to_owned()),
            ("ONEGIT_ENTERED".into(), marker.as_os_str().to_owned()),
            ("ONEGIT_RELEASE".into(), release.as_os_str().to_owned()),
        ])
    };

    let first = coordinator
        .open(&fixture.root, configured("A"), None)
        .unwrap();

    let second = coordinator
        .open(&fixture.root, configured("B"), None)
        .unwrap();

    let third = coordinator
        .open(&fixture.root, configured("C"), None)
        .unwrap();

    let common = first.info().common_directory.clone();
    let cancellation = Cancellation::default();

    std::thread::scope(|scope| {
        let a = scope.spawn(|| first.stage(&["one".into()], None));

        wait_until("successful add did not enter refresh", || marker.exists());
        assert_eq!(fixture.git(&["ls-files", "--", "one"]), b"one\n");
        let b = scope.spawn(|| second.stage(&["two".into()], Some(&cancellation)));

        wait_until("second writer not queued", || {
            coordinator.pending_writes(&common) == 2
        });
        cancellation.cancel();
        let c = scope.spawn(|| third.stage(&["two".into()], None));

        wait_until("third writer not queued", || {
            coordinator.pending_writes(&common) == 3
        });
        assert_eq!(
            fs::read_to_string(&log).unwrap(),
            "A\n",
            "queue released before refresh finished"
        );
        fs::write(&release, b"go").unwrap();
        a.join().unwrap().unwrap();
        let stopped = b.join().unwrap().unwrap_err();

        assert_eq!(stopped.phase, WritePhase::BeforeCommand);
        assert!(matches!(
            stopped.error,
            RepositoryError::Git(GitError::Cancelled)
        ));
        c.join().unwrap().unwrap();
    });
    assert_eq!(fs::read_to_string(log).unwrap(), "A\nC\n");
    assert_eq!(staged(&first), BTreeSet::from(["one".into(), "two".into()]));
}

#[test]
#[cfg(unix)]
fn cancellation_holds_coordination_until_owned_term_ignoring_processes_are_reaped() {
    let fixture = Fixture::new();

    fixture.write("one", "one\n");
    let marker = fixture.temporary.path().join("leader");
    let child_marker = fixture.temporary.path().join("child");

    let wrapper = script(
        &fixture,
        r#"
case " $* " in
  *" add "*)
    if [ "$ONEGIT_TAG" = A ]; then
      trap '' TERM
      printf '%s' "$$" > "$ONEGIT_LEADER"
      sleep 60 &
      printf '%s' "$!" > "$ONEGIT_CHILD"
      wait
      exit 91
    fi ;;
esac
exec git "$@""#,
    );

    let coordinator = RepositoryCoordinator::default();

    let configured = |tag: &str| {
        process(&fixture, &wrapper).with_environment([
            ("ONEGIT_TAG".into(), tag.into()),
            ("ONEGIT_LEADER".into(), marker.as_os_str().to_owned()),
            ("ONEGIT_CHILD".into(), child_marker.as_os_str().to_owned()),
        ])
    };

    let first = coordinator
        .open(&fixture.root, configured("A"), None)
        .unwrap();

    let next = coordinator
        .open(&fixture.root, configured("B"), None)
        .unwrap();

    let common = first.info().common_directory.clone();
    let cancellation = Cancellation::default();

    std::thread::scope(|scope| {
        let writer = scope.spawn(|| first.stage_all(Some(&cancellation)));

        wait_until("owned helper not started", || child_marker.exists());
        let (done, result) = mpsc::channel();

        let next = scope.spawn(move || {
            done.send(next.stage_all(None)).unwrap();
        });

        wait_until("next mutation not queued", || {
            coordinator.pending_writes(&common) == 2
        });
        cancellation.cancel();
        assert!(
            result.recv_timeout(Duration::from_millis(100)).is_err(),
            "write guard released during process cleanup"
        );
        let stopped = writer.join().unwrap().unwrap_err();

        assert_eq!(stopped.phase, WritePhase::Command);
        assert!(matches!(
            stopped.error,
            RepositoryError::Git(GitError::Cancelled)
        ));
        result
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        next.join().unwrap();
    });

    for marker in [marker, child_marker] {
        let pid = fs::read_to_string(marker).unwrap();

        assert!(
            !std::process::Command::new("/bin/kill")
                .args(["-0", &pid])
                .output()
                .unwrap()
                .status
                .success(),
            "owned process {pid} survived completion"
        );
    }

    assert_eq!(coordinator.pending_writes(&common), 0);
}
