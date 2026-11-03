//! Source: repository-graph/reader.integration.test.ts.
mod common;

use common::Fixture;
use onegit_git::{GraphHistoryOptions, Repository};

#[test]
fn graph_pages_anchor_all_tips_include_merge_parents_and_never_write() {
    let f = Fixture::new();

    f.write("a", "base\n");
    f.commit("Base");
    f.git(&["checkout", "-b", "feature"]);
    f.write("b", "feature\n");
    f.commit("Feature");
    let feature = f.git(&["rev-parse", "HEAD"]);

    f.git(&["checkout", "main"]);
    f.write("a", "main\n");
    f.commit("Main");
    f.git(&["merge", "--no-ff", "feature", "-m", "Merge"]);
    f.git(&["tag", "v1"]);
    f.git(&["tag", "-a", "v2", "-m", "Release"]);
    let head = String::from_utf8(f.git(&["rev-parse", "HEAD"]))
        .unwrap()
        .trim()
        .to_owned();

    let repo = Repository::open(&f.root, f.process(), None).unwrap();
    let refs = f.git(&["show-ref"]);
    let index = std::fs::read(f.root.join(".git/index")).unwrap();

    let tips = vec![
        head.clone(),
        String::from_utf8(feature).unwrap().trim().into(),
        head,
    ];

    let first = repo
        .graph_history(
            GraphHistoryOptions {
                tips: &tips,
                limit: 2,
                offset: 0,
            },
            None,
        )
        .unwrap();

    assert_eq!(first.commits[0].parent_oids.len(), 2);
    assert_eq!(first.next_offset, Some(2));
    assert_eq!(f.git(&["show-ref"]), refs);
    f.git(&["commit", "--allow-empty", "-m", "New tip"]);
    let updated_refs = f.git(&["show-ref"]);

    let rest = repo
        .graph_history(
            GraphHistoryOptions {
                tips: &tips,
                limit: 100,
                offset: 2,
            },
            None,
        )
        .unwrap();

    let full = repo
        .graph_history(
            GraphHistoryOptions {
                tips: &tips,
                limit: 100,
                offset: 0,
            },
            None,
        )
        .unwrap();

    assert_eq!(
        first
            .commits
            .into_iter()
            .chain(rest.commits)
            .collect::<Vec<_>>(),
        full.commits
    );
    assert_eq!(full.commits.len(), 4);
    assert!(!full.commits.iter().any(|c| c.summary == "New tip"));
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(f.git(&["show-ref"]), updated_refs);
}

#[test]
fn graph_handles_unborn_detached_and_tree_tags_and_rejects_bad_inputs() {
    let f = Fixture::new();
    let repo = Repository::open(&f.root, f.process(), None).unwrap();

    assert!(
        repo.graph_history(GraphHistoryOptions::default(), None)
            .unwrap()
            .commits
            .is_empty()
    );
    f.write("a", "base\n");
    f.commit("Root");
    let head = String::from_utf8(f.git(&["rev-parse", "HEAD"]))
        .unwrap()
        .trim()
        .to_owned();

    let tree = String::from_utf8(f.git(&["rev-parse", "HEAD^{tree}"]))
        .unwrap()
        .trim()
        .to_owned();

    let cancelled = onegit_git::Cancellation::default();

    cancelled.cancel();
    assert!(
        repo.graph_history(
            GraphHistoryOptions {
                tips: std::slice::from_ref(&head),
                ..Default::default()
            },
            Some(&cancelled)
        )
        .is_err()
    );
    f.git(&["checkout", "--detach"]);
    let tips = vec![head.clone(), tree.clone()];

    assert_eq!(
        repo.graph_history(
            GraphHistoryOptions {
                tips: &tips,
                ..Default::default()
            },
            None
        )
        .unwrap()
        .commits
        .len(),
        1
    );
    assert!(
        repo.graph_history(
            GraphHistoryOptions {
                tips: &[tree],
                ..Default::default()
            },
            None
        )
        .unwrap()
        .commits
        .is_empty()
    );

    for tips in [
        vec!["--all".into()],
        vec!["HEAD~1".into()],
        vec!["bad\nargument".into()],
    ] {
        assert!(
            repo.graph_history(
                GraphHistoryOptions {
                    tips: &tips,
                    ..Default::default()
                },
                None
            )
            .is_err()
        );
    }

    assert!(
        repo.graph_history(
            GraphHistoryOptions {
                tips: &[head],
                limit: 0,
                offset: 0
            },
            None
        )
        .is_err()
    );
}

#[test]
fn creating_a_branch_at_a_graph_commit_preserves_dirty_index_working_tree_and_head() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit("Base");

    let oid = String::from_utf8(f.git(&["rev-parse", "HEAD"]))
        .unwrap()
        .trim()
        .to_owned();

    f.write("b.txt", "new tip\n");
    f.commit("Tip");
    f.write("a.txt", "staged\n");
    f.git(&["add", "a.txt"]);
    f.write("a.txt", "working\n");
    f.write("untracked.txt", "keep\n");

    let repo = Repository::open(&f.root, f.process(), None).unwrap();
    let head = f.git(&["rev-parse", "HEAD"]);
    let index = std::fs::read(f.root.join(".git/index")).unwrap();

    let result = repo
        .create_branch_at_commit("graph/review", &oid, None)
        .unwrap();

    assert_eq!(
        result.snapshot.status.head.oid.as_deref(),
        Some(String::from_utf8_lossy(&head).trim())
    );
    assert_eq!(
        f.git(&["rev-parse", "graph/review"]),
        format!("{oid}\n").into_bytes()
    );
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(std::fs::read(f.root.join("a.txt")).unwrap(), b"working\n");
    assert_eq!(
        std::fs::read(f.root.join("untracked.txt")).unwrap(),
        b"keep\n"
    );
    assert_eq!(
        repo.create_branch_at_commit("graph/review", &oid, None)
            .unwrap_err()
            .phase,
        onegit_git::WritePhase::BeforeCommand
    );
    assert_eq!(
        repo.create_branch_at_commit("invalid", "HEAD", None)
            .unwrap_err()
            .phase,
        onegit_git::WritePhase::BeforeCommand
    );
    f.git(&["checkout", "--detach"]);

    repo.create_branch_at_commit("from-detached", &oid, None)
        .unwrap();
    assert!(
        repo.snapshot(false, None)
            .unwrap()
            .status
            .head
            .branch
            .is_none()
    );
    std::fs::write(f.root.join(".git/MERGE_HEAD"), format!("{oid}\n")).unwrap();
    assert_eq!(
        repo.create_branch_at_commit("during-merge", &oid, None)
            .unwrap_err()
            .phase,
        onegit_git::WritePhase::BeforeCommand
    );
    assert!(
        f.process()
            .run(onegit_git::GitCommand::new(
                &f.root,
                ["show-ref", "--verify", "refs/heads/during-merge"]
            ))
            .is_err()
    );
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
}
