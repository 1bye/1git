#[cfg(unix)]
use super::*;
#[cfg(unix)]
use onegit_git::{Cancellation, ErrorCode, RepositoryCoordinator};
#[cfg(unix)]
use std::time::{Duration, Instant};

#[cfg(unix)]
fn wait_until(predicate: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);

    while !predicate() {
        if Instant::now() >= deadline {
            return false;
        }

        std::thread::sleep(Duration::from_millis(5));
    }

    true
}

#[test]
#[cfg(unix)]
fn preparation_and_final_refresh_own_the_queue_and_ignore_late_cancellation() {
    for phase in ["preparation", "refresh"] {
        let fixture = Fixture::new();

        fixture.write("base", "base\n");
        fixture.commit("base");
        fixture.write("selected", "selected\n");
        fixture.write("queued", "queued\n");
        let wrapper = fixture.temporary.path().join("git-wrapper.sh");
        let entered = fixture.temporary.path().join("entered");
        let release = fixture.temporary.path().join("release");
        let committed = fixture.temporary.path().join("committed");

        executable(
            &wrapper,
            r#"#!/bin/sh
for argument in "$@"; do
  if [ "$argument" = add ] && [ "$ONEGIT_PHASE" = preparation ]; then
    : > "$ONEGIT_ENTERED"
    count=0
    while [ ! -f "$ONEGIT_RELEASE" ]; do count=$((count + 1)); [ "$count" -lt 1000 ] || exit 90; sleep 0.01; done
  fi
  if [ "$argument" = status ] && [ "$ONEGIT_PHASE" = refresh ] && [ -f "$ONEGIT_COMMITTED" ]; then
    : > "$ONEGIT_ENTERED"
    count=0
    while [ ! -f "$ONEGIT_RELEASE" ]; do count=$((count + 1)); [ "$count" -lt 1000 ] || exit 90; sleep 0.01; done
  fi
  if [ "$argument" = commit ]; then
    git "$@" || exit "$?"
    : > "$ONEGIT_COMMITTED"
    exit 0
  fi
done
exec git "$@"
"#,
        );
        let runner = process(&fixture, wrapper).with_environment([
            ("ONEGIT_PHASE".into(), phase.into()),
            ("ONEGIT_ENTERED".into(), entered.as_os_str().to_owned()),
            ("ONEGIT_RELEASE".into(), release.as_os_str().to_owned()),
            ("ONEGIT_COMMITTED".into(), committed.as_os_str().to_owned()),
        ]);

        let coordinator = RepositoryCoordinator::default();
        let first = coordinator.open(&fixture.root, runner, None).unwrap();

        let second = coordinator
            .open(&fixture.root, fixture.process(), None)
            .unwrap();

        let reader = coordinator
            .open(&fixture.root, fixture.process(), None)
            .unwrap();

        let common = first.info().common_directory.clone();
        let input = request(&first, &["selected"]);
        let cancellation = Cancellation::default();
        let queued_cancellation = Cancellation::default();
        let working = unchanged_working(&fixture);

        std::thread::scope(|scope| {
            let commit = scope.spawn(|| first.commit_selected_files(&input, Some(&cancellation)));
            let reached = wait_until(|| entered.exists());

            cancellation.cancel();
            let next = scope.spawn(|| {
                second.stage(&["queued".try_into().unwrap()], Some(&queued_cancellation))
            });
            let queued = wait_until(|| coordinator.pending_writes(&common) == 2);

            queued_cancellation.cancel();
            let read = scope.spawn(|| reader.snapshot(false, None));
            let blocked = !commit.is_finished() && !next.is_finished() && !read.is_finished();

            fs::write(&release, "continue\n").unwrap();
            let result = commit.join().unwrap().unwrap();
            let error = next.join().unwrap().unwrap_err();
            let snapshot = read.join().unwrap().unwrap();

            assert!(reached && queued && blocked, "{phase}");
            assert_eq!(result.outcome, CommitOutcome::Committed);
            assert!(result.warning.is_none());
            assert_eq!(snapshot.status.head.oid, result.oid);
            assert_eq!(
                onegit_git::Failure::from_repository(onegit_git::Operation::Stage, &error.error)
                    .code,
                ErrorCode::Aborted
            );
        });
        assert_eq!(coordinator.pending_writes(&common), 0);
        assert_eq!(fixture.git(&["show", "HEAD:selected"]), b"selected\n");
        assert!(fixture.git(&["ls-files", "--", "queued"]).is_empty());
        assert!(!fixture.root.join(".git/index.lock").exists());
        working();
    }
}
