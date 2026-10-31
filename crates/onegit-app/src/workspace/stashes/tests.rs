//! Source mapping: repository-stashes/stashes.integration.test.ts and state.unit.test.ts.
use super::*;
use crate::workspace::tests::{Fixture, contents};

fn action(
    f: &Fixture,
    action: onegit_git::StashAction,
) -> Result<onegit_git::Snapshot, onegit_git::WriteError> {
    let source = f.load();

    source.repository.change_stash(
        &onegit_git::StashRequest {
            source: onegit_git::BranchIdentity::from_snapshot(&source.snapshot),
            action,
        },
        None,
    )
}

fn save(f: &Fixture, message: &str, include_untracked: bool) -> String {
    action(
        f,
        onegit_git::StashAction::Save {
            message: message.into(),
            include_untracked,
        },
    )
    .unwrap();

    f.load().repository.stashes(None).unwrap()[0].oid.clone()
}

fn fixture() -> Fixture {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.write(".gitignore", "ignored.txt\n");
    f.commit();

    f
}

#[test]
fn creates_tracked_changes_opts_into_untracked_and_apply_keeps_saved_work() {
    let f = fixture();

    f.write("a.txt", "staged\n");
    f.git(&["add", "a.txt"]);
    f.write("a.txt", "working\n");
    f.write("new.txt", "untracked\n");
    f.write("ignored.txt", "ignored\n");
    let first = save(&f, "My work", false);

    assert_eq!(
        std::fs::read_to_string(f.root.join("a.txt")).unwrap(),
        "base\n"
    );
    assert!(f.root.join("new.txt").exists());
    save(&f, "New files", true);
    assert!(!f.root.join("new.txt").exists());
    assert!(f.root.join("ignored.txt").exists());
    action(&f, onegit_git::StashAction::Apply(first.clone())).unwrap();
    assert_eq!(
        std::fs::read_to_string(f.root.join("a.txt")).unwrap(),
        "working\n"
    );
    assert_eq!(f.load().repository.stashes(None).unwrap().len(), 2);
    let before = contents(&f.root);

    assert!(action(&f, onegit_git::StashAction::Apply(first)).is_err());
    assert_eq!(contents(&f.root), before);
}

#[test]
fn deletion_uses_reviewed_oid_after_renumbering_and_rejects_stale_head_or_missing_id() {
    let f = fixture();

    f.write("a.txt", "first\n");
    let first = save(&f, "First", false);
    let source = f.load();

    let request = onegit_git::StashRequest {
        source: onegit_git::BranchIdentity::from_snapshot(&source.snapshot),
        action: onegit_git::StashAction::Delete(first),
    };

    f.write("a.txt", "second\n");
    let second = save(&f, "Second", false);

    source.repository.change_stash(&request, None).unwrap();
    assert_eq!(source.repository.stashes(None).unwrap()[0].oid, second);
    assert!(source.repository.change_stash(&request, None).is_err());
    let request = onegit_git::StashRequest {
        action: onegit_git::StashAction::Delete(second),
        ..request
    };

    f.git(&["commit", "--allow-empty", "-m", "New HEAD"]);
    assert!(source.repository.change_stash(&request, None).is_err());
    assert_eq!(source.repository.stashes(None).unwrap().len(), 1);
}

#[test]
fn pop_removes_only_on_success_and_conflicts_keep_saved_work() {
    let f = fixture();

    f.write("a.txt", "saved\n");
    let oid = save(&f, "Saved", false);

    action(&f, onegit_git::StashAction::Pop(oid)).unwrap();
    assert!(f.load().repository.stashes(None).unwrap().is_empty());
    let oid = save(&f, "Saved again", false);

    f.write("a.txt", "other commit\n");
    f.commit();
    assert!(action(&f, onegit_git::StashAction::Pop(oid.clone())).is_err());
    assert_eq!(f.load().repository.stashes(None).unwrap()[0].oid, oid);
    assert!(
        f.load()
            .snapshot
            .status
            .files
            .iter()
            .any(|f| f.record_type == onegit_git::RecordType::Unmerged)
    );
}

#[test]
fn rejects_empty_unborn_invalid_messages_and_existing_stash_lock() {
    let unborn = Fixture::new();

    unborn.write("new.txt", "new\n");
    assert!(
        action(
            &unborn,
            onegit_git::StashAction::Save {
                message: String::new(),
                include_untracked: true
            }
        )
        .is_err()
    );
    let f = fixture();

    assert!(
        action(
            &f,
            onegit_git::StashAction::Save {
                message: String::new(),
                include_untracked: false
            }
        )
        .is_err()
    );
    f.write("a.txt", "save\n");
    assert!(
        action(
            &f,
            onegit_git::StashAction::Save {
                message: "bad\0message".into(),
                include_untracked: false
            }
        )
        .is_err()
    );
    let oid = save(&f, "Saved", false);

    std::fs::write(f.root.join(".git/refs/stash.lock"), "someone else's lock").unwrap();
    assert!(action(&f, onegit_git::StashAction::Delete(oid)).is_err());
    assert_eq!(
        std::fs::read_to_string(f.root.join(".git/refs/stash.lock")).unwrap(),
        "someone else's lock"
    );
    std::fs::remove_file(f.root.join(".git/refs/stash.lock")).unwrap();
}

#[test]
fn packed_last_stash_deletion_preserves_head_index_and_working_files() {
    let f = fixture();

    f.write("a.txt", "saved\n");
    let oid = save(&f, "Saved", false);

    f.git(&["pack-refs", "--all", "--prune"]);
    let head = f.git(&["rev-parse", "HEAD"]);
    let index = std::fs::read(f.root.join(".git/index")).unwrap();

    f.write("new.txt", "keep\n");
    action(&f, onegit_git::StashAction::Delete(oid)).unwrap();
    assert!(f.load().repository.stashes(None).unwrap().is_empty());
    assert_eq!(f.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
    assert_eq!(
        std::fs::read_to_string(f.root.join("new.txt")).unwrap(),
        "keep\n"
    );
    assert!(!f.root.join(".git/refs/stash.lock").exists());
}

#[test]
fn previews_tracked_and_untracked_snapshots_without_mutating_repository_bytes() {
    let f = fixture();

    f.write("a.txt", "saved tracked\n");
    f.write("café [one]\tline\n.txt", "saved untracked\n");
    let oid = save(&f, "Snapshots", true);

    f.write("a.txt", "later\n");
    f.git(&["add", "a.txt"]);
    let source = f.load();
    let before = contents(&f.root);

    let files = read::files(
        &source.repository,
        &oid,
        &onegit_git::Cancellation::default(),
    )
    .unwrap();

    assert_eq!(files.len(), 2);

    for file in &files {
        let Preview::Patch(document) = read::patch(
            &source.repository,
            file,
            &onegit_git::Cancellation::default(),
        )
        .unwrap() else {
            panic!("expected text patch")
        };

        assert!(document.patch().contains("+saved "));
    }

    assert_eq!(contents(&f.root), before);
}

#[test]
fn rejects_duplicate_stash_ids_invalid_reflogs_and_foreign_log_locks_without_data_loss() {
    let f = fixture();

    f.write("a.txt", "saved\n");
    let oid = save(&f, "Saved", false);

    f.write("a.txt", "another saved version\n");
    save(&f, "Intervening", false);
    f.git(&["stash", "store", "-m", "Duplicate", &oid]);
    let before = contents(&f.root);

    assert!(action(&f, onegit_git::StashAction::Delete(oid.clone())).is_err());
    assert_eq!(contents(&f.root), before);
    f.git(&["stash", "drop", "stash@{0}"]);
    let log = f.root.join(".git/logs/refs/stash");
    let valid = std::fs::read(&log).unwrap();

    std::fs::write(&log, b"invalid\n").unwrap();
    let before = contents(&f.root);

    assert!(action(&f, onegit_git::StashAction::Delete(oid.clone())).is_err());
    assert_eq!(contents(&f.root), before);
    std::fs::write(&log, valid).unwrap();
    std::fs::write(f.root.join(".git/logs/refs/stash.lock"), "foreign lock").unwrap();
    let before = contents(&f.root);

    assert!(action(&f, onegit_git::StashAction::Delete(oid)).is_err());
    assert_eq!(contents(&f.root), before);
}

#[test]
fn deleting_middle_stash_preserves_neighbor_order_messages_and_reflog_identity_bytes() {
    let f = fixture();

    f.write("a.txt", "first\n");
    let first = save(&f, "First été", false);

    f.write("a.txt", "middle\n");
    let middle = save(&f, "Middle", false);

    f.write("a.txt", "last\n");
    let last = save(&f, "Last", false);

    action(&f, onegit_git::StashAction::Delete(middle)).unwrap();
    let entries = f.load().repository.stashes(None).unwrap();

    assert_eq!(
        entries.iter().map(|s| s.oid.clone()).collect::<Vec<_>>(),
        vec![last, first]
    );
    assert!(entries[1].summary.contains("First été"));
    assert_eq!(entries[1].reference, "stash@{1}");
    assert!(
        String::from_utf8(f.git(&["fsck", "--no-reflogs"]))
            .unwrap()
            .contains("dangling commit")
    );
}

#[test]
fn cancelled_stash_request_does_not_start_a_write_or_leave_locks() {
    let f = fixture();

    f.write("a.txt", "saved\n");
    let source = f.load();
    let before = contents(&f.root);
    let cancel = onegit_git::Cancellation::default();

    cancel.cancel();
    assert!(
        source
            .repository
            .change_stash(
                &onegit_git::StashRequest {
                    source: onegit_git::BranchIdentity::from_snapshot(&source.snapshot),
                    action: onegit_git::StashAction::Save {
                        message: String::new(),
                        include_untracked: false
                    }
                },
                Some(&cancel)
            )
            .is_err()
    );
    assert_eq!(contents(&f.root), before);
}

#[cfg(unix)]
fn intercepted_repository(
    f: &Fixture,
    script_body: &str,
    oid: &str,
) -> (onegit_git::Repository, std::path::PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let script = f.directory.path().join("git-interceptor");
    let marker = f.directory.path().join("race-result");

    std::fs::write(
        &script,
        format!("#!/bin/sh\n{script_body}\nexec /usr/bin/git \"$@\"\n"),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let process = onegit_git::GitProcess::new(script, 16 * 1024 * 1024).with_environment([
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_COMMITTER_NAME".into(), "Fixture".into()),
        (
            "GIT_COMMITTER_EMAIL".into(),
            "fixture@example.invalid".into(),
        ),
        (
            "ONEGIT_STASH_RACE_ROOT".into(),
            f.root.as_os_str().to_owned(),
        ),
        (
            "ONEGIT_STASH_RACE_MARKER".into(),
            marker.as_os_str().to_owned(),
        ),
        ("ONEGIT_STASH_RACE_OID".into(), oid.into()),
    ]);

    (
        onegit_git::Repository::open(&f.root, process, None).unwrap(),
        marker,
    )
}

#[cfg(unix)]
#[test]
fn git_stash_lock_excludes_an_external_writer_during_reviewed_identity_lookup() {
    let f = fixture();

    f.write("a.txt", "first\n");
    let first = save(&f, "First", false);

    f.write("a.txt", "second\n");
    let second = save(&f, "Second", false);

    let (repository, marker) = intercepted_repository(
        &f,
        r#"case "$*" in *"stash list"*)
if test -e "$ONEGIT_STASH_RACE_ROOT/.git/refs/stash.lock" && ! test -e "$ONEGIT_STASH_RACE_MARKER"; then
  if /usr/bin/git -C "$ONEGIT_STASH_RACE_ROOT" stash store -m Concurrent "$ONEGIT_STASH_RACE_OID"; then printf allowed > "$ONEGIT_STASH_RACE_MARKER"; else printf blocked > "$ONEGIT_STASH_RACE_MARKER"; fi
fi;; esac"#,
        &first,
    );

    repository
        .change_stash(
            &onegit_git::StashRequest {
                source: onegit_git::BranchIdentity::from_snapshot(&f.load().snapshot),
                action: onegit_git::StashAction::Delete(first),
            },
            None,
        )
        .unwrap();
    assert_eq!(std::fs::read_to_string(marker).unwrap(), "blocked");
    assert_eq!(
        repository
            .stashes(None)
            .unwrap()
            .iter()
            .map(|s| s.oid.clone())
            .collect::<Vec<_>>(),
        vec![second]
    );
    assert!(!f.root.join(".git/refs/stash.lock").exists());
}

#[cfg(unix)]
#[test]
fn final_ref_cleanup_keeps_a_new_stash_inserted_by_an_external_client() {
    let f = fixture();

    f.write("a.txt", "first\n");
    let first = save(&f, "First", false);

    f.write("a.txt", "concurrent saved work\n");
    let next = String::from_utf8(f.git(&["stash", "create"]))
        .unwrap()
        .trim()
        .to_owned();

    let (repository, marker) = intercepted_repository(
        &f,
        r#"case "$*" in *"update-ref --no-deref -d refs/stash"*)
if ! test -e "$ONEGIT_STASH_RACE_MARKER"; then
  /usr/bin/git -C "$ONEGIT_STASH_RACE_ROOT" stash store -m Concurrent "$ONEGIT_STASH_RACE_OID" || exit 1
  printf inserted > "$ONEGIT_STASH_RACE_MARKER"
fi;; esac"#,
        &next,
    );

    repository
        .change_stash(
            &onegit_git::StashRequest {
                source: onegit_git::BranchIdentity::from_snapshot(&f.load().snapshot),
                action: onegit_git::StashAction::Delete(first),
            },
            None,
        )
        .unwrap();
    assert_eq!(std::fs::read_to_string(marker).unwrap(), "inserted");
    assert_eq!(
        repository
            .stashes(None)
            .unwrap()
            .iter()
            .map(|s| s.oid.clone())
            .collect::<Vec<_>>(),
        vec![next]
    );
    assert!(!f.root.join(".git/refs/stash.lock").exists());
}

#[test]
fn pop_cleanup_failure_reports_partial_completion_and_keeps_the_saved_copy() {
    let f = fixture();

    f.write("a.txt", "saved\n");
    let oid = save(&f, "Saved", false);

    std::fs::write(f.root.join(".git/refs/stash.lock"), "foreign lock").unwrap();
    let error = action(&f, onegit_git::StashAction::Pop(oid.clone())).unwrap_err();

    assert_eq!(error.phase, onegit_git::WritePhase::Refresh);
    assert_eq!(
        std::fs::read_to_string(f.root.join("a.txt")).unwrap(),
        "saved\n"
    );
    assert_eq!(f.load().repository.stashes(None).unwrap()[0].oid, oid);
    assert_eq!(
        std::fs::read_to_string(f.root.join(".git/refs/stash.lock")).unwrap(),
        "foreign lock"
    );
}

#[test]
fn tracked_and_saved_untracked_versions_with_the_same_path_have_distinct_previews() {
    let f = fixture();

    f.git(&["rm", "--cached", "a.txt"]);
    f.write("a.txt", "saved untracked version\n");
    let oid = save(&f, "Both versions", true);
    let source = f.load();
    let before = contents(&f.root);

    let files = read::files(
        &source.repository,
        &oid,
        &onegit_git::Cancellation::default(),
    )
    .unwrap();

    assert_eq!(files.len(), 2);
    assert_eq!(files[0].file.path, files[1].file.path);
    assert_ne!(files[0].revision, files[1].revision);
    let patches: Vec<_> = files
        .iter()
        .map(|file| {
            match read::patch(
                &source.repository,
                file,
                &onegit_git::Cancellation::default(),
            )
            .unwrap()
            {
                Preview::Patch(doc) => doc.patch().to_owned(),
                _ => panic!(),
            }
        })
        .collect();

    assert!(patches.iter().any(|p| p.contains("-base")));
    assert!(
        patches
            .iter()
            .any(|p| p.contains("+saved untracked version"))
    );
    assert_eq!(contents(&f.root), before);
}
