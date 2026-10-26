//! Covers: local ref/remote/stash/worktree/config queries, exact paths and cancellation.
//! Real: Git CLI, disposable repositories and file remotes only.
//! Doubles: isolated fixture config/identity; no providers or user accounts.
//! Requires: Git and temporary storage; no network.

mod common;

use std::fs;
use std::path::Path;

use common::{Fixture, files_under};

use onegit_git::{
    BranchKind, Cancellation, ConfigScope, GitError, Repository, RepositoryError, TagKind,
};

#[test]
fn lists_branches_and_configured_upstream_destinations_without_fetching() {
    let fixture = Fixture::new();

    fixture.write("tracked", "initial\n");
    fixture.commit("initial");

    let oid = fixture.git(&["rev-parse", "HEAD"]);
    let oid = std::str::from_utf8(&oid).unwrap().trim();

    fixture.git(&["update-ref", "refs/remotes/custom/tracking/ui", oid]);
    fixture.git(&["remote", "add", "team/upstream", "/unused/local/remote"]);
    fixture.git(&[
        "config",
        "remote.team/upstream.fetch",
        "+refs/heads/release/*:refs/remotes/custom/tracking/*",
    ]);
    fixture.git(&["config", "branch.main.remote", "team/upstream"]);
    fixture.git(&["config", "branch.main.merge", "refs/heads/release/ui"]);
    fixture.git(&[
        "symbolic-ref",
        "refs/remotes/custom/HEAD",
        "refs/remotes/custom/tracking/ui",
    ]);

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let branches = repository.branches(None).unwrap();

    let current = branches
        .branches
        .iter()
        .find(|branch| branch.name == "main")
        .unwrap();

    assert_eq!(branches.current.as_deref(), Some("main"));
    assert!(current.checked_out);
    assert_eq!(current.kind, BranchKind::Local);
    assert_eq!(current.upstream.as_deref(), Some("custom/tracking/ui"));
    assert_eq!(current.upstream_remote.as_deref(), Some("team/upstream"));
    assert_eq!(
        current.upstream_ref.as_deref(),
        Some("refs/heads/release/ui")
    );
    assert_eq!(
        current.worktree_path.as_deref(),
        Some(fs::canonicalize(&fixture.root).unwrap().as_path())
    );
    assert!(
        branches
            .branches
            .iter()
            .all(|branch| !branch.full_name.ends_with("/HEAD"))
    );
    assert!(
        branches
            .branches
            .iter()
            .any(|branch| branch.kind == BranchKind::Remote
                && branch.remote.as_deref() == Some("custom"))
    );
}

#[test]
fn returns_all_remote_urls_and_locally_recorded_default_branch() {
    let fixture = Fixture::new();

    fixture.write("tracked", "initial\n");
    fixture.commit("initial");

    let oid = fixture.git(&["rev-parse", "HEAD"]);
    let oid = std::str::from_utf8(&oid).unwrap().trim();

    fixture.git(&["remote", "add", "origin", "/fixture/fetch-a"]);
    fixture.git(&["config", "--add", "remote.origin.url", "/fixture/fetch-b"]);
    fixture.git(&[
        "config",
        "--add",
        "remote.origin.pushurl",
        "/fixture/push-a",
    ]);
    fixture.git(&[
        "config",
        "--add",
        "remote.origin.pushurl",
        "/fixture/push-b",
    ]);
    fixture.git(&["update-ref", "refs/remotes/origin/main", oid]);
    fixture.git(&[
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
    ]);

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let remotes = repository.remotes(None).unwrap();

    assert_eq!(remotes.len(), 1);
    assert_eq!(remotes[0].name, "origin");
    assert_eq!(remotes[0].default_branch.as_deref(), Some("main"));
    assert_eq!(
        remotes[0].fetch_urls,
        ["/fixture/fetch-a", "/fixture/fetch-b"]
    );
    assert_eq!(remotes[0].push_urls, ["/fixture/push-a", "/fixture/push-b"]);
}

#[test]
fn distinguishes_annotated_tags_and_lists_stashes_newest_first() {
    let fixture = Fixture::new();

    fixture.write("tracked", "initial\n");
    fixture.commit("initial");
    fixture.git(&["tag", "light"]);
    fixture.git(&["tag", "-a", "annotated", "-m", "fixture tag"]);
    fixture.write("tracked", "first stash\n");
    fixture.git(&["stash", "push", "-m", "first"]);
    fixture.write("tracked", "second stash\n");
    fixture.git(&["stash", "push", "-m", "second"]);

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let tags = repository.tags(None).unwrap();
    let stashes = repository.stashes(None).unwrap();
    let light = tags.iter().find(|tag| tag.name == "light").unwrap();
    let annotated = tags.iter().find(|tag| tag.name == "annotated").unwrap();

    assert_eq!(light.kind, TagKind::Lightweight);
    assert_eq!(light.oid, light.target_oid);
    assert_eq!(annotated.kind, TagKind::Annotated);
    assert_eq!(annotated.target_oid, light.target_oid);
    assert_ne!(annotated.oid, annotated.target_oid);
    assert_eq!(annotated.message, "fixture tag");
    assert_eq!(stashes.len(), 2);
    assert_eq!(stashes[0].reference, "stash@{0}");
    assert!(stashes[0].summary.ends_with("second"));
    assert!(stashes[1].summary.ends_with("first"));
}

#[test]
fn lists_locked_and_detached_worktrees_without_losing_newlines_in_paths() {
    let fixture = Fixture::new();

    fixture.write("tracked", "initial\n");
    fixture.commit("initial");

    let linked = fixture.temporary.path().join("linked\nété");

    fixture.git_os([
        "worktree".into(),
        "add".into(),
        "--detach".into(),
        linked.as_os_str().to_owned(),
    ]);
    fixture.git_os([
        "worktree".into(),
        "lock".into(),
        "--reason".into(),
        "fixture reason".into(),
        linked.as_os_str().to_owned(),
    ]);

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let worktrees = repository.worktrees(None).unwrap();

    let detached = worktrees
        .iter()
        .find(|worktree| worktree.path == fs::canonicalize(&linked).unwrap())
        .unwrap();

    assert_eq!(worktrees.len(), 2);
    assert!(detached.detached);
    assert!(detached.branch.is_none());
    assert!(detached.locked);
    assert_eq!(detached.lock_reason.as_deref(), Some("fixture reason"));
    assert!(!detached.prunable);
    assert_eq!(
        repository.branches(None).unwrap().branches[0]
            .worktree_path
            .as_deref(),
        Some(fs::canonicalize(&fixture.root).unwrap().as_path())
    );
}

#[test]
fn reads_scoped_empty_and_missing_config_and_rejects_invalid_keys() {
    let fixture = Fixture::new();

    fixture.git(&["config", "user.name", "local fixture"]);
    fixture.git(&["config", "onegit.empty", ""]);
    fixture.git(&["config", "extensions.worktreeConfig", "true"]);
    fixture.git(&["config", "--worktree", "user.name", "worktree fixture"]);

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    assert_eq!(
        repository
            .config("user.name", ConfigScope::Local, None)
            .unwrap()
            .value
            .as_deref(),
        Some("local fixture")
    );
    assert_eq!(
        repository
            .config("user.name", ConfigScope::Worktree, None)
            .unwrap()
            .value
            .as_deref(),
        Some("worktree fixture")
    );
    assert_eq!(
        repository
            .config("user.name", ConfigScope::Effective, None)
            .unwrap()
            .value
            .as_deref(),
        Some("worktree fixture")
    );
    assert_eq!(
        repository
            .config("onegit.empty", ConfigScope::Local, None)
            .unwrap()
            .value
            .as_deref(),
        Some("")
    );
    assert!(
        repository
            .config("onegit.absent", ConfigScope::Local, None)
            .unwrap()
            .value
            .is_none()
    );

    for key in [
        "--global",
        "invalid",
        "section.key\0",
        "section.sub_section.key",
    ] {
        assert!(matches!(
            repository.config(key, ConfigScope::Local, None),
            Err(RepositoryError::InvalidInput(_))
        ));
    }
}

#[test]
fn empty_queries_and_cancelled_queries_keep_distinct_results() {
    let fixture = Fixture::new();
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    assert!(repository.branches(None).unwrap().branches.is_empty());
    assert!(repository.tags(None).unwrap().is_empty());
    assert!(repository.stashes(None).unwrap().is_empty());
    assert!(repository.remotes(None).unwrap().is_empty());
    assert_eq!(
        repository.worktrees(None).unwrap()[0].branch.as_deref(),
        Some("main")
    );

    let cancellation = Cancellation::default();

    cancellation.cancel();

    assert!(matches!(
        repository.tags(Some(&cancellation)),
        Err(RepositoryError::Git(GitError::Cancelled))
    ));
    assert_eq!(
        repository.info().root.file_name(),
        Path::new("repository été\n ").file_name()
    );
}

#[test]
fn metadata_reads_preserve_all_repository_file_contents_and_modified_times() {
    let fixture = Fixture::new();

    fixture.write("tracked", "initial\n");
    fixture.commit("initial");
    fixture.git(&["tag", "light"]);
    fixture.write("tracked", "stash\n");
    fixture.git(&["stash", "push", "-m", "fixture"]);

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let before = files_under(&fixture.root);

    repository.branches(None).unwrap();
    repository.tags(None).unwrap();
    repository.stashes(None).unwrap();
    repository.remotes(None).unwrap();
    repository.worktrees(None).unwrap();
    repository
        .config("user.name", ConfigScope::Effective, None)
        .unwrap();

    assert_eq!(files_under(&fixture.root), before);
}
