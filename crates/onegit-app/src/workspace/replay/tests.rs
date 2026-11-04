//! Maps source cherry-pick/revert guards and paused-sequencer behavior.
use super::*;
use crate::workspace::{conflicts, tests::Fixture, write};
use onegit_git::{FinishKind, OperationState};

fn action(f: &Fixture, destination: Option<(String, String)>) -> Action {
    let source = f.load();

    let review = Review::new(
        &source,
        Arc::new(source.repository.commit("HEAD", None).unwrap()),
    );

    match destination {
        Some(destination) => Action::CherryPick {
            review,
            destination,
        },
        None => Action::Revert(review),
    }
}

#[test]
fn stale_replay_is_rejected_before_command_and_keeps_working_files() {
    let f = Fixture::new();

    f.write("a", "base");
    f.commit();
    let action = action(&f, None);

    f.write("a", "new");
    f.commit();
    let source = f.load();
    let head = source.snapshot.status.head.oid.clone();

    let result = write::run(
        source,
        write::Operation::Replay {
            action,
            peers: Vec::new(),
        },
    );

    assert!(result.result.is_err());
    assert!(!result.replay_completion.unwrap().started);
    assert_eq!(f.load().snapshot.status.head.oid, head);
    assert_eq!(std::fs::read(f.root.join("a")).unwrap(), b"new");
}

#[test]
fn cherry_pick_conflict_stays_on_destination_and_can_resolve_then_continue() {
    let f = Fixture::new();

    f.write("a", "zero\n");
    f.commit();
    f.git(&["switch", "-c", "target"]);
    f.write("a", "target\n");
    f.commit();
    let target = f.load().snapshot.status.head.oid.clone().unwrap();

    f.git(&["switch", "main"]);
    f.write("a", "source\n");
    f.commit();
    let source_head = f.load().snapshot.status.head.oid.clone().unwrap();
    let action = action(&f, Some(("target".into(), target)));

    let result = write::run(
        f.load(),
        write::Operation::Replay {
            action,
            peers: Vec::new(),
        },
    );

    assert!(result.result.is_err());
    assert!(result.replay_completion.unwrap().started);
    let source = result.loaded.unwrap();

    assert_eq!(
        source.snapshot.status.head.branch.as_deref(),
        Some("target")
    );
    assert_eq!(source.snapshot.operation, OperationState::CherryPick);
    assert!(conflicts::finish_request(&source.snapshot, FinishKind::Continue).is_some());
    assert!(!conflicts::can_continue(&source.snapshot));
    f.write("a", "resolved\n");
    source
        .repository
        .stage(&[onegit_git::GitPath::new("a").unwrap()], None)
        .unwrap();
    let ready = f.load();

    assert!(conflicts::can_continue(&ready.snapshot));
    let finish = conflicts::finish_request(&ready.snapshot, FinishKind::Continue).unwrap();
    let result = conflicts::run(ready, &finish, &[]);

    assert!(result.result.is_ok(), "{:?}", result.result);
    assert_eq!(f.load().snapshot.operation, OperationState::Normal);
    assert_eq!(std::fs::read(f.root.join("a")).unwrap(), b"resolved\n");
    assert_eq!(
        String::from_utf8(f.git(&["rev-parse", "main"]))
            .unwrap()
            .trim(),
        source_head
    );
}

#[test]
fn revert_conflict_can_abort_without_replaying_and_stale_operation_token_is_refused() {
    let f = Fixture::new();

    f.write("a", "zero\n");
    f.commit();
    f.write("a", "one\n");
    f.commit();
    let action = action(&f, None);

    f.write("a", "two\n");
    f.commit();
    let source = f.load();
    let mut action = action;

    let Action::Revert(review) = &mut action else {
        panic!("expected revert")
    };

    review.expected = onegit_git::BranchIdentity::from_snapshot(&source.snapshot);
    let result = run(source, &action, &[]);

    assert!(result.result.is_err());
    assert!(result.replay_completion.unwrap().started);
    let source = result.loaded.unwrap();

    assert_eq!(source.snapshot.operation, OperationState::Revert);
    let mut abort = conflicts::finish_request(&source.snapshot, FinishKind::Abort).unwrap();

    if let conflicts::Action::Finish(request) = &mut abort {
        request.token.push_str("stale");
    }

    assert!(conflicts::run(source.clone(), &abort, &[]).result.is_err());
    let abort = conflicts::finish_request(&source.snapshot, FinishKind::Abort).unwrap();
    let result = conflicts::run(source, &abort, &[]);

    assert!(result.result.is_ok(), "{:?}", result.result);
    assert_eq!(f.load().snapshot.operation, OperationState::Normal);
    assert_eq!(std::fs::read(f.root.join("a")).unwrap(), b"two\n");
}

fn reset(f: &Fixture) -> Action {
    let source = f.load();

    Action::Reset(Review::new(
        &source,
        Arc::new(source.repository.commit("HEAD^", None).unwrap()),
    ))
}

#[test]
fn reset_reports_recovery_ref_and_preserves_files_and_staging() {
    let f = Fixture::new();

    f.write("a", "base");
    f.commit();
    f.write("a", "later");
    f.commit();
    let source = f.load();
    let old = source.snapshot.status.head.oid.clone().unwrap();
    let action = reset(&f);
    let index = std::fs::read(f.root.join(".git/index")).unwrap();
    let result = run(source, &action, &[]);
    let message = result.result.unwrap();
    let recovery = message.split("Recovery ref: ").nth(1).unwrap();

    assert!(recovery.starts_with("refs/1git/reset/"));
    assert_eq!(
        String::from_utf8(f.git(&["rev-parse", recovery]))
            .unwrap()
            .trim(),
        old
    );
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(std::fs::read(f.root.join("a")).unwrap(), b"later");
    let completion = result.replay_completion.unwrap();

    assert!(completion.started);
    assert!(!completion.needs_review);
    assert!(completion.result.is_ok());
    assert_eq!(completion.kind, Kind::Reset);
}

#[test]
fn reset_retains_recovery_feedback_and_blocks_writes_if_a_peer_refresh_fails() {
    let f = Fixture::new();

    f.write("a", "base");
    f.commit();
    f.write("a", "later");
    f.commit();
    let action = reset(&f);
    let peer = Fixture::new();

    peer.write("b", "peer");
    peer.commit();
    let repository = peer.load().repository.clone();

    std::fs::rename(peer.root.join(".git"), peer.root.join("saved-git")).unwrap();
    let result = run(f.load(), &action, &[repository]);
    let message = result.result.unwrap_err();

    assert!(message.contains("related repository"));
    assert!(message.contains("Recovery ref: refs/1git/reset/"));
    let completion = result.replay_completion.unwrap();

    assert!(completion.started);
    assert!(completion.needs_review);
}

#[test]
fn reset_rejects_new_publication_after_confirmation_review() {
    let f = Fixture::new();

    f.write("a", "base");
    f.commit();
    f.write("a", "later");
    f.commit();
    let action = reset(&f);
    let source = f.load();

    source
        .repository
        .reset_commit_plan(&action.review().reset_request(), None)
        .unwrap();
    let old = source.snapshot.status.head.oid.clone().unwrap();

    f.git(&["update-ref", "refs/remotes/origin/main", &old]);
    let result = run(source, &action, &[]);

    assert!(result.result.unwrap_err().contains("published"));
    assert!(!result.replay_completion.unwrap().started);
    assert_eq!(f.load().snapshot.status.head.oid.as_ref(), Some(&old));
    assert!(f.git(&["for-each-ref", "refs/1git/reset/"]).is_empty());
}

fn range_fixture() -> Fixture {
    let f = Fixture::new();

    for name in ["base", "one", "two", "later"] {
        f.write(name, name);
        f.commit();
    }

    f
}

fn range_action(f: &Fixture, kind: Kind) -> Action {
    let source = f.load();

    let commits: Vec<_> = ["HEAD^", "HEAD^^"]
        .into_iter()
        .map(|id| Arc::new(source.repository.commit(id, None).unwrap()))
        .collect();

    let review = RangeReview {
        source: Review::new(&source, commits[0].clone()),
        commits,
    };

    if kind == Kind::Squash {
        Action::Squash {
            review,
            message: "Combined\n\nDetails".into(),
            cancel: onegit_git::Cancellation::default(),
        }
    } else {
        let order = review.commits.iter().map(|c| c.oid.clone()).collect();

        Action::Reorder {
            review,
            order,
            cancel: onegit_git::Cancellation::default(),
        }
    }
}

#[test]
fn range_edits_report_exact_recovery_refs_and_keep_files_index_and_other_refs() {
    for kind in [Kind::Squash, Kind::Reorder] {
        let f = range_fixture();
        let action = range_action(&f, kind);
        let old = f.load().snapshot.status.head.oid.clone().unwrap();

        f.git(&["tag", "retained", &old]);
        f.git(&["branch", "other", &old]);
        let index = std::fs::read(f.root.join(".git/index")).unwrap();
        let result = run(f.load(), &action, &[]);
        let message = result.result.unwrap();
        let recovery = message.split("Recovery ref: ").nth(1).unwrap();

        assert!(recovery.starts_with(if kind == Kind::Squash {
            "refs/1git/squash/"
        } else {
            "refs/1git/reorder/"
        }));
        assert_eq!(
            String::from_utf8(f.git(&["rev-parse", recovery]))
                .unwrap()
                .trim(),
            old
        );
        assert_eq!(
            String::from_utf8(f.git(&["rev-parse", "retained"]))
                .unwrap()
                .trim(),
            old
        );
        assert_eq!(
            String::from_utf8(f.git(&["rev-parse", "other"]))
                .unwrap()
                .trim(),
            old
        );
        assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);

        for name in ["base", "one", "two", "later"] {
            assert_eq!(std::fs::read_to_string(f.root.join(name)).unwrap(), name);
        }

        let completion = result.replay_completion.unwrap();

        assert!(completion.started);
        assert!(!completion.needs_review);
        assert!(completion.result.is_ok());
        assert_eq!(completion.kind, kind);
    }
}

#[test]
fn acknowledged_range_recovery_survives_peer_refresh_failure_and_stale_consent_never_installs() {
    for kind in [Kind::Squash, Kind::Reorder] {
        let f = range_fixture();
        let action = range_action(&f, kind);
        let peer = Fixture::new();

        peer.write("peer", "peer");
        peer.commit();
        let repository = peer.load().repository.clone();

        std::fs::rename(peer.root.join(".git"), peer.root.join("saved-git")).unwrap();
        let result = run(f.load(), &action, &[repository]);
        let message = result.result.unwrap_err();

        assert!(message.contains("Recovery ref: refs/1git/"));
        assert!(result.replay_completion.unwrap().needs_review);
        let f = range_fixture();
        let action = range_action(&f, kind);

        f.git(&["commit", "--allow-empty", "-m", "External tip"]);
        let old = f.load().snapshot.status.head.oid.clone();
        let result = run(f.load(), &action, &[]);

        assert!(result.result.is_err());
        assert!(!result.replay_completion.unwrap().started);
        assert_eq!(f.load().snapshot.status.head.oid, old);
        assert!(
            f.git(&["for-each-ref", "refs/1git/squash/", "refs/1git/reorder/"])
                .is_empty()
        );
    }
}
