//! Ports local-remote fetch/pull/push, reviewed branch sync and release-tag publishing.
mod common;
use common::Fixture;
use onegit_git::{
    AddRemote, BranchIdentity, CreateReleaseTag, FetchOptions, HttpAuthentication, PullOptions,
    PushOptions, PushTag, Repository, SetRemoteUrl, SyncBranch, SyncKind,
};
fn remote(f: &Fixture) -> String {
    let path = f.temporary.path().join("remote.git");
    f.git_os([
        "init".into(),
        "--bare".into(),
        "--initial-branch=main".into(),
        path.as_os_str().into(),
    ]);
    common::file_url(&path)
}
fn setup() -> (Fixture, Repository, String) {
    let f = Fixture::new();
    f.write("base", "base");
    f.commit("Base");
    let url = remote(&f);
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    r.add_remote(
        AddRemote {
            name: "origin",
            url: &url,
            fetch: false,
        },
        None,
    )
    .unwrap();
    (f, r, url)
}
#[test]
fn pushes_establishes_upstream_fetches_and_pulls_from_a_local_remote() {
    let (f, r, _) = setup();
    r.push(
        PushOptions {
            remote: Some("origin"),
            branch: Some("main"),
            set_upstream: true,
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert_eq!(
        r.snapshot(false, None)
            .unwrap()
            .status
            .head
            .upstream
            .as_deref(),
        Some("origin/main")
    );
    r.fetch(
        FetchOptions {
            prune: true,
            ..Default::default()
        },
        None,
    )
    .unwrap();
    r.set_upstream("origin/main", Some("main"), None).unwrap();
    f.git(&["checkout", "-b", "advance"]);
    f.write("remote-change", "new");
    f.commit("Advance");
    f.git(&["push", "origin", "HEAD:main"]);
    f.git(&["switch", "main"]);
    r.pull(
        PullOptions {
            remote: Some("origin"),
            branch: Some("main"),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert!(f.root.join("remote-change").exists());
    assert!(
        r.pull(
            PullOptions {
                branch: Some("main"),
                ..Default::default()
            },
            None
        )
        .is_err()
    );
    assert!(
        r.push(
            PushOptions {
                set_upstream: true,
                ..Default::default()
            },
            None
        )
        .is_err()
    );
}
#[test]
fn reviewed_publish_pushes_only_one_branch_and_rejects_stale_or_ambiguous_intent() {
    let (f, r, url) = setup();
    f.git(&["branch", "other"]);
    f.git(&["config", "remote.origin.mirror", "true"]);
    f.git(&["config", "push.followTags", "true"]);
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());
    let request = SyncBranch {
        kind: SyncKind::Publish,
        expected: &expected,
        remote: "origin",
        remote_ref: "refs/heads/main",
        authentication: None,
        on_progress: None,
    };
    r.sync_branch(request, None).unwrap();
    let heads = String::from_utf8(f.git(&["ls-remote", "--heads", "origin"])).unwrap();
    assert!(heads.contains("refs/heads/main"));
    assert!(!heads.contains("refs/heads/other"));
    assert!(
        r.sync_branch(
            SyncBranch {
                kind: SyncKind::Publish,
                expected: &expected,
                remote: "origin",
                remote_ref: "refs/heads/main",
                authentication: None,
                on_progress: None
            },
            None
        )
        .is_err()
    );
    r.set_remote_url(
        SetRemoteUrl {
            name: "origin",
            url: &url,
            push: true,
            add: false,
        },
        None,
    )
    .unwrap();
    r.set_remote_url(
        SetRemoteUrl {
            name: "origin",
            url: "https://example.invalid/other",
            push: true,
            add: true,
        },
        None,
    )
    .unwrap();
    assert!(
        r.sync_branch(
            SyncBranch {
                kind: SyncKind::Push,
                expected: &expected,
                remote: "origin",
                remote_ref: "refs/heads/main",
                authentication: None,
                on_progress: None
            },
            None
        )
        .is_err()
    );
}
#[test]
fn rejects_dirty_reviewed_pull_and_credentials_for_changed_or_non_https_destinations() {
    let (f, r, _) = setup();
    r.push(
        PushOptions {
            remote: Some("origin"),
            branch: Some("main"),
            set_upstream: true,
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());
    f.write("dirty", "keep");
    assert!(
        r.sync_branch(
            SyncBranch {
                kind: SyncKind::Pull,
                expected: &expected,
                remote: "origin",
                remote_ref: "refs/heads/main",
                authentication: None,
                on_progress: None
            },
            None
        )
        .is_err()
    );
    let auth = HttpAuthentication {
        url: "https://example.invalid/repo",
        username: "fixture",
        password: "secret",
    };
    assert!(
        r.fetch(
            FetchOptions {
                remote: Some("origin"),
                authentication: Some(&auth),
                ..Default::default()
            },
            None
        )
        .is_err()
    );
    assert_eq!(std::fs::read(f.root.join("dirty")).unwrap(), b"keep");
}
#[test]
fn release_tags_require_reviewed_reachable_commits_and_push_exactly_the_reviewed_object() {
    let (f, r, url) = setup();
    let snapshot = r.snapshot(false, None).unwrap();
    let expected = BranchIdentity::from_snapshot(&snapshot);
    let commit = expected.oid.as_deref().unwrap();
    f.write("dirty", "keep");
    r.create_release_tag(
        &CreateReleaseTag {
            name: "v1",
            message: "Release",
            commit,
            expected: &expected,
        },
        None,
    )
    .unwrap();
    assert!(
        r.create_release_tag(
            &CreateReleaseTag {
                name: "v1",
                message: "Replace",
                commit,
                expected: &expected
            },
            None
        )
        .is_err()
    );
    let tag = r.tags(None).unwrap().remove(0);
    let request = PushTag {
        name: &tag.name,
        expected_oid: &tag.oid,
        expected_target: &tag.target_oid,
        remote: "origin",
        expected_url: &url,
        expected: &expected,
        authentication: None,
    };
    r.push_tag(request, None).unwrap();
    let heads = f.git(&["ls-remote", "--heads", "origin"]);
    assert!(heads.is_empty());
    let tags = String::from_utf8(f.git(&["ls-remote", "--tags", "origin"])).unwrap();
    assert!(tags.contains(&tag.oid));
    assert_eq!(std::fs::read(f.root.join("dirty")).unwrap(), b"keep");
}

#[test]
fn pins_relative_local_tag_destinations_even_when_a_remote_with_the_same_name_points_elsewhere() {
    let (f, r, _) = setup();
    f.git(&["init", "--bare", "destination.git"]);
    let elsewhere = f.temporary.path().join("elsewhere.git");
    f.git_os(["init".into(), "--bare".into(), elsewhere.as_os_str().into()]);
    let elsewhere_url = common::file_url(&elsewhere);
    r.add_remote(
        AddRemote {
            name: "destination.git",
            url: &elsewhere_url,
            fetch: false,
        },
        None,
    )
    .unwrap();
    r.add_remote(
        AddRemote {
            name: "local",
            url: "destination.git",
            fetch: false,
        },
        None,
    )
    .unwrap();
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());
    r.create_release_tag(
        &CreateReleaseTag {
            name: "v1",
            message: "Release",
            commit: expected.oid.as_deref().unwrap(),
            expected: &expected,
        },
        None,
    )
    .unwrap();
    let tag = r.tags(None).unwrap().remove(0);
    r.push_tag(
        PushTag {
            name: "v1",
            expected_oid: &tag.oid,
            expected_target: &tag.target_oid,
            remote: "local",
            expected_url: "destination.git",
            expected: &expected,
            authentication: None,
        },
        None,
    )
    .unwrap();
    assert!(
        String::from_utf8(f.git(&[
            "--git-dir",
            "destination.git",
            "for-each-ref",
            "--format=%(refname)"
        ]))
        .unwrap()
        .contains("refs/tags/v1")
    );
    let output = f
        .process()
        .run(onegit_git::GitCommand::new(
            &f.root,
            ["ls-remote", &elsewhere_url],
        ))
        .unwrap();
    assert!(output.stdout.is_empty());
}
#[test]
fn release_tag_push_honors_pre_push_hooks_and_refuses_changed_or_existing_different_remote_tags() {
    let (f, r, url) = setup();
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());
    r.create_release_tag(
        &CreateReleaseTag {
            name: "v1",
            message: "Release",
            commit: expected.oid.as_deref().unwrap(),
            expected: &expected,
        },
        None,
    )
    .unwrap();
    let tag = r.tags(None).unwrap().remove(0);
    common::install_hook(&f, "pre-push", "#!/bin/sh\necho refused >&2\nexit 1\n");
    let hooked = Repository::open(&f.root, f.process_with_hooks(), None).unwrap();
    assert!(
        hooked
            .push_tag(
                PushTag {
                    name: "v1",
                    expected_oid: &tag.oid,
                    expected_target: &tag.target_oid,
                    remote: "origin",
                    expected_url: &url,
                    expected: &expected,
                    authentication: None
                },
                None
            )
            .is_err()
    );
    assert!(f.git(&["ls-remote", "--tags", "origin"]).is_empty());
    f.git(&[
        "push",
        "origin",
        &format!("{}:refs/tags/v1", expected.oid.as_deref().unwrap()),
    ]);
    assert!(
        r.push_tag(
            PushTag {
                name: "v1",
                expected_oid: &tag.oid,
                expected_target: &tag.target_oid,
                remote: "origin",
                expected_url: &url,
                expected: &expected,
                authentication: None
            },
            None
        )
        .is_err()
    );
}
