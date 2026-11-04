//! Source: git-settings/settings.integration.test.ts; real Git, isolated global config, no network.
mod common;

use common::Fixture;

use onegit_git::{
    CommitIdentity, GitCommand, GlobalGitIdentity, Repository, SettingsChange, WritePhase,
};

use std::fs;

fn identity(name: &str, email: &str) -> CommitIdentity {
    CommitIdentity {
        name: Some(name.into()),
        email: Some(email.into()),
    }
}

#[test]
fn saves_repository_identity_preserves_history_files_index_and_resets_inheritance() {
    let f = Fixture::new();

    f.write("file", "base\n");
    f.commit("Initial");
    f.git(&["config", "user.name", "Before"]);
    f.git(&["config", "user.email", "before@example.invalid"]);
    let repo = Repository::open(&f.root, f.process(), None).unwrap();
    let head = f.git(&["rev-parse", "HEAD"]);
    let index = fs::read(f.root.join(".git/index")).unwrap();
    let first = repo.git_settings(None).unwrap();

    let changed = repo
        .change_git_settings(
            &first,
            &SettingsChange::Identity(Some(identity(" Work ", " work@example.invalid "))),
            None,
        )
        .unwrap();

    assert_eq!(changed.identity, identity("Work", "work@example.invalid"));
    let inherited = repo
        .change_git_settings(&changed, &SettingsChange::Identity(None), None)
        .unwrap();

    assert!(!inherited.custom());
    assert_eq!(inherited.identity, CommitIdentity::default());
    assert_eq!(f.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read_to_string(f.root.join("file")).unwrap(), "base\n");
}

#[test]
fn remote_edits_preserve_push_urls_and_removal_preserves_local_branches() {
    let f = Fixture::new();

    f.write("file", "base\n");
    f.commit("Initial");
    let repo = Repository::open(&f.root, f.process(), None).unwrap();
    let first = repo.git_settings(None).unwrap();

    repo.change_git_settings(
        &first,
        &SettingsChange::AddRemote {
            name: "origin".into(),
            url: "https://example.invalid/one.git".into(),
        },
        None,
    )
    .unwrap();
    f.git(&[
        "remote",
        "set-url",
        "--push",
        "origin",
        "git@example.invalid:push.git",
    ]);
    let review = repo.git_settings(None).unwrap();

    let edited = repo
        .change_git_settings(
            &review,
            &SettingsChange::EditRemote {
                name: "origin".into(),
                url: "https://example.invalid/two.git".into(),
            },
            None,
        )
        .unwrap();

    assert_eq!(
        edited.remotes[0].push_urls,
        ["git@example.invalid:push.git"]
    );
    assert_eq!(
        edited.remotes[0].fetch_urls,
        ["https://example.invalid/two.git"]
    );
    assert!(f.git(&["for-each-ref", "refs/remotes/"]).is_empty());
    let head = f.git(&["rev-parse", "HEAD"]);

    let result = repo
        .change_git_settings(
            &edited,
            &SettingsChange::RemoveRemote {
                name: "origin".into(),
            },
            None,
        )
        .unwrap();

    assert!(result.remotes.is_empty());
    assert_eq!(head, f.git(&["rev-parse", "HEAD"]));
}

#[test]
fn rejects_stale_settings_invalid_identity_credentials_and_advanced_worktree_identity() {
    let f = Fixture::new();
    let repo = Repository::open(&f.root, f.process(), None).unwrap();
    let review = repo.git_settings(None).unwrap();

    f.git(&["config", "user.name", "External"]);
    let change = SettingsChange::Identity(Some(identity("App", "app@example.invalid")));

    assert_eq!(
        repo.change_git_settings(&review, &change, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    let review = repo.git_settings(None).unwrap();

    for change in [
        SettingsChange::Identity(Some(identity("Bad\nName", "bad"))),
        SettingsChange::AddRemote {
            name: "origin".into(),
            url: "https://user:secret@example.invalid/a.git".into(),
        },
    ] {
        assert_eq!(
            repo.change_git_settings(&review, &change, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
    }

    f.git(&["config", "extensions.worktreeConfig", "true"]);
    f.git(&["config", "--worktree", "user.name", "Worktree author"]);
    let review = repo.git_settings(None).unwrap();

    assert!(review.identity_read_only_reason.is_some());
    assert!(
        repo.change_git_settings(&review, &SettingsChange::Identity(None), None)
            .is_err()
    );
    f.git(&["remote", "add", "origin", "https://example.invalid/one.git"]);
    f.git(&[
        "config",
        "--add",
        "remote.origin.url",
        "https://example.invalid/two.git",
    ]);
    let review = repo.git_settings(None).unwrap();

    assert!(
        repo.change_git_settings(
            &review,
            &SettingsChange::EditRemote {
                name: "origin".into(),
                url: "https://example.invalid/replacement.git".into()
            },
            None
        )
        .is_err()
    );
}

#[test]
fn global_identity_is_isolated_validated_and_guarded_against_external_edits() {
    let f = Fixture::new();
    let config = f.temporary.path().join("global.gitconfig");

    let process = f
        .process()
        .with_environment([("GIT_CONFIG_GLOBAL".into(), config.as_os_str().to_owned())]);

    let global = GlobalGitIdentity::new(process.clone(), f.temporary.path().to_owned());
    let review = global.read(None).unwrap();

    assert_eq!(review.identity, CommitIdentity::default());
    let next = global
        .write(
            &review,
            &identity("Default", "default@example.invalid"),
            None,
        )
        .unwrap();

    assert_eq!(
        next.identity,
        identity("Default", "default@example.invalid")
    );
    process
        .run(GitCommand::new(
            f.temporary.path(),
            ["config", "--global", "user.name", "External"],
        ))
        .unwrap();
    assert_eq!(
        global
            .write(&next, &identity("Overwrite", "o@example.invalid"), None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    let repo = Repository::open(&f.root, process, None).unwrap();
    let inherited = repo.git_settings(None).unwrap();

    assert!(!inherited.custom());
    assert_eq!(inherited.identity.name.as_deref(), Some("External"));
}

#[test]
fn linked_worktrees_share_settings_and_stale_remote_confirmation_cannot_remove_a_changed_connection()
 {
    let f = Fixture::new();

    f.write("file", "base\n");
    f.commit("Initial");
    let linked = f.temporary.path().join("linked");

    f.git(&["worktree", "add", "-b", "feature", linked.to_str().unwrap()]);
    let repo = Repository::open(&f.root, f.process(), None).unwrap();
    let peer = Repository::open(&linked, f.process(), None).unwrap();
    let review = repo.git_settings(None).unwrap();

    repo.change_git_settings(
        &review,
        &SettingsChange::Identity(Some(identity("Shared", "shared@example.invalid"))),
        None,
    )
    .unwrap();
    assert_eq!(
        peer.git_settings(None).unwrap().identity,
        identity("Shared", "shared@example.invalid")
    );
    let review = repo.git_settings(None).unwrap();

    repo.change_git_settings(
        &review,
        &SettingsChange::AddRemote {
            name: "origin".into(),
            url: "https://example.invalid/one.git".into(),
        },
        None,
    )
    .unwrap();
    let review = repo.git_settings(None).unwrap();

    f.git(&[
        "remote",
        "set-url",
        "origin",
        "https://example.invalid/external.git",
    ]);
    assert_eq!(
        repo.change_git_settings(
            &review,
            &SettingsChange::RemoveRemote {
                name: "origin".into()
            },
            None
        )
        .unwrap_err()
        .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(
        peer.git_settings(None).unwrap().remotes[0].fetch_urls,
        ["https://example.invalid/external.git"]
    );
}

#[test]
fn failed_second_identity_key_reports_partial_write_and_requires_new_review() {
    let f = Fixture::new();

    f.git(&["config", "user.name", "Before"]);
    f.git(&["config", "--add", "user.email", "one@example.invalid"]);
    f.git(&["config", "--add", "user.email", "two@example.invalid"]);
    let repo = Repository::open(&f.root, f.process(), None).unwrap();
    let review = repo.git_settings(None).unwrap();
    let change = SettingsChange::Identity(Some(identity("After", "after@example.invalid")));

    assert_eq!(
        repo.change_git_settings(&review, &change, None)
            .unwrap_err()
            .phase,
        WritePhase::Command
    );
    assert_eq!(f.git(&["config", "user.name"]), b"After\n");
    assert_eq!(
        f.git(&["config", "--get-all", "user.email"]),
        b"one@example.invalid\ntwo@example.invalid\n"
    );
    assert_eq!(
        repo.change_git_settings(&review, &change, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
}
