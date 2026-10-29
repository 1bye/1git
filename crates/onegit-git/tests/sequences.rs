//! Ports ordinary and reviewed cherry-pick/revert and index commit workflows.
mod common;
use common::Fixture;
use onegit_git::{
    BranchIdentity, CherryPickCommit, CommitIndex, FinishKind, FinishOperation, OperationState,
    ReplayCommit, Repository, RevertOptions,
};
fn oid(f: &Fixture) -> String {
    String::from_utf8(f.git(&["rev-parse", "HEAD"]))
        .unwrap()
        .trim()
        .into()
}
#[test]
fn cherry_picks_a_commit_and_reverts_it_with_ordinary_git_hooks() {
    let f = Fixture::new();
    f.write("base", "base");
    f.commit("Base");
    f.git(&["branch", "target"]);
    f.write("addition", "add");
    f.commit("Feature");
    let commit = oid(&f);
    f.git(&["switch", "target"]);
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    r.cherry_pick(&[&commit], None).unwrap();
    assert!(f.root.join("addition").exists());
    let picked = oid(&f);
    r.revert(
        RevertOptions {
            revisions: &[&picked],
            no_commit: false,
        },
        None,
    )
    .unwrap();
    assert!(!f.root.join("addition").exists());
    assert!(r.cherry_pick(&["--all"], None).is_err());
}
#[test]
fn creates_a_structured_index_commit_and_rejects_empty_summaries() {
    let f = Fixture::new();
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    f.write("new", "content");
    r.stage_all(None).unwrap();
    assert!(
        r.commit_index(
            CommitIndex {
                summary: "  ",
                ..Default::default()
            },
            None
        )
        .is_err()
    );
    let result = r
        .commit_index(
            CommitIndex {
                summary: " Subject ",
                description: Some(" Body "),
                signoff: true,
                ..Default::default()
            },
            None,
        )
        .unwrap();
    assert_eq!(result.commit.summary, "Subject");
    assert!(result.commit.body.contains("Body"));
    assert!(result.snapshot.status.files.is_empty());
    r.commit_index(
        CommitIndex {
            summary: "Empty",
            allow_empty: true,
            ..Default::default()
        },
        None,
    )
    .unwrap();
}
#[test]
fn reviewed_cherry_pick_checks_both_tips_and_refuses_dirty_or_reused_history() {
    let f = Fixture::new();
    f.write("base", "base");
    f.commit("Base");
    let target = oid(&f);
    f.git(&["branch", "target"]);
    f.write("addition", "add");
    f.commit("Feature");
    let commit = oid(&f);
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());
    let request = CherryPickCommit {
        review: ReplayCommit {
            commit: commit.clone(),
            expected,
        },
        target_branch: "target".into(),
        expected_target: target,
    };
    f.write("dirty", "keep");
    assert!(r.cherry_pick_commit(&request, None).is_err());
    std::fs::remove_file(f.root.join("dirty")).unwrap();
    r.cherry_pick_commit(&request, None).unwrap();
    assert_eq!(
        r.snapshot(false, None)
            .unwrap()
            .status
            .head
            .branch
            .as_deref(),
        Some("target")
    );
    assert!(r.cherry_pick_commit(&request, None).is_err());
}
#[test]
fn reviewed_revert_retains_conflicts_for_reviewed_abort() {
    let f = Fixture::new();
    f.write("base", "zero\n");
    f.commit("Base");
    f.write("base", "one\n");
    f.commit("One");
    let one = oid(&f);
    f.write("base", "two\n");
    f.commit("Two");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());
    assert!(
        r.revert_commit(
            &ReplayCommit {
                commit: one,
                expected
            },
            None
        )
        .is_err()
    );
    let current = r.snapshot(false, None).unwrap();
    assert_eq!(current.operation, OperationState::Revert);
    r.finish_operation(
        &FinishOperation {
            kind: FinishKind::Abort,
            operation: current.operation,
            expected: BranchIdentity::from_snapshot(&current),
            token: current.operation_token.unwrap(),
        },
        None,
    )
    .unwrap();
    assert_eq!(std::fs::read(f.root.join("base")).unwrap(), b"two\n");
}

#[test]
fn selected_commit_streams_lifecycle_and_output_without_allowing_observers_to_break_cleanup() {
    use onegit_git::{CommitFiles, CommitPhase, CommitProgress};
    let f = Fixture::new();
    f.write("new", "value");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let input = CommitFiles::new(
        vec!["new".try_into().unwrap()],
        "Selected".into(),
        &r.snapshot(false, None).unwrap(),
    );
    let phases = std::cell::RefCell::new(Vec::new());
    let bytes = std::cell::Cell::new(0usize);
    let observer = |event: CommitProgress<'_>| {
        phases.borrow_mut().push(event.phase);
        bytes.set(bytes.get() + event.output.map_or(0, <[u8]>::len));
    };
    r.commit_selected_files_with_progress(&input, Some(&observer), None)
        .unwrap();
    assert_eq!(phases.borrow()[0], CommitPhase::Preparing);
    assert_eq!(phases.borrow().last(), Some(&CommitPhase::Refreshing));
    assert!(bytes.get() > 0);
    assert!(!f.root.join(".git/index.lock").exists());
}
