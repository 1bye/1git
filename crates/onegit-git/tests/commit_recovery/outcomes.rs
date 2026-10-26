#[cfg(unix)]
use super::*;

#[cfg(unix)]
fn competing_tip(fixture: &Fixture) -> String {
    fixture.git(&["checkout", "-b", "other"]);
    fixture.write("other.txt", "other\n");
    fixture.commit("Other");
    let competing = text(fixture.git(&["rev-parse", "HEAD"]));

    fixture.git(&["checkout", "main"]);

    competing
}

#[test]
#[cfg(unix)]
fn failed_compare_and_swap_cannot_create_a_partial_recovery_ref() {
    let fixture = Fixture::new();

    base_and_tip(&fixture);
    let competing = competing_tip(&fixture);
    let wrapper = fixture.temporary.path().join("git-wrapper");

    executable(
        &wrapper,
        r#"#!/bin/sh
for arg in "$@"; do
 if [ "$arg" = update-ref ]; then git update-ref refs/heads/main "$COMPETING" || exit 77; break; fi
done
exec git "$@"
"#,
    );
    let process = process(&fixture, &wrapper)
        .with_environment([("COMPETING".into(), competing.clone().into())]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let expected = review(&repository);
    let verify_working = unchanged_working(&fixture);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let error = repository.undo_last_commit(&expected, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::Command);
    assert!(std::error::Error::source(&error).is_some());
    assert_eq!(text(fixture.git(&["rev-parse", "HEAD"])), competing);
    assert!(
        fixture
            .git(&["for-each-ref", "--format=%(refname)", "refs/1git/undo/"])
            .is_empty()
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    verify_working();
}

#[test]
#[cfg(unix)]
fn missing_ack_is_command_error_even_when_branch_moved_and_recovery_survives() {
    let fixture = Fixture::new();
    let (parent, tip) = base_and_tip(&fixture);
    let wrapper = fixture.temporary.path().join("git-wrapper");

    executable(
        &wrapper,
        r#"#!/bin/sh
for arg in "$@"; do
 if [ "$arg" = update-ref ]; then git "$@" || exit $?; printf 'lost acknowledgement\n' >&2; exit 73; fi
done
exec git "$@"
"#,
    );
    let repository = Repository::open(&fixture.root, process(&fixture, &wrapper), None).unwrap();
    let expected = review(&repository);
    let verify_working = unchanged_working(&fixture);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let error = repository.undo_last_commit(&expected, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::Command);
    assert_eq!(text(fixture.git(&["rev-parse", "HEAD"])), parent);
    assert_eq!(
        text(fixture.git(&["for-each-ref", "--format=%(objectname)", "refs/1git/undo/"])),
        tip
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    verify_working();
}

#[test]
#[cfg(unix)]
fn acknowledged_undo_with_failed_refresh_keeps_message_and_recovery_warning() {
    let fixture = Fixture::new();
    let (parent, tip) = base_and_tip(&fixture);
    let wrapper = fixture.temporary.path().join("git-wrapper");

    executable(
        &wrapper,
        r#"#!/bin/sh
update=0
status=0
for arg in "$@"; do case "$arg" in update-ref) update=1;; status) status=1;; esac; done
if [ "$update" = 1 ]; then git "$@" || exit $?; : > "$FIXTURE_DIRECTORY/acknowledged"; exit 0; fi
if [ "$status" = 1 ] && [ -f "$FIXTURE_DIRECTORY/acknowledged" ]; then exit 74; fi
exec git "$@"
"#,
    );
    let repository = Repository::open(&fixture.root, process(&fixture, &wrapper), None).unwrap();
    let expected = review(&repository);
    let result = repository.undo_last_commit(&expected, None).unwrap();

    assert!(result.snapshot.is_none());
    assert_eq!(
        result.warning.as_deref(),
        Some("Commit undone, but refreshing failed. Refresh before continuing.")
    );
    assert_eq!(result.message, "Feature\n\nDetails");
    assert_eq!(text(fixture.git(&["rev-parse", "HEAD"])), parent);
    assert_eq!(text(fixture.git(&["rev-parse", &result.recovery_ref])), tip);
}

#[test]
#[cfg(unix)]
fn acknowledged_undo_reports_external_branch_change_without_losing_recovery_or_message() {
    let fixture = Fixture::new();
    let (_, tip) = base_and_tip(&fixture);
    let competing = competing_tip(&fixture);
    let wrapper = fixture.temporary.path().join("git-wrapper");

    executable(
        &wrapper,
        r#"#!/bin/sh
for arg in "$@"; do
 if [ "$arg" = update-ref ]; then
  git "$@" || exit $?
  git update-ref refs/heads/main "$COMPETING" || exit 78
  exit 0
 fi
done
exec git "$@"
"#,
    );
    let process = process(&fixture, &wrapper)
        .with_environment([("COMPETING".into(), competing.clone().into())]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let expected = review(&repository);
    let result = repository.undo_last_commit(&expected, None).unwrap();

    assert_eq!(
        result.snapshot.unwrap().status.head.oid.as_deref(),
        Some(competing.as_str())
    );
    assert_eq!(
        result.warning.as_deref(),
        Some(
            "Undo completed, but the branch changed externally. Refresh and inspect History before continuing."
        )
    );
    assert_eq!(result.message, "Feature\n\nDetails");
    assert_eq!(text(fixture.git(&["rev-parse", &result.recovery_ref])), tip);
}

#[test]
#[cfg(unix)]
fn replaced_directory_after_install_returns_warning_without_reading_the_new_directory() {
    let fixture = Fixture::new();
    let (parent, tip) = base_and_tip(&fixture);
    let wrapper = fixture.temporary.path().join("git-wrapper");
    let moved = fixture.temporary.path().join("moved repository");
    let index = fs::read(fixture.root.join(".git/index")).unwrap();

    executable(
        &wrapper,
        r#"#!/bin/sh
for arg in "$@"; do
 if [ "$arg" = update-ref ]; then
  git "$@" || exit $?
  mv "$ORIGINAL_ROOT" "$MOVED_ROOT" || exit 78
  mkdir "$ORIGINAL_ROOT" || exit 79
  exit 0
 fi
done
exec git "$@"
"#,
    );
    let process = process(&fixture, &wrapper).with_environment([
        (
            "ORIGINAL_ROOT".into(),
            fixture.root.clone().into_os_string(),
        ),
        ("MOVED_ROOT".into(), moved.clone().into_os_string()),
    ]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let expected = review(&repository);
    let result = repository.undo_last_commit(&expected, None).unwrap();

    assert!(result.snapshot.is_none());
    assert_eq!(
        result.warning.as_deref(),
        Some("Commit undone, but refreshing failed. Refresh before continuing.")
    );
    assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 0);
    assert_eq!(fs::read(moved.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(moved.join("a.txt")).unwrap(), b"committed\n");

    for (reference, expected) in [
        ("HEAD", parent.as_str()),
        (result.recovery_ref.as_str(), tip.as_str()),
    ] {
        let output = fixture
            .process()
            .run(GitCommand::new(&moved, ["rev-parse", reference]))
            .unwrap();

        assert_eq!(text(output.stdout), expected);
    }
}

#[test]
#[cfg(unix)]
fn cancellation_after_install_starts_cannot_interrupt_transaction_or_release_queued_reads_early() {
    use std::sync::{Arc, mpsc};
    use std::time::{Duration, Instant};

    let fixture = Fixture::new();
    let (parent, _) = base_and_tip(&fixture);
    let wrapper = fixture.temporary.path().join("git-wrapper");

    executable(
        &wrapper,
        r#"#!/bin/sh
update=0
status=0
for arg in "$@"; do case "$arg" in update-ref) update=1;; status) status=1;; esac; done
if [ "$update" = 1 ]; then
 : > "$FIXTURE_DIRECTORY/install-entered"
 attempts=0
 while [ ! -f "$FIXTURE_DIRECTORY/install-release" ]; do
  attempts=$((attempts+1)); if [ "$attempts" -gt 1200 ]; then exit 78; fi
  sleep 0.01
 done
 git "$@" || exit $?
 : > "$FIXTURE_DIRECTORY/acknowledged"
 exit 0
fi
if [ "$status" = 1 ] && [ -f "$FIXTURE_DIRECTORY/acknowledged" ]; then
 : > "$FIXTURE_DIRECTORY/refresh-entered"
 attempts=0
 while [ ! -f "$FIXTURE_DIRECTORY/refresh-release" ]; do
  attempts=$((attempts+1)); if [ "$attempts" -gt 1200 ]; then exit 79; fi
  sleep 0.01
 done
fi
exec git "$@"
"#,
    );
    let repository =
        Arc::new(Repository::open(&fixture.root, process(&fixture, &wrapper), None).unwrap());

    let expected = review(&repository);
    let cancellation = Cancellation::default();
    let cancel = cancellation.clone();
    let write_repository = Arc::clone(&repository);

    let writer = std::thread::spawn(move || {
        write_repository
            .undo_last_commit(&expected, Some(&cancel))
            .unwrap()
    });

    let wait = |name: &str| {
        let deadline = Instant::now() + Duration::from_secs(6);

        while !fixture.temporary.path().join(name).exists() {
            assert!(Instant::now() < deadline, "undo marker timeout: {name}");
            std::thread::sleep(Duration::from_millis(5));
        }
    };

    wait("install-entered");
    let reader_repository = Arc::clone(&repository);
    let (started, ready) = mpsc::channel();
    let (snapshot, completed) = mpsc::channel();

    let reader = std::thread::spawn(move || {
        started.send(()).unwrap();
        snapshot
            .send(reader_repository.snapshot(false, None).unwrap())
            .unwrap();
    });

    ready.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(matches!(
        completed.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    cancellation.cancel();
    fs::write(fixture.temporary.path().join("install-release"), b"").unwrap();
    wait("refresh-entered");
    assert!(!writer.is_finished());
    assert!(matches!(
        completed.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    ));
    assert_eq!(text(fixture.git(&["rev-parse", "HEAD"])), parent);
    fs::write(fixture.temporary.path().join("refresh-release"), b"").unwrap();
    let result = writer.join().unwrap();
    let fresh = completed.recv_timeout(Duration::from_secs(4)).unwrap();

    reader.join().unwrap();
    assert!(result.warning.is_none());
    assert_eq!(
        result.snapshot.unwrap().status.head.oid.as_deref(),
        Some(parent.as_str())
    );
    assert_eq!(fresh.status.head.oid.as_deref(), Some(parent.as_str()));
}
