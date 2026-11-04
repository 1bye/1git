//! Source tag creation guards plus requested lightweight/deletion behavior.
mod common;

use common::Fixture;

use onegit_git::{
    BranchIdentity, Cancellation, DeleteReviewedTag, Repository, ReviewedTag, TagKind, WritePhase,
};

fn setup() -> (Fixture, Repository, BranchIdentity) {
    let f = Fixture::new();

    f.write("base", "base");
    f.commit("Base");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let identity = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());

    (f, r, identity)
}

#[test]
fn creates_both_kinds_locally_on_dirty_worktrees_without_moving_head_or_index() {
    let (f, r, expected) = setup();

    f.write("base", "staged");
    r.stage_all(None).unwrap();
    f.write("base", "working");
    f.write("keep", "untracked");
    let index = std::fs::read(f.root.join(".git/index")).unwrap();

    f.git(&["config", "tag.gpgSign", "true"]);
    r.create_reviewed_tag(
        &ReviewedTag {
            name: "preview",
            annotation: None,
            commit: expected.oid.as_deref().unwrap(),
            expected: &expected,
        },
        None,
    )
    .unwrap();
    f.git(&["config", "tag.gpgSign", "false"]);
    r.create_reviewed_tag(
        &ReviewedTag {
            name: "v1",
            annotation: Some("Release v1"),
            commit: expected.oid.as_deref().unwrap(),
            expected: &expected,
        },
        None,
    )
    .unwrap();
    let tags = r.tags(None).unwrap();

    assert_eq!(
        tags.iter().find(|t| t.name == "preview").unwrap().kind,
        TagKind::Lightweight
    );
    assert_eq!(
        tags.iter().find(|t| t.name == "v1").unwrap().kind,
        TagKind::Annotated
    );
    assert_eq!(
        r.snapshot(false, None).unwrap().status.head.oid,
        expected.oid
    );
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(std::fs::read(f.root.join("base")).unwrap(), b"working");
    assert_eq!(std::fs::read(f.root.join("keep")).unwrap(), b"untracked");
}

#[test]
fn creates_on_graph_commits_reachable_only_from_other_local_remote_or_tag_refs() {
    for kind in ["local", "remote", "tag"] {
        let (f, r, _) = setup();

        f.git(&["checkout", "-b", "feature"]);
        f.write("feature", "feature");
        f.commit("Feature");
        let target = r.snapshot(false, None).unwrap().status.head.oid.unwrap();

        f.git(&["checkout", "main"]);
        f.write("main", "main");
        f.commit("Main");

        if kind == "remote" {
            f.git(&["update-ref", "refs/remotes/origin/feature", &target]);
        }

        if kind == "tag" {
            f.git(&["tag", "source", &target]);
        }

        if kind != "local" {
            f.git(&["branch", "-D", "feature"]);
        }

        let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());

        r.create_reviewed_tag(
            &ReviewedTag {
                name: "release",
                annotation: Some("Feature release"),
                commit: &target,
                expected: &expected,
            },
            None,
        )
        .unwrap();
        assert_eq!(
            r.tags(None)
                .unwrap()
                .into_iter()
                .find(|t| t.name == "release")
                .unwrap()
                .target_oid,
            target,
            "{kind}"
        );
        assert_eq!(
            BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap()),
            expected
        );
    }
}

#[test]
fn refuses_duplicate_invalid_or_stale_creation_and_cancelled_writes() {
    let (f, r, expected) = setup();

    let request = ReviewedTag {
        name: "v1",
        annotation: Some("Release"),
        commit: expected.oid.as_deref().unwrap(),
        expected: &expected,
    };

    let cancel = Cancellation::default();

    cancel.cancel();
    assert_eq!(
        r.create_reviewed_tag(&request, Some(&cancel))
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    r.create_reviewed_tag(&request, None).unwrap();
    let old = r.tags(None).unwrap();

    assert_eq!(
        r.create_reviewed_tag(&request, None).unwrap_err().phase,
        WritePhase::BeforeCommand
    );

    for name in ["--all", "../bad", "bad name", "bad\nname"] {
        assert!(
            r.create_reviewed_tag(&ReviewedTag { name, ..request }, None)
                .is_err()
        );
    }

    f.git(&["branch", "other"]);
    f.git(&["switch", "other"]);
    assert_eq!(
        r.create_reviewed_tag(
            &ReviewedTag {
                name: "stale",
                ..request
            },
            None
        )
        .unwrap_err()
        .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(r.tags(None).unwrap(), old);
    f.write("next", "next");
    f.commit("Next");
    assert!(
        r.create_reviewed_tag(
            &ReviewedTag {
                name: "moved",
                ..request
            },
            None
        )
        .is_err()
    );
    assert_eq!(r.tags(None).unwrap(), old);
}

#[test]
fn deletion_requires_the_exact_reviewed_tag_object_and_never_deletes_replacement_or_remote() {
    let (f, r, expected) = setup();

    r.create_reviewed_tag(
        &ReviewedTag {
            name: "v1",
            annotation: Some("Original"),
            commit: expected.oid.as_deref().unwrap(),
            expected: &expected,
        },
        None,
    )
    .unwrap();
    let old = r.tags(None).unwrap().remove(0);

    let request = DeleteReviewedTag {
        name: &old.name,
        expected_oid: &old.oid,
        expected_target: &old.target_oid,
        expected: &expected,
    };

    f.git(&["tag", "-f", "-a", "-m", "Replacement", "v1"]);
    assert_eq!(
        r.delete_reviewed_tag(&request, None).unwrap_err().phase,
        WritePhase::BeforeCommand
    );
    let new = r.tags(None).unwrap().remove(0);

    assert_ne!(old.oid, new.oid);
    f.git(&["update-ref", "refs/remotes/origin/keep", &old.target_oid]);
    r.delete_reviewed_tag(
        &DeleteReviewedTag {
            expected_oid: &new.oid,
            expected_target: &new.target_oid,
            ..request
        },
        None,
    )
    .unwrap();
    assert!(r.tags(None).unwrap().is_empty());
    assert_eq!(
        String::from_utf8(f.git(&["rev-parse", "refs/remotes/origin/keep"]))
            .unwrap()
            .trim(),
        old.target_oid
    );
    assert_eq!(
        r.snapshot(false, None).unwrap().status.head.oid,
        expected.oid
    );
}

#[test]
fn deletion_rechecks_head_branch_operation_and_cancellation_without_removing_the_tag() {
    let (f, r, expected) = setup();

    r.create_reviewed_tag(
        &ReviewedTag {
            name: "keep",
            annotation: None,
            commit: expected.oid.as_deref().unwrap(),
            expected: &expected,
        },
        None,
    )
    .unwrap();
    let tag = r.tags(None).unwrap().remove(0);

    let request = DeleteReviewedTag {
        name: &tag.name,
        expected_oid: &tag.oid,
        expected_target: &tag.target_oid,
        expected: &expected,
    };

    let cancel = Cancellation::default();

    cancel.cancel();
    assert_eq!(
        r.delete_reviewed_tag(&request, Some(&cancel))
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    f.git(&["checkout", "-b", "other"]);
    assert_eq!(
        r.delete_reviewed_tag(&request, None).unwrap_err().phase,
        WritePhase::BeforeCommand
    );
    f.git(&["checkout", "main"]);
    f.write("more", "more");
    f.commit("More");
    assert_eq!(
        r.delete_reviewed_tag(&request, None).unwrap_err().phase,
        WritePhase::BeforeCommand
    );
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());

    std::fs::write(f.root.join(".git/MERGE_HEAD"), tag.target_oid.as_bytes()).unwrap();
    assert_eq!(
        r.delete_reviewed_tag(
            &DeleteReviewedTag {
                expected: &expected,
                ..request
            },
            None
        )
        .unwrap_err()
        .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(r.tags(None).unwrap(), vec![tag]);
}

#[test]
fn creation_supports_detached_head_but_refuses_unreachable_or_noncommit_targets_and_blank_annotations()
 {
    let (f, r, expected) = setup();

    f.git(&["checkout", "--detach"]);
    let expected = BranchIdentity {
        branch: None,
        ..expected
    };

    let request = ReviewedTag {
        name: "detached",
        annotation: None,
        commit: expected.oid.as_deref().unwrap(),
        expected: &expected,
    };

    r.create_reviewed_tag(&request, None).unwrap();
    assert!(
        r.create_reviewed_tag(
            &ReviewedTag {
                name: "blank",
                annotation: Some(" \n "),
                ..request
            },
            None
        )
        .is_err()
    );
    let tree = String::from_utf8(f.git(&["rev-parse", "HEAD^{tree}"])).unwrap();

    assert!(
        r.create_reviewed_tag(
            &ReviewedTag {
                name: "tree",
                commit: tree.trim(),
                ..request
            },
            None
        )
        .is_err()
    );
    f.git(&["switch", "-c", "temporary"]);
    f.write("dangling", "dangling");
    f.commit("Dangling");
    let dangling = String::from_utf8(f.git(&["rev-parse", "HEAD"])).unwrap();

    f.git(&["checkout", "--detach", request.commit]);
    f.git(&["branch", "-D", "temporary"]);
    assert!(
        r.create_reviewed_tag(
            &ReviewedTag {
                name: "unreachable",
                commit: dangling.trim(),
                ..request
            },
            None
        )
        .is_err()
    );
    assert_eq!(r.tags(None).unwrap().len(), 1);
}
