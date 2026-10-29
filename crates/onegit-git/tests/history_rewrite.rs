//! Ports guarded squash/reorder/reset: disposable construction, atomic retention and unchanged files/index.
mod common;

use common::Fixture;

use onegit_git::{
    BranchIdentity, HistoryRange, ReorderCommits, Repository, ResetCommit, SquashCommits,
};

fn text(f: &Fixture, args: &[&str]) -> String {
    String::from_utf8(f.git(args)).unwrap().trim().into()
}

fn setup() -> (Fixture, Repository, Vec<String>, BranchIdentity) {
    let f = Fixture::new();
    let mut commits = Vec::new();

    for name in ["Base", "One", "Two", "Three"] {
        f.write(name, name);
        f.commit(name);
        commits.push(text(&f, &["rev-parse", "HEAD"]));
    }

    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());

    (f, r, commits, expected)
}

#[test]
fn squashes_a_middle_range_replays_later_commits_and_preserves_files_index_and_other_refs() {
    let (f, r, ids, expected) = setup();

    f.git(&["tag", "original", &ids[3]]);
    f.git(&["branch", "other", &ids[3]]);
    let index = std::fs::read(f.root.join(".git/index")).unwrap();
    let tree = text(&f, &["rev-parse", "HEAD^{tree}"]);

    let request = SquashCommits {
        range: HistoryRange {
            commits: vec![ids[2].clone(), ids[1].clone()],
            expected,
        },
        message: "Combined\n\nBody".into(),
    };

    let plan = r.squash_plan(&request, None).unwrap();

    assert_eq!(plan.commits.len(), 2);
    assert_eq!(plan.replay[0].oid, ids[3]);
    let result = r.squash_commits(&request, None).unwrap();

    assert!(result.warning.is_none());
    assert_ne!(result.oid, ids[3]);
    assert_eq!(text(&f, &["rev-parse", &result.recovery_ref]), ids[3]);
    assert_eq!(text(&f, &["rev-parse", "HEAD^{tree}"]), tree);
    assert_eq!(text(&f, &["rev-parse", "original"]), ids[3]);
    assert_eq!(text(&f, &["rev-parse", "other"]), ids[3]);
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(text(&f, &["log", "--format=%s"]), "Three\nCombined\nBase");
    assert_eq!(r.worktrees(None).unwrap().len(), 1);
}

#[test]
fn reorders_a_middle_range_preserving_messages_authors_final_tree_and_original_history() {
    let (f, r, ids, expected) = setup();
    let tree = text(&f, &["rev-parse", "HEAD^{tree}"]);
    let index = std::fs::read(f.root.join(".git/index")).unwrap();

    let request = ReorderCommits {
        range: HistoryRange {
            commits: vec![ids[2].clone(), ids[1].clone()],
            expected,
        },
        order: vec![ids[2].clone(), ids[1].clone()],
    };

    assert_eq!(r.reorder_plan(&request, None).unwrap().replay.len(), 1);
    let result = r.reorder_commits(&request, None).unwrap();

    assert!(result.warning.is_none());
    assert_eq!(text(&f, &["log", "--format=%s"]), "Three\nOne\nTwo\nBase");
    assert_eq!(text(&f, &["rev-parse", "HEAD^{tree}"]), tree);
    assert_eq!(text(&f, &["rev-parse", &result.recovery_ref]), ids[3]);
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
}

#[test]
fn squashes_a_root_range_and_retains_empty_later_commits() {
    let (f, r, ids, _) = setup();

    f.git(&["commit", "--allow-empty", "-m", "Empty"]);
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());

    r.squash_commits(
        &SquashCommits {
            range: HistoryRange {
                commits: vec![ids[1].clone(), ids[0].clone()],
                expected,
            },
            message: "Root combined".into(),
        },
        None,
    )
    .unwrap();
    assert_eq!(
        text(&f, &["log", "--format=%s"]),
        "Empty\nThree\nTwo\nRoot combined"
    );
}

#[test]
fn refuses_published_dirty_stale_nonconsecutive_and_locked_rewrites_without_removing_foreign_locks()
{
    let (f, r, ids, expected) = setup();

    let request = SquashCommits {
        range: HistoryRange {
            commits: vec![ids[2].clone(), ids[1].clone()],
            expected,
        },
        message: "Combined".into(),
    };

    f.write("dirty", "keep");
    assert!(r.squash_plan(&request, None).is_err());
    std::fs::remove_file(f.root.join("dirty")).unwrap();
    f.write(".git/index.lock", "foreign");
    assert!(r.squash_commits(&request, None).is_err());
    assert_eq!(
        std::fs::read(f.root.join(".git/index.lock")).unwrap(),
        b"foreign"
    );
    std::fs::remove_file(f.root.join(".git/index.lock")).unwrap();
    f.git(&["update-ref", "refs/remotes/origin/main", &ids[2]]);
    assert!(r.squash_commits(&request, None).is_err());
    f.git(&["update-ref", "-d", "refs/remotes/origin/main"]);
    let mut bad = request.clone();

    bad.range.commits = vec![ids[3].clone(), ids[1].clone()];
    assert!(r.squash_commits(&bad, None).is_err());
    bad.range.expected.oid = Some(ids[0].clone());
    assert!(r.squash_plan(&bad, None).is_err());
    assert_eq!(text(&f, &["rev-parse", "HEAD"]), ids[3]);
}

#[test]
fn guarded_reset_removes_only_unpublished_history_retains_index_files_and_recovery_ref() {
    let (f, r, ids, expected) = setup();

    f.git(&["update-ref", "refs/remotes/origin/main", &ids[1]]);
    let request = ResetCommit {
        target: ids[1].clone(),
        expected,
    };

    let plan = r.reset_commit_plan(&request, None).unwrap();

    assert_eq!(plan.commit_count, 2);
    let index = std::fs::read(f.root.join(".git/index")).unwrap();

    r.reset_to_commit(&request, None).unwrap();
    assert_eq!(text(&f, &["rev-parse", "HEAD"]), ids[1]);
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    assert!(f.root.join("Three").exists());
}

#[test]
fn guarded_reset_refuses_removing_published_commits_and_current_tip() {
    let (f, r, ids, expected) = setup();

    assert!(
        r.reset_to_commit(
            &ResetCommit {
                target: ids[3].clone(),
                expected: expected.clone()
            },
            None
        )
        .is_err()
    );
    f.git(&["update-ref", "refs/remotes/origin/main", &ids[2]]);
    assert!(
        r.reset_to_commit(
            &ResetCommit {
                target: ids[1].clone(),
                expected
            },
            None
        )
        .is_err()
    );
    assert_eq!(text(&f, &["rev-parse", "HEAD"]), ids[3]);
}

#[test]
fn refuses_missing_duplicate_foreign_unchanged_and_root_moving_orders() {
    let (_f, r, ids, expected) = setup();

    let range = HistoryRange {
        commits: vec![ids[2].clone(), ids[1].clone()],
        expected: expected.clone(),
    };

    for order in [
        vec![],
        vec![ids[2].clone(), ids[2].clone()],
        vec![ids[0].clone(), ids[1].clone()],
        vec![ids[1].clone(), ids[2].clone()],
    ] {
        assert!(
            r.reorder_commits(
                &ReorderCommits {
                    range: range.clone(),
                    order
                },
                None
            )
            .is_err()
        );
    }

    let range = HistoryRange {
        commits: vec![ids[1].clone(), ids[0].clone()],
        expected,
    };

    assert!(
        r.reorder_plan(
            &ReorderCommits {
                range,
                order: vec![ids[1].clone(), ids[0].clone()]
            },
            None
        )
        .is_err()
    );
}

#[test]
fn rejects_dependent_replay_conflicts_without_touching_branch_files_or_index() {
    let (f, r, ids, _) = setup();

    f.write("One", "changed later");
    f.commit("Dependent");
    let tip = text(&f, &["rev-parse", "HEAD"]);
    let index = std::fs::read(f.root.join(".git/index")).unwrap();
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());

    let range = HistoryRange {
        commits: vec![tip.clone(), ids[3].clone(), ids[2].clone(), ids[1].clone()],
        expected,
    };

    let result = r.reorder_commits(
        &ReorderCommits {
            range,
            order: vec![tip.clone(), ids[1].clone(), ids[2].clone(), ids[3].clone()],
        },
        None,
    );

    assert!(result.is_err());
    assert_eq!(text(&f, &["rev-parse", "HEAD"]), tip);
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(std::fs::read(f.root.join("One")).unwrap(), b"changed later");
    assert!(
        text(
            &f,
            &["for-each-ref", "--format=%(refname)", "refs/1git/reorder/"]
        )
        .is_empty()
    );
    assert_eq!(r.worktrees(None).unwrap().len(), 1);
}

#[test]
fn rejects_conflict_free_replay_that_changes_the_final_tree() {
    let f = Fixture::new();

    f.write("base", "original");
    f.commit("Base");
    f.write("base", "changed");
    f.commit("Change");
    let first = text(&f, &["rev-parse", "HEAD"]);

    f.write("base", "original");
    f.commit("Undo change");
    let tip = text(&f, &["rev-parse", "HEAD"]);
    let r = Repository::open(&f.root, f.process(), None).unwrap();

    let range = HistoryRange {
        commits: vec![tip.clone(), first.clone()],
        expected: BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap()),
    };

    assert!(
        r.reorder_commits(
            &ReorderCommits {
                range,
                order: vec![tip.clone(), first]
            },
            None
        )
        .is_err()
    );
    assert_eq!(text(&f, &["rev-parse", "HEAD"]), tip);
    assert_eq!(std::fs::read(f.root.join("base")).unwrap(), b"original");
}

#[test]
fn relative_commit_hook_failure_does_not_move_original_branch_or_leave_a_worktree() {
    let (f, _, ids, expected) = setup();

    common::install_hook(
        &f,
        "pre-commit",
        "#!/bin/sh\necho hook-refused >&2\nexit 1\n",
    );
    let r = Repository::open(&f.root, f.process_with_hooks(), None).unwrap();

    assert!(
        r.squash_commits(
            &SquashCommits {
                range: HistoryRange {
                    commits: vec![ids[2].clone(), ids[1].clone()],
                    expected
                },
                message: "Combined".into()
            },
            None
        )
        .is_err()
    );
    assert_eq!(text(&f, &["rev-parse", "HEAD"]), ids[3]);
    assert!(!f.root.join(".git/index.lock").exists());
    assert_eq!(r.worktrees(None).unwrap().len(), 1);
}

#[test]
fn never_overwrites_external_branch_movement_from_a_rewrite_hook() {
    let (f, _, ids, expected) = setup();

    common::install_hook(
        &f,
        "post-commit",
        &format!("#!/bin/sh\ngit update-ref refs/heads/main {}\n", ids[2]),
    );
    let r = Repository::open(&f.root, f.process_with_hooks(), None).unwrap();

    assert!(
        r.squash_commits(
            &SquashCommits {
                range: HistoryRange {
                    commits: vec![ids[2].clone(), ids[1].clone()],
                    expected
                },
                message: "Combined".into()
            },
            None
        )
        .is_err()
    );
    assert_eq!(text(&f, &["rev-parse", "HEAD"]), ids[2]);
    assert_eq!(std::fs::read(f.root.join("Three")).unwrap(), b"Three");
    assert!(
        text(
            &f,
            &["for-each-ref", "--format=%(refname)", "refs/1git/squash/"]
        )
        .is_empty()
    );
}

#[test]
fn refuses_hook_altered_replay_without_installation_and_retains_authors_and_messages() {
    let (f, _, ids, expected) = setup();

    common::install_hook(&f, "post-commit", "#!/bin/sh\ngit read-tree --empty\n");
    let r = Repository::open(&f.root, f.process_with_hooks(), None).unwrap();

    let request = ReorderCommits {
        range: HistoryRange {
            commits: vec![ids[2].clone(), ids[1].clone()],
            expected,
        },
        order: vec![ids[2].clone(), ids[1].clone()],
    };

    assert!(r.reorder_commits(&request, None).is_err());
    assert_eq!(text(&f, &["rev-parse", "HEAD"]), ids[3]);
    assert!(r.snapshot(false, None).unwrap().status.files.is_empty());
}

#[test]
fn linked_worktree_rewrite_and_guarded_reset_leave_the_primary_branch_and_files_intact() {
    let (f, r, ids, _) = setup();
    let linked = f.temporary.path().join("linked");

    f.git_os([
        "worktree".into(),
        "add".into(),
        "-b".into(),
        "linked".into(),
        linked.as_os_str().into(),
    ]);
    let other = Repository::open(&linked, f.process(), None).unwrap();
    let expected = BranchIdentity::from_snapshot(&other.snapshot(false, None).unwrap());

    let result = other
        .squash_commits(
            &SquashCommits {
                range: HistoryRange {
                    commits: vec![ids[2].clone(), ids[1].clone()],
                    expected,
                },
                message: "Combined".into(),
            },
            None,
        )
        .unwrap();

    let snapshot = result.snapshot.unwrap();

    other
        .reset_to_commit(
            &ResetCommit {
                target: ids[0].clone(),
                expected: BranchIdentity::from_snapshot(&snapshot),
            },
            None,
        )
        .unwrap();
    assert_eq!(
        r.snapshot(false, None).unwrap().status.head.oid.as_ref(),
        Some(&ids[3])
    );
    assert_eq!(std::fs::read(f.root.join("Three")).unwrap(), b"Three");
    assert!(linked.join("Three").exists());
}

#[test]
fn rejects_shallow_merge_foreign_and_cancelled_history_before_any_ref_installation() {
    let (f, r, ids, expected) = setup();

    let request = SquashCommits {
        range: HistoryRange {
            commits: vec![ids[2].clone(), ids[1].clone()],
            expected,
        },
        message: "Combined".into(),
    };

    let stop = onegit_git::Cancellation::default();

    stop.cancel();
    assert!(r.squash_commits(&request, Some(&stop)).is_err());
    assert!(!f.root.join(".git/index.lock").exists());
    f.git(&["switch", "-c", "topic", &ids[1]]);
    f.write("side", "side");
    f.commit("Side");
    f.git(&["switch", "main"]);
    f.git(&["merge", "--no-ff", "--no-edit", "topic"]);
    let mut merged = request.clone();

    merged.range.expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());
    assert!(r.squash_plan(&merged, None).is_err());
    let destination = f.temporary.path().join("shallow");
    let url = common::file_url(&f.root);
    let mut options = onegit_git::CloneOptions::new(&url, &destination);

    options.depth = Some(2);
    let shallow = Repository::clone(options, f.process(), None).unwrap();

    merged.range.expected = BranchIdentity::from_snapshot(&shallow.snapshot(false, None).unwrap());
    assert!(shallow.squash_plan(&merged, None).is_err());
}

#[test]
fn guarded_reset_counts_merge_side_commits_and_refuses_published_side_history() {
    let (f, r, ids, _) = setup();

    f.git(&["switch", "-c", "side", &ids[1]]);
    f.write("side", "side");
    f.commit("Side");
    let side = text(&f, &["rev-parse", "HEAD"]);

    f.git(&["switch", "main"]);
    f.git(&["merge", "--no-ff", "--no-edit", "side"]);
    let request = ResetCommit {
        target: ids[1].clone(),
        expected: BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap()),
    };

    assert_eq!(r.reset_commit_plan(&request, None).unwrap().commit_count, 4);
    f.git(&["update-ref", "refs/remotes/other/side", &side]);
    assert!(r.reset_to_commit(&request, None).is_err());
}
