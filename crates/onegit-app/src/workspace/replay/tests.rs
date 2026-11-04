//! Maps source cherry-pick/revert guards and paused-sequencer behavior.
use super::*;
use crate::workspace::{conflicts, tests::Fixture, write};
use onegit_git::{FinishKind, OperationState};

fn action(f: &Fixture, destination: Option<(String, String)>) -> Action {
    let source = f.load();

    Action {
        review: Review::new(
            &source,
            Arc::new(source.repository.commit("HEAD", None).unwrap()),
        ),
        destination,
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

    action.review.expected = onegit_git::BranchIdentity::from_snapshot(&source.snapshot);
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
