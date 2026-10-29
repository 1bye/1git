//! Ports remotes-stash and repository configuration/restore/reset integration behavior.
mod common;

use common::Fixture;
use onegit_git::{
    AddRemote, Cancellation, ConfigScope, CreateTag, Repository, ResetMode, ResetOptions,
    RestoreOptions, SetRemoteUrl, StashOptions, StashReference,
};

#[test]
fn adds_renames_updates_and_removes_remotes_without_persisting_http_credentials() {
    let f = Fixture::new();
    f.write("base", "base");
    f.commit("Base");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    assert!(
        r.add_remote(
            AddRemote {
                name: "origin",
                url: "https://user:secret@example.invalid/repo",
                fetch: false
            },
            None
        )
        .is_err()
    );
    assert!(r.remotes(None).unwrap().is_empty());
    r.add_remote(
        AddRemote {
            name: "origin",
            url: "https://example.invalid/repo",
            fetch: false,
        },
        None,
    )
    .unwrap();
    r.rename_remote("origin", "upstream", None).unwrap();
    let urls = r
        .set_remote_url(
            SetRemoteUrl {
                name: "upstream",
                url: "https://example.invalid/push",
                push: true,
                add: false,
            },
            None,
        )
        .unwrap();
    assert_eq!(urls[0].fetch_urls, ["https://example.invalid/repo"]);
    assert_eq!(urls[0].push_urls, ["https://example.invalid/push"]);
    r.set_remote_url(
        SetRemoteUrl {
            name: "upstream",
            url: "https://example.invalid/other",
            push: false,
            add: true,
        },
        None,
    )
    .unwrap();
    assert_eq!(r.remotes(None).unwrap()[0].fetch_urls.len(), 2);
    assert!(r.remove_remote("upstream", None).unwrap().is_empty());
}

#[test]
fn creates_and_deletes_lightweight_and_annotated_tags_with_explicit_force() {
    let f = Fixture::new();
    f.write("base", "base");
    f.commit("Base");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let tags = r
        .create_tag(
            CreateTag {
                name: "v1",
                revision: None,
                message: Some("Release"),
                force: false,
            },
            None,
        )
        .unwrap();
    assert_eq!(tags[0].name, "v1");
    assert!(
        r.create_tag(
            CreateTag {
                name: "v1",
                revision: None,
                message: None,
                force: false
            },
            None
        )
        .is_err()
    );
    r.create_tag(
        CreateTag {
            name: "v1",
            revision: Some("HEAD"),
            message: None,
            force: true,
        },
        None,
    )
    .unwrap();
    assert!(r.delete_tag("--all", None).is_err());
    assert!(r.delete_tag("v1", None).unwrap().is_empty());
}

#[test]
fn reads_writes_and_idempotently_unsets_local_and_worktree_configuration() {
    let f = Fixture::new();
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    assert!(
        r.set_config("--global", "value", ConfigScope::Local, None)
            .is_err()
    );
    assert!(
        r.set_config("user.name", "value", ConfigScope::Effective, None)
            .is_err()
    );
    r.set_config("user.name", "Local fixture", ConfigScope::Local, None)
        .unwrap();
    assert_eq!(
        r.config("user.name", ConfigScope::Local, None)
            .unwrap()
            .value
            .as_deref(),
        Some("Local fixture")
    );
    r.unset_config("user.name", ConfigScope::Local, None)
        .unwrap();
    assert!(
        r.unset_config("user.name", ConfigScope::Local, None)
            .unwrap()
            .value
            .is_none()
    );
    r.set_config(
        "extensions.worktreeConfig",
        "true",
        ConfigScope::Local,
        None,
    )
    .unwrap();
    r.set_config(
        "onegit.fixture",
        "worktree value",
        ConfigScope::Worktree,
        None,
    )
    .unwrap();
    assert_eq!(
        r.config("onegit.fixture", ConfigScope::Worktree, None)
            .unwrap()
            .value
            .as_deref(),
        Some("worktree value")
    );
}

#[test]
fn stashes_selected_literal_paths_and_applies_pops_and_drops_entries() {
    let f = Fixture::new();
    f.write("file[1]", "base");
    f.write("other", "base");
    f.commit("Base");
    f.write("file[1]", "changed");
    f.write("other", "keep");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let paths = ["file[1]".try_into().unwrap()];
    let snapshot = r
        .stash(
            StashOptions {
                paths: Some(&paths),
                message: Some("selected"),
                ..Default::default()
            },
            None,
        )
        .unwrap();
    assert_eq!(snapshot.status.files.len(), 1);
    r.apply_stash(
        StashReference {
            reference: "stash@{0}",
            reinstate_index: false,
        },
        None,
    )
    .unwrap();
    assert_eq!(std::fs::read(f.root.join("file[1]")).unwrap(), b"changed");
    r.restore(
        RestoreOptions {
            paths: &paths,
            allow_destructive: true,
            ..Default::default()
        },
        None,
    )
    .unwrap();
    r.pop_stash(
        StashReference {
            reference: "stash@{0}",
            reinstate_index: false,
        },
        None,
    )
    .unwrap();
    assert!(r.stashes(None).unwrap().is_empty());
    r.stash(StashOptions::default(), None).unwrap();
    assert!(r.drop_stash("stash@{0}", None).unwrap().is_empty());
}

#[test]
fn restore_and_hard_reset_require_consent_and_preserve_literal_neighbors() {
    let f = Fixture::new();
    f.write("file[1]", "base");
    f.write("file1", "neighbor");
    f.commit("Base");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    f.write("file[1]", "change");
    f.write("file1", "keep");
    let paths = ["file[1]".try_into().unwrap()];
    assert!(
        r.restore(
            RestoreOptions {
                paths: &paths,
                ..Default::default()
            },
            None
        )
        .is_err()
    );
    r.restore(
        RestoreOptions {
            paths: &paths,
            allow_destructive: true,
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert_eq!(std::fs::read(f.root.join("file1")).unwrap(), b"keep");
    assert!(
        r.reset(
            ResetOptions {
                mode: ResetMode::Hard,
                ..Default::default()
            },
            None
        )
        .is_err()
    );
    r.reset(
        ResetOptions {
            mode: ResetMode::Hard,
            allow_destructive: true,
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert_eq!(std::fs::read(f.root.join("file1")).unwrap(), b"neighbor");
    let stop = Cancellation::default();
    stop.cancel();
    assert!(
        r.create_tag(
            CreateTag {
                name: "never",
                revision: None,
                message: None,
                force: false
            },
            Some(&stop)
        )
        .is_err()
    );
    assert!(r.tags(None).unwrap().is_empty());
}

#[test]
fn keeps_a_stash_when_pop_produces_conflicts() {
    let f = Fixture::new();
    f.write("file", "base\n");
    f.commit("Base");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    f.write("file", "stashed\n");
    r.stash(StashOptions::default(), None).unwrap();
    f.write("file", "committed\n");
    f.commit("Conflict");
    assert!(
        r.pop_stash(
            StashReference {
                reference: "stash@{0}",
                reinstate_index: false
            },
            None
        )
        .is_err()
    );
    assert_eq!(r.stashes(None).unwrap().len(), 1);
    assert!(
        r.snapshot(false, None)
            .unwrap()
            .status
            .files
            .iter()
            .any(|f| f.record_type == onegit_git::RecordType::Unmerged)
    );
}
#[test]
fn stash_includes_untracked_files_and_restores_saved_staging_when_requested() {
    let f = Fixture::new();
    f.write("base", "base");
    f.commit("Base");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    f.write("base", "staged");
    r.stage_all(None).unwrap();
    f.write("untracked", "untracked");
    r.stash(
        StashOptions {
            include_untracked: true,
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert!(!f.root.join("untracked").exists());
    r.apply_stash(
        StashReference {
            reference: "stash@{0}",
            reinstate_index: true,
        },
        None,
    )
    .unwrap();
    assert!(f.root.join("untracked").exists());
    assert_eq!(f.git(&["show", ":base"]), b"staged");
}

#[test]
fn stashes_only_selected_untracked_literal_names_without_consuming_the_glob_neighbor() {
    let f = Fixture::new();
    f.write("base", "base");
    f.commit("Base");
    f.write("new[1]", "selected");
    f.write("new1", "keep");
    let r = Repository::open(&f.root, f.process(), None).unwrap();
    let paths = ["new[1]".try_into().unwrap()];
    r.stash(
        StashOptions {
            include_untracked: true,
            paths: Some(&paths),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert!(!f.root.join("new[1]").exists());
    assert_eq!(std::fs::read(f.root.join("new1")).unwrap(), b"keep");
    r.pop_stash(
        StashReference {
            reference: "stash@{0}",
            reinstate_index: false,
        },
        None,
    )
    .unwrap();
    assert_eq!(std::fs::read(f.root.join("new[1]")).unwrap(), b"selected");
}
